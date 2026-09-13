"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Verdict = "VERIFIED" | "NO_EVIDENCE" | "INCONCLUSIVE";

interface AuditResult {
  verdict: Verdict;
  message: string;
  reason?: string;
  auditId: string;
  targetUrl: string;
  request?: {
    method: string;
    endpoint: string;
    domain: string;
    status: number | null;
    accepted?: boolean | null;
  };
}

const PROGRESS_STAGES = [
  { until: 18, label: "Membuka halaman..." },
  { until: 42, label: "Mengecek form..." },
  { until: 68, label: "Mengisi data uji..." },
  { until: 88, label: "Memeriksa pengiriman..." },
  { until: 100, label: "Menyiapkan hasil..." },
];

export default function DummyWalletTester() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const normalizedUrl = useMemo(() => normalizeUrl(url), [url]);

  useEffect(() => {
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, []);

  function startProgress() {
    if (progressTimer.current) clearInterval(progressTimer.current);
    setProgress(5);

    progressTimer.current = setInterval(() => {
      setProgress((current) => {
        if (current >= 92) return current;
        const remaining = 92 - current;
        const step = Math.max(0.35, remaining * 0.035);
        return Math.min(92, current + step);
      });
    }, 120);
  }

  function finishProgress() {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
    setProgress(100);
  }

  async function runAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizedUrl) return;

    setLoading(true);
    setError("");
    setResult(null);
    setUrl(normalizedUrl);
    startProgress();

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: normalizedUrl }),
      });

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Pemeriksaan belum bisa diselesaikan. Silakan coba lagi.");
      }

      const payload = (await response.json()) as AuditResult & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Pemeriksaan belum bisa diselesaikan. Silakan coba lagi.");
      }

      finishProgress();
      await new Promise((resolve) => setTimeout(resolve, 320));
      setResult(payload);
    } catch (auditError) {
      finishProgress();
      setError(
        auditError instanceof Error
          ? makeFriendlyError(auditError.message)
          : "Pemeriksaan belum bisa diselesaikan. Silakan coba lagi.",
      );
    } finally {
      setLoading(false);
    }
  }

  const stageLabel = getProgressLabel(progress);

  return (
    <main className="min-h-screen px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <header className="text-center sm:text-left">
          <p className="text-sm font-semibold text-cyan-400">Whitelist Form Auditor</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Cek apakah form benar-benar mengirim data
          </h1>
          <p className="editorial-description mx-auto mt-4 max-w-xl text-zinc-400 sm:mx-0">
            Tempel link form whitelist, waitlist, atau airdrop. Kami akan mengujinya dengan data aman dan memberi hasil sederhana.
          </p>
        </header>

        <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 sm:p-6">
          <form onSubmit={runAudit}>
            <label htmlFor="target-url" className="text-sm font-medium text-zinc-200">
              Link form
            </label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input
                id="target-url"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onBlur={() => {
                  if (url.trim()) setUrl(normalizedUrl);
                }}
                placeholder="https://project.xyz/waitlist"
                className="h-12 min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/10"
              />
              <button
                type="submit"
                disabled={loading || !url.trim()}
                className="flex h-12 shrink-0 items-center justify-center rounded-xl bg-cyan-400 px-5 text-sm font-semibold text-zinc-950 transition duration-200 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              >
                {loading ? "Mengecek..." : "Cek form"}
              </button>
            </div>
          </form>

          {loading ? (
            <div className="mt-6 rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.04] p-5">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-medium text-cyan-100">{stageLabel}</p>
                <span className="text-xs tabular-nums text-cyan-300/80">{Math.round(progress)}%</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-cyan-400 transition-[width] duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-3 text-xs leading-5 text-zinc-500">
                Tidak perlu melakukan apa pun. Pemeriksaan berjalan otomatis di belakang.
              </p>
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="mt-5 rounded-xl border border-red-500/25 bg-red-500/10 p-4">
              <p className="text-sm font-semibold text-red-200">Belum bisa diperiksa</p>
              <p className="mt-1 text-sm leading-6 text-red-200/75">{error}</p>
            </div>
          ) : null}
        </section>

        {result ? <SimpleResult result={result} /> : null}

        <p className="mx-auto mt-5 max-w-xl text-center text-xs leading-5 text-zinc-600 sm:text-left">
          Pemeriksaan menggunakan data uji, tidak menghubungkan wallet, tidak meminta signature, dan tidak melakukan transaksi.
        </p>
      </div>
    </main>
  );
}

function SimpleResult({ result }: { result: AuditResult }) {
  const presentation = getResultPresentation(result);

  return (
    <section
      aria-live="polite"
      className={`mt-4 rounded-2xl border p-6 text-center sm:p-7 ${presentation.className}`}
    >
      <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${presentation.iconClass}`}>
        <span aria-hidden="true" className="text-2xl">{presentation.icon}</span>
      </div>
      <p className={`mt-4 text-xs font-semibold uppercase tracking-[0.18em] ${presentation.labelClass}`}>
        {presentation.label}
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{presentation.title}</h2>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-zinc-300">{presentation.description}</p>

      {result.verdict === "VERIFIED" && result.request?.status ? (
        <div className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Server merespons {result.request.status}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="mt-6 rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/5"
      >
        Cek link lain
      </button>
    </section>
  );
}

function getResultPresentation(result: AuditResult) {
  if (result.verdict === "VERIFIED") {
    const serverRejected = result.request?.status !== null && result.request?.status !== undefined && result.request.status >= 400;

    if (serverRejected) {
      return {
        label: "Data terkirim",
        title: "Data keluar, tetapi server menolak",
        description:
          "Form memang mengirim data dari browser, tetapi server memberi respons gagal. Pendaftaran mungkin belum berhasil.",
        icon: "!",
        className: "border-amber-500/30 bg-amber-500/10",
        iconClass: "bg-amber-400/15 text-amber-300",
        labelClass: "text-amber-300",
      };
    }

    return {
      label: "Berhasil",
      title: "Data benar-benar terkirim",
      description:
        "Data uji ditemukan pada pengiriman form dan server merespons. Form ini terlihat berfungsi untuk mengirim data.",
      icon: "✓",
      className: "border-emerald-500/30 bg-emerald-500/10",
      iconClass: "bg-emerald-400/15 text-emerald-300",
      labelClass: "text-emerald-300",
    };
  }

  if (result.verdict === "NO_EVIDENCE") {
    return {
      label: "Tidak ditemukan",
      title: "Data tidak terlihat terkirim",
      description:
        "Form berhasil diuji, tetapi data uji tidak ditemukan pada pengiriman keluar. Jangan anggap form ini sudah menyimpan data.",
      icon: "×",
      className: "border-red-500/30 bg-red-500/10",
      iconClass: "bg-red-400/15 text-red-300",
      labelClass: "text-red-300",
    };
  }

  return {
    label: "Belum pasti",
    title: "Form belum bisa dipastikan",
    description:
      "Website ini tidak bisa diuji sampai selesai secara otomatis. Hasil ini bukan berarti form palsu atau rusak.",
    icon: "?",
    className: "border-amber-500/30 bg-amber-500/10",
    iconClass: "bg-amber-400/15 text-amber-300",
    labelClass: "text-amber-300",
  };
}

function getProgressLabel(progress: number) {
  return PROGRESS_STAGES.find((stage) => progress <= stage.until)?.label || "Menyiapkan hasil...";
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function makeFriendlyError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("url") || normalized.includes("alamat")) {
    return "Link tidak valid atau tidak bisa dibuka. Periksa alamatnya lalu coba lagi.";
  }
  return "Pemeriksaan tidak dapat diselesaikan saat ini. Silakan coba lagi beberapa saat lagi.";
}
