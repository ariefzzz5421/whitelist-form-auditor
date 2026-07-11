# Whitelist Form Auditor

Browserless-powered website auditor for one question: **does a waitlist, whitelist, or airdrop form actually send the entered data to a server?**

## Quick start

Create `.env.local`:

```env
BROWSERLESS_TOKEN=your_browserless_token
BROWSERLESS_WS_URL=wss://production-sfo.browserless.io
```

Then run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, paste a public form URL, then click **Analyze & submit**.

## What the audit does

1. Connects to Browserless using `playwright-core` and `chromium.connectOverCDP()`.
2. Opens the supplied public website.
3. Detects wallet, X/Twitter, email, and username fields.
4. Fills unique dummy values.
5. Clicks a safe submit/join/apply button.
6. Watches outgoing network requests for the exact dummy values.

## Result meanings

- `VERIFIED`: at least one exact dummy value appeared in a non-analytics outgoing request.
- `NO_EVIDENCE`: the form was filled and submitted, but no matching request was observed.
- `INCONCLUSIVE`: the audit could not safely finish, for example because no supported form was found, a wallet connection/signature was required, or automation failed.

`VERIFIED` proves that data left the page in a request. It does not prove permanent database storage.

## Safety boundaries

- No real wallet data.
- No wallet connection.
- No signatures or transactions.
- No CAPTCHA bypass.
- Localhost and private-network targets are blocked.
- Browserless credentials remain server-side and must never use a `NEXT_PUBLIC_` prefix.
