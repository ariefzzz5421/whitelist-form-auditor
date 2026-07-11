"use client";

import { FormEvent, useMemo, useState } from "react";

type FieldKey = "wallet" | "xHandle" | "email" | "username";
type Verdict = "VERIFIED" | "NO_EVIDENCE" | "INCONCLUSIVE";

interface AuditResult {
  verdict: Verdict;
  message: string;
  reason?: string;
  auditId: string;
  targetUrl: string;
  dummyData: Record<FieldKey, string>;
  filledFields: FieldKey[];
  matchedFields: FieldKey[];
  request?: {
    method: string;
    endpoint: string;
    domain: string;
    status: number | null;
  };
  debug: {
    pageLoaded: boolean;
    formDetected: boolean;
    submitClicked: boolean;
    requestsObserved: number;
    relevantRequests: number;
  };
}

const EXAMPLE_DATA = {
  wallet: "0x000000000000000000000000<unique-test-id>",
  xHandle: "@dummy_<unique-test-id>",
  email: "dummy+<unique-test-id>@example.com",
  username: "dummy_<unique-test-id>",
};

const FIELD_LABELS: Record<FieldKey, string> = {
  wallet: "Wallet EVM",
  xHandle: "X / Twitter",
  email: "Email",
  username: "Username",
};

export default function DummyWalletTester() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const normalizedUrl = useMemo(() => normalizeUrl(url), [url]);

  async function runAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizedUrl) return;

    setLoading(true);
    setError("");
    setResult(null);
    setUrl(normalizedUrl);

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: normalizedUrl }),
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Backend mengembalikan HTTP ${response.status}, bukan JSON.`);
      }

      const payload = (await response.json()) as AuditResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || `Audit gagal dengan HTTP ${response.status}.`);
      setResult(payload);
    } catch (auditError) {
      setError(auditError instanceof Error ? auditError.message : "Audit gagal dijalankan.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <header>
          <p className="text-sm font-semibold text-cyan-400">Browserless network audit</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Whitelist Form Auditor
          </h1>
          <p className="editorial-description mt-4 max-w-xl text-zinc-400">
            Tempel halaman waitlist, whitelist, atau airdrop. Auditor akan mengisi data dummy lalu memeriksa apakah
            informasi tersebut benar-benar dikirim menuju server.
          </p>
        </header>

        <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 sm:p-6">
          <form onSubmit={runAudit}>
            <label htmlFor="target-url" className="text-sm font-medium text-zinc-200">
              URL halaman form
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
                onBlur={() => { if (url.trim()) setUrl(normalizedUrl); }}
                placeholder="https://project.xyz/waitlist"
                className="h-12 min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 text-sm text-white placeholder:text-zinc-600 focus:border-cyan-400"
              />
              <button
                type="submit"
                disabled={loading || !url.trim()}
                aria-label={loading ? "Sedang menganalisis halaman" : "Analisis dan kirim form"}
                title={loading ? "Sedang menganalisis..." : "Analisis dan kirim"}
                className="flex h-12 w-full shrink-0 items-center justify-center rounded-xl bg-cyan-400 text-2xl text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400 sm:w-14"
              >
                <span aria-hidden="true" className={loading ? "animate-pulse" : ""}>🔎</span>
              </button>
            </div>
          </form>

          {loading ? (
            <div className="mt-5 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-cyan-400" />
              </div>
              <p className="mt-3 text-xs leading-5 text-cyan-200/80">
                Browserless sedang membuka halaman, mencari form, mengisi data dummy, dan memantau network request.
                Biasanya membutuhkan 10–30 detik.
              </p>
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              <p className="font-semibold">Audit gagal</p>
              <p className="mt-1 leading-5 text-red-200/80">{error}</p>
            </div>
          ) : null}
        </section>

        <section className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Format data dummy</h2>
              <p className="mt-1 text-xs text-zinc-500">Nilai unik dibuat untuk setiap audit.</p>
            </div>
            <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-400">
              Auto-fill
            </span>
          </div>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-zinc-950 p-4 font-mono text-xs leading-6 text-zinc-300">
            {JSON.stringify(EXAMPLE_DATA, null, 2)}
          </pre>
        </section>

        {result ? <ResultPanel result={result} /> : null}

        <p className="mt-5 text-xs leading-5 text-zinc-600">
          Auditor tidak connect wallet, sign message, menyelesaikan CAPTCHA, atau melakukan transaksi. “Verified”
          membuktikan data muncul dalam request keluar, bukan membuktikan penyimpanan permanen di database.
        </p>
      </div>
    </main>
  );
}

function ResultPanel({ result }: { result: AuditResult }) {
  const theme = {
    VERIFIED: {
      title: "Verified — data sent to server",
      className: "border-emerald-500/30 bg-emerald-500/10",
      textClass: "text-emerald-300",
    },
    NO_EVIDENCE: {
      title: "No matching request found",
      className: "border-red-500/30 bg-red-500/10",
      textClass: "text-red-300",
    },
    INCONCLUSIVE: {
      title: "Could not verify",
      className: "border-amber-500/30 bg-amber-500/10",
      textClass: "text-amber-300",
    },
  }[result.verdict];

  return (
    <section aria-live="polite" className={`mt-4 rounded-2xl border p-5 sm:p-6 ${theme.className}`}>
      <p className={`text-sm font-semibold ${theme.textClass}`}>{result.verdict}</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">{theme.title}</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-300">{result.reason || result.message}</p>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2">
        <Evidence label="Page loaded" value={yesNo(result.debug.pageLoaded)} />
        <Evidence label="Form detected" value={yesNo(result.debug.formDetected)} />
        <Evidence label="Submit clicked" value={yesNo(result.debug.submitClicked)} />
        <Evidence label="Requests observed" value={String(result.debug.requestsObserved)} />
        <Evidence label="Fields filled" value={formatFields(result.filledFields)} />
        <Evidence label="Dummy values matched" value={formatFields(result.matchedFields)} />
      </dl>

      {result.request ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Request evidence</p>
          <p className="mt-3 text-sm font-medium text-zinc-200">
            {result.request.method} · HTTP {result.request.status ?? "unknown"}
          </p>
          <p className="mt-2 break-all font-mono text-xs leading-5 text-zinc-400">{result.request.endpoint}</p>
        </div>
      ) : null}

      <details className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-300">Lihat data aktual audit</summary>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-5 text-zinc-300">
          {JSON.stringify(result.dummyData, null, 2)}
        </pre>
        <p className="mt-3 font-mono text-xs text-zinc-500">Audit ID: {result.auditId}</p>
      </details>
    </section>
  );
}

function Evidence({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 break-all text-sm font-medium text-zinc-200">{value}</dd>
    </div>
  );
}

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function formatFields(fields: FieldKey[]) {
  if (!fields.length) return "None";
  return fields.map((field) => FIELD_LABELS[field]).join(", ");
}
