"use client";

import { FormEvent, useMemo, useState } from "react";
import type { CapturedRequest, LiveAuditReport } from "@/lib/audit/types";

export default function AuditorClient() {
  const [targetUrl, setTargetUrl] = useState("");
  const [report, setReport] = useState<LiveAuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const bestRequest = useMemo(() => {
    return report?.requests.find((request) => request.containsDummyData) || null;
  }, [report]);

  async function runAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setReport(null);
    setLoading(true);

    try {
      const response = await fetch("/api/audit/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: normalizeUrl(targetUrl) }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Audit failed.");
      }

      setReport(payload as LiveAuditReport);
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
            Simple Whitelist Checker
          </p>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">YES / NO Form Detector</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600 sm:text-base">
            Paste website whitelist atau waitlist. Tool akan buka website, isi dummy data, submit,
            lalu cek request seperti Inspect Network.
          </p>
        </header>

        <section className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
          <strong>Penting:</strong> Tool ini membuktikan data dummy terkirim ke server endpoint.
          Bukan bukti pasti data tersimpan di database, karena database hanya bisa dicek dari backend.
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
              {loading ? "Checking..." : "CHECK NOW"}
            </button>
          </form>

          <p className="mt-3 text-xs leading-5 text-zinc-500">
            Format otomatis: kalau kamu paste <code>example.com</code>, tool akan mencoba{" "}
            <code>https://example.com</code>.
          </p>

          {error ? (
            <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          ) : null}
        </section>

        {report ? (
          <ResultCard report={report} request={bestRequest} />
        ) : loading ? (
          <section className="rounded border border-zinc-200 bg-white p-5 text-sm leading-6 text-zinc-700 shadow-sm">
            Membuka website, generate dummy wallet, isi form, submit, lalu tunggu response network.
            Biasanya butuh 10-20 detik.
          </section>
        ) : null}

        {report ? (
          <section className="rounded border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Dummy data yang dipakai</h2>
            <div className="mt-3 grid gap-2 text-xs">
              <DummyRow label="Wallet" value={report.dummyData.wallet} />
              <DummyRow label="Email" value={report.dummyData.email} />
              <DummyRow label="X/Twitter" value={report.dummyData.twitter} />
              <DummyRow label="Name" value={report.dummyData.name} />
            </div>
          </section>
        ) : null}

        {report ? (
          <section className="rounded border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Network result</h2>
            {bestRequest ? (
              <RequestDetails request={bestRequest} />
            ) : (
              <p className="mt-3 text-sm leading-6 text-zinc-600">
                Tidak ada request Fetch/XHR/POST yang membawa dummy data.
              </p>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function ResultCard({
  report,
  request,
}: {
  report: LiveAuditReport;
  request: CapturedRequest | null;
}) {
  if (report.result === "YES") {
    return (
      <section className="rounded border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.14em]">Result</p>
        <h2 className="mt-3 text-3xl font-bold">YES - DATA SENT TO SERVER</h2>
        <p className="mt-3 text-sm leading-6">
          Dummy data ditemukan di request server. Status response:{" "}
          <strong>{formatStatus(request)}</strong>.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-[0.14em]">Result</p>
      <h2 className="mt-3 text-3xl font-bold">NO - NO SERVER SUBMISSION DETECTED</h2>
      <p className="mt-3 text-sm leading-6">
        No request containing the submitted dummy data was detected.
      </p>
    </section>
  );
}

function RequestDetails({ request }: { request: CapturedRequest }) {
  return (
    <dl className="mt-3 grid gap-3 text-sm">
      <InfoRow label="Endpoint" value={request.url} />
      <InfoRow label="Method" value={request.method} />
      <InfoRow label="Status response" value={formatStatus(request)} />
      <InfoRow label="Data dummy terdeteksi" value={request.detectedMarkers.join(", ")} />
      <InfoRow label="Request type" value={request.graphqlMutation ? "GraphQL mutation" : request.resourceType} />
    </dl>
  );
}

function DummyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
        {label}
      </div>
      <div className="mt-1 break-all font-mono text-zinc-900">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
        {label}
      </dt>
      <dd className="mt-1 break-all text-zinc-900">{value}</dd>
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

function formatStatus(request: CapturedRequest | null) {
  if (!request) {
    return "No response";
  }

  if (typeof request.statusCode !== "number") {
    return "No response status captured";
  }

  return `${request.statusCode}${request.responseOk ? " OK" : " response"}`;
}
