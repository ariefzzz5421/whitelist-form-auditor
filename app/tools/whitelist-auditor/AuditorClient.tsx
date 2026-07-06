"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { getStatusMeaning } from "@/lib/audit/status-meaning";

type Verdict = "YES" | "NO_EVIDENCE" | "INCONCLUSIVE";
type FieldKey = "xHandle" | "wallet" | "email" | "name";
type StepStatus = "done" | "failed" | "skipped";
type VisibleStepStatus = StepStatus | "pending" | "active";

interface StatusChainItem {
  status: number;
  url: string;
}

interface AuditStep {
  label: string;
  status: StepStatus;
}

interface AuditResponse {
  verdict: Verdict;
  message: string;
  confidence?: "HIGH";
  auditId: string;
  targetUrl: string;
  dummyData: Record<FieldKey | "marker", string>;
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
  debug: {
    pageLoaded: boolean;
    formDetected: boolean;
    fieldsFilledCount: number;
    submitClicked: boolean;
    requestsObserved: number;
    analyticsIgnored: number;
    relevantRequests: number;
    matchingRequests: number;
  };
  steps: AuditStep[];
}

const PROGRESS_STEPS = [
  "Opening page",
  "Detecting form",
  "Filling dummy data",
  "Submitting",
  "Inspecting requests",
  "Result",
];

const FIELD_LABELS: Record<FieldKey, string> = {
  xHandle: "X Handle",
  wallet: "Wallet",
  email: "Email",
  name: "Name",
};

export default function AuditorClient() {
  const [targetUrl, setTargetUrl] = useState("");
  const [report, setReport] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading) return;

    const timer = window.setInterval(() => {
      setLoadingIndex((value) => Math.min(value + 1, PROGRESS_STEPS.length - 1));
    }, 2_200);

    return () => window.clearInterval(timer);
  }, [loading]);

  const visibleSteps = useMemo<Array<{ label: string; status: VisibleStepStatus }>>(() => {
    if (report?.steps?.length) {
      return PROGRESS_STEPS.map((label) => {
        const existing = report.steps.find((step) => step.label === label);
        return { label, status: existing?.status || "skipped" };
      });
    }

    return PROGRESS_STEPS.map((label, index) => ({
      label,
      status: index < loadingIndex ? "done" : index === loadingIndex && loading ? "active" : "pending",
    }));
  }, [loading, loadingIndex, report]);

  async function runAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setReport(null);
    setLoadingIndex(0);
    setLoading(true);

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: normalizeUrl(targetUrl) }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Audit failed.");
      }

      setReport(payload as AuditResponse);
    } catch (auditError) {
      setError(auditError instanceof Error ? auditError.message : "Audit failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#070b10] px-4 py-5 text-slate-100 sm:px-6">
      <div className="pointer-events-none fixed inset-0 opacity-30 [background-image:linear-gradient(rgba(34,211,238,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,.08)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 inline-flex rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
              Remote browser audit
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Whitelist Form Auditor</h1>
            <p className="mt-2 text-sm text-slate-400">
              Verify whether submitted dummy data actually leaves the browser.
            </p>
          </div>
          <div className="rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-400">
            Browserless + Playwright
          </div>
        </header>

        <section className="rounded-lg border border-white/10 bg-slate-950/75 p-3 shadow-2xl shadow-black/20">
          <form className="grid gap-3 md:grid-cols-[1fr_auto]" onSubmit={runAudit}>
            <label className="sr-only" htmlFor="target-url">
              Target URL
            </label>
            <input
              id="target-url"
              value={targetUrl}
              onChange={(event) => setTargetUrl(event.target.value)}
              placeholder="https://example.com/waitlist"
              className="h-12 rounded-md border border-white/10 bg-black/30 px-4 font-mono text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-400/20"
            />
            <button
              type="submit"
              disabled={loading}
              className="h-12 rounded-md bg-cyan-300 px-5 text-sm font-bold uppercase tracking-[0.12em] text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {loading ? "Running..." : "Run Audit"}
            </button>
          </form>

          {error ? (
            <div className="mt-3 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}
        </section>

        {(loading || report) && <ProgressStepper steps={visibleSteps} />}

        {report ? <ResultDashboard report={report} /> : null}
      </div>
    </main>
  );
}

function ProgressStepper({
  steps,
}: {
  steps: Array<{ label: string; status: VisibleStepStatus }>;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-slate-950/70 p-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className={`rounded-md border px-3 py-2 ${
              step.status === "done"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                : step.status === "failed"
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
                  : step.status === "active"
                    ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-100"
                    : "border-white/10 bg-white/[0.03] text-slate-500"
            }`}
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">
              Step {index + 1}
            </div>
            <div className="mt-1 text-xs font-semibold">{step.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ResultDashboard({ report }: { report: AuditResponse }) {
  const resultStyle = getResultStyle(report.verdict);
  const statusChain = report.statusChain || [];
  const firstStatus = statusChain[0]?.status ?? report.status ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
      <section className={`rounded-lg border p-4 ${resultStyle.card}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">Result</div>
            <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{resultStyle.title}</h2>
            <p className="mt-1 text-sm font-semibold">{resultStyle.subtitle}</p>
          </div>
          {report.confidence ? (
            <span className="w-fit rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-bold text-emerald-100">
              HIGH CONFIDENCE
            </span>
          ) : null}
        </div>

        {report.verdict === "INCONCLUSIVE" ? (
          <p className="mt-4 rounded-md border border-amber-300/20 bg-black/20 px-3 py-2 text-sm text-amber-100">
            Reason: {report.reason || "Browser automation could not verify this page."}
          </p>
        ) : null}

        {report.verdict === "NO_EVIDENCE" ? (
          <p className="mt-4 rounded-md border border-red-300/20 bg-black/20 px-3 py-2 text-sm text-red-100">
            No request containing the generated dummy markers was detected.
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Method" value={report.request?.method || "None"} />
          <Metric label="Endpoint" value={report.request?.endpointDomain || "None"} />
          <Metric label="Status" value={formatStatusChain(statusChain, report.status)} />
          <Metric label="Matched fields" value={String(report.matchedFields.length)} />
        </div>

        <p className="mt-4 text-xs leading-5 text-slate-400">
          Verified means the dummy marker was observed in an outgoing server request. It does not prove permanent
          database storage.
        </p>
      </section>

      <TechnicalDetails report={report} />

      <DummyDataSection report={report} />
      <RequestEvidence report={report} />
      <StatusMeaningSection statusChain={statusChain} fallbackStatus={firstStatus} />
    </div>
  );
}

function DummyDataSection({ report }: { report: AuditResponse }) {
  return (
    <section className="rounded-lg border border-white/10 bg-slate-950/70 p-4 lg:col-span-1">
      <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Dummy Data Used</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {FIELD_KEYS.map((field) => (
          <DummyValueCard
            key={field}
            label={FIELD_LABELS[field]}
            value={report.dummyData[field]}
            filled={report.filledFields[field]}
            matched={report.matchedFields.includes(field)}
          />
        ))}
      </div>
    </section>
  );
}

function DummyValueCard({
  label,
  value,
  filled,
  matched,
}: {
  label: string;
  value: string;
  filled: boolean;
  matched: boolean;
}) {
  const status = matched ? "FILLED · MATCHED" : filled ? "FILLED" : "NOT USED";
  const statusClass = matched
    ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
    : filled
      ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
      : "border-white/10 bg-white/[0.03] text-slate-500";

  return (
    <div className="rounded-md border border-white/10 bg-black/25 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass}`}>{status}</span>
      </div>
      <div className="mt-2 break-all font-mono text-xs text-slate-100">{value}</div>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(value)}
        className="mt-3 rounded border border-white/10 px-2 py-1 text-xs font-semibold text-slate-300 transition hover:border-cyan-300/40 hover:text-cyan-100"
      >
        Copy
      </button>
    </div>
  );
}

function RequestEvidence({ report }: { report: AuditResponse }) {
  return (
    <section className="rounded-lg border border-white/10 bg-slate-950/70 p-4">
      <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Request Evidence</h3>
      <div className="mt-3 grid gap-2">
        <EvidenceRow label="Method" value={report.request?.method || "None"} />
        <EvidenceRow label="Endpoint domain" value={report.request?.endpointDomain || "None"} />
        <EvidenceRow label="Status chain" value={formatStatusChain(report.statusChain || [], report.status)} />
        <EvidenceRow label="Matched fields" value={formatFields(report.matchedFields)} />
      </div>
    </section>
  );
}

function StatusMeaningSection({
  statusChain,
  fallbackStatus,
}: {
  statusChain: StatusChainItem[];
  fallbackStatus: number | null;
}) {
  const statuses = statusChain.length > 0 ? statusChain.map((item) => item.status) : fallbackStatus ? [fallbackStatus] : [];

  return (
    <section className="rounded-lg border border-white/10 bg-slate-950/70 p-4 lg:col-span-2">
      <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">What The Status Means</h3>
      {statuses.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No response status was captured.</p>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {statuses.map((status, index) => {
            const meaning = getStatusMeaning(status);
            return (
              <div key={`${status}-${index}`} className="rounded-md border border-white/10 bg-black/25 p-3">
                <div className="font-mono text-sm font-bold text-white">
                  {status} {meaning.title}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-300">{meaning.meaning}</p>
                {meaning.note ? <p className="mt-2 text-xs leading-5 text-slate-500">Important: {meaning.note}</p> : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TechnicalDetails({ report }: { report: AuditResponse }) {
  return (
    <details className="rounded-lg border border-white/10 bg-slate-950/70 p-4" open>
      <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
        Technical Details
      </summary>
      <div className="mt-3 grid gap-2 text-sm">
        <EvidenceRow label="Page loaded" value={yesNo(report.debug.pageLoaded)} />
        <EvidenceRow label="Form detected" value={yesNo(report.debug.formDetected)} />
        <EvidenceRow label="Fields filled" value={String(report.debug.fieldsFilledCount)} />
        <EvidenceRow label="Submit clicked" value={yesNo(report.debug.submitClicked)} />
        <EvidenceRow label="Requests observed" value={String(report.debug.requestsObserved)} />
        <EvidenceRow label="Analytics ignored" value={String(report.debug.analyticsIgnored)} />
        <EvidenceRow label="Matching requests" value={String(report.debug.matchingRequests)} />
      </div>
    </details>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/25 p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-2 break-all font-mono text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-white/10 bg-black/20 px-3 py-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="break-all text-right font-mono text-xs font-semibold text-slate-100">{value}</span>
    </div>
  );
}

function getResultStyle(verdict: Verdict) {
  if (verdict === "YES") {
    return {
      title: "✅ VERIFIED",
      subtitle: "Data sent to server",
      card: "border-emerald-300/25 bg-emerald-400/[0.08] text-emerald-100",
    };
  }

  if (verdict === "NO_EVIDENCE") {
    return {
      title: "❌ NO MATCH FOUND",
      subtitle: "No matching server submission detected",
      card: "border-red-300/25 bg-red-400/[0.08] text-red-100",
    };
  }

  return {
    title: "⚠️ COULDN'T VERIFY",
    subtitle: "Audit ended before proof could be collected",
    card: "border-amber-300/25 bg-amber-400/[0.08] text-amber-100",
  };
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function formatStatusChain(statusChain: StatusChainItem[], fallbackStatus?: number | null) {
  if (statusChain.length > 0) {
    return statusChain.map((item) => item.status).join(" → ");
  }
  return typeof fallbackStatus === "number" ? String(fallbackStatus) : "None";
}

function formatFields(fields: FieldKey[]) {
  if (fields.length === 0) {
    return "None";
  }
  return fields.map((field) => FIELD_LABELS[field]).join(", ");
}

function yesNo(value: boolean) {
  return value ? "✓" : "No";
}

const FIELD_KEYS: FieldKey[] = ["xHandle", "wallet", "email", "name"];
