import { randomBytes } from "node:crypto";
import type { Browser, Frame, Page, Request } from "playwright-core";
import { chromium } from "playwright-core";

const POST_SUBMIT_WAIT_MS = 12_000;
const PAGE_LOAD_TIMEOUT_MS = 25_000;
const FIELD_FILL_TIMEOUT_MS = 2_500;
const SUBMIT_TIMEOUT_MS = 3_000;

const SUBMISSION_METHODS = new Set(["POST", "PUT", "PATCH"]);
const FIELD_KEYS = ["xHandle", "wallet", "email", "name"] as const;
const ANALYTICS_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "cloudflareinsights.com",
  "sentry.io",
  "segment.io",
  "mixpanel.com",
  "amplitude.com",
  "doubleclick.net",
];

type FieldKey = (typeof FIELD_KEYS)[number];

export type BrowserlessAuditVerdict = "YES" | "NO_EVIDENCE" | "INCONCLUSIVE";

export interface AuditDummyData {
  marker: string;
  xHandle: string;
  wallet: string;
  email: string;
  name: string;
}

export interface AuditStep {
  label: string;
  status: "done" | "failed" | "skipped";
}

export interface AuditDebugState {
  pageLoaded: boolean;
  formDetected: boolean;
  fieldsFilledCount: number;
  submitClicked: boolean;
  requestsObserved: number;
  analyticsIgnored: number;
  relevantRequests: number;
  matchingRequests: number;
}

export interface StatusChainItem {
  status: number;
  url: string;
}

export interface BrowserlessAuditResponse {
  verdict: BrowserlessAuditVerdict;
  message: string;
  confidence?: "HIGH";
  auditId: string;
  targetUrl: string;
  dummyData: AuditDummyData;
  filledFields: Record<FieldKey, boolean>;
  matchedFields: FieldKey[];
  request?: {
    method: string;
    endpoint: string;
    endpointDomain: string;
  };
  status?: number | null;
  statusChain?: StatusChainItem[];
  reason?: string;
  debug: AuditDebugState;
  steps: AuditStep[];
}

interface CandidateField {
  frameIndex: number;
  fieldIndex: number;
  category: FieldKey;
  score: number;
}

interface FillableField {
  index: number;
  text: string;
  type: string;
  visible: boolean;
  disabled: boolean;
  readOnly: boolean;
}

interface SubmitControl {
  index: number;
  text: string;
  type: string;
  disabled: boolean;
  visible: boolean;
  score: number;
}

interface MatchedRequest {
  request: Request;
  url: string;
  method: string;
  endpointDomain: string;
  matchedFields: FieldKey[];
  markerMatched: boolean;
  timestamp: number;
  graphqlMutation: boolean;
  status: number | null;
  statusChain: StatusChainItem[];
}

interface AuditContext {
  auditId: string;
  targetUrl: URL;
  dummyData: AuditDummyData;
  filledFields: Record<FieldKey, boolean>;
  steps: AuditStep[];
  debug: AuditDebugState;
}

export async function runBrowserlessAudit(targetUrl: URL): Promise<BrowserlessAuditResponse> {
  const auditId = randomBytes(4).toString("hex");
  const context: AuditContext = {
    auditId,
    targetUrl,
    dummyData: buildDummyData(auditId),
    filledFields: emptyFilledFields(),
    steps: [],
    debug: {
      pageLoaded: false,
      formDetected: false,
      fieldsFilledCount: 0,
      submitClicked: false,
      requestsObserved: 0,
      analyticsIgnored: 0,
      relevantRequests: 0,
      matchingRequests: 0,
    },
  };

  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) {
    return inconclusive(context, "BROWSERLESS_TOKEN is not configured on the server.");
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(buildBrowserlessEndpoint(token), { timeout: 20_000 });

    const browserContext = browser.contexts()[0] || (await browser.newContext());
    const page = await browserContext.newPage();
    const matchedRequests: MatchedRequest[] = [];
    const requestMap = new Map<Request, MatchedRequest>();
    const auditStartedAt = Date.now();

    page.on("request", (request) => {
      if (Date.now() < auditStartedAt) {
        return;
      }

      context.debug.requestsObserved += 1;
      if (isAnalyticsUrl(request.url())) {
        context.debug.analyticsIgnored += 1;
        return;
      }

      const match = inspectRequest(request, context.dummyData);
      if (!match) {
        return;
      }

      context.debug.relevantRequests += 1;
      if (!match.markerMatched) {
        return;
      }

      matchedRequests.push(match);
      requestMap.set(request, match);
      context.debug.matchingRequests = matchedRequests.length;
    });

    page.on("response", (response) => {
      const match = findTrackedMatch(response.request(), requestMap);
      if (!match) {
        return;
      }

      match.statusChain.push({
        status: response.status(),
        url: response.url(),
      });
      match.status = match.status ?? response.status();
    });

    mark(context, "Opening page", "done");
    const loaded = await openTarget(page, targetUrl);
    if (!loaded.ok) {
      mark(context, "Opening page", "failed");
      return inconclusive(context, loaded.reason || "Page failed to load.");
    }
    context.debug.pageLoaded = true;

    const blockerBeforeFill = await detectBlocker(page);
    if (blockerBeforeFill) {
      mark(context, "Detecting form", "failed");
      return inconclusive(context, blockerBeforeFill);
    }

    const filled = await fillDetectedFields(page, context.dummyData);
    context.debug.formDetected = filled.formDetected;
    context.debug.fieldsFilledCount = filled.filledFields.length;
    context.filledFields = toFilledFields(filled.filledFields);

    if (!filled.formDetected) {
      mark(context, "Detecting form", "failed");
      return inconclusive(context, "No supported form field was detected.");
    }
    mark(context, "Detecting form", "done");

    if (filled.filledFields.length === 0) {
      mark(context, "Filling dummy data", "failed");
      return inconclusive(context, "Supported fields were found, but dummy data could not be filled.");
    }
    mark(context, "Filling dummy data", "done");

    const blockerBeforeSubmit = await detectBlocker(page);
    if (blockerBeforeSubmit) {
      mark(context, "Submitting", "failed");
      return inconclusive(context, blockerBeforeSubmit);
    }

    const submitted = await clickSubmit(page);
    if (!submitted.ok) {
      mark(context, "Submitting", "failed");
      return inconclusive(context, submitted.reason || "No supported submit button was detected.");
    }

    context.debug.submitClicked = true;
    mark(context, "Submitting", "done");

    await page.waitForTimeout(POST_SUBMIT_WAIT_MS);
    mark(context, "Inspecting requests", "done");

    const winner = matchedRequests[0];
    if (winner) {
      mark(context, "Result", "done");
      return {
        verdict: "YES",
        message: "DATA SENT TO SERVER",
        confidence: "HIGH",
        auditId,
        targetUrl: targetUrl.toString(),
        dummyData: context.dummyData,
        filledFields: context.filledFields,
        matchedFields: winner.matchedFields,
        request: {
          method: winner.method,
          endpoint: winner.url,
          endpointDomain: winner.endpointDomain,
        },
        status: winner.status,
        statusChain: winner.statusChain,
        debug: context.debug,
        steps: context.steps,
      };
    }

    mark(context, "Result", "done");
    return {
      verdict: "NO_EVIDENCE",
      message: "No matching server submission detected.",
      auditId,
      targetUrl: targetUrl.toString(),
      dummyData: context.dummyData,
      filledFields: context.filledFields,
      matchedFields: [],
      debug: context.debug,
      steps: context.steps,
    };
  } catch (error) {
    return inconclusive(context, error instanceof Error ? error.message : "Browser automation failed.");
  } finally {
    await browser?.close().catch(() => {});
  }
}

function buildBrowserlessEndpoint(token: string) {
  if (process.env.BROWSERLESS_WS_ENDPOINT) {
    const endpoint = new URL(process.env.BROWSERLESS_WS_ENDPOINT);
    if (!endpoint.searchParams.has("token")) {
      endpoint.searchParams.set("token", token);
    }
    return endpoint.toString();
  }

  const endpoint = new URL("wss://production-sfo.browserless.io");
  endpoint.searchParams.set("token", token);
  return endpoint.toString();
}

async function openTarget(page: Page, targetUrl: URL) {
  try {
    await page.goto(targetUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? `Page failed to load: ${error.message}` : "Page failed to load.",
    };
  }
}

async function fillDetectedFields(page: Page, dummyData: AuditDummyData) {
  const frames = page.frames();
  const candidates: CandidateField[] = [];
  const fieldsByFrame: FillableField[][] = [];

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const fields = await getFillableFields(frames[frameIndex]).catch(() => [] as FillableField[]);
    fieldsByFrame.push(fields);
    for (const field of fields) {
      for (const category of FIELD_KEYS) {
        const score = scoreField(field, category);
        if (score > 0) {
          candidates.push({ frameIndex, fieldIndex: field.index, category, score });
        }
      }
    }
  }

  const filledFields: FieldKey[] = [];
  const usedDomFields = new Set<string>();
  const usedCategories = new Set<FieldKey>();

  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const fieldKey = `${candidate.frameIndex}:${candidate.fieldIndex}`;
    if (usedDomFields.has(fieldKey) || usedCategories.has(candidate.category)) {
      continue;
    }

    const filled = await frames[candidate.frameIndex]
      .locator("input, textarea")
      .nth(candidate.fieldIndex)
      .fill(dummyData[candidate.category], { timeout: FIELD_FILL_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);

    if (filled) {
      usedDomFields.add(fieldKey);
      usedCategories.add(candidate.category);
      filledFields.push(candidate.category);
    }
  }

  return {
    formDetected: candidates.length > 0,
    fieldsDetectedCount: candidates.length,
    filledFields,
    fieldsByFrame,
  };
}

async function getFillableFields(frame: Frame): Promise<FillableField[]> {
  return frame.locator("input, textarea").evaluateAll((elements) =>
    elements.map((element, index) => {
      const input = element as HTMLInputElement | HTMLTextAreaElement;
      const rect = input.getBoundingClientRect();
      const style = window.getComputedStyle(input);
      const id = input.id || "";
      let forLabel = "";
      try {
        forLabel = id
          ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || ""
          : "";
      } catch {
        forLabel = "";
      }

      const nearby = [
        input.closest("label")?.textContent || "",
        input.parentElement?.textContent || "",
        input.parentElement?.previousElementSibling?.textContent || "",
      ].join(" ");

      return {
        index,
        type: "type" in input ? (input.type || "text").toLowerCase() : "textarea",
        text: [
          input.getAttribute("name") || "",
          input.id || "",
          input.getAttribute("placeholder") || "",
          input.getAttribute("aria-label") || "",
          forLabel,
          nearby,
        ]
          .join(" ")
          .toLowerCase(),
        disabled: input.disabled,
        readOnly: input.readOnly,
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none",
      };
    }),
  );
}

function scoreField(field: FillableField, category: FieldKey) {
  if (!field.visible || field.disabled || field.readOnly) {
    return 0;
  }

  const textTypes = new Set(["", "text", "search", "url", "email", "tel", "textarea"]);
  if (!textTypes.has(field.type)) {
    return 0;
  }

  if (category === "email" && field.type === "email") {
    return 20;
  }

  const patterns: Record<FieldKey, RegExp[]> = {
    xHandle: [/\bx handle\b/i, /\bx username\b/i, /\btwitter\b/i, /\bhandle\b/i],
    wallet: [/\bwallet address\b/i, /\bevm address\b/i, /\bwallet\b/i, /\baddress\b/i, /\b0x\b/i],
    email: [/\be-mail\b/i, /\bemail\b/i],
    name: [/\bfull name\b/i, /\bname\b/i],
  };

  const matchIndex = patterns[category].findIndex((pattern) => pattern.test(field.text));
  return matchIndex === -1 ? 0 : 15 - matchIndex;
}

async function clickSubmit(page: Page) {
  const frames = page.frames();
  for (const frame of frames) {
    const quickButton = frame
      .locator('button, input[type="submit"], input[type="button"], [role="button"]')
      .filter({ hasText: submitButtonNamePattern })
      .first();

    const clicked = await quickButton
      .click({ timeout: SUBMIT_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (clicked) {
      return { ok: true };
    }
  }

  for (const frame of frames) {
    const controls = await getSubmitControls(frame).catch(() => [] as SubmitControl[]);
    const preferred = controls
      .filter((control) => control.visible && !control.disabled && control.score > 0)
      .filter((control) => !unsafeActionPattern.test(control.text))
      .sort((a, b) => b.score - a.score)[0];

    if (!preferred) {
      continue;
    }

    const clicked = await frame
      .locator('button, input[type="submit"], input[type="button"], [role="button"]')
      .nth(preferred.index)
      .click({ timeout: SUBMIT_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (clicked) {
      return { ok: true };
    }

    const dispatched = await frame
      .locator('button, input[type="submit"], input[type="button"], [role="button"]')
      .nth(preferred.index)
      .evaluate((element) => {
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      })
      .then(() => true)
      .catch(() => false);
    if (dispatched) {
      return { ok: true };
    }
  }

  const blocker = await detectBlocker(page);
  return { ok: false, reason: blocker || "No supported submit button was detected." };
}

async function getSubmitControls(frame: Frame): Promise<SubmitControl[]> {
  return frame
    .locator('button, input[type="submit"], input[type="button"], [role="button"]')
    .evaluateAll((elements) =>
      elements.map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const input = element as HTMLInputElement;
        const type = input.type || element.getAttribute("type") || "";
        const text = [
          element.textContent || "",
          input.value || "",
          element.getAttribute("aria-label") || "",
          element.getAttribute("title") || "",
        ]
          .join(" ")
          .trim()
          .toLowerCase();

        const textScore = submitPatterns.reduce((score, pattern, patternIndex) => {
          return pattern.test(text) ? Math.max(score, 20 - patternIndex) : score;
        }, 0);

        return {
          index,
          text,
          type: type.toLowerCase(),
          disabled: input.disabled || element.getAttribute("aria-disabled") === "true",
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none",
          score: textScore + (type.toLowerCase() === "submit" ? 10 : 0),
        };
      }),
    );
}

async function detectBlocker(page: Page) {
  const text = await page
    .locator("body")
    .innerText({ timeout: 2_000 })
    .then((value) => value.toLowerCase())
    .catch(() => "");

  const frameUrls = page.frames().map((frame) => frame.url().toLowerCase()).join(" ");
  const combined = `${text} ${frameUrls}`;

  if (/captcha|recaptcha|hcaptcha|turnstile|cf-challenge/.test(combined)) {
    return "CAPTCHA blocks submission.";
  }
  if (/\blog in\b|\blogin\b|\bsign in\b/.test(combined)) {
    return "Login is required.";
  }
  if (/connect wallet|walletconnect|metamask|sign message|signature required|sign transaction/.test(combined)) {
    return "Wallet connection or signature is required.";
  }

  return "";
}

function inspectRequest(request: Request, dummyData: AuditDummyData): MatchedRequest | null {
  const searchableText = buildSearchableRequestText(request);
  const graphqlMutation = /\bmutation\b/i.test(searchableText);
  const method = request.method().toUpperCase();

  if (!SUBMISSION_METHODS.has(method) && !graphqlMutation) {
    return null;
  }

  const matchedFields = detectMatchedFields(searchableText, dummyData);
  const markerMatched = markerVariants(dummyData.marker).some((variant) => searchableText.includes(variant));

  return {
    request,
    url: request.url(),
    method,
    endpointDomain: safeDomain(request.url()),
    matchedFields,
    markerMatched,
    timestamp: Date.now(),
    graphqlMutation,
    status: null,
    statusChain: [],
  };
}

function buildSearchableRequestText(request: Request) {
  const parts = new Set<string>();
  addDecodedVariants(parts, request.url());

  const requestUrl = safeCall(() => new URL(request.url()));
  if (requestUrl) {
    for (const [key, value] of requestUrl.searchParams.entries()) {
      addDecodedVariants(parts, key);
      addDecodedVariants(parts, value);
    }
  }

  const postData = safeCall(() => request.postData()) || "";
  addDecodedVariants(parts, postData);
  addFormUrlEncodedParts(parts, postData);

  const postDataBuffer = safeCall(() => request.postDataBuffer());
  if (postDataBuffer) {
    const bufferText = Buffer.from(postDataBuffer).toString("utf8");
    addDecodedVariants(parts, bufferText);
    addFormUrlEncodedParts(parts, bufferText);
  }

  const postDataJson = safeCall(() => request.postDataJSON());
  if (postDataJson) {
    addDecodedVariants(parts, JSON.stringify(postDataJson));
  }

  return Array.from(parts).join("\n");
}

function addFormUrlEncodedParts(parts: Set<string>, value: string) {
  if (!value || !value.includes("=")) {
    return;
  }

  try {
    for (const [key, fieldValue] of new URLSearchParams(value).entries()) {
      addDecodedVariants(parts, key);
      addDecodedVariants(parts, fieldValue);
    }
  } catch {
    return;
  }
}

function addDecodedVariants(parts: Set<string>, value: string) {
  if (!value) {
    return;
  }

  parts.add(value);
  parts.add(value.replace(/\+/g, " "));

  let decoded = value;
  for (let index = 0; index < 2; index += 1) {
    try {
      decoded = decodeURIComponent(decoded);
      parts.add(decoded);
      parts.add(decoded.replace(/\+/g, " "));
    } catch {
      break;
    }
  }
}

function detectMatchedFields(text: string, dummyData: AuditDummyData): FieldKey[] {
  return FIELD_KEYS.filter((key) => markerVariants(dummyData[key]).some((variant) => text.includes(variant)));
}

function markerVariants(value: string) {
  return [value, encodeURIComponent(value), encodeURI(value), value.replace(/\s/g, "+")];
}

function findTrackedMatch(request: Request, requestMap: Map<Request, MatchedRequest>) {
  let current: Request | null = request;
  while (current) {
    const match = requestMap.get(current);
    if (match) {
      return match;
    }
    current = current.redirectedFrom();
  }
  return null;
}

function isAnalyticsUrl(url: string) {
  const hostname = safeDomain(url).replace(/^www\./, "");
  return ANALYTICS_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function safeDomain(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function safeCall<T>(callback: () => T) {
  try {
    return callback();
  } catch {
    return null;
  }
}

function buildDummyData(auditId: string): AuditDummyData {
  return {
    marker: auditId,
    xHandle: `audit_x_${auditId}`,
    wallet: `0x${"1".repeat(32)}${auditId}`,
    email: `audit_${auditId}@example.invalid`,
    name: `Audit ${auditId}`,
  };
}

function emptyFilledFields(): Record<FieldKey, boolean> {
  return {
    xHandle: false,
    wallet: false,
    email: false,
    name: false,
  };
}

function toFilledFields(fields: FieldKey[]) {
  const filledFields = emptyFilledFields();
  for (const field of fields) {
    filledFields[field] = true;
  }
  return filledFields;
}

function inconclusive(context: AuditContext, reason: string): BrowserlessAuditResponse {
  mark(context, "Result", "failed");
  return {
    verdict: "INCONCLUSIVE",
    message: "COULDN'T VERIFY",
    auditId: context.auditId,
    targetUrl: context.targetUrl.toString(),
    dummyData: context.dummyData,
    filledFields: context.filledFields,
    matchedFields: [],
    reason,
    debug: context.debug,
    steps: context.steps,
  };
}

function mark(context: AuditContext, label: string, status: AuditStep["status"]) {
  const existing = context.steps.find((step) => step.label === label);
  if (existing) {
    existing.status = status;
    return;
  }

  context.steps.push({ label, status });
}

const submitPatterns = [
  /\bjoin apelist\b/i,
  /\bjoin whitelist\b/i,
  /\bjoin waitlist\b/i,
  /\bsubmit\b/i,
  /\bapply\b/i,
  /\bregister\b/i,
  /\bsend\b/i,
  /\bjoin\b/i,
];
const submitButtonNamePattern = /join apelist|join whitelist|join waitlist|submit|apply|register|send|join/i;
const unsafeActionPattern = /\b(connect|metamask|walletconnect|sign message|signature|transaction)\b/i;
