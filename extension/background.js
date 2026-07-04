const AUDIT_WINDOW_MS = 10_000;
const MAX_WAIT_FOR_SUBMIT_MS = 120_000;
const HISTORY_LIMIT = 25;

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

const SUBMISSION_METHODS = new Set(["POST", "PUT", "PATCH"]);
const MARKER_LABELS = {
  wallet: "wallet",
  twitter: "X/Twitter",
  email: "email",
  name: "name",
};

const activeAudits = new Map();
const pendingRequests = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup?.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Extension error" });
    });
  return true;
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    inspectRequest(details);
  },
  { urls: ["<all_urls>"] },
  ["requestBody"],
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    completeRequest(details.requestId, details.statusCode);
  },
  { urls: ["<all_urls>"] },
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    failRequest(details.requestId, details.error || "Request failed");
  },
  { urls: ["<all_urls>"] },
);

async function handleMessage(message, sender) {
  if (message?.type === "START_AUDIT") {
    return startAudit();
  }

  if (message?.type === "GET_ACTIVE_AUDIT") {
    return getActiveAuditResponse();
  }

  if (message?.type === "GET_HISTORY") {
    return { ok: true, history: await loadHistory() };
  }

  if (message?.type === "CLEAR_HISTORY") {
    await chrome.storage.local.set({ auditHistory: [] });
    return { ok: true, history: [] };
  }

  if (message?.type === "USER_SUBMITTED") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      const audit = activeAudits.get(tabId);
      if (audit && audit.id === message.auditId) {
        markSubmitted(audit, "submit event detected");
      }
    }
    return { ok: true };
  }

  return { ok: false, error: "Unknown message type" };
}

async function startAudit() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    throw new Error("Open a normal http/https whitelist or waitlist page first.");
  }

  finishExistingAudit(tab.id);

  const id = makeAuditId();
  const audit = {
    id,
    tabId: tab.id,
    targetUrl: tab.url,
    host: safeHost(tab.url),
    startedAt: Date.now(),
    submittedAt: null,
    deadlineAt: null,
    finishedAt: null,
    verdict: null,
    reason: "",
    status: "WAITING_FOR_SUBMIT",
    markers: buildMarkers(id),
    requests: [],
    timers: {},
  };

  activeAudits.set(tab.id, audit);
  await injectSubmissionDetector(tab.id, audit.id);

  audit.timers.maxWait = setTimeout(() => {
    finishAudit(audit, "NO", "No form submit or submit-like click was detected during the audit.");
  }, MAX_WAIT_FOR_SUBMIT_MS);

  broadcastAudit(audit);
  return { ok: true, audit: publicAudit(audit) };
}

function finishExistingAudit(tabId) {
  const audit = activeAudits.get(tabId);
  if (!audit) return;
  clearAuditTimers(audit);
  activeAudits.delete(tabId);
}

async function injectSubmissionDetector(tabId, auditId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [auditId],
    func: (currentAuditId) => {
      window.__wfaAuditId = currentAuditId;

      if (window.__wfaSubmissionDetectorInstalled) {
        return;
      }

      window.__wfaSubmissionDetectorInstalled = true;

      const notifySubmitted = () => {
        chrome.runtime.sendMessage({
          type: "USER_SUBMITTED",
          auditId: window.__wfaAuditId,
        });
      };

      document.addEventListener(
        "submit",
        () => {
          notifySubmitted();
        },
        true,
      );

      document.addEventListener(
        "click",
        (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const control = target.closest('button, input[type="submit"], input[type="button"], [role="button"]');
          if (!control) return;

          const input = control;
          const label = [
            control.textContent || "",
            input.value || "",
            control.getAttribute("aria-label") || "",
            control.getAttribute("title") || "",
          ]
            .join(" ")
            .toLowerCase();

          if (/\b(submit|join|waitlist|whitelist|register|apply|claim|mint|send|enter|continue|sign up|signup)\b/.test(label)) {
            notifySubmitted();
          }
        },
        true,
      );
    },
  });
}

function inspectRequest(details) {
  const audit = activeAudits.get(details.tabId);
  if (!audit || audit.verdict || details.timeStamp < audit.startedAt) {
    return;
  }

  if (isAnalyticsUrl(details.url)) {
    return;
  }

  const requestText = extractRequestText(details);
  const isGraphqlMutation = /\bmutation\b/i.test(requestText) || /\bmutation\b/i.test(details.url);
  if (!SUBMISSION_METHODS.has(details.method) && !isGraphqlMutation) {
    return;
  }

  const detectedMarkers = detectMarkers(requestText, audit.markers);
  if (detectedMarkers.length === 0) {
    return;
  }

  if (!audit.submittedAt) {
    markSubmitted(audit, "network request with dummy marker detected");
  }

  const requestRecord = {
    requestId: details.requestId,
    endpoint: details.url,
    method: details.method,
    statusCode: null,
    detectedMarkers,
    timestamp: Date.now(),
    graphqlMutation: isGraphqlMutation,
    error: "",
  };

  audit.requests.push(requestRecord);
  pendingRequests.set(details.requestId, { tabId: audit.tabId, auditId: audit.id });
  broadcastAudit(audit);
}

function completeRequest(requestId, statusCode) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  pendingRequests.delete(requestId);

  const audit = activeAudits.get(pending.tabId);
  if (!audit || audit.id !== pending.auditId || audit.verdict) {
    return;
  }

  const request = audit.requests.find((item) => item.requestId === requestId);
  if (!request) return;

  request.statusCode = statusCode;
  finishAudit(audit, "YES", "Dummy marker was found inside a non-analytics server request.");
}

function failRequest(requestId, error) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  pendingRequests.delete(requestId);

  const audit = activeAudits.get(pending.tabId);
  if (!audit || audit.id !== pending.auditId || audit.verdict) {
    return;
  }

  const request = audit.requests.find((item) => item.requestId === requestId);
  if (request) {
    request.error = error;
    broadcastAudit(audit);
  }
}

function markSubmitted(audit, reason) {
  if (audit.submittedAt || audit.verdict) {
    return;
  }

  audit.submittedAt = Date.now();
  audit.deadlineAt = audit.submittedAt + AUDIT_WINDOW_MS;
  audit.status = "WATCHING_REQUESTS";
  audit.reason = reason;

  clearTimeout(audit.timers.maxWait);
  audit.timers.auditWindow = setTimeout(() => {
    finishAudit(audit, "NO", "No request containing the submitted dummy data was detected.");
  }, AUDIT_WINDOW_MS);

  broadcastAudit(audit);
}

async function finishAudit(audit, verdict, reason) {
  if (audit.verdict) return;

  audit.verdict = verdict;
  audit.reason = reason;
  audit.status = "DONE";
  audit.finishedAt = Date.now();
  clearAuditTimers(audit);

  await saveHistory(publicAudit(audit));
  broadcastAudit(audit);
}

function clearAuditTimers(audit) {
  Object.values(audit.timers || {}).forEach((timer) => clearTimeout(timer));
  audit.timers = {};
}

function extractRequestText(details) {
  const pieces = [details.url || ""];
  const body = details.requestBody;
  if (!body) return pieces.join("\n");

  if (body.formData) {
    for (const [key, values] of Object.entries(body.formData)) {
      pieces.push(key);
      pieces.push(...values);
    }
  }

  if (body.raw) {
    for (const part of body.raw) {
      if (!part.bytes) continue;
      try {
        pieces.push(new TextDecoder("utf-8").decode(part.bytes));
      } catch {
        pieces.push(String(part.bytes));
      }
    }
  }

  return pieces.join("\n").slice(0, 250_000);
}

function detectMarkers(text, markers) {
  return Object.entries(markers)
    .filter(([, value]) => markerVariants(value).some((variant) => text.includes(variant)))
    .map(([key]) => MARKER_LABELS[key] || key);
}

function markerVariants(value) {
  return [value, encodeURIComponent(value), encodeURI(value), value.replace(/\s/g, "+")];
}

function isAnalyticsUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    return ANALYTICS_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return true;
  }
}

function buildMarkers(id) {
  const hex = crypto.getRandomValues(new Uint8Array(20));
  const wallet = `0x${Array.from(hex, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const suffix = id.replace(/-/g, "").slice(0, 12).toLowerCase();

  return {
    wallet,
    twitter: `audit_${suffix}`,
    email: `audit_${suffix}@example.com`,
    name: `Audit User ${suffix}`,
  };
}

function makeAuditId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function publicAudit(audit) {
  const remainingMs = audit.deadlineAt ? Math.max(0, audit.deadlineAt - Date.now()) : null;
  return {
    id: audit.id,
    tabId: audit.tabId,
    targetUrl: audit.targetUrl,
    host: audit.host,
    startedAt: audit.startedAt,
    submittedAt: audit.submittedAt,
    deadlineAt: audit.deadlineAt,
    finishedAt: audit.finishedAt,
    status: audit.status,
    verdict: audit.verdict,
    reason: audit.reason,
    markers: audit.markers,
    requests: audit.requests.map(({ requestId, ...request }) => request),
    remainingMs,
    auditWindowMs: AUDIT_WINDOW_MS,
    ignoredAnalyticsDomains: ANALYTICS_DOMAINS,
  };
}

async function getActiveAuditResponse() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const audit = tab?.id ? activeAudits.get(tab.id) : null;
  return { ok: true, audit: audit ? publicAudit(audit) : null };
}

function broadcastAudit(audit) {
  chrome.runtime.sendMessage({ type: "AUDIT_UPDATE", audit: publicAudit(audit) }).catch(() => {});
}

async function loadHistory() {
  const { auditHistory = [] } = await chrome.storage.local.get({ auditHistory: [] });
  return auditHistory;
}

async function saveHistory(audit) {
  const history = await loadHistory();
  const nextHistory = [
    {
      id: audit.id,
      targetUrl: audit.targetUrl,
      host: audit.host,
      startedAt: audit.startedAt,
      finishedAt: audit.finishedAt,
      verdict: audit.verdict,
      reason: audit.reason,
      requests: audit.requests,
    },
    ...history,
  ].slice(0, HISTORY_LIMIT);

  await chrome.storage.local.set({ auditHistory: nextHistory });
}
