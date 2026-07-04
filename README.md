# Whitelist / Waitlist Submission Detector

This project is a Chrome Extension companion for the Vercel documentation dashboard.

The tool answers one question only:

**Did the submitted dummy data leave the browser and get sent to a non-analytics server endpoint?**

It does **not** claim that data was saved to a database.

## Result Meaning

### YES - DATA SENT TO SERVER

The extension saw a non-analytics request from the active tab that:

- happened after the audit started
- used `POST`, `PUT`, `PATCH`, or a GraphQL mutation
- contained at least one generated dummy marker
- did not go to a known analytics/tracking endpoint

### NO - NO SERVER SUBMISSION DETECTED

No matching request containing the dummy data was detected during the audit window.

This can mean the form is fake frontend UI, only stores data locally, did not submit, blocked the request, or uses a flow the extension cannot observe.

## Why It Does Not Claim Database Persistence

From the browser, the extension can see whether dummy data is sent to a server endpoint. It cannot see what the backend does after receiving that request.

Saving to a database can only be proven with backend access, logs, database records, or admin tooling from the website owner.

## Load The Extension Unpacked In Chrome

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this folder:

   ```text
   extension
   ```

6. Pin or open the extension, then open its side panel.

## Run An Audit

1. Open the target whitelist or waitlist website in Chrome.
2. Open the extension side panel.
3. Click **START AUDIT**.
4. Copy the generated dummy values:
   - wallet
   - X/Twitter handle
   - email
   - name
5. Manually paste those dummy values into the target form.
6. Submit the form yourself.
7. The extension watches requests for 10 seconds after submit.
8. Read the result:
   - `YES - DATA SENT TO SERVER`
   - `NO - NO SERVER SUBMISSION DETECTED`

## Safety Rules

- Do not connect a wallet.
- Do not sign messages.
- Do not execute transactions.
- Do not enter real credentials.
- Do not submit a real wallet address.
- Use only generated dummy data.

## Ignored Analytics Domains

The detector ignores common analytics and tracking endpoints, including:

- `google-analytics.com`
- `googletagmanager.com`
- `cloudflareinsights.com`
- `sentry.io`
- `segment.io`
- `mixpanel.com`
- `amplitude.com`
- `doubleclick.net`

## Local Audit History

Audit history is stored locally in Chrome using `chrome.storage.local`.

The Vercel dashboard is only for documentation and product context.
