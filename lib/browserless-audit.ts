import { randomBytes } from "node:crypto";
import {
  chromium,
  type Browser,
  type Frame,
  type Locator,
  type Request as PlaywrightRequest,
} from "playwright-core";

export type FieldKey = "wallet" | "xHandle" | "email" | "username";
export type Verdict = "VERIFIED" | "NO_EVIDENCE" | "INCONCLUSIVE";

export interface AuditResult {
  verdict: Verdict;
  message: string;
  reason?: string;
  auditId: string;
  targetUrl: string;
  dummyData: Record<FieldKey, string>;
  filledFields: FieldKey[];
  matchedFields: FieldKey[];
  request?: {
    method: string;
    endpoint: string;
    domain: string;
    status: number | null;
  };
  debug: {
    pageLoaded: boolean;
    formDetected: boolean;
    submitClicked: boolean;
    requestsObserved: number;
    relevantRequests: number;
  };
}

interface FieldInfo {
  index: number;
  type: string;
  text: string;
  visible: boolean;
  disabled: boolean;
  readOnly: boolean;
}

interface Candidate {
  frame: Frame;
  frameIndex: number;
  fieldIndex: number;
  key: FieldKey;
  score: number;
}

interface FilledTarget {
  frame: Frame;
  fieldIndex: number;
}

interface Match {
  request: PlaywrightRequest;
  method: string;
  endpoint: string;
  domain: string;
  matchedFields: FieldKey[];
  status: number | null;
}

const FIELD_KEYS: FieldKey[] = ["wallet", "xHandle", "email", "username"];
const ANALYTICS_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "segment.io",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
  "sentry.io",
  "hotjar.com",
  "clarity.ms",
];
const IGNORED_RESOURCE_TYPES = new Set(["image", "stylesheet", "font", "media", "script"]);

export async function runBrowserlessAudit(targetUrl: URL): Promise<AuditResult> {
  const auditId = randomBytes(8).toString("hex");
  const dummyData = buildDummyData(auditId);
  const debug = {
    pageLoaded: false,
    formDetected: false,
    submitClicked: false,
    requestsObserved: 0,
    relevantRequests: 0,
  };
  const base = {
    auditId,
    targetUrl: targetUrl.toString(),
    dummyData,
    filledFields: [] as FieldKey[],
    matchedFields: [] as FieldKey[],
    debug,
  };

  const token = process.env.BROWSERLESS_TOKEN?.trim();
  if (!token) {
    return {
      ...base,
      verdict: "INCONCLUSIVE",
      message: "Browserless belum dikonfigurasi.",
      reason: "BROWSERLESS_TOKEN tidak ditemukan di server.",
    };
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(buildBrowserlessUrl(token), { timeout: 20_000 });
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();
    const matches: Match[] = [];
    const matchByRequest = new Map<PlaywrightRequest, Match>();

    page.on("request", (request) => {
      debug.requestsObserved += 1;
      if (IGNORED_RESOURCE_TYPES.has(request.resourceType()) || isAnalytics(request.url())) return;

      const matchedFields = detectDummyValues(request, dummyData);
      if (!matchedFields.length) return;

      const match: Match = {
        request,
        method: request.method().toUpperCase(),
        endpoint: request.url(),
        domain: safeDomain(request.url()),
        matchedFields,
        status: null,
      };
      matches.push(match);
      matchByRequest.set(request, match);
      debug.relevantRequests += 1;
    });

    page.on("response", (response) => {
      let request: PlaywrightRequest | null = response.request();
      while (request) {
        const match = matchByRequest.get(request);
        if (match) {
          match.status = response.status();
          break;
        }
        request = request.redirectedFrom();
      }
    });

    await page.goto(targetUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    debug.pageLoaded = true;
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

    let fillResult = await fillDummyFields(page.frames(), dummyData);
    if (fillResult.formDetected && !fillResult.filledFields.length) {
      await page.waitForTimeout(1_200);
      fillResult = await fillDummyFields(page.frames(), dummyData);
    }
    base.filledFields = fillResult.filledFields;
    debug.formDetected = fillResult.formDetected;

    if (!fillResult.formDetected) {
      return inconclusive(base, "Tidak ditemukan field wallet, X, email, atau username yang bisa diisi.");
    }
    if (!fillResult.filledFields.length) {
      return inconclusive(base, "Form terdeteksi, tetapi field dummy tidak berhasil diisi.");
    }

    await page.waitForTimeout(400);
    const submitted = await clickSafeSubmit(page.frames(), fillResult.filledTargets);
    debug.submitClicked = submitted.clicked;

    if (!submitted.clicked) {
      return inconclusive(base, submitted.reason || "Tombol submit yang aman tidak ditemukan.");
    }

    await page.waitForTimeout(8_000);
    const winner = pickBestMatch(matches);
    if (!winner) {
      return {
        ...base,
        verdict: "NO_EVIDENCE",
        message: "Tidak ada request yang membawa data dummy.",
      };
    }

    base.matchedFields = winner.matchedFields;
    return {
      ...base,
      verdict: "VERIFIED",
      message: "Data dummy benar-benar terlihat pada request keluar ke server.",
      request: {
        method: winner.method,
        endpoint: winner.endpoint,
        domain: winner.domain,
        status: winner.status,
      },
    };
  } catch (error) {
    return inconclusive(
      base,
      error instanceof Error ? sanitizeError(error.message) : "Browser automation gagal.",
    );
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

function buildBrowserlessUrl(token: string) {
  const endpoint = new URL(
    process.env.BROWSERLESS_WS_URL?.trim() || "wss://production-sfo.browserless.io",
  );
  if (!endpoint.searchParams.has("token")) endpoint.searchParams.set("token", token);
  if (!endpoint.searchParams.has("blockAds")) endpoint.searchParams.set("blockAds", "true");
  return endpoint.toString();
}

async function fillDummyFields(frames: Frame[], dummyData: Record<FieldKey, string>) {
  const candidates: Candidate[] = [];

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex];
    const fields = await readFields(frame).catch(() => [] as FieldInfo[]);
    for (const field of fields) {
      for (const key of FIELD_KEYS) {
        const score = scoreField(field, key);
        if (score > 0) candidates.push({ frame, frameIndex, fieldIndex: field.index, key, score });
      }
    }
  }

  const filledFields: FieldKey[] = [];
  const filledTargets: FilledTarget[] = [];
  const usedElements = new Set<string>();
  const usedKeys = new Set<FieldKey>();

  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const elementId = `${candidate.frameIndex}:${candidate.fieldIndex}`;
    if (usedElements.has(elementId) || usedKeys.has(candidate.key)) continue;

    const field = candidate.frame
      .locator("input:not([type=hidden]), textarea")
      .nth(candidate.fieldIndex);
    const filled = await fillField(field, dummyData[candidate.key]);

    if (filled) {
      usedElements.add(elementId);
      usedKeys.add(candidate.key);
      filledFields.push(candidate.key);
      filledTargets.push({ frame: candidate.frame, fieldIndex: candidate.fieldIndex });
    }
  }

  return { formDetected: candidates.length > 0, filledFields, filledTargets };
}

async function fillField(field: Locator, value: string) {
  const normallyFilled = await field
    .fill(value, { timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (normallyFilled) return true;

  const forceFilled = await field
    .fill(value, { timeout: 2_000, force: true })
    .then(() => true)
    .catch(() => false);
  if (forceFilled) return true;

  return field
    .evaluate((element, nextValue) => {
      const input = element as HTMLInputElement | HTMLTextAreaElement;
      const prototype = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(input, nextValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return input.value === nextValue;
    }, value)
    .catch(() => false);
}

async function readFields(frame: Frame): Promise<FieldInfo[]> {
  return frame.locator("input:not([type=hidden]), textarea").evaluateAll((elements) =>
    elements.map((element, index) => {
      const input = element as HTMLInputElement | HTMLTextAreaElement;
      const rect = input.getBoundingClientRect();
      const style = window.getComputedStyle(input);
      let label = "";
      try {
        label = input.id
          ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent || ""
          : "";
      } catch {
        label = "";
      }

      return {
        index,
        type: "type" in input ? (input.type || "text").toLowerCase() : "textarea",
        text: [
          input.getAttribute("name") || "",
          input.id || "",
          input.getAttribute("placeholder") || "",
          input.getAttribute("aria-label") || "",
          input.getAttribute("autocomplete") || "",
          label,
          input.closest("label")?.textContent || "",
        ].join(" ").toLowerCase(),
        visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
        disabled: input.disabled,
        readOnly: input.readOnly,
      };
    }),
  );
}

function scoreField(field: FieldInfo, key: FieldKey) {
  if (!field.visible || field.disabled || field.readOnly) return 0;
  if (!["text", "email", "url", "tel", "search", "textarea", ""].includes(field.type)) return 0;

  const patterns: Record<FieldKey, RegExp[]> = {
    wallet: [/wallet address/, /evm address/, /public address/, /\bwallet\b/, /\b0x\b/],
    xHandle: [/x handle/, /x username/, /twitter handle/, /twitter username/, /\btwitter\b/, /social handle/],
    email: [/e-mail/, /\bemail\b/],
    username: [/user name/, /\busername\b/, /full name/, /display name/, /\bname\b/],
  };

  if (key === "email" && field.type === "email") return 30;
  const index = patterns[key].findIndex((pattern) => pattern.test(field.text));
  return index === -1 ? 0 : 20 - index;
}

async function clickSafeSubmit(frames: Frame[], filledTargets: FilledTarget[]) {
  const unsafe = /connect wallet|walletconnect|metamask|sign message|signature|transaction|purchase|buy|mint/i;
  const safe = /join waitlist|join whitelist|join allowlist|submit|apply|register|send|continue|join/i;

  for (const target of filledTargets) {
    const field = target.frame.locator("input:not([type=hidden]), textarea").nth(target.fieldIndex);
    const form = field.locator("xpath=ancestor::form[1]");
    if ((await form.count().catch(() => 0)) === 0) continue;

    const controls = form.locator('button, input[type="submit"], input[type="button"], [role="button"]');
    const clicked = await clickBestControl(controls, safe, unsafe);
    if (clicked) return { clicked: true as const };
  }

  for (const frame of frames) {
    const controls = frame.locator('button, input[type="submit"], input[type="button"], [role="button"]');
    const clicked = await clickBestControl(controls, safe, unsafe);
    if (clicked) return { clicked: true as const };
  }

  return { clicked: false as const, reason: "Tombol submit tidak ditemukan, diblokir, atau membutuhkan wallet/signature." };
}

async function clickBestControl(controls: Locator, safe: RegExp, unsafe: RegExp) {
  const items = await controls.evaluateAll((elements) =>
      elements.map((element, index) => {
        const input = element as HTMLInputElement;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          index,
          text: [
            element.textContent || "",
            input.value || "",
            element.getAttribute("aria-label") || "",
            element.getAttribute("title") || "",
          ].join(" ").trim(),
          type: (input.type || element.getAttribute("type") || "").toLowerCase(),
          disabled: input.disabled || element.getAttribute("aria-disabled") === "true",
          visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
        };
      }),
    ).catch(() => [] as Array<{ index: number; text: string; type: string; disabled: boolean; visible: boolean }>);

  const candidate = items
    .filter((item) => item.visible && !item.disabled && !unsafe.test(item.text))
    .map((item) => ({ ...item, score: (safe.test(item.text) ? 20 : 0) + (item.type === "submit" ? 10 : 0) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  if (!candidate) return false;
  return controls.nth(candidate.index).click({ timeout: 5_000 }).then(() => true).catch(() => false);
}

function detectDummyValues(request: PlaywrightRequest, dummyData: Record<FieldKey, string>) {
  const parts = [request.url(), request.postData() || ""];
  try {
    const json = request.postDataJSON();
    if (json) parts.push(JSON.stringify(json));
  } catch {}

  const variants = new Set<string>();
  for (const part of parts) {
    variants.add(part);
    variants.add(part.replace(/\+/g, " "));
    try { variants.add(decodeURIComponent(part)); } catch {}
  }
  const text = Array.from(variants).join("\n").toLowerCase();
  return FIELD_KEYS.filter((key) => {
    const value = dummyData[key].toLowerCase();
    return text.includes(value) || text.includes(encodeURIComponent(value).toLowerCase());
  });
}

function pickBestMatch(matches: Match[]) {
  return matches.sort((a, b) => b.matchedFields.length - a.matchedFields.length)[0];
}

function isAnalytics(url: string) {
  const domain = safeDomain(url).replace(/^www\./, "");
  return ANALYTICS_DOMAINS.some((item) => domain === item || domain.endsWith(`.${item}`));
}

function safeDomain(url: string) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function buildDummyData(auditId: string): Record<FieldKey, string> {
  return {
    wallet: `0x${"0".repeat(24)}${auditId}`,
    xHandle: `@dummy_${auditId}`,
    email: `dummy+${auditId}@example.com`,
    username: `dummy_${auditId}`,
  };
}

function inconclusive(
  base: Omit<AuditResult, "verdict" | "message">,
  reason: string,
): AuditResult {
  return { ...base, verdict: "INCONCLUSIVE", message: "Audit tidak dapat diselesaikan.", reason };
}

function sanitizeError(message: string) {
  const token = process.env.BROWSERLESS_TOKEN;
  return token ? message.replaceAll(token, "[token hidden]") : message;
}
