"use client";

import { FormEvent, useMemo, useState } from "react";
import { STATUS_CODE_LAB } from "@/lib/audit/status-meaning";

type Verdict = "CONFIRMED_SENT" | "SENT_BUT_REJECTED" | "NO_SUBMISSION_DETECTED" | "INCONCLUSIVE" | "AUDIT_ERROR";
type FieldKind = "username" | "email" | "xHandle" | "discord" | "telegram" | "evmWallet" | "solanaWallet";

interface ProgressEvent { progress: number; label: string; }
interface DetectedField { kind: FieldKind; label: string; required: boolean; }
interface Evidence { method: string; endpointDomain: string; endpointPath: string; statusCode: number | null; responseTimeMs: number | null; markersFound: Record<FieldKind, boolean>; sanitizedResponsePreview: string; }
interface AuditResponse { verdict: Verdict; message: string; runId: string; targetUrl: string; detectedFields: DetectedField[]; dummyData: Record<FieldKind | "runId", string>; evidence: Evidence | null; progress: ProgressEvent[]; reason?: string; }

const FIELD_LABELS: Record<FieldKind, string> = { username: "Username", email: "Email", xHandle: "X/Twitter", discord: "Discord", telegram: "Telegram", evmWallet: "EVM wallet", solanaWallet: "Solana wallet" };
const FIELD_KEYS = Object.keys(FIELD_LABELS) as FieldKind[];

export default function AuditorClient() {
  const [targetUrl, setTargetUrl] = useState("");
  const [report, setReport] = useState<AuditResponse | null>(null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const formattedUrl = useMemo(() => normalizeUrl(targetUrl), [targetUrl]);

  async function runAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError(""); setReport(null); setEvents([]);
    try {
      const response = await fetch("/api/audit", { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify({ url: formattedUrl, stream: true }) });
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => null))?.error || "Audit failed.");
      await readEventStream(response.body, (type, data) => {
        if (type === "progress") setEvents((current) => [...current, data as ProgressEvent]);
        if (type === "complete") setReport(data as AuditResponse);
        if (type === "error") throw new Error((data as { error?: string }).error || "Audit failed.");
      });
    } catch (auditError) {
      setError(auditError instanceof Error ? auditError.message : "Audit failed.");
    } finally {
      setLoading(false);
    }
  }

  const visibleProgress = report?.progress?.length ? report.progress : events;
  const percent = visibleProgress.at(-1)?.progress || 0;

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-6 text-zinc-950 sm:px-6">
      <div className="mx-auto grid w-full max-w-6xl gap-5 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-5">
          <header className="border-b border-zinc-200 pb-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">Evidence-based remote browser audit</p>
            <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Whitelist Form Auditor</h1>
            <p className="mt-3 text-sm leading-6 text-zinc-600 sm:text-base">Determines whether unique dummy data leaves the remote browser in an outbound request after one form submission. It never claims database persistence.</p>
          </header>

          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <form className="flex flex-col gap-3" onSubmit={runAudit}>
              <label className="flex flex-col gap-2"><span className="text-sm font-medium text-zinc-700">Website whitelist / waitlist</span><input value={targetUrl} onBlur={() => targetUrl && setTargetUrl(formattedUrl)} onChange={(event) => setTargetUrl(event.target.value)} placeholder="example.com/whitelist" className="h-12 rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-sky-600 focus:ring-2 focus:ring-sky-100" /></label>
              {targetUrl ? <div className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-900">Auto format: <span className="font-mono">{formattedUrl}</span></div> : null}
              <button type="submit" disabled={loading || !targetUrl.trim()} className="h-12 rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400">{loading ? "AUDITING..." : "RUN AUDIT"}</button>
            </form>
            {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
          </section>

          {(loading || visibleProgress.length > 0) ? <ProgressPanel percent={percent} events={visibleProgress} /> : null}
          {report ? <ResultCard report={report} /> : null}
        </div>
        <StatusCodeLab />
      </div>
    </main>
  );
}

async function readEventStream(body: ReadableStream<Uint8Array>, onEvent: (type: string, data: unknown) => void) {
  const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  while (true) {
    const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n"); buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const type = chunk.match(/^event: (.+)$/m)?.[1] || "message"; const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (data) onEvent(type, JSON.parse(data));
    }
  }
}

function ProgressPanel({ percent, events }: { percent: number; events: ProgressEvent[] }) {
  return <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-500">Live backend progress</p><p className="font-mono text-sm font-bold">{percent}%</p></div><div className="mt-4 h-3 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-sky-600 transition-all duration-500" style={{ width: `${percent}%` }} /></div><div className="mt-4 grid gap-2">{events.map((event, index) => <div key={`${event.progress}-${index}`} className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-950"><span className="font-mono font-semibold">{event.progress}</span> {event.label}</div>)}</div></section>;
}

function ResultCard({ report }: { report: AuditResponse }) {
  const color = verdictClass(report.verdict);
  return <section className={`rounded-2xl border p-5 shadow-sm ${color}`}><p className="text-sm font-semibold uppercase tracking-[0.14em]">Verdict</p><h2 className="mt-3 text-3xl font-bold">{report.verdict}</h2><p className="mt-2 text-sm leading-6">{report.message}</p>{report.reason ? <p className="mt-2 text-sm font-medium">Reason: {report.reason}</p> : null}<div className="mt-4 grid gap-3 sm:grid-cols-2"><InfoBox label="Request method" value={report.evidence?.method || "None"} /><InfoBox label="Endpoint domain/path" value={report.evidence ? `${report.evidence.endpointDomain}${report.evidence.endpointPath}` : "None"} /><InfoBox label="Status code" value={String(report.evidence?.statusCode ?? "None")} /><InfoBox label="Response time" value={report.evidence?.responseTimeMs == null ? "None" : `${report.evidence.responseTimeMs} ms`} /></div><DetectedFields report={report} /><DummyData report={report} /><ResponsePreview preview={report.evidence?.sanitizedResponsePreview || "No response preview captured."} /></section>;
}
function DetectedFields({ report }: { report: AuditResponse }) { return <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4"><h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-500">Detected required fields</h3><div className="mt-3 flex flex-wrap gap-2">{report.detectedFields.length ? report.detectedFields.map((field) => <span key={`${field.kind}-${field.label}`} className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold">{FIELD_LABELS[field.kind]} · required</span>) : <span className="text-sm text-zinc-500">None</span>}</div></section>; }
function DummyData({ report }: { report: AuditResponse }) { return <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-4"><h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-500">Exact dummy data and marker matches</h3><div className="mt-3 grid gap-2">{FIELD_KEYS.map((field) => <div key={field} className="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 sm:grid-cols-[130px_1fr_110px]"><span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">{FIELD_LABELS[field]}</span><span className="break-all font-mono text-xs">{report.dummyData[field]}</span><span className={`rounded-full px-2 py-1 text-center text-[11px] font-bold ${report.evidence?.markersFound?.[field] ? "bg-emerald-100 text-emerald-800" : "bg-zinc-200 text-zinc-600"}`}>{report.evidence?.markersFound?.[field] ? "FOUND" : "NOT FOUND"}</span></div>)}</div></section>; }
function ResponsePreview({ preview }: { preview: string }) { return <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-4"><h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-500">Sanitized response preview</h3><pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-zinc-950 p-3 text-xs text-zinc-50">{preview}</pre></section>; }
function StatusCodeLab() { return <aside className="h-fit rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm lg:sticky lg:top-6"><p className="text-sm font-semibold uppercase tracking-[0.14em] text-sky-700">Status Code Lab</p><h2 className="mt-2 text-2xl font-semibold">What HTTP statuses mean here</h2><div className="mt-4 grid gap-3">{STATUS_CODE_LAB.map((item) => <article key={item.code} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3"><p className="font-mono text-sm font-bold">{item.code} {item.title}</p><p className="mt-2 text-xs leading-5"><strong>General:</strong> {item.generalMeaning}</p><p className="mt-2 text-xs leading-5"><strong>Auditor:</strong> {item.auditorMeaning}</p><p className="mt-2 text-xs leading-5"><strong>Does not prove:</strong> {item.doesNotProve}</p></article>)}</div></aside>; }
function InfoBox({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-zinc-200 bg-white/75 px-3 py-2"><dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{label}</dt><dd className="mt-1 break-all font-medium text-zinc-950">{value}</dd></div>; }
function verdictClass(verdict: Verdict) { if (verdict === "CONFIRMED_SENT") return "border-emerald-200 bg-emerald-50 text-emerald-950"; if (verdict === "SENT_BUT_REJECTED") return "border-amber-200 bg-amber-50 text-amber-950"; if (verdict === "NO_SUBMISSION_DETECTED") return "border-red-200 bg-red-50 text-red-950"; return "border-zinc-300 bg-zinc-100 text-zinc-950"; }
function normalizeUrl(value: string) { const trimmed = value.trim(); if (!trimmed) return ""; return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`; }
