# Whitelist Form Auditor

Automated browser-based detector for one question:

**Did unique dummy whitelist/waitlist data leave the browser and get sent to a non-analytics server endpoint?**

The result is intentionally simple:

- `YES - DATA SENT TO SERVER`
- `NO EVIDENCE - No matching server submission detected`
- `INCONCLUSIVE - Could not verify`

## What The Tool Does

1. User pastes a whitelist or waitlist website URL.
2. The backend connects to Browserless remote Chromium with Playwright CDP.
3. The remote browser opens the target website.
4. The tool generates a unique audit marker and dummy data:
   - wallet
   - email
   - X/Twitter handle
   - name
5. The tool fills matching form fields across page frames.
6. The tool clicks one safe submit button.
7. It watches network requests for 12 seconds.
8. It checks requests similar to manual DevTools flow:
   - Inspect
   - Network
   - Fetch/XHR or form submission request
   - Preserve log
   - Submit dummy data
   - Check request payload and response status

## YES Meaning

`YES - DATA SENT TO SERVER` means:

- a non-analytics request was detected
- the request used `POST`, `PUT`, `PATCH`, or GraphQL mutation
- the request payload contained at least one unique dummy marker
- the response status was captured when available
- redirect chains such as `302 -> 200` are shown when available

It does not prove database persistence.

## NO EVIDENCE Meaning

`NO EVIDENCE` means:

- the page loaded
- a supported form field was detected
- at least one dummy value was filled
- submit was clicked
- the monitoring window completed
- no matching request containing the unique dummy marker was detected

Automation failures are reported as `INCONCLUSIVE`, not `NO EVIDENCE`.

## INCONCLUSIVE Meaning

`INCONCLUSIVE` means the audit could not safely complete. Common reasons:

- page failed to load
- form could not be found
- CAPTCHA blocks submission
- login is required
- wallet connection or signature is required
- browser automation failed

## Database Limitation

The tool does **not** prove database persistence.

From outside the website, we can detect whether dummy data was sent to a server endpoint. We cannot prove what the backend does after receiving it. Database proof requires backend logs, database access, or admin tooling from the website owner.

## Safety

- Do not connect wallets.
- Do not sign messages.
- Do not execute transactions.
- Do not enter real credentials.
- The tool only uses generated dummy data.

## Environment

Create an environment variable on the server:

```text
BROWSERLESS_TOKEN=
```

The token is only read server-side by `app/api/audit/route.ts`.

Optional override for Browserless region or self-hosted endpoint:

```text
BROWSERLESS_WS_ENDPOINT=wss://production-sfo.browserless.io
```
