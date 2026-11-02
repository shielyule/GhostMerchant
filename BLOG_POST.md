# GhostMerchant: a kill switch for AI agents that buy things

**Tagline:** Zero-trust PayPal escrow for autonomous buyers — authorize, probe, then capture or void.

*Built for the PayPal AI Hackathon. Live demo and code linked at the end.*

---

## The problem in one Monday morning

Priya runs Finance at Acme Cloud. Over the weekend, a deploy bug sent their purchasing agent — OpsBot — into a loop: “buy more OpenAI credits,” every thirty seconds, £800 a pop.

If OpsBot held a virtual card, Monday’s surprise is a five-figure statement and a long Slack thread.

That’s the quiet risk of agentic commerce. We’re handing software the ability to spend, often with the same instrument we’d give a junior employee: a card number in a vault, maybe a limit, not much proof that the vendor was real before the money moved.

GhostMerchant is built for the other shape of the story.

---

## What GhostMerchant is (and isn’t)

GhostMerchant is a **buyer-side control plane**. It sits between your buying agents and PayPal:

1. **Policy** — max order size, velocity (orders per minute), trust rules  
2. **AUTHORIZE** — hold funds on PayPal (not capture yet)  
3. **Probe** — check the vendor / deliverable looks alive  
4. **CAPTURE or VOID** — settle only if the probe passes; otherwise poison-pill the hold  
5. **Payouts (optional)** — split a successful capture across agent budget emails  
6. **Dispute dossier** — keep the forensic trail (policy, probe, PayPal IDs, step log)

It is **not** a Shopify plugin for every storefront. The merchant on the other side of the payment — a SaaS vendor, a PluginMart-style shop, anyone on PayPal — stays a normal seller. GhostMerchant doesn’t need to live in their checkout. You’re controlling *your* agent’s wallet behaviour once.

---

## Three stories that explain the product

### 1. The honeypot vendor (VOID)

Marcus in Security at Northwind Analytics has a research agent scraping “cheap GPU API” listings. It finds a slick site selling H100 access for £15. The marketing page looks fine. The actual key endpoint is dead.

**Trigger:** agent fires buy.  
**GhostMerchant:** AUTHORIZE £15 → probe vendor health → fail → **VOID**.  
**Value:** Marcus gets a VOIDED session with probe proof — not a captured payment to a scam shop.  
**For the merchant:** they never receive a capture. The auth doesn’t settle.

That’s the poison pill: money was held, not taken, and the bad vendor never got paid.

### 2. The healthy provision (CAPTURE)

Lena at RelayDesk wires an onboarding agent that must buy email API credits when a new tenant signs up.

**Trigger:** signup workflow calls purchase.  
**GhostMerchant:** AUTHORIZE → probe “key / health OK” → **CAPTURE**.  
**Value:** Lena doesn’t pay for dead keys; failed probes void and the flow can retry another vendor.  
**For the merchant:** this is when they actually get paid — an ordinary PayPal capture. GhostMerchant stayed on the buyer’s side of the counter.

### 3. The human still owns PayPal

Sam at BrightPath Tutoring won’t put card PANs inside an LLM tool stack. Their content agent wants a £49 stock-footage pack.

**Trigger:** agent requests a hold.  
**GhostMerchant:** creates a PayPal wallet order → status awaiting approval → Sam Approves in PayPal as the company buyer → pipeline continues.  
**Value:** spend sits under a real PayPal identity Finance can audit (and dispute later). The agent only got permission to *request* a hold.

---

## Why PayPal AUTHORIZE fits

Virtual cards are great at “can this agent pay?” They’re weaker at “should this payment settle *after* we checked delivery?”

PayPal’s authorize-and-capture model is closer to what agent spend needs:

- **AUTHORIZE** = escrow-shaped hold  
- **Probe** = your policy + canary check in the middle  
- **CAPTURE** = merchant gets paid  
- **VOID** = kill switch before settlement  

Add velocity limits and you also blunt the 3am runaway loop before it becomes a capture storm.

---

## What’s in the Control Room

The hackathon build ships a single Control Room dashboard:

- Policy sandbox (currency, max order, velocity, force probe fail)  
- Fire agent purchase (dry-run or live sandbox card / wallet)  
- Live pipeline: Policy → Authorize → Probe → Settle  
- Sessions table with PayPal IDs  
- Dossier drawer for forensics  

Live sandbox paths produce real order, authorization, capture, and payout identifiers — the kind of proof judges (and future customers) can trust.

---

## Who should care

| Role | Why GhostMerchant shows up |
|------|----------------------------|
| Finance / ops | Kill switch and audit trail when agents spend |
| Security | Probe-before-capture against honeypots and dead vendors |
| Agent / platform builders | `purchase` behind policy instead of a raw card in the prompt |
| Multi-agent product owners | Capture once, Payouts split across agent envelopes |

If you sell on Shopify or Stripe Checkout, you’re usually the **merchant counterparty**, not the GhostMerchant customer — unless you’re also running buying agents of your own.

---

## Try it

- **Live demo:** [ghostmerchant-production.up.railway.app](https://ghostmerchant-production.up.railway.app/)  
- **Source:** [github.com/shielyule/GhostMerchant](https://github.com/shielyule/GhostMerchant)  
- **Scenarios (short form):** [SCENARIOS.md](./SCENARIOS.md)  
- **Demo video:** *(add your YouTube URL)*  

Built with PayPal Sandbox (Orders AUTHORIZE, CAPTURE/VOID, Payouts, Disputes, Webhooks), Node/Express, and Cursor + PayPal MCP while developing.

---

## What’s next

Post-hackathon, the natural product shape is the same API with thinner clients on top: hosted Control Room, an agent SDK / MCP `buy` tool, and optional Chrome or Slack “Approve / freeze” for humans in the loop. The brand stays GhostMerchant; the surfaces are just how Priya and Lena meet it.

Until then: agents can shop. Finance can sleep.

—
*GhostMerchant — autonomous procurement with a kill switch.*
