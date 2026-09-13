"use client";

import { FormEvent, useState } from "react";

export default function NoSubmitFixturePage() {
  const [wallet, setWallet] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [sent, setSent] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSent(true);
  }

  return (
    <main style={{ maxWidth: 560, margin: "40px auto", padding: 24 }}>
      <h1>No-submit fixture</h1>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label>Wallet address<input name="wallet" value={wallet} onChange={(e) => setWallet(e.target.value)} /></label>
        <label>X handle<input name="xHandle" value={xHandle} onChange={(e) => setXHandle(e.target.value)} /></label>
        <label>Email<input type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Username<input name="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <button type="submit">Submit</button>
      </form>
      {sent ? <p>Submitted locally only</p> : null}
    </main>
  );
}
