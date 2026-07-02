import * as cheerio from "cheerio";
import type {
  DetectionSignals,
  ExtractedForm,
  ExtractedInput,
  SignalName,
  StaticAuditReport,
  StaticVerdict,
} from "@/lib/audit/types";
import { SIGNAL_KEYS } from "@/lib/audit/types";

const SIGNAL_PATTERNS: Record<SignalName, RegExp> = {
  fetch: /\bfetch\s*\(/i,
  XMLHttpRequest: /\bXMLHttpRequest\b/i,
  axios: /\baxios\b/i,
  supabase: /\bsupabase\b|supabase\.co/i,
  firebase: /\bfirebase\b|firebaseapp\.com/i,
  firestore: /\bfirestore\b/i,
  airtable: /\bairtable\b|api\.airtable\.com/i,
  formspree: /\bformspree\b|formspree\.io/i,
  "script.google.com": /script\.google\.com/i,
  localStorage: /\blocalStorage\b/i,
  sessionStorage: /\bsessionStorage\b/i,
  indexedDB: /\bindexedDB\b/i,
  sendBeacon: /\bsendBeacon\s*\(/i,
};

const SERVER_SIGNAL_KEYS: SignalName[] = [
  "fetch",
  "XMLHttpRequest",
  "axios",
  "supabase",
  "firebase",
  "firestore",
  "airtable",
  "formspree",
  "script.google.com",
  "sendBeacon",
];

export function scanStaticHtml(html: string, targetUrl: URL): StaticAuditReport {
  const $ = cheerio.load(html);
  const forms = $("form")
    .map((index, form): ExtractedForm => {
      const action = ($(form).attr("action") || "").trim();
      const method = ($(form).attr("method") || "GET").trim().toUpperCase();
      const actionResolved = resolveUrl(action, targetUrl);
      const inputs = $(form)
        .find("input, textarea, select")
        .map((_, input): ExtractedInput => {
          const element = $(input);
          return {
            name: (element.attr("name") || "").trim(),
            id: (element.attr("id") || "").trim(),
            type: (element.attr("type") || input.tagName || "text").trim().toLowerCase(),
            placeholder: (element.attr("placeholder") || "").trim(),
            autocomplete: (element.attr("autocomplete") || "").trim(),
            required: element.attr("required") !== undefined,
          };
        })
        .get();
      const submitLabels = $(form)
        .find('button, input[type="submit"], input[type="button"]')
        .map((_, button) => {
          const element = $(button);
          return (element.text() || element.attr("value") || element.attr("aria-label") || "").trim();
        })
        .get()
        .filter(Boolean);

      return {
        index,
        action,
        actionResolved,
        method,
        inputs,
        submitLabels,
      };
    })
    .get();

  const signals = detectSignals(html);
  const hasForm = forms.length > 0;
  const hasServerScriptSignal = SERVER_SIGNAL_KEYS.some((signal) => signals[signal]);
  const hasPostForm = forms.some((form) => ["POST", "PUT", "PATCH"].includes(form.method));
  const hasFormActionEndpoint = forms.some((form) => hasUsableFormAction(form));
  const hasBackendEndpoint = hasPostForm || hasFormActionEndpoint || hasServerScriptSignal;
  const usesLocalStorage = signals.localStorage || signals.sessionStorage || signals.indexedDB;
  const usesSupabaseOrFirebase = signals.supabase || signals.firebase || signals.firestore;
  const verdict = classifyStatic({ hasForm, hasBackendEndpoint, usesLocalStorage });

  return {
    targetUrl: targetUrl.toString(),
    scannedAt: new Date().toISOString(),
    htmlBytes: new TextEncoder().encode(html).byteLength,
    hasForm,
    hasBackendEndpoint,
    usesLocalStorage,
    usesSupabaseOrFirebase,
    signals,
    forms,
    verdict,
    summary: buildSummary(verdict),
  };
}

function detectSignals(html: string) {
  const signals = Object.fromEntries(SIGNAL_KEYS.map((key) => [key, false])) as DetectionSignals;

  for (const key of SIGNAL_KEYS) {
    signals[key] = SIGNAL_PATTERNS[key].test(html);
  }

  return signals;
}

function classifyStatic({
  hasForm,
  hasBackendEndpoint,
  usesLocalStorage,
}: {
  hasForm: boolean;
  hasBackendEndpoint: boolean;
  usesLocalStorage: boolean;
}): StaticVerdict {
  if (hasBackendEndpoint) {
    return "BACKEND_ENDPOINT_FOUND";
  }

  if (hasForm && usesLocalStorage) {
    return "LOCAL_ONLY";
  }

  if (!hasForm && !usesLocalStorage) {
    return "NO_SUBMISSION_DETECTED_OR_FAKE_UI";
  }

  return "UNKNOWN";
}

function buildSummary(verdict: StaticVerdict) {
  switch (verdict) {
    case "BACKEND_ENDPOINT_FOUND":
      return "Static scan found a form action or JavaScript/server-service submission signal.";
    case "LOCAL_ONLY":
      return "Static scan found a form and browser storage signals, but no clear backend submission signal.";
    case "NO_SUBMISSION_DETECTED_OR_FAKE_UI":
      return "Static scan did not find a form or meaningful submission/storage signal.";
    default:
      return "Static scan found partial signals, but not enough to classify confidently.";
  }
}

function resolveUrl(action: string, baseUrl: URL) {
  try {
    return new URL(action || baseUrl.toString(), baseUrl).toString();
  } catch {
    return "";
  }
}

function hasUsableFormAction(form: ExtractedForm) {
  const action = form.action.trim().toLowerCase();

  if (!form.actionResolved) {
    return false;
  }

  return Boolean(action && action !== "#" && !action.startsWith("javascript:"));
}
