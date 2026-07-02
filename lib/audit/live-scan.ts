import type { Page } from "playwright";
import {
  DUMMY_EMAIL,
  DUMMY_NAME,
  DUMMY_TWITTER,
  DUMMY_WALLET,
  type CapturedRequest,
  type LiveAuditReport,
  type LiveVerdict,
  type StorageEventCapture,
} from "@/lib/audit/types";
import { LIVE_AUDIT_TIMEOUT_MS } from "@/lib/audit/security";

const SUBMISSION_METHODS = new Set(["POST", "PUT", "PATCH"]);
const MAX_CAPTURED_REQUESTS = 25;
const DUMMY_VALUES = [DUMMY_WALLET, DUMMY_TWITTER, DUMMY_EMAIL, DUMMY_NAME];

export async function runLiveAudit(targetUrl: URL): Promise<LiveAuditReport> {
  const { chromium } = await import("playwright");
  const startedAt = Date.now();
  const requests: CapturedRequest[] = [];
  const notes: string[] = [];

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: false,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) WhitelistFormAuditor/1.0 Chrome/120 Safari/537.36",
    });

    await context.addInitScript(
      ({ wallet, twitter, email, name }) => {
        const existing = window as Window & {
          __whitelistAuditStorageEvents?: StorageEventCapture[];
        };
        existing.__whitelistAuditStorageEvents = [];
        const dummyValues = [wallet, twitter, email, name];

        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function setItem(key: string, value: string) {
          let area: StorageEventCapture["area"] = "unknown";
          try {
            if (this === window.localStorage) {
              area = "localStorage";
            } else if (this === window.sessionStorage) {
              area = "sessionStorage";
            }
          } catch {
            area = "unknown";
          }

          const normalizedValue = String(value);
          const containsDummyData = dummyValues.some((dummyValue) => normalizedValue.includes(dummyValue));
          existing.__whitelistAuditStorageEvents?.push({
            area,
            key: String(key),
            valuePreview: normalizedValue.slice(0, 500),
            containsDummyWallet: normalizedValue.includes(wallet),
            containsDummyTwitter: normalizedValue.includes(twitter),
            containsDummyEmail: normalizedValue.includes(email),
            containsDummyName: normalizedValue.includes(name),
            containsDummyData,
            timestamp: Date.now(),
          });

          return originalSetItem.apply(this, [key, value]);
        };
      },
      { wallet: DUMMY_WALLET, twitter: DUMMY_TWITTER, email: DUMMY_EMAIL, name: DUMMY_NAME },
    );

    const page = await context.newPage();

    page.on("request", (request) => {
      if (!SUBMISSION_METHODS.has(request.method()) || requests.length >= MAX_CAPTURED_REQUESTS) {
        return;
      }

      const postData = request.postData() || "";
      const containsDummyWallet = postData.includes(DUMMY_WALLET);
      const containsDummyTwitter = postData.includes(DUMMY_TWITTER);
      const containsDummyEmail = postData.includes(DUMMY_EMAIL);
      const containsDummyName = postData.includes(DUMMY_NAME);
      const containsDummyData = containsAnyDummyValue(postData);
      requests.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        postDataPreview: postData.slice(0, 1_000),
        containsDummyWallet,
        containsDummyTwitter,
        containsDummyEmail,
        containsDummyName,
        containsDummyData,
        timestamp: new Date().toISOString(),
      });
    });

    await page.goto(targetUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: Math.max(5_000, LIVE_AUDIT_TIMEOUT_MS - (Date.now() - startedAt)),
    });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {
      notes.push("Page did not become fully idle before interaction.");
    });

    const fillResult = await fillTargetInputs(page);
    notes.push(...fillResult.notes);

    const submitClicked = await clickSubmitButton(page);
    if (!submitClicked) {
      notes.push("No safe submit button was clicked.");
    }

    await page.waitForTimeout(3_000);

    const storageEvents = await page
      .evaluate(() => {
        const existing = window as Window & {
          __whitelistAuditStorageEvents?: StorageEventCapture[];
        };
        return existing.__whitelistAuditStorageEvents || [];
      })
      .catch(() => {
        notes.push("Could not read storage monitor results after interaction.");
        return [] as StorageEventCapture[];
      });

    const hasPostRequest = requests.length > 0;
    const payloadContainsDummyWallet = requests.some((request) => request.containsDummyWallet);
    const payloadContainsDummyTwitter = requests.some((request) => request.containsDummyTwitter);
    const payloadContainsDummyEmail = requests.some((request) => request.containsDummyEmail);
    const payloadContainsDummyName = requests.some((request) => request.containsDummyName);
    const payloadContainsDummyData = requests.some((request) => request.containsDummyData);
    const usesLocalStorage = storageEvents.some((event) => event.area === "localStorage");
    const storageContainsDummyData = storageEvents.some((event) => event.containsDummyData);
    const verdict = classifyLive({
      hasPostRequest,
      payloadContainsDummyData,
      storageContainsDummyData,
      filledAnyInput:
        fillResult.walletFilled ||
        fillResult.twitterFilled ||
        fillResult.emailFilled ||
        fillResult.nameFilled,
      submitClicked,
    });

    await context.close();

    return {
      targetUrl: targetUrl.toString(),
      scannedAt: new Date().toISOString(),
      requests,
      storageEvents,
      hasPostRequest,
      payloadContainsDummyWallet,
      payloadContainsDummyTwitter,
      payloadContainsDummyEmail,
      payloadContainsDummyName,
      payloadContainsDummyData,
      storageContainsDummyData,
      usesLocalStorage,
      walletFilled: fillResult.walletFilled,
      twitterFilled: fillResult.twitterFilled,
      emailFilled: fillResult.emailFilled,
      nameFilled: fillResult.nameFilled,
      submitClicked,
      verdict,
      notes,
    };
  } finally {
    await browser.close();
  }
}

async function fillTargetInputs(page: Page) {
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
        tagName: input.tagName.toLowerCase(),
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
  const walletCandidate =
    fillable.find((field) => walletPattern.test(fieldText(field))) ||
    fillable.find((field) => /0x|ethereum|evm/i.test(field.placeholder));
  if (walletCandidate) {
    usedIndexes.add(walletCandidate.index);
  }
  const emailCandidate = findUnusedField(fillable, usedIndexes, (field) => {
    return field.type === "email" || emailPattern.test(fieldText(field));
  });
  const twitterCandidate = findUnusedField(fillable, usedIndexes, (field) => {
    return twitterPattern.test(fieldText(field));
  });
  const nameCandidate = findUnusedField(fillable, usedIndexes, (field) => {
    return namePattern.test(fieldText(field));
  });
  const fallbackCandidate = findUnusedField(fillable, usedIndexes, () => true);
  let walletFilled = false;
  let twitterFilled = false;
  let emailFilled = false;
  let nameFilled = false;

  if (walletCandidate) {
    usedIndexes.add(walletCandidate.index);
    walletFilled = await fillField(locator, walletCandidate.index, DUMMY_WALLET, "Wallet", notes);
  } else {
    notes.push("No fillable wallet-like input was found.");
  }

  if (emailCandidate) {
    usedIndexes.add(emailCandidate.index);
    emailFilled = await fillField(locator, emailCandidate.index, DUMMY_EMAIL, "Email", notes);
  }

  if (twitterCandidate) {
    usedIndexes.add(twitterCandidate.index);
    twitterFilled = await fillField(locator, twitterCandidate.index, DUMMY_TWITTER, "Twitter/X", notes);
  }

  if (nameCandidate) {
    usedIndexes.add(nameCandidate.index);
    nameFilled = await fillField(locator, nameCandidate.index, DUMMY_NAME, "Name", notes);
  } else if (!walletFilled && !emailFilled && !twitterFilled && fallbackCandidate) {
    usedIndexes.add(fallbackCandidate.index);
    nameFilled = await fillField(locator, fallbackCandidate.index, DUMMY_NAME, "Generic text", notes);
  }

  if (!emailFilled) {
    notes.push("No fillable email-like input was found.");
  }

  if (!twitterFilled) {
    notes.push("No fillable Twitter/X-like input was found.");
  }

  if (!nameFilled) {
    notes.push("No fillable name-like input was found.");
  }

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

function classifyLive({
  hasPostRequest,
  payloadContainsDummyData,
  storageContainsDummyData,
  filledAnyInput,
  submitClicked,
}: {
  hasPostRequest: boolean;
  payloadContainsDummyData: boolean;
  storageContainsDummyData: boolean;
  filledAnyInput: boolean;
  submitClicked: boolean;
}): LiveVerdict {
  if (hasPostRequest && payloadContainsDummyData) {
    return "DATA_SENT_TO_SERVER";
  }

  if (storageContainsDummyData) {
    return "LOCAL_ONLY";
  }

  if (filledAnyInput && submitClicked) {
    return "NO_SUBMISSION_DETECTED_OR_FAKE_UI";
  }

  return "UNKNOWN";
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
const submitPattern = /\b(submit|join|whitelist|register|apply|claim|mint|send|enter|continue)\b/i;

function containsAnyDummyValue(value: string) {
  return DUMMY_VALUES.some((dummyValue) => value.includes(dummyValue));
}
