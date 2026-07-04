# YES / NO Whitelist Form Detector

Simple tool for checking one thing:

**Did dummy whitelist/waitlist data leave the browser and get sent to a non-analytics server endpoint?**

The result is intentionally binary:

- `YES - DATA SENT TO SERVER`
- `NO - NO SERVER SUBMISSION DETECTED`

## What The Web Tool Does

1. User pastes a whitelist or waitlist website URL.
2. The backend opens that URL in headless Chromium.
3. The tool generates unique dummy data:
   - wallet
   - email
   - X/Twitter handle
   - name
4. The tool fills matching form fields.
5. The tool clicks a safe submit button.
6. It watches network requests for 10 seconds.
7. It checks requests similar to manual DevTools flow:
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

## NO Meaning

`NO - NO SERVER SUBMISSION DETECTED` means:

- no matching request containing the dummy data was detected

This can happen if the frontend is fake, the form only stores locally, the website blocks automation, the submit button is not detected, or the request does not include the dummy markers.

## Database Limitation

The tool does **not** prove database persistence.

From outside the website, we can detect whether dummy data was sent to a server endpoint. We cannot prove what the backend does after receiving it. Database proof requires backend logs, database access, or admin tooling from the website owner.

## Safety

- Do not connect wallets.
- Do not sign messages.
- Do not execute transactions.
- Do not enter real credentials.
- The tool only uses generated dummy data.

## Chrome Extension

The repo also includes an optional Chrome extension in `extension/` for manual audits from the browser side panel. The main product flow is the web dashboard.
