"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Verdict = "YES" | "NO_EVIDENCE" | "INCONCLUSIVE";

interface AuditResponse {
  verdict: Verdict;
  message: string;
  targetUrl: string;
  method?: string;
  endpoint?: string;
  endpointDomain?: string;
  status?: number | null;
  detectedMarkers?: string[];
  auditId: string;
  reason?: string;
}

const LOADING_STEPS = [
  "Opening website",
  "Detecting form",
  "Filling dummy values",
  "Submitting",
  "Inspecting network",
];

export default function AuditorClient() {
  const [targetUrl, setTargetUrl] = useState("");
  const [report, setReport] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [error, setError] = useState("");

  const currentStep = useMemo(() => LOADING_STEPS[Math.min(loadingIndex, LOADING_STEPS.length - 1)], [loadingIndex]);

  useEffect(() => {
    if (!loading) return;

    const timer = window.setInterval(() => {
      setLoadingIndex((value) => Math.min(value + 1, LOADING_STEPS.length - 1));
    }, 2_500);

    return () => window.clearInterval(timer);
  }, [loading]);

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
    <main className="min-h-screen bg-zinc-50 px-4 py-6 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <header className="border-b border-zinc-200 pb-5">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
            Browser Submission Detector
          </p>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Whitelist Form Auditor</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600 sm:text-base">
            Paste URL, click CHECK, lalu tool membuka website di remote browser dan mengecek apakah
            dummy data keluar lewat request server.
          </p>
        </header>

        <section className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
          YES hanya berarti dummy data terkirim ke server endpoint. Ini bukan bukti permanen masuk
          database.
        </section>

        <section className="rounded border border-zinc-200 bg-white p-4 shadow-sm">
          <form className="flex flex-col gap-3" onSubmit={runAudit}>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Website whitelist / waitlist</span>
              <input
                value={targetUrl}
                onChange={(event) => setTargetUrl(event.target.value)}
                placeholder="example.com/whitelist"
                className="h-12 rounded border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
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

        {loading ? (
          <section className="rounded border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-500">Loading</p>
            <p className="mt-3 text-xl font-semibold text-zinc-950">{currentStep}</p>
            <div className="mt-4 h-2 overflow-hidden rounded bg-zinc-100">
              <div
                className="h-full rounded bg-zinc-950 transition-all"
                style={{ width: `${((loadingIndex + 1) / LOADING_STEPS.length) * 100}%` }}
              />
            </div>
          </section>
        ) : null}

        {report ? <ResultCard report={report} /> : null}
      </div>
    </main>
  );
}

function ResultCard({ report }: { report: AuditResponse }) {
  if (report.verdict === "YES") {
    return (
      <section className="rounded border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.14em]">Result</p>
        <h2 className="mt-3 text-3xl font-bold">✅ YES</h2>
        <p className="mt-1 text-lg font-semibold">DATA SENT TO SERVER</p>
        <dl className="mt-4 grid gap-3 text-sm">
          <InfoRow label="Method" value={report.method || "Unknown"} />
          <InfoRow label="Endpoint domain" value={report.endpointDomain || endpointDomain(report.endpoint)} />
          <InfoRow label="Status" value={formatStatus(report.status)} />
          <InfoRow label="Detected dummy fields" value={(report.detectedMarkers || []).join(", ")} />
        </dl>
      </section>
    );
  }

  if (report.verdict === "NO_EVIDENCE") {
    return (
      <section className="rounded border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.14em]">Result</p>
        <h2 className="mt-3 text-3xl font-bold">❌ NO EVIDENCE</h2>
        <p className="mt-3 text-sm leading-6">No matching server submission detected.</p>
      </section>
    );
  }

  return (
    <section className="rounded border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-[0.14em]">Result</p>
      <h2 className="mt-3 text-3xl font-bold">⚠️ COULDN&apos;T VERIFY</h2>
      <p className="mt-3 text-sm leading-6">{report.reason || "Browser automation could not verify this page."}</p>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-emerald-200 bg-white/70 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] opacity-70">{label}</dt>
      <dd className="mt-1 break-all font-medium">{value || "None"}</dd>
    </div>
  );
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function formatStatus(status?: number | null) {
  return typeof status === "number" ? String(status) : "No status captured";
}

function endpointDomain(endpoint?: string) {
  if (!endpoint) {
    return "Unknown";
  }
  try {
    return new URL(endpoint).hostname;
  } catch {
    return "Unknown";
  }
}
