import { randomBytes, randomUUID } from "node:crypto";
import type { Browser, Frame, Page, Request } from "playwright-core";
import { chromium } from "playwright-core";

const POST_SUBMIT_WAIT_MS = 10_000;
const PAGE_LOAD_TIMEOUT_MS = 25_000;
const FIELD_FILL_TIMEOUT_MS = 2_500;
const SUBMIT_TIMEOUT_MS = 3_000;

const SUBMISSION_METHODS = new Set(["POST", "PUT", "PATCH"]);
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

export type BrowserlessAuditVerdict = "YES" | "NO_EVIDENCE" | "INCONCLUSIVE";

export interface BrowserlessAuditResponse {
  verdict: BrowserlessAuditVerdict;
  message: string;
  targetUrl: string;
  method?: string;
  endpoint?: string;
  endpointDomain?: string;
  status?: number | null;
  detectedMarkers?: string[];
  auditId: string;
  reason?: string;
  dummy?: AuditDummyData;
  steps: AuditStep[];
}

interface AuditDummyData {
  marker: string;
  wallet: string;
  twitter: string;
  email: string;
  name: string;
}

interface AuditStep {
  label: string;
  status: "done" | "failed" | "skipped";
}

interface CandidateField {
  frameIndex: number;
  fieldIndex: number;
  category: keyof Omit<AuditDummyData, "marker">;
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

interface MatchedRequest {
  request: Request;
  url: string;
  method: string;
  endpointDomain: string;
  postData: string;
  detectedMarkers: string[];
  timestamp: number;
  graphqlMutation: boolean;
  status: number | null;
}

interface AuditContext {
  auditId: string;
  targetUrl: URL;
  dummy: AuditDummyData;
  steps: AuditStep[];
}

export async function runBrowserlessAudit(targetUrl: URL): Promise<BrowserlessAuditResponse> {
  const auditId = randomUUID();
  const context: AuditContext = {
    auditId,
    targetUrl,
    dummy: buildDummyData(auditId),
    steps: [],
  };

  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) {
    return inconclusive(context, "BROWSERLESS_TOKEN is not configured on the server.");
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(buildBrowserlessEndpoint(token), { timeout: 20_000 });
    mark(context, "Opening website", "done");

    const browserContext = browser.contexts()[0] || (await browser.newContext());
    const page = await browserContext.newPage();
    const matchedRequests: MatchedRequest[] = [];
    const requestMap = new Map<Request, MatchedRequest>();
    const auditStartedAt = Date.now();

    page.on("request", (request) => {
      const match = inspectRequest(request, context.dummy, auditStartedAt);
      if (!match) {
        return;
      }
      matchedRequests.push(match);
      requestMap.set(request, match);
    });

    page.on("response", (response) => {
      const match = requestMap.get(response.request());
      if (match) {
        match.status = response.status();
      }
    });

    const loaded = await openTarget(page, targetUrl);
    if (!loaded.ok) {
      mark(context, "Opening website", "failed");
      return inconclusive(context, loaded.reason || "Page failed to load.");
    }

    const blockerBeforeFill = await detectBlocker(page);
    if (blockerBeforeFill) {
      mark(context, "Detecting form", "failed");
      return inconclusive(context, blockerBeforeFill);
    }

    const filled = await fillDetectedFields(page, context.dummy);
    if (!filled.formFound) {
      mark(context, "Detecting form", "failed");
      return inconclusive(context, "Form could not be found.");
    }

    mark(context, "Detecting form", "done");
    if (filled.filledCategories.length === 0) {
      mark(context, "Filling dummy values", "failed");
      return inconclusive(context, "Form fields were found, but dummy values could not be filled.");
    }
    mark(context, "Filling dummy values", "done");

    const blockerBeforeSubmit = await detectBlocker(page);
    if (blockerBeforeSubmit) {
      mark(context, "Submitting", "failed");
      return inconclusive(context, blockerBeforeSubmit);
    }

    const submitted = await clickSubmit(page);
    if (!submitted.ok) {
      mark(context, "Submitting", "failed");
      return inconclusive(context, submitted.reason || "Submit button could not be found.");
    }
    mark(context, "Submitting", "done");

    await page.waitForTimeout(POST_SUBMIT_WAIT_MS);
    mark(context, "Inspecting network", "done");

    const winner = matchedRequests[0];
    if (winner) {
      return {
        verdict: "YES",
        message: "DATA SENT TO SERVER",
        targetUrl: targetUrl.toString(),
        method: winner.method,
        endpoint: winner.url,
        endpointDomain: winner.endpointDomain,
        status: winner.status,
        detectedMarkers: winner.detectedMarkers,
        auditId,
        dummy: context.dummy,
        steps: context.steps,
      };
    }

    return {
      verdict: "NO_EVIDENCE",
      message: "No matching server submission detected.",
      targetUrl: targetUrl.toString(),
      auditId,
      dummy: context.dummy,
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

async function fillDetectedFields(page: Page, dummy: AuditDummyData) {
  const frames = page.frames();
  const allCandidates: CandidateField[] = [];
  const frameFields: FillableField[][] = [];

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const fields = await getFillableFields(frames[frameIndex]).catch(() => [] as FillableField[]);
    frameFields.push(fields);
    for (const field of fields) {
      for (const category of ["wallet", "twitter", "email", "name"] as const) {
        const score = scoreField(field, category);
        if (score > 0) {
          allCandidates.push({ frameIndex, fieldIndex: field.index, category, score });
        }
      }
    }
  }

  const formFound = frameFields.some((fields) => fields.length > 0);
  const filledCategories: string[] = [];
  const usedFields = new Set<string>();
  const usedCategories = new Set<string>();

  const candidates = allCandidates.sort((a, b) => b.score - a.score);
  for (const candidate of candidates) {
    const fieldKey = `${candidate.frameIndex}:${candidate.fieldIndex}`;
    if (usedFields.has(fieldKey) || usedCategories.has(candidate.category)) {
      continue;
    }

    const frame = frames[candidate.frameIndex];
    const value = dummy[candidate.category];
    const filled = await frame
      .locator("input, textarea")
      .nth(candidate.fieldIndex)
      .fill(value, { timeout: FIELD_FILL_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);

    if (filled) {
      usedFields.add(fieldKey);
      usedCategories.add(candidate.category);
      filledCategories.push(candidate.category);
    }
  }

  if (filledCategories.length === 0) {
    const fallback = firstVisibleField(frameFields);
    if (fallback) {
      const filled = await frames[fallback.frameIndex]
        .locator("input, textarea")
        .nth(fallback.fieldIndex)
        .fill(dummy.wallet, { timeout: FIELD_FILL_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
      if (filled) {
        filledCategories.push("wallet");
      }
    }
  }

  return { formFound, filledCategories };
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

function scoreField(field: FillableField, category: "wallet" | "twitter" | "email" | "name") {
  if (!field.visible || field.disabled || field.readOnly) {
    return 0;
  }

  const textTypes = new Set(["", "text", "search", "url", "email", "tel", "textarea"]);
  if (!textTypes.has(field.type)) {
    return 0;
  }

  if (category === "email" && field.type === "email") {
    return 10;
  }

  const patterns: Record<typeof category, RegExp[]> = {
    wallet: [/\bwallet address\b/i, /\bevm address\b/i, /\bwallet\b/i, /\baddress\b/i, /\b0x\b/i],
    twitter: [/\bx handle\b/i, /\bx username\b/i, /\btwitter\b/i, /\bhandle\b/i],
    email: [/\be-mail\b/i, /\bemail\b/i],
    name: [/\bfull name\b/i, /\bname\b/i],
  };

  const matchIndex = patterns[category].findIndex((pattern) => pattern.test(field.text));
  return matchIndex === -1 ? 0 : 9 - matchIndex;
}

function firstVisibleField(frameFields: FillableField[][]) {
  for (let frameIndex = 0; frameIndex < frameFields.length; frameIndex += 1) {
    const field = frameFields[frameIndex].find((candidate) => {
      const textTypes = new Set(["", "text", "search", "url", "email", "tel", "textarea"]);
      return candidate.visible && !candidate.disabled && !candidate.readOnly && textTypes.has(candidate.type);
    });
    if (field) {
      return { frameIndex, fieldIndex: field.index };
    }
  }
  return null;
}

async function clickSubmit(page: Page) {
  const frames = page.frames();
  for (const frame of frames) {
    const clicked = await frame
      .locator('button[type="submit"], input[type="submit"]')
      .first()
      .click({ timeout: SUBMIT_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (clicked) {
      return { ok: true };
    }
  }

  for (const frame of frames) {
    const buttons = await getSubmitButtons(frame).catch(() => []);
    const safeButtons = buttons
      .filter((button) => button.visible && !button.disabled)
      .filter((button) => !unsafeActionPattern.test(button.text))
      .sort((a, b) => b.score - a.score);
    const preferred = safeButtons[0];
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
  }

  const blocker = await detectBlocker(page);
  return { ok: false, reason: blocker || "Submit button could not be found." };
}

async function getSubmitButtons(frame: Frame) {
  return frame
    .locator('button, input[type="submit"], input[type="button"], [role="button"]')
    .evaluateAll((elements) =>
      elements.map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const input = element as HTMLInputElement;
        const text = [
          element.textContent || "",
          input.value || "",
          element.getAttribute("aria-label") || "",
          element.getAttribute("title") || "",
        ]
          .join(" ")
          .trim()
          .toLowerCase();

        return {
          index,
          text,
          disabled: input.disabled || element.getAttribute("aria-disabled") === "true",
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none",
          score: submitPatterns.reduce((score, pattern, patternIndex) => {
            return pattern.test(text) ? Math.max(score, 10 - patternIndex) : score;
          }, 0),
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

function inspectRequest(request: Request, dummy: AuditDummyData, auditStartedAt: number): MatchedRequest | null {
  if (Date.now() < auditStartedAt || isAnalyticsUrl(request.url())) {
    return null;
  }

  const postData = request.postData() || "";
  const text = `${request.url()}\n${postData}`;
  const graphqlMutation = /\bmutation\b/i.test(text);
  if (!SUBMISSION_METHODS.has(request.method()) && !graphqlMutation) {
    return null;
  }

  const detectedMarkers = detectMarkers(text, dummy);
  if (detectedMarkers.length === 0) {
    return null;
  }

  return {
    request,
    url: request.url(),
    method: request.method(),
    endpointDomain: safeDomain(request.url()),
    postData,
    detectedMarkers,
    timestamp: Date.now(),
    graphqlMutation,
    status: null,
  };
}

function detectMarkers(text: string, dummy: AuditDummyData) {
  const checks: Array<[keyof AuditDummyData, string]> = [
    ["wallet", "wallet"],
    ["twitter", "X/Twitter"],
    ["email", "email"],
    ["name", "name"],
  ];

  return checks
    .filter(([key]) => markerVariants(dummy[key]).some((variant) => text.includes(variant)))
    .map(([, label]) => label);
}

function markerVariants(value: string) {
  return [value, encodeURIComponent(value), encodeURI(value), value.replace(/\s/g, "+")];
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

function buildDummyData(auditId: string): AuditDummyData {
  const marker = `audit_${auditId.replace(/-/g, "").slice(0, 12).toLowerCase()}`;
  return {
    marker,
    wallet: `0x${randomBytes(20).toString("hex")}_${marker}`,
    twitter: `${marker}_x`,
    email: `${marker}@example.com`,
    name: `Audit User ${marker}`,
  };
}

function inconclusive(context: AuditContext, reason: string): BrowserlessAuditResponse {
  return {
    verdict: "INCONCLUSIVE",
    message: "COULDN'T VERIFY",
    targetUrl: context.targetUrl.toString(),
    auditId: context.auditId,
    reason,
    dummy: context.dummy,
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
  /\bsubmit\b/i,
  /\bjoin waitlist\b/i,
  /\bjoin whitelist\b/i,
  /\bjoin apelist\b/i,
  /\bjoin\b/i,
  /\bapply\b/i,
  /\bregister\b/i,
  /\bsend\b/i,
];
const unsafeActionPattern = /\b(connect|metamask|walletconnect|sign message|signature|transaction)\b/i;
