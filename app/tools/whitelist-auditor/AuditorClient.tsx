"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  DUMMY_EMAIL,
  DUMMY_NAME,
  DUMMY_TWITTER,
  DUMMY_WALLET,
  LIVE_AUDIT_RATE_LIMIT,
  type LiveAuditReport,
} from "@/lib/audit/types";

export default function AuditorClient() {
  const [targetUrl, setTargetUrl] = useState("");
  const [report, setReport] = useState<LiveAuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const result = useMemo(() => getSimpleResult(report), [report]);

  async function runAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setReport(null);
    setLoading(true);

    try {
      const response = await fetch("/api/audit/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
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
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-sky-700">
            Crypto form checker
          </p>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">
            Whitelist / Waitlist Form Auditor
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600 sm:text-base">
            Paste website whitelist atau waitlist. Tool ini isi data dummy, klik submit, lalu jawab
            sederhana: YES kalau dummy data terkirim ke server, NO kalau tidak terkirim.
          </p>
        </header>

        <section className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
          <strong>Penting:</strong> Pakai dummy data saja. Jangan connect wallet dan jangan sign
          message.
        </section>

        <section className="rounded border border-zinc-200 bg-white p-4 shadow-sm">
          <form className="flex flex-col gap-3" onSubmit={runAudit}>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Website whitelist / waitlist</span>
              <input
                value={targetUrl}
                onChange={(event) => setTargetUrl(event.target.value)}
                placeholder="https://example.com/waitlist"
                className="h-12 rounded border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="h-12 rounded bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
            >
              {loading ? "Lagi cek form..." : "Cek Form"}
            </button>
          </form>

          <div className="mt-4 rounded border border-zinc-200 bg-zinc-50 px-3 py-3 text-xs leading-5 text-zinc-600">
            Wallet dummy: <span className="font-mono text-zinc-900">{DUMMY_WALLET}</span>
            <br />
            X/Twitter dummy: <span className="font-mono text-zinc-900">{DUMMY_TWITTER}</span>
            <br />
            Email dummy: <span className="font-mono text-zinc-900">{DUMMY_EMAIL}</span>
            <br />
            Nama dummy: <span className="font-mono text-zinc-900">{DUMMY_NAME}</span>
            <br />
            Rate limit:{" "}
            <span className="font-medium text-zinc-900">{LIVE_AUDIT_RATE_LIMIT.label}</span>
          </div>

          {error ? (
            <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          ) : null}
        </section>

        {report ? (
          <section className={`rounded border p-5 shadow-sm ${result.className}`}>
            <p className="text-sm font-medium uppercase tracking-[0.14em] opacity-75">Result</p>
            <h2 className="mt-3 text-3xl font-semibold leading-9">{result.title}</h2>
            <p className="mt-3 text-sm leading-6">{result.description}</p>
          </section>
        ) : null}

        {report ? (
          <section className="rounded border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Ringkasan metrik</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Fact label="Request membawa data dummy" value={report.payloadContainsDummyData} />
              <Fact label="Ada request POST/PUT/PATCH" value={report.hasPostRequest} />
              <Fact label="Tombol submit berhasil diklik" value={report.submitClicked} />
              <Fact label="Data dummy hanya tersimpan di browser" value={report.storageContainsDummyData} />
            </dl>

            <div className="mt-5 grid gap-3 text-sm">
              <InfoRow title="Metric utama">
                YES hanya kalau dummy wallet, email, nama, atau X/Twitter muncul di payload request
                POST/PUT/PATCH.
              </InfoRow>
              <InfoRow title="Metric NO">
                NO kalau dummy data tidak muncul di request server, termasuk saat hanya tersimpan di
                browser storage atau submit tidak jalan.
              </InfoRow>
              <InfoRow title="Database">
                Dari luar, database tidak bisa dicek langsung. Request ke server dianggap jalur normal
                menuju database.
              </InfoRow>
              <InfoRow title="Rate limit">
                {report.rateLimit.label}. Sisa request window ini: {report.rateLimit.remaining}.
              </InfoRow>
            </div>

            {report.requests.length > 0 ? (
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-zinc-800">Request detail</h3>
                <div className="mt-2 space-y-2">
                  {report.requests.slice(0, 5).map((request) => (
                    <div
                      key={`${request.method}-${request.url}-${request.timestamp}`}
                      className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs"
                    >
                      <div className="font-medium text-zinc-900">{request.method}</div>
                      <div className="mt-1 break-all text-zinc-600">{request.url}</div>
                      <div className="mt-2 text-zinc-700">
                        Membawa dummy data:{" "}
                        <span className={request.containsDummyData ? "text-emerald-700" : "text-red-700"}>
                          {request.containsDummyData ? "Ya" : "Tidak"}
                        </span>
                      </div>
                      {request.postDataPreview ? (
                        <details className="mt-2 rounded border border-zinc-200 bg-white">
                          <summary className="cursor-pointer px-2 py-1 font-medium text-zinc-800">
                            Payload preview
                          </summary>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all border-t border-zinc-200 p-2 text-[11px] leading-5 text-zinc-700">
                            {request.postDataPreview}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {report.notes.length > 0 ? (
              <details className="mt-5 rounded border border-zinc-200 bg-zinc-50">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-zinc-800">
                  Catatan teknis
                </summary>
                <ul className="space-y-1 border-t border-zinc-200 px-3 py-2 text-sm text-zinc-600">
                  {report.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`mt-1 font-semibold ${value ? "text-emerald-700" : "text-zinc-800"}`}>
        {value ? "Ya" : "Tidak"}
      </dd>
    </div>
  );
}

function InfoRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2">
      <h3 className="font-semibold text-zinc-900">{title}</h3>
      <p className="mt-1 leading-6 text-zinc-600">{children}</p>
    </div>
  );
}

function getSimpleResult(report: LiveAuditReport | null) {
  if (!report || report.result === "NO") {
    return {
      title: "NO - data tidak terkirim",
      description:
        "Dummy data tidak ditemukan di request ke server. Dalam test ini form dianggap tidak bekerja sebagai form database/server.",
      className: "border-red-200 bg-red-50 text-red-900",
    };
  }

  return {
    title: "YES - form works",
    description:
      "Dummy data ditemukan di request POST/PUT/PATCH ke server. Ini berarti form mengirim data keluar dari browser.",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900",
  };
}
