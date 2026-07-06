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

const FIELD_KEYS: FieldKey[] = ["xHandle", "wallet", "email", "name"];
const STUDY_STATUSES = [200, 201, 202, 204, 301, 302, 307, 308, 400, 401, 403, 404, 429, 500, 502, 503, 504];

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

  const formattedUrl = useMemo(() => normalizeUrl(targetUrl), [targetUrl]);
  const hasInput = targetUrl.trim().length > 0;

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
    setTargetUrl(formattedUrl);
    setLoading(true);

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: formattedUrl }),
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
    <main className="min-h-screen bg-zinc-50 px-4 py-6 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="border-b border-zinc-200 pb-5">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
            Remote browser audit
          </p>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Whitelist Form Auditor</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600 sm:text-base">
            Verify whether submitted dummy data actually leaves the browser.
          </p>
        </header>

        <section className="rounded border border-zinc-200 bg-white p-4 shadow-sm">
          <form className="flex flex-col gap-3" onSubmit={runAudit}>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Website whitelist / waitlist</span>
              <input
                value={targetUrl}
                onBlur={() => {
                  if (hasInput) setTargetUrl(formattedUrl);
                }}
                onChange={(event) => setTargetUrl(event.target.value)}
                placeholder="example.com/whitelist"
                className="h-12 rounded border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
              />
            </label>

            {hasInput ? (
              <div className="rounded border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                Auto format: <span className="font-mono">{formattedUrl}</span>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading || !hasInput}
              className="h-12 rounded bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              {loading ? "CHECKING..." : "CHECK"}
            </button>
          </form>

          {error ? (
            <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          ) : null}
        </section>

        {(loading || report) && <ProgressPanel steps={visibleSteps} />}

        {report ? <ResultCard report={report} /> : null}

        <StatusStudy />
      </div>
    </main>
  );
}

function ProgressPanel({ steps }: { steps: Array<{ label: string; status: VisibleStepStatus }> }) {
  const activeStep = steps.find((step) => step.status === "active") || steps.find((step) => step.status === "failed");

  return (
    <section className="rounded border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-500">Audit Progress</p>
      <p className="mt-3 text-xl font-semibold text-zinc-950">{activeStep?.label || "Result"}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {steps.map((step) => (
          <div
            key={step.label}
            className={`rounded border px-3 py-2 text-sm ${
              step.status === "done"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : step.status === "failed"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : step.status === "active"
                    ? "border-sky-200 bg-sky-50 text-sky-900"
                    : "border-zinc-200 bg-zinc-50 text-zinc-500"
            }`}
          >
            {step.label}
          </div>
        ))}
      </div>
    </section>
  );
}

function ResultCard({ report }: { report: AuditResponse }) {
  const statusChain = report.statusChain || [];
  const headline = getHeadline(report);

  return (
    <section className={`rounded border p-5 shadow-sm ${headline.cardClass}`}>
      <p className="text-sm font-semibold uppercase tracking-[0.14em]">Result</p>
      <h2 className="mt-3 text-3xl font-bold">{headline.title}</h2>
      <p className="mt-2 text-sm leading-6">{headline.description}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <InfoBox label="Method" value={report.request?.method || "None"} />
        <InfoBox label="Endpoint domain" value={report.request?.endpointDomain || "None"} />
        <InfoBox label="Status" value={formatStatusChain(statusChain, report.status)} />
        <InfoBox label="Matched dummy fields" value={formatFields(report.matchedFields)} />
      </div>

      <p className="mt-4 rounded border border-zinc-200 bg-white/70 px-3 py-2 text-xs leading-5 text-zinc-700">
        Verified means the dummy marker was observed in an outgoing server request. It does not prove permanent
        database storage.
      </p>

      <DummyData report={report} />
      <RequestEvidence report={report} />
      <TechnicalDetails report={report} />
    </section>
  );
}

function DummyData({ report }: { report: AuditResponse }) {
  return (
    <section className="mt-5 rounded border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-500">Dummy Data Sent / Used</h3>
      <div className="mt-3 grid gap-3">
        {FIELD_KEYS.map((field) => {
          const filled = report.filledFields[field];
          const matched = report.matchedFields.includes(field);
          return (
            <div key={field} className="rounded border border-zinc-200 bg-zinc-50 px-3 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
                    {FIELD_LABELS[field]}
                  </p>
                  <p className="mt-1 break-all font-mono text-sm text-zinc-950">{report.dummyData[field]}</p>
                </div>
                <span className={`w-fit rounded border px-2 py-1 text-xs font-semibold ${dummyBadgeClass(filled, matched)}`}>
                  {dummyBadgeText(filled, matched)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RequestEvidence({ report }: { report: AuditResponse }) {
  const statuses = report.statusChain?.length
    ? report.statusChain.map((item) => item.status)
    : typeof report.status === "number"
      ? [report.status]
      : [];

  return (
    <section className="mt-4 rounded border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-500">Evidence</h3>
      <dl className="mt-3 grid gap-2 text-sm">
        <InfoRow label="Request endpoint" value={report.request?.endpoint || "None"} />
        <InfoRow label="Status chain" value={statuses.length ? statuses.join(" -> ") : "No status captured"} />
        <InfoRow label="Audit ID" value={report.auditId} />
      </dl>
    </section>
  );
}

function TechnicalDetails({ report }: { report: AuditResponse }) {
  return (
    <details className="mt-4 rounded border border-zinc-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold uppercase tracking-[0.12em] text-zinc-500">
        Technical Details
      </summary>
      <dl className="mt-3 grid gap-2 text-sm">
        <InfoRow label="Page loaded" value={yesNo(report.debug.pageLoaded)} />
        <InfoRow label="Form detected" value={yesNo(report.debug.formDetected)} />
        <InfoRow label="Fields filled" value={String(report.debug.fieldsFilledCount)} />
        <InfoRow label="Submit clicked" value={yesNo(report.debug.submitClicked)} />
        <InfoRow label="Requests observed" value={String(report.debug.requestsObserved)} />
        <InfoRow label="Analytics ignored" value={String(report.debug.analyticsIgnored)} />
        <InfoRow label="Matching requests" value={String(report.debug.matchingRequests)} />
      </dl>
    </details>
  );
}

function StatusStudy() {
  return (
    <section className="rounded border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-sky-700">Study Page</p>
      <h2 className="mt-2 text-2xl font-semibold">HTTP Status Code dan Artinya</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-600">
        Status code membantu membaca response server. Untuk auditor ini, yang paling penting tetap marker dummy:
        status 200 saja belum cukup untuk membuktikan data terkirim.
      </p>
      <div className="mt-4 grid gap-3">
        {STUDY_STATUSES.map((status) => {
          const meaning = getStatusMeaning(status);
          return (
            <div key={status} className="rounded border border-zinc-200 bg-zinc-50 px-3 py-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
                <p className="font-mono text-sm font-bold text-zinc-950">
                  {status} {meaning.title}
                </p>
                <p className="text-sm text-zinc-700">{meaning.meaning}</p>
              </div>
              {meaning.note ? <p className="mt-2 text-xs leading-5 text-zinc-500">Note: {meaning.note}</p> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-200 bg-white/75 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{label}</dt>
      <dd className="mt-1 break-all font-medium text-zinc-950">{value || "None"}</dd>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 sm:grid-cols-[150px_1fr]">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className="break-all font-mono text-xs text-zinc-950">{value}</dd>
    </div>
  );
}

function getHeadline(report: AuditResponse) {
  if (report.verdict === "YES") {
    return {
      title: "YES - DATA SENT TO SERVER",
      description: "A unique dummy marker was detected in a non-analytics server request.",
      cardClass: "border-emerald-200 bg-emerald-50 text-emerald-950",
    };
  }

  if (report.verdict === "NO_EVIDENCE") {
    return {
      title: "NO EVIDENCE",
      description: "No request containing the generated dummy markers was detected.",
      cardClass: "border-red-200 bg-red-50 text-red-950",
    };
  }

  return {
    title: "COULDN'T VERIFY",
    description: report.reason || "Browser automation could not verify this page.",
    cardClass: "border-amber-200 bg-amber-50 text-amber-950",
  };
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function formatStatusChain(statusChain: StatusChainItem[], fallbackStatus?: number | null) {
  if (statusChain.length > 0) {
    return statusChain.map((item) => item.status).join(" -> ");
  }
  return typeof fallbackStatus === "number" ? String(fallbackStatus) : "None";
}

function formatFields(fields: FieldKey[]) {
  if (fields.length === 0) {
    return "None";
  }
  return fields.map((field) => FIELD_LABELS[field]).join(", ");
}

function dummyBadgeText(filled: boolean, matched: boolean) {
  if (matched) {
    return "FILLED + MATCHED";
  }
  if (filled) {
    return "FILLED ONLY";
  }
  return "NOT USED";
}

function dummyBadgeClass(filled: boolean, matched: boolean) {
  if (matched) {
    return "border-emerald-200 bg-emerald-100 text-emerald-900";
  }
  if (filled) {
    return "border-sky-200 bg-sky-100 text-sky-900";
  }
  return "border-zinc-200 bg-white text-zinc-500";
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}
