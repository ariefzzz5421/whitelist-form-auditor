"use client";

import { FormEvent, useState } from "react";

export function LabForm({ endpoint, title, description }: { endpoint: string | null; title: string; description: string }) {
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!endpoint) {
      setMessage("No network request was sent by this lab page.");
      return;
    }
    const response = await fetch(endpoint, { method: "POST", body: JSON.stringify(Object.fromEntries(data)), headers: { "content-type": "application/json" } });
    setMessage(`Response status: ${response.status}`);
  }
  return <main className="min-h-screen bg-zinc-50 p-8 text-zinc-950"><section className="mx-auto max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"><p className="text-sm font-semibold uppercase tracking-[0.14em] text-sky-700">Internal auditor lab</p><h1 className="mt-2 text-3xl font-bold">{title}</h1><p className="mt-3 text-sm leading-6 text-zinc-600">{description}</p><form className="mt-6 grid gap-3" onSubmit={submit}><label className="grid gap-1 text-sm font-medium">Email<input required name="email" type="email" className="h-11 rounded-xl border border-zinc-300 px-3" /></label><label className="grid gap-1 text-sm font-medium">Username<input required name="username" className="h-11 rounded-xl border border-zinc-300 px-3" /></label><button className="h-11 rounded-xl bg-zinc-950 font-semibold text-white" type="submit">Submit</button></form>{message ? <p className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm">{message}</p> : null}</section></main>;
}
