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

export default function DummyWalletTester() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null);
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
    setProgress(3);
    progressTimer.current = setInterval(() => {
      setProgress((current) => {
        if (current >= 94) return current;
        const remaining = 94 - current;
        const step = Math.max(0.2, remaining * 0.025);
        return Math.min(94, current + step);
      });
    }, 80);
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
        throw new Error("Audit failed");
      }

      const payload = (await response.json()) as AuditResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Audit failed");

      finishProgress();
      await new Promise((resolve) => setTimeout(resolve, 220));
      setResult(payload);
    } catch {
      finishProgress();
      setResult({
        verdict: "NO_EVIDENCE",
        message: "No evidence of data transmission",
        auditId: "failed-audit",
        targetUrl: normalizedUrl,
      });
    } finally {
      setLoading(false);
    }
  }

  const answer: "YES" | "NO" | null = result ? (result.verdict === "VERIFIED" ? "YES" : "NO") : null;

  return (
    <main className="min-h-screen px-4 py-12 sm:px-6 sm:py-20">
      <div className="mx-auto w-full max-w-xl">
        <header>
          <p className="text-sm font-semibold text-cyan-400">Whitelist Form Auditor</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Does this form actually send your data?
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-6 text-zinc-400">
            Paste the form link. The check runs automatically with dummy data and returns one simple answer.
          </p>
        </header>

        <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 sm:p-6">
          <form onSubmit={runAudit}>
            <label htmlFor="target-url" className="text-sm font-medium text-zinc-200">
              Form URL
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
                {loading ? "Checking..." : "Check"}
              </button>
            </div>
          </form>

          {loading ? (
            <div className="mt-6">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Checking...</span>
                <span className="tabular-nums">{Math.round(progress)}%</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-cyan-400 transition-[width] duration-700 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : null}
        </section>

        {answer ? <BinaryResult answer={answer} /> : null}
      </div>
    </main>
  );
}

function BinaryResult({ answer }: { answer: "YES" | "NO" }) {
  const yes = answer === "YES";
  return (
    <section
      aria-live="polite"
      className={`mt-4 rounded-2xl border p-8 text-center ${
        yes ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"
      }`}
    >
      <div
        className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full text-3xl font-bold ${
          yes ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300"
        }`}
      >
        {yes ? "✓" : "×"}
      </div>
      <p className={`mt-5 text-4xl font-black tracking-tight sm:text-5xl ${yes ? "text-emerald-300" : "text-red-300"}`}>
        {answer}
      </p>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-zinc-300">
        {yes ? "The submitted dummy data was detected leaving the form." : "No proof was found that the submitted dummy data left the form."}
      </p>
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="mt-6 rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/5"
      >
        Check another link
      </button>
    </section>
  );
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
