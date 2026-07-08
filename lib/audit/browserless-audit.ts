import { randomBytes } from "node:crypto";
import type { Browser, Page, Request, Response } from "playwright-core";
import { chromium } from "playwright-core";
import { validateNavigationUrl } from "@/lib/audit/security";

const PAGE_LOAD_TIMEOUT_MS = 25_000;
const EVIDENCE_WAIT_MS = 12_000;
const FILL_TIMEOUT_MS = 2_500;
const SUBMIT_TIMEOUT_MS = 3_000;
const OUTBOUND_METHODS = new Set(["POST", "PUT", "PATCH", "GET"]);
const SECRET_HEADER_PATTERN = /^(authorization|cookie|set-cookie|x-api-key|api-key|proxy-authorization)$/i;

export type AuditVerdict =
  | "CONFIRMED_SENT"
  | "SENT_BUT_REJECTED"
  | "NO_SUBMISSION_DETECTED"
  | "INCONCLUSIVE"
  | "AUDIT_ERROR";

export type FieldKind = "username" | "email" | "xHandle" | "discord" | "telegram" | "evmWallet" | "solanaWallet";
export type ProgressPercent = 10 | 20 | 35 | 50 | 65 | 75 | 85 | 95 | 100;

export interface AuditProgressEvent {
  progress: ProgressPercent;
  label: string;
}

export interface DetectedField {
  kind: FieldKind;
  label: string;
  required: boolean;
  selector: string;
}

export interface AuditDummyData extends Record<FieldKind, string> {
  runId: string;
}

export interface RequestEvidence {
  method: string;
  endpointDomain: string;
  endpointPath: string;
  statusCode: number | null;
  responseTimeMs: number | null;
  markersFound: Record<FieldKind, boolean>;
  sanitizedResponsePreview: string;
}

export interface BrowserlessAuditResponse {
  verdict: AuditVerdict;
  message: string;
  runId: string;
  targetUrl: string;
  detectedFields: DetectedField[];
  dummyData: AuditDummyData;
  evidence: RequestEvidence | null;
  progress: AuditProgressEvent[];
  reason?: string;
}

type ProgressSink = (event: AuditProgressEvent) => void;

interface CandidateField extends DetectedField {
  index: number;
  score: number;
}

interface TrackedRequest {
  request: Request;
  startedAt: number;
  evidence: RequestEvidence;
}

const FIELD_KINDS: FieldKind[] = ["username", "email", "xHandle", "discord", "telegram", "evmWallet", "solanaWallet"];

export async function runBrowserlessAudit(targetUrl: URL, onProgress?: ProgressSink): Promise<BrowserlessAuditResponse> {
  const progress: AuditProgressEvent[] = [];
  const emit = (progressValue: ProgressPercent, label: string) => {
    const event = { progress: progressValue, label };
    progress.push(event);
    onProgress?.(event);
  };

  const runId = randomBytes(3).toString("hex");
  const dummyData = buildDummyData(runId);
  let browser: Browser | null = null;
  let page: Page | null = null;
  const tracked = new Map<Request, TrackedRequest>();
  const matches: TrackedRequest[] = [];
  let submitted = false;

  try {
    emit(10, "target validated");
    const token = process.env.BROWSERLESS_TOKEN;
    if (!token) {
      emit(100, "complete");
      return baseReport("AUDIT_ERROR", "Browserless is not configured.", runId, targetUrl, dummyData, progress, [], null, "BROWSERLESS_TOKEN is missing.");
    }

    browser = await chromium.connectOverCDP(buildBrowserlessEndpoint(token), { timeout: 20_000 });
    emit(20, "remote browser connected");
    const context = browser.contexts()[0] || (await browser.newContext());
    page = await context.newPage();

    page.on("request", (request) => {
      if (!submitted || !OUTBOUND_METHODS.has(request.method().toUpperCase())) return;
      const evidence = inspectOutboundRequest(request, dummyData);
      if (!evidence) return;
      const item = { request, startedAt: Date.now(), evidence };
      tracked.set(request, item);
      matches.push(item);
      emitOnce(progress, emit, 85, "submission observed");
    });

    page.on("response", async (response) => {
      const item = tracked.get(response.request());
      if (!item) return;
      item.evidence.statusCode = response.status();
      item.evidence.responseTimeMs = Date.now() - item.startedAt;
      item.evidence.sanitizedResponsePreview = await sanitizedPreview(response);
    });

    page.on("framenavigated", (frame) => {
      if (frame === page?.mainFrame()) validateNavigationUrl(frame.url());
    });

    await page.goto(targetUrl.toString(), { waitUntil: "domcontentloaded", timeout: PAGE_LOAD_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    emit(35, "page loaded");

    const blocker = await detectBlocker(page);
    if (blocker) { emitOnce(progress, emit, 100, "complete"); return inconclusive(runId, targetUrl, dummyData, progress, blocker); }

    const fields = await detectRequiredFields(page);
    emit(50, "fields detected");
    if (fields.length === 0) { emitOnce(progress, emit, 100, "complete"); return inconclusive(runId, targetUrl, dummyData, progress, "No visible required supported form fields were detected."); }

    emit(65, "dummy data prepared");
    const filled = await fillFields(page, fields, dummyData);
    if (filled === 0) { emitOnce(progress, emit, 100, "complete"); return inconclusive(runId, targetUrl, dummyData, progress, "Detected fields could not be filled."); }
    emit(75, "form filled");

    const blockerBeforeSubmit = await detectBlocker(page);
    if (blockerBeforeSubmit) { emitOnce(progress, emit, 100, "complete"); return inconclusive(runId, targetUrl, dummyData, progress, blockerBeforeSubmit); }

    submitted = true;
    const clicked = await submitOnce(page);
    if (!clicked) { emitOnce(progress, emit, 100, "complete"); return inconclusive(runId, targetUrl, dummyData, progress, "No safe submit control was detected."); }

    await page.waitForTimeout(EVIDENCE_WAIT_MS);
    const winner = matches[0]?.evidence || null;
    emit(95, "response analyzed");
    emit(100, "complete");

    if (!winner) {
      return baseReport("NO_SUBMISSION_DETECTED", "Submit was triggered, but no outbound request containing a dummy marker was observed.", runId, targetUrl, dummyData, progress, fields, null);
    }

    const status = winner.statusCode;
    const rejected = typeof status === "number" && (status >= 400 || status === 0);
    return baseReport(
      rejected ? "SENT_BUT_REJECTED" : "CONFIRMED_SENT",
      rejected ? "A dummy marker left the browser, but the target returned a rejection or error response." : "A unique dummy marker was detected in an outbound request.",
      runId,
      targetUrl,
      dummyData,
      progress,
      fields,
      winner,
    );
  } catch (error) {
    emitOnce(progress, emit, 100, "complete");
    return baseReport("AUDIT_ERROR", "The auditor failed before it could produce reliable evidence.", runId, targetUrl, dummyData, progress, [], null, error instanceof Error ? error.message : "Internal audit error.");
  } finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

function baseReport(verdict: AuditVerdict, message: string, runId: string, targetUrl: URL, dummyData: AuditDummyData, progress: AuditProgressEvent[], detectedFields: DetectedField[], evidence: RequestEvidence | null, reason?: string): BrowserlessAuditResponse {
  return { verdict, message, runId, targetUrl: targetUrl.toString(), detectedFields, dummyData, evidence, progress, reason };
}

function inconclusive(runId: string, targetUrl: URL, dummyData: AuditDummyData, progress: AuditProgressEvent[], reason: string) {
  emitComplete(progress);
  return baseReport("INCONCLUSIVE", "The audit could not reach a reliable conclusion.", runId, targetUrl, dummyData, progress, [], null, reason);
}

function emitComplete(progress: AuditProgressEvent[]) {
  if (!progress.some((event) => event.progress === 100)) progress.push({ progress: 100, label: "complete" });
}
function emitOnce(events: AuditProgressEvent[], emit: (progress: ProgressPercent, label: string) => void, progress: ProgressPercent, label: string) {
  if (!events.some((event) => event.progress === progress)) emit(progress, label);
}

function buildDummyData(runId: string): AuditDummyData {
  return {
    runId,
    username: `audit_${runId}`,
    email: `audit-${runId}@example.com`,
    xHandle: `@audit_${runId}`,
    discord: `audit_${runId}`,
    telegram: `audit_${runId}`,
    evmWallet: `0x${runId.padEnd(40, "a")}`,
    solanaWallet: `${runId}${"So11111111111111111111111111111111111111112".slice(runId.length)}`,
  };
}

function buildBrowserlessEndpoint(token: string) {
  const endpoint = new URL(process.env.BROWSERLESS_WS_URL || "wss://production-sfo.browserless.io");
  if (!endpoint.searchParams.has("token")) endpoint.searchParams.set("token", token);
  return endpoint.toString();
}

async function detectRequiredFields(page: Page): Promise<DetectedField[]> {
  const raw = await page.locator("input, textarea").evaluateAll((elements) => elements.map((element, index) => {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    const rect = input.getBoundingClientRect();
    const style = window.getComputedStyle(input);
    const id = input.id || "";
    const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || "" : "";
    return {
      index,
      selector: `input, textarea >> nth=${index}`,
      required: input.required || input.getAttribute("aria-required") === "true",
      type: (input.getAttribute("type") || input.tagName || "text").toLowerCase(),
      label: [label, input.closest("label")?.textContent || "", input.getAttribute("name") || "", input.id || "", input.getAttribute("placeholder") || "", input.getAttribute("autocomplete") || "", input.getAttribute("aria-label") || ""].join(" ").trim(),
      visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
      disabled: input.disabled,
      readOnly: input.readOnly,
    };
  }));

  const candidates: CandidateField[] = [];
  for (const field of raw) {
    if (!field.required || !field.visible || field.disabled || field.readOnly) continue;
    if (!["", "text", "email", "url", "search", "textarea"].includes(field.type)) continue;
    for (const kind of FIELD_KINDS) {
      const score = scoreField(`${field.type} ${field.label}`.toLowerCase(), kind);
      if (score > 0) candidates.push({ kind, label: field.label || kind, required: true, selector: field.selector, index: field.index, score });
    }
  }

  const usedKinds = new Set<FieldKind>();
  const usedIndexes = new Set<number>();
  return candidates.sort((a, b) => b.score - a.score).filter((candidate) => {
    if (usedKinds.has(candidate.kind) || usedIndexes.has(candidate.index)) return false;
    usedKinds.add(candidate.kind);
    usedIndexes.add(candidate.index);
    return true;
  });
}

function scoreField(text: string, kind: FieldKind) {
  const patterns: Record<FieldKind, RegExp[]> = {
    username: [/user\s*name|username|name/],
    email: [/\bemail\b|e-mail/],
    xHandle: [/x\/twitter|twitter|x handle|\bx\b|handle/],
    discord: [/discord/],
    telegram: [/telegram|\btg\b/],
    evmWallet: [/evm|ethereum|wallet|0x|address/],
    solanaWallet: [/solana|\bsol\b|wallet|address/],
  };
  if (kind === "email" && text.includes("email")) return 30;
  const index = patterns[kind].findIndex((pattern) => pattern.test(text));
  return index === -1 ? 0 : 20 - index;
}

async function fillFields(page: Page, fields: DetectedField[], dummyData: AuditDummyData) {
  let filled = 0;
  for (const field of fields) {
    const index = Number(field.selector.split("nth=")[1]);
    const ok = await page.locator("input, textarea").nth(index).fill(dummyData[field.kind], { timeout: FILL_TIMEOUT_MS }).then(() => true).catch(() => false);
    if (ok) filled += 1;
  }
  return filled;
}

async function submitOnce(page: Page) {
  const locator = page.locator('button[type="submit"], input[type="submit"], button, [role="button"]').filter({ hasText: /submit|join|apply|send|register|sign up|continue/i }).first();
  return locator.click({ timeout: SUBMIT_TIMEOUT_MS }).then(() => true).catch(async () => {
    return page.locator("form").first().evaluate((form) => (form as HTMLFormElement).requestSubmit()).then(() => true).catch(() => false);
  });
}

async function detectBlocker(page: Page) {
  const text = await page.locator("body").innerText({ timeout: 2_000 }).then((value) => value.toLowerCase()).catch(() => "");
  if (/captcha|recaptcha|hcaptcha|turnstile|cf-challenge/.test(text)) return "CAPTCHA or bot challenge prevented a conclusion.";
  if (/\blog in\b|\blogin\b|\bsign in\b/.test(text)) return "Login prevented a conclusion.";
  if (/connect wallet|walletconnect|metamask|sign message|signature required|sign transaction/.test(text)) return "Wallet signature or access control prevented a conclusion.";
  return "";
}

function inspectOutboundRequest(request: Request, dummyData: AuditDummyData): RequestEvidence | null {
  const text = searchableRequestText(request);
  const markersFound = Object.fromEntries(FIELD_KINDS.map((kind) => [kind, includesMarker(text, dummyData[kind])])) as Record<FieldKind, boolean>;
  if (!Object.values(markersFound).some(Boolean)) return null;
  const url = new URL(request.url());
  return { method: request.method().toUpperCase(), endpointDomain: url.hostname, endpointPath: `${url.pathname}${url.search}`, statusCode: null, responseTimeMs: null, markersFound, sanitizedResponsePreview: "" };
}

function searchableRequestText(request: Request) {
  const parts = [request.url(), request.postData() || ""];
  const post = request.postData() || "";
  try { parts.push(decodeURIComponent(post)); } catch {}
  try { parts.push(JSON.stringify(request.postDataJSON())); } catch {}
  return parts.join("\n").toLowerCase();
}

function includesMarker(text: string, marker: string) {
  const lower = marker.toLowerCase();
  return text.includes(lower) || text.includes(encodeURIComponent(marker).toLowerCase());
}

async function sanitizedPreview(response: Response) {
  for (const name of Object.keys(response.headers())) {
    if (SECRET_HEADER_PATTERN.test(name)) return "[response preview withheld because sensitive headers were present]";
  }
  const contentType = response.headers()["content-type"] || "";
  if (!/json|text|html|xml|plain/i.test(contentType)) return "[non-text response omitted]";
  return response.text().then((body) => body.replace(/(authorization|cookie|set-cookie|api[_-]?key|token|secret)[^\n,}]*/gi, "$1=[redacted]").slice(0, 600)).catch(() => "");
}
