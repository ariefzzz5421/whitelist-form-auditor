export default function WhitelistAuditorPage() {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="border-b border-zinc-200 pb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
            Chrome Extension Companion
          </p>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">
            Whitelist / Waitlist Submission Detector
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600 sm:text-base">
            The extension answers one question only: did submitted dummy data leave the browser and
            get sent to a non-analytics server endpoint?
          </p>
        </header>

        <section className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
          Use dummy data only. Do not connect wallets, sign messages, execute transactions, or enter
          real credentials.
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <ResultCard
            title="YES - DATA SENT TO SERVER"
            body="A POST, PUT, PATCH, or GraphQL mutation request contained one of the generated dummy markers and was not an analytics endpoint."
            tone="yes"
          />
          <ResultCard
            title="NO - NO SERVER SUBMISSION DETECTED"
            body="No non-analytics server request containing the submitted dummy data was detected during the audit window."
            tone="no"
          />
        </section>

        <section className="rounded border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">How To Use</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-zinc-700">
            <li>Open <code>chrome://extensions</code>, enable Developer mode, then Load unpacked.</li>
            <li>Select the local <code>extension</code> folder from this project.</li>
            <li>Open the target whitelist or waitlist website in Chrome.</li>
            <li>Open the extension side panel and click START AUDIT.</li>
            <li>Copy the generated dummy wallet, X/Twitter, email, and name.</li>
            <li>Manually fill and submit the form on the target website.</li>
            <li>The extension watches network requests for 10 seconds after submit.</li>
          </ol>
        </section>

        <section className="rounded border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Metrics Used</h2>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <Metric title="Timing" body="Only requests after START AUDIT are evaluated." />
            <Metric title="Method" body="POST, PUT, PATCH, or GraphQL mutation requests are checked." />
            <Metric title="Dummy Marker" body="At least one unique dummy value must appear in the request." />
            <Metric title="Analytics Filter" body="Known analytics/tracking domains are ignored." />
          </div>
        </section>

        <section className="rounded border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Database Persistence</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-700">
            This tool does not claim that data was saved to a database. From the browser, it can only
            prove that dummy data was sent to a server endpoint. Database persistence requires
            backend logs, database access, or admin tooling from the website owner.
          </p>
        </section>

        <section className="rounded border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Local History</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-700">
            Audit history is stored locally inside Chrome with <code>chrome.storage.local</code>.
            The dashboard is documentation only; it does not collect the user&apos;s audit results.
          </p>
        </section>
      </div>
    </main>
  );
}

function ResultCard({ title, body, tone }: { title: string; body: string; tone: "yes" | "no" }) {
  const classes =
    tone === "yes"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : "border-red-200 bg-red-50 text-red-950";

  return (
    <div className={`rounded border p-4 shadow-sm ${classes}`}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6">{body}</p>
    </div>
  );
}

function Metric({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2">
      <h3 className="font-semibold text-zinc-900">{title}</h3>
      <p className="mt-1 leading-6 text-zinc-600">{body}</p>
    </div>
  );
}
