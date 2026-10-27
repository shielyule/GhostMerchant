# GhostMerchant — Setup (singing & dancing)

Full scope stays: policy firewall + poison-pill AUTHORIZE→probe→CAPTURE/VOID + webhooks + payouts + disputes dossier.

Deadline: **12 Nov 2026, 12:00pm PST**.

---

## 0. You do once (credentials)

1. [PayPal Developer Dashboard](https://developer.paypal.com/dashboard) → **Sandbox** app → copy **Client ID** + **Secret**.
2. **Sandbox → Accounts**: note a business (merchant) + personal (buyer) email.
3. In `ghostmerchant/`:

```bash
cp .env.example .env
# fill PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET
npm install
npm run token   # prints access token (~8–9h life)
```

---

## 1. Activate PayPal MCP in Cursor

Project already has `.mcp.json` pointing at:

`https://mcp.sandbox.paypal.com/sse` with `Bearer ${PAYPAL_SANDBOX_ACCESS_TOKEN}`

**Do this:**

1. Install PayPal plugin (pick one):
   - Chat: try `/add-plugin paypal` or **Customize → Plugins**
   - Or: Cursor marketplace add `https://github.com/paypal/AI-Toolkit`
2. **Customize → Plugins → PayPal → Configure** → paste token from `npm run token`
3. **Fully quit and reopen Cursor** (not just reload chat)
4. Ask: *“List PayPal MCP tools”* or *“Create a sandbox invoice for $1”*

Best-practices skill is vendored at:

- `.cursor/skills/paypal-best-practices/`
- `ghostmerchant/.cursor/skills/paypal-best-practices/`
- Full toolkit mirror: `vendor/paypal-AI-Toolkit/`

Token died? `npm run token` again → paste into Configure → `/paypal:setup refresh` if commands are available.

---

## 2. Local server + webhook tunnel

`ngrok` is **not** on this machine yet. Install then tunnel:

```bash
brew install ngrok
# or download from https://ngrok.com/download — auth token from ngrok dashboard

cd ghostmerchant
npm run dev
# other terminal:
ngrok http 3000
```

Copy the `https://….ngrok.app` URL into `.env`:

```
PUBLIC_BASE_URL=https://YOUR_SUBDOMAIN.ngrok.app
```

### Register webhooks (Dashboard)

**Developer Dashboard → Sandbox → Webhooks** (on your app):

| URL | Events |
|-----|--------|
| `https://YOUR_SUBDOMAIN.ngrok.app/webhooks/paypal` | `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED` (add disputes events when you wire that path) |

Paste **Webhook ID** into `PAYPAL_WEBHOOK_ID`.

Simulate: Dashboard webhook simulator → watch `GET http://127.0.0.1:3000/webhooks/paypal/events`.

---

## 3. Verification gate (probe)

Already built:

```bash
npm run probe
# or force fail:
PROBE_MODE=fail npm run probe

# against live server health endpoint:
curl -s http://127.0.0.1:3000/demo/vendor/health
curl -s 'http://127.0.0.1:3000/demo/vendor/health?ok=0'
```

Dry-run firewall (no PayPal settle):

```bash
npm run demo:void     # WOULD_VOID
npm run demo:capture  # WOULD_CAPTURE
```

---

## 4. Live PayPal settle (next coding session)

1. Create order `intent: AUTHORIZE` (MCP tool, Postman, or `POST /firewall/run` with `createOrder: true`).
2. Approve with sandbox buyer (approve link / MCP).
3. Authorize → get `authorizationId`.
4. `POST /firewall/settle` with `{ "authorizationId": "…" }` and `probeMode: "fail"` → **VOID** hero beat.
5. Repeat with `probeMode: "pass"` → **CAPTURE**.
6. On `PAYMENT.CAPTURE.COMPLETED`, set `PAYOUT_AGENT_A/B/C` sandbox emails and hit webhook with `?demo_split=1` or wire splits from capture handler.

---

## 5. Build order (nothing cut — sequenced)

| Phase | Deliverable |
|-------|-------------|
| **A** (this checklist) | MCP + token, server, probe, webhook tunnel |
| **B** | Live AUTHORIZE → probe → VOID/CAPTURE with IDs on UI |
| **C** | Webhook → Payouts batch to 3 agent sandbox accounts |
| **D** | Disputes dossier → Disputes MCP `provide_evidence` |
| **E** | Buyer-agent UI + policy editor + demo video |

---

## Postman (side learning)

Import: https://www.postman.com/paypal  

Vars: `base_url=https://api-m.sandbox.paypal.com`, client id/secret → **Get Access Token** → Orders AUTHORIZE path.
