"use client";

import { FormEvent, useMemo, useState } from "react";
import { DUMMY_TWITTER, DUMMY_WALLET, type LiveAuditReport } from "@/lib/audit/types";

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
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Whitelist Form Auditor</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600 sm:text-base">
            Paste website whitelist. Tool ini akan isi data dummy, klik submit, lalu cek apakah data
            benar-benar keluar dari browser ke server.
          </p>
        </header>

        <section className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
          <strong>Penting:</strong> Pakai dummy data saja. Jangan connect wallet dan jangan sign
          message.
        </section>

        <section className="rounded border border-zinc-200 bg-white p-4 shadow-sm">
          <form className="flex flex-col gap-3" onSubmit={runAudit}>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">Website whitelist</span>
              <input
                value={targetUrl}
                onChange={(event) => setTargetUrl(event.target.value)}
                placeholder="https://example.com/whitelist"
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
            Data dummy yang dipakai: <span className="font-mono text-zinc-900">{DUMMY_WALLET}</span>
            <br />
            X/Twitter dummy: <span className="font-mono text-zinc-900">{DUMMY_TWITTER}</span>
          </div>

          {error ? (
            <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          ) : null}
        </section>

        {report ? (
          <section className={`rounded border p-5 shadow-sm ${result.className}`}>
            <p className="text-sm font-medium uppercase tracking-[0.14em] opacity-75">Hasil</p>
            <h2 className="mt-3 text-2xl font-semibold leading-8">{result.title}</h2>
            <p className="mt-3 text-sm leading-6">{result.description}</p>
          </section>
        ) : null}

        {report ? (
          <section className="rounded border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Bukti singkat</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Fact label="Tombol submit berhasil diklik" value={report.submitClicked} />
              <Fact label="Data dummy masuk request" value={report.payloadContainsDummyWallet} />
              <Fact label="Ada request POST/PUT/PATCH" value={report.hasPostRequest} />
              <Fact label="Hanya tersimpan di browser" value={report.usesLocalStorage} />
            </dl>

            {report.requests.length > 0 ? (
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-zinc-800">Request yang tertangkap</h3>
                <div className="mt-2 space-y-2">
                  {report.requests.slice(0, 5).map((request) => (
                    <div
                      key={`${request.method}-${request.url}-${request.timestamp}`}
                      className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs"
                    >
                      <div className="font-medium text-zinc-900">{request.method}</div>
                      <div className="mt-1 break-all text-zinc-600">{request.url}</div>
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

function getSimpleResult(report: LiveAuditReport | null) {
  if (!report) {
    return {
      title: "Belum dicek",
      description: "",
      className: "border-zinc-200 bg-white text-zinc-900",
    };
  }

  if (report.verdict === "DATA_SENT_TO_SERVER") {
    return {
      title: "Data dummy terkirim ke server",
      description:
        "Saat form dites, wallet dummy masuk ke request POST/PUT/PATCH. Dari luar kita bisa membuktikan data keluar ke server. Penyimpanan ke database tidak bisa dibuktikan tanpa akses backend.",
      className: "border-emerald-200 bg-emerald-50 text-emerald-900",
    };
  }

  if (report.verdict === "LOCAL_ONLY") {
    return {
      title: "Data tidak terkirim ke server",
      description:
        "Data dummy hanya tertulis di storage browser. Tidak ada request pengiriman data dummy ke server yang tertangkap.",
      className: "border-amber-200 bg-amber-50 text-amber-900",
    };
  }

  if (report.verdict === "NO_SUBMISSION_DETECTED_OR_FAKE_UI") {
    return {
      title: "Data tidak terkirim ke mana-mana",
      description:
        "Form berhasil dites, tapi tidak ada request pengiriman data dummy dan tidak ada penyimpanan data dummy di browser. Ini bisa berarti UI hanya pajangan atau submit tidak jalan.",
      className: "border-red-200 bg-red-50 text-red-900",
    };
  }

  return {
    title: "Belum bisa dibuktikan otomatis",
    description:
      "Tool tidak berhasil mengisi input atau klik submit dengan aman. Coba cek manual, terutama kalau website meminta connect wallet, captcha, atau sign message.",
    className: "border-zinc-200 bg-white text-zinc-900",
  };
}
