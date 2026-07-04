import { randomBytes } from "node:crypto";
import type { Browser, Page, Request } from "playwright-core";
import type {
  CapturedRequest,
  DummyAuditData,
  LiveAuditReport,
  LiveVerdict,
} from "@/lib/audit/types";
import { LIVE_AUDIT_TIMEOUT_MS } from "@/lib/audit/security";

const SUBMISSION_METHODS = new Set(["POST", "PUT", "PATCH"]);
const POST_SUBMIT_WAIT_MS = 10_000;
const MAX_CAPTURED_REQUESTS = 25;

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

export async function runLiveAudit(targetUrl: URL): Promise<LiveAuditReport> {
  const startedAt = Date.now();
  const dummyData = createDummyData();
  const dummyValues = Object.values(dummyData);
  const requests: CapturedRequest[] = [];
  const requestMap = new Map<Request, CapturedRequest>();
  const notes: string[] = [];

  const browser = await launchAuditBrowser();

  try {
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: false,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) WhitelistFormAuditor/2.0 Chrome/120 Safari/537.36",
    });
    const page = await context.newPage();

    page.on("request", (request) => {
      if (requests.length >= MAX_CAPTURED_REQUESTS || isAnalyticsUrl(request.url())) {
        return;
      }

      const postData = request.postData() || "";
      const graphqlMutation = /\bmutation\b/i.test(postData) || /\bmutation\b/i.test(request.url());
      if (!SUBMISSION_METHODS.has(request.method()) && !graphqlMutation) {
        return;
      }

      const detectedMarkers = detectMarkers(postData, dummyData);
      if (detectedMarkers.length === 0) {
        return;
      }

      const captured: CapturedRequest = {
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        statusCode: null,
        responseOk: null,
        postDataPreview: postData.slice(0, 1_000),
        containsDummyWallet: detectedMarkers.includes("wallet"),
        containsDummyTwitter: detectedMarkers.includes("X/Twitter"),
        containsDummyEmail: detectedMarkers.includes("email"),
        containsDummyName: detectedMarkers.includes("name"),
        containsDummyData: true,
        detectedMarkers,
        graphqlMutation,
        timestamp: new Date().toISOString(),
      };

      requests.push(captured);
      requestMap.set(request, captured);
    });

    page.on("response", (response) => {
      const captured = requestMap.get(response.request());
      if (!captured) {
        return;
      }

      captured.statusCode = response.status();
      captured.responseOk = response.ok();
    });

    await page.goto(targetUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: Math.max(5_000, LIVE_AUDIT_TIMEOUT_MS - (Date.now() - startedAt)),
    });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {
      notes.push("Page did not become fully idle before interaction.");
    });

    const fillResult = await fillTargetInputs(page, dummyData);
    notes.push(...fillResult.notes);

    const submitClicked = await clickSubmitButton(page);
    if (!submitClicked) {
      notes.push("No safe submit button was clicked.");
    }

    await page.waitForTimeout(POST_SUBMIT_WAIT_MS);
    await context.close();

    const payloadContainsDummyData = requests.some((request) => request.containsDummyData);
    const verdict = classifyLive(payloadContainsDummyData);
    const result = verdict === "DATA_SENT_TO_SERVER" ? "YES" : "NO";
    const reason = buildReason({
      payloadContainsDummyData,
      hasPostRequest: requests.length > 0,
      filledAnyInput:
        fillResult.walletFilled ||
        fillResult.twitterFilled ||
        fillResult.emailFilled ||
        fillResult.nameFilled,
      submitClicked,
    });

    return {
      targetUrl: targetUrl.toString(),
      scannedAt: new Date().toISOString(),
      dummyData,
      requests,
      storageEvents: [],
      hasPostRequest: requests.length > 0,
      payloadContainsDummyWallet: requests.some((request) => request.containsDummyWallet),
      payloadContainsDummyTwitter: requests.some((request) => request.containsDummyTwitter),
      payloadContainsDummyEmail: requests.some((request) => request.containsDummyEmail),
      payloadContainsDummyName: requests.some((request) => request.containsDummyName),
      payloadContainsDummyData,
      storageContainsDummyData: false,
      usesLocalStorage: false,
      walletFilled: fillResult.walletFilled,
      twitterFilled: fillResult.twitterFilled,
      emailFilled: fillResult.emailFilled,
      nameFilled: fillResult.nameFilled,
      submitClicked,
      verdict,
      result,
      reason,
      rateLimit: {
        limit: 0,
        remaining: 0,
        windowMs: 0,
        label: "",
        resetAt: "",
      },
      notes,
    };
  } finally {
    await browser.close();
  }
}

async function launchAuditBrowser(): Promise<Browser> {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const [{ chromium: playwrightChromium }, serverlessChromium] = await Promise.all([
      import("playwright-core"),
      import("@sparticuz/chromium"),
    ]);
    const chromium = serverlessChromium.default;

    return playwrightChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true });
}

async function fillTargetInputs(page: Page, dummyData: DummyAuditData) {
  const notes: string[] = [];
  const locator = page.locator("input, textarea");
  const fields = await locator.evaluateAll((elements) =>
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

      return {
        index,
        type: "type" in input ? (input.type || "text").toLowerCase() : "textarea",
        name: "name" in input ? input.name || "" : "",
        id,
        placeholder: input.getAttribute("placeholder") || "",
        ariaLabel: input.getAttribute("aria-label") || "",
        label: `${forLabel} ${input.closest("label")?.textContent || ""}`.trim(),
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

  const fillable = fields.filter((field) => {
    const textTypes = new Set(["", "text", "search", "url", "email", "tel", "textarea"]);
    return field.visible && !field.disabled && !field.readOnly && textTypes.has(field.type);
  });

  const usedIndexes = new Set<number>();
  const walletCandidate = findUnusedField(fillable, usedIndexes, (field) => {
    return walletPattern.test(fieldText(field)) || /0x|ethereum|evm/i.test(field.placeholder);
  });
  const emailCandidate = findUnusedField(fillable, usedIndexes, (field) => {
    return field.type === "email" || emailPattern.test(fieldText(field));
  });
  const twitterCandidate = findUnusedField(fillable, usedIndexes, (field) => {
    return twitterPattern.test(fieldText(field));
  });
  const nameCandidate = findUnusedField(fillable, usedIndexes, (field) => {
    return namePattern.test(fieldText(field));
  });
  const genericCandidate = findUnusedField(fillable, usedIndexes, () => true);

  const walletFilled = walletCandidate
    ? await fillField(locator, walletCandidate.index, dummyData.wallet, "Wallet", notes)
    : genericCandidate
      ? await fillField(locator, genericCandidate.index, dummyData.wallet, "Generic wallet", notes)
      : false;
  const emailFilled = emailCandidate
    ? await fillField(locator, emailCandidate.index, dummyData.email, "Email", notes)
    : false;
  const twitterFilled = twitterCandidate
    ? await fillField(locator, twitterCandidate.index, dummyData.twitter, "Twitter/X", notes)
    : false;
  const nameFilled = nameCandidate
    ? await fillField(locator, nameCandidate.index, dummyData.name, "Name", notes)
    : false;

  if (!walletFilled) notes.push("No wallet or generic text input was filled.");
  if (!emailFilled) notes.push("No email-like input was filled.");
  if (!twitterFilled) notes.push("No Twitter/X-like input was filled.");
  if (!nameFilled) notes.push("No name-like input was filled.");

  return { walletFilled, twitterFilled, emailFilled, nameFilled, notes };
}

async function clickSubmitButton(page: Page) {
  const locator = page.locator('button, input[type="submit"], input[type="button"], [role="button"]');
  const candidates = await locator.evaluateAll((elements) =>
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
        .trim();

      return {
        index,
        text,
        type: input.type || "",
        disabled: input.disabled || element.getAttribute("aria-disabled") === "true",
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none",
      };
    }),
  );

  const safeCandidates = candidates.filter((candidate) => {
    const text = candidate.text.toLowerCase();
    const unsafeWalletAction = /\b(connect|metamask|walletconnect|sign message|signature)\b/i.test(text);
    return candidate.visible && !candidate.disabled && !unsafeWalletAction;
  });

  const preferred =
    safeCandidates.find((candidate) => submitPattern.test(candidate.text)) ||
    safeCandidates.find((candidate) => candidate.type.toLowerCase() === "submit");

  if (!preferred) {
    return false;
  }

  return locator
    .nth(preferred.index)
    .click({ timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
}

function classifyLive(payloadContainsDummyData: boolean): LiveVerdict {
  return payloadContainsDummyData ? "DATA_SENT_TO_SERVER" : "NO_DATA_SENT";
}

function buildReason({
  payloadContainsDummyData,
  hasPostRequest,
  filledAnyInput,
  submitClicked,
}: {
  payloadContainsDummyData: boolean;
  hasPostRequest: boolean;
  filledAnyInput: boolean;
  submitClicked: boolean;
}) {
  if (payloadContainsDummyData) {
    return "Dummy marker was found inside a non-analytics server request payload.";
  }

  if (hasPostRequest) {
    return "A submission request was found, but it did not contain the dummy marker.";
  }

  if (filledAnyInput && submitClicked) {
    return "Dummy data was filled and submit was clicked, but no matching server request was detected.";
  }

  return "The form could not be safely filled and submitted automatically.";
}

function createDummyData(): DummyAuditData {
  const suffix = randomBytes(6).toString("hex");
  return {
    wallet: `0x${randomBytes(20).toString("hex")}`,
    twitter: `audit_${suffix}`,
    email: `audit_${suffix}@example.com`,
    name: `Audit User ${suffix}`,
  };
}

function detectMarkers(text: string, dummyData: DummyAuditData) {
  const markers: string[] = [];
  const checks: Array<[keyof DummyAuditData, string]> = [
    ["wallet", "wallet"],
    ["twitter", "X/Twitter"],
    ["email", "email"],
    ["name", "name"],
  ];

  for (const [key, label] of checks) {
    if (markerVariants(dummyData[key]).some((variant) => text.includes(variant))) {
      markers.push(label);
    }
  }

  return markers;
}

function markerVariants(value: string) {
  return [value, encodeURIComponent(value), encodeURI(value), value.replace(/\s/g, "+")];
}

function isAnalyticsUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return ANALYTICS_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return true;
  }
}

function fieldText(field: {
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  label: string;
}) {
  return [field.name, field.id, field.placeholder, field.ariaLabel, field.label].join(" ");
}

function findUnusedField<T extends { index: number }>(
  fields: T[],
  usedIndexes: Set<number>,
  predicate: (field: T) => boolean,
) {
  const field = fields.find((candidate) => !usedIndexes.has(candidate.index) && predicate(candidate));
  if (field) {
    usedIndexes.add(field.index);
  }
  return field;
}

async function fillField(
  locator: ReturnType<Page["locator"]>,
  index: number,
  value: string,
  label: string,
  notes: string[],
) {
  return locator
    .nth(index)
    .fill(value, { timeout: 2_500 })
    .then(() => true)
    .catch(() => {
      notes.push(`${label} input was found but could not be filled.`);
      return false;
    });
}

const walletPattern = /\b(wallet|wallet address|address|eth|ethereum|evm|base|public key|public address)\b/i;
const emailPattern = /\b(email|e-mail|mail)\b/i;
const twitterPattern = /\b(twitter|x handle|x account|x username|handle|username)\b/i;
const namePattern = /\b(name|full name|nama|nama lengkap|first name|last name)\b/i;
const submitPattern = /\b(submit|join|whitelist|waitlist|register|apply|claim|mint|send|enter|continue|sign up|signup)\b/i;
