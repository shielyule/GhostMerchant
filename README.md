# GhostMerchant

**Zero-trust escrow for autonomous buyers.**  
Agents don’t get a corporate card. GhostMerchant sits between buyer agents and PayPal: **policy → AUTHORIZE → delivery probe → CAPTURE or VOID** — then optional agent **payouts** and a **dispute forensics dossier**.

Built for the [PayPal AI Hackathon](https://paypal.dev/) (sandbox).

**License:** [MIT](./LICENSE)

### PayPal + AI (hackathon requirement)

| Tool | Role in GhostMerchant |
|------|------------------------|
| **PayPal Orders API** (`intent: AUTHORIZE`) | Create a hold for an agent purchase |
| **Authorizations CAPTURE / VOID** | Settle after a healthy probe, or poison-pill VOID |
| **PayPal Payouts** | Split a successful capture across agent budget emails |
| **Customer Disputes API** | Attach forensic dossier evidence when seller response is allowed |
| **PayPal Webhooks** | Async confirmation of auth / capture / void (via ngrok in dev) |
| **PayPal Sandbox MCP + AI Toolkit** | Used in Cursor while designing and debugging sandbox flows |
| **Cursor (AI IDE / agent)** | Primary AI tool used to build and iterate the control plane |

See also [`SCENARIOS.md`](./SCENARIOS.md) for judge-facing who/trigger/value stories.

---

## Why

Virtual cards give agents a spend instrument with weak delivery proof. GhostMerchant holds funds with PayPal **AUTHORIZE**, runs a canary **probe** against the vendor, then either **CAPTURE** (real goods/service) or **VOID** (poison pill — money never settles).

| Problem | GhostMerchant |
|---------|----------------|
| Agent runaway spend | Policy: max order + velocity circuit breaker |
| Fake / dead vendors | Pre-capture health probe → VOID on fail |
| Agent swarm budgets | After CAPTURE → Payouts split to sandbox agents |
| Chargebacks later | Session log → structured dispute evidence pack |

---

## Architecture

```text
Buyer agent / dashboard
        │
        ▼
┌───────────────────┐
│  Policy firewall  │  max amount · velocity · force-fail
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ PayPal AUTHORIZE  │  hold (card path or wallet approve)
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ Delivery probe    │  GET /demo/vendor/health (or custom URL)
└─────────┬─────────┘
     pass │ fail
          ├──────────► CAPTURE ──► optional Payouts (A/B/C)
          └──────────► VOID
          │
          ▼
   Dispute dossier (session forensics → Disputes API when seller evidence is requested)
```

**Live Pipeline (dashboard):** Policy → Authorize → Probe → Settle, with PayPal IDs on the status line.

---

## Quick start

**Requirements:** Node 18+, PayPal Sandbox app (Client ID + Secret).

```bash
git clone https://github.com/shielyule/GhostMerchant.git
cd GhostMerchant          # or cd ghostmerchant if nested
cp .env.example .env      # fill credentials (see below)
npm install
npm start                 # http://127.0.0.1:3030/
# or: npm run dev         # watch mode
```

Open **http://127.0.0.1:3030/** — Control Room dashboard.

### `.env` (minimum)

| Variable | Purpose |
|----------|---------|
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | Sandbox REST app |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` |
| `PORT` | Default `3030` |
| `SANDBOX_BUYER_EMAIL` | Personal account that Approves wallet checkouts + opens disputes |
| `PAYOUT_AGENT_A` / `B` / `C` | Personal sandbox emails for micro-splits after CAPTURE |
| `PUBLIC_BASE_URL` | Public HTTPS base for webhooks (ngrok URL) |
| `PAYPAL_WEBHOOK_ID` | From Developer Dashboard after registering the webhook |

Never commit `.env`. Token helper: `npm run token` (for Cursor PayPal MCP; the server prefers client credentials).

---

## Demo loop (≤3 min)

### A. Poison pill → VOID (sandbox card, fast)

1. Force probe fail **ON** → Save policy  
2. Mode: **Live: sandbox card**  
3. **Run through firewall** → expect **VOIDED** (authorization never captured)

### B. Happy path → CAPTURE + payouts

1. Force probe fail **OFF** → Save  
2. Mode: **Live: sandbox card** (or wallet — see C)  
3. **Run** → **CAPTURED** + payout batch id when `PAYOUT_AGENT_*` are set

### C. Wallet → dispute forensics

1. Mode: **Live: PayPal wallet**  
2. **Run** → status `AWAITING_APPROVAL` shows **Sandbox buyer (Approve as)** on the Live Pipeline line only  
3. Log into [sandbox.paypal.com](https://www.sandbox.paypal.com) as that Personal → **Approve in PayPal ↗**  
4. GhostMerchant polls PayPal and continues automatically (authorize → probe → settle) — no “I’ve approved” button  
5. Buyer: Activity → **Report a problem** → note Case ID (e.g. `PP-R-…`)  
6. Dashboard: click a session → dossier drawer; or `POST /disputes/dossier` / `POST /disputes/submit` with `disputeId` + `sessionId`

---

## Webhooks (optional but strong for video)

PayPal cannot POST to `localhost`. A tunnel exposes GhostMerchant:

```bash
ngrok http 3030
# set PUBLIC_BASE_URL=https://YOUR_SUBDOMAIN.ngrok-free.app
```

In **Developer Dashboard → Sandbox → your app → Webhooks**, subscribe that URL + `/webhooks/paypal` to events such as:

- `CHECKOUT.ORDER.APPROVED`
- `PAYMENT.AUTHORIZATION.CREATED` / `VOIDED`
- `PAYMENT.CAPTURE.COMPLETED`
- `CUSTOMER.DISPUTE.CREATED` (if available on the app)

**What “landing” means:** each PayPal event is accepted at `POST /webhooks/paypal`, logged in the server terminal (`[webhook]`), and stored in memory for `GET /webhooks/paypal/events`.

If the ngrok URL changes, update **both** `.env` `PUBLIC_BASE_URL` and the Dashboard webhook URL — otherwise events stop arriving even though CAPTURE/VOID still work via the REST API.

---

## Sessions & dispute dossier (hackathon caveat)

Pipeline **sessions live in process memory** (`Map` in the Node server). That means:

- Restarting `npm start` / `npm run dev` **clears** Live Pipeline history and session logs.
- The **dossier drawer** builds evidence from the selected session (policy decision, probe result, authorize/capture/void IDs, payout batch, step log). If the session is gone, the drawer has nothing to attach even though PayPal still has the capture and dispute.
- A real sandbox **dispute Case ID** (e.g. `PP-R-DQB-10194814`) lives in PayPal forever; GhostMerchant can still `GET` it via Disputes API. Seller `provide-evidence` only works when PayPal exposes that action (often after `WAITING_FOR_SELLER_RESPONSE` — early **INQUIRY / UNDER_REVIEW** may only show a `self` link).

**Practical tip for demos/video:** don’t restart the server between CAPTURE and opening the dossier; or keep the Case ID and capture id on a notepad as proof.

---

## PayPal products used

| Product | Role |
|---------|------|
| Orders v2 (`intent: AUTHORIZE`) | Create hold |
| Authorizations capture / void | Settle or poison-pill |
| Payouts | Split to agent emails after CAPTURE |
| Customer Disputes | List / show / provide-evidence when allowed |
| Webhooks | Async confirmation of auth/capture/void/dispute |

---

## Scripts

| Command | What it does |
|---------|----------------|
| `npm start` | Server on `PORT` (default 3030) |
| `npm run dev` | Same with `--watch` |
| `npm run token` | Print sandbox access token (MCP / tooling) |
| `npm run demo:void` / `demo:capture` | CLI dry/live helpers |
| `npm run live:phase-b` | Phase B live AUTHORIZE path |

---

## API surface (short)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/firewall/dashboard` | Policy + sessions (+ polls awaiting wallet approval) |
| POST | `/firewall/run` | Start poison-pill flow |
| POST | `/webhooks/paypal` | PayPal → GhostMerchant |
| GET | `/webhooks/paypal/events` | Recent received events |
| POST | `/disputes/dossier` | Build evidence JSON from `sessionId` |
| POST | `/disputes/submit` | Multipart provide-evidence when HATEOAS allows |
| GET | `/disputes/list` | Sandbox disputes page |

---

## Repo

- **GitHub:** https://github.com/shielyule/GhostMerchant (**public**)
- Local app path in the hackathon workspace: `ghostmerchant/`
- Extra cribs (video shot list, checklists) may live beside this folder in the private working tree — not required to run the app

---

## License / disclaimer

Hackathon demo against **PayPal Sandbox** only. Not production payment advice; dispute evidence packaging does not claim win rates.
