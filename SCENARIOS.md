# GhostMerchant — real-world scenarios

Use these for DevPost, demo video voiceover, or short animations.  
Each story: **who → what happens → trigger → GhostMerchant → value**.

**Spine for pitches:** something inside the company decides “buy” → GhostMerchant holds via PayPal → verifies → settles or kills → optionally splits and keeps dispute evidence. The shop on the other side can be Shopify, a SaaS vendor, or anyone on PayPal — **they’re the counterparty, not the customer of GhostMerchant.**

---

## 1. Overnight agent runaway — Acme Cloud (Series B SaaS)

| | |
|--|--|
| **Who** | Priya (Finance) · “OpsBot” (purchasing agent) |
| **What happens** | A deploy bug loops OpsBot: “buy more OpenAI credits” every 30 seconds overnight. |
| **Trigger** | Agent fires `buy` with amount £800 again and again. |
| **GhostMerchant** | Velocity + max-order policy blocks or VOIDs after AUTHORIZE — holds never stack into a five-figure capture. |
| **Value** | Priya opens the dashboard Monday to a few blocked attempts, not a £40k PayPal bill. |

**Demo beat:** Force high velocity / low max order → repeated Run → `POLICY_BLOCKED` or capped attempts.

---

## 2. Fake vendor / honeypot — Northwind Analytics

| | |
|--|--|
| **Who** | Marcus (Security) · research agent scraping “cheap GPU API” listings |
| **What happens** | Agent finds `gpu-keys-deal.example` selling “H100 API access” for £15. Site looks fine in a browser; the actual key endpoint is dead/honeypot. |
| **Trigger** | Agent calls buy → GhostMerchant AUTHORIZEs £15. |
| **GhostMerchant** | Pre-capture probe hits vendor health → fail → **VOID**. Money never settles. |
| **Value** | Marcus gets a VOIDED session with probe proof instead of a captured payment to a scam shop. |

**Demo beat:** Force probe fail **ON** → Live sandbox card → **VOIDED**.

---

## 3. Buy SaaS / API credits — RelayDesk (support AI startup)

| | |
|--|--|
| **Who** | Onboarding agent for new customer tenants · Lena (Platform eng) |
| **What happens** | New tenant needs a SendGrid (or similar) sub-account/API key provisioned automatically. |
| **Trigger** | Signup workflow: `provision_email_vendor` → buy/activate plan via PayPal-capable seller. |
| **GhostMerchant** | AUTHORIZE → probe “key works / health 200” → **CAPTURE** only if healthy. |
| **Value** | Lena doesn’t pay for dead keys; failed probes VOID and the workflow retries another vendor. |

**Demo beat:** Force probe fail **OFF** → CAPTURED + capture id.

---

## 4. Human still owns PayPal identity — BrightPath Tutoring

| | |
|--|--|
| **Who** | Agency’s content agent · office manager Sam (holds Business/Personal buyer login) |
| **What happens** | Agent wants a £49 stock-footage pack from a PayPal checkout seller. Company policy: no card numbers inside the LLM tool stack. |
| **Trigger** | Agent creates purchase intent → GhostMerchant creates AUTHORIZE order → **Approve as** Sam’s PayPal buyer. |
| **GhostMerchant** | Agent never sees a PAN; Sam (or policy-approved wallet) Approves; pipeline continues to probe/CAPTURE. |
| **Value** | Spend is auditable under a real PayPal identity; agent only gets “permission to request a hold.” |

**Demo beat:** Mode **Live: PayPal wallet** → status `AWAITING_APPROVAL` + Sandbox buyer on the status line → Approve in PayPal → auto-continue.

---

## 5. Swarm of specialist agents — ForgeWrite (AI content studio)

| | |
|--|--|
| **Who** | Three agents — Writer, Fact-Checker, Thumbnail Designer · owner Kai |
| **What happens** | Client job needs a paid stock image + a plagiarism-scan API top-up in one procurement. |
| **Trigger** | Job orchestrator: “fulfill brief” → single CAPTURE for the bundle. |
| **GhostMerchant** | Probe passes → CAPTURE £30 → **Payouts** split (e.g. 40/35/25) to each agent’s payout email/budget envelope. |
| **Value** | Kai sees one customer charge path and automatic internal micro-splits without manual transfers. |

**Demo beat:** CAPTURED session shows `payout_batch_id` when `PAYOUT_AGENT_A/B/C` are set.

---

## 6. Dispute after bad digital delivery — PixelCart ↔ PluginMart

| | |
|--|--|
| **Who** | Buyer-side ops Rina · PluginMart (Shopify shop that takes PayPal) sold a “premium Shopify plugin” |
| **What happens** | Probe looked OK (download URL 200); after CAPTURE the zip is corrupt / license server dies. Buyer opens PayPal **Report a Problem**. |
| **Trigger** | Dispute Case ID appears (e.g. `PP-R-…`). |
| **GhostMerchant** | Dossier already has order/capture IDs, probe JSON, policy decision, step log → evidence pack for Disputes. |
| **Value** | Rina answers PayPal with forensics (“we probed, then captured”) instead of screenshots from Slack. |

**Demo beat:** Click session → dossier drawer; or `POST /disputes/submit` with `disputeId` + `sessionId` when PayPal requests seller evidence.

---

## 7. Many shops, one leash — Harbor Freight Robotics

| | |
|--|--|
| **Who** | Procurement agent buying fasteners from Shop A (Shopify+PayPal), sensors from Shop B, cloud inference credits from Vendor C |
| **What happens** | Weekly restock plan generates three buys across unrelated merchants. |
| **Trigger** | Each line item → GhostMerchant run with that merchant’s PayPal checkout. |
| **GhostMerchant** | Same policy plane (limits, probe, VOID/CAPTURE) in front of every PayPal spend; shops stay normal merchants. |
| **Value** | Harbor doesn’t install an app on every storefront — they control **their** agent’s wallet behavior once. |

**Pitch line:** GhostMerchant is the buyer’s control plane, not a Shopify plugin for every seller.

---

## 8. Dry-run before live money — Nova Labs internal hack week

| | |
|--|--|
| **Who** | Dev Jess wiring a buying agent for the first time |
| **What happens** | Jess isn’t sure if “force probe fail” and velocity rules behave before enabling live AUTHORIZE. |
| **Trigger** | Dashboard dry-run / force-fail toggles, then a £1 live card path. |
| **GhostMerchant** | Shows `WOULD_VOID` / `VOIDED` vs `CAPTURED` with real PayPal IDs in sandbox. |
| **Value** | Jess demos a kill switch to stakeholders before any production budget is attached. |

**Demo beat:** Dry-run modes first, then Live sandbox card for proof IDs.

---

## 9. Consumer metaphor only — The Patel family *(analogy, not the product)*

| | |
|--|--|
| **Who** | Parent Neha · teenager Aria’s “auto top-up game skins” script (stand-in for an agent) |
| **What happens** | Script tries to buy £20 skins every time balance drops. |
| **Trigger** | Auto-buy fires. |
| **GhostMerchant-shaped control** | Hold → “is this allowed / does the seller check out?” → capture or void. |
| **Value** | Same *story shape* as parental limits — but in the real product the “teen” is Nova Labs’ agent and the “parent” is Priya in Finance (story 1), not a consumer parenting app. |

**Use carefully:** great 10-second intuition; then pivot to story 1 or 2 for judges.

---

## Animation-friendly shorts (pick 1–2)

1. **Acme overnight** — clock → looping “BUY £800” → red POLICY/VOID → Priya Monday coffee, calm dashboard.  
2. **Northwind honeypot** — shiny vendor page → AUTHORIZE → probe fail → VOID stamp → Marcus nods.  
3. **ForgeWrite split** — one CAPTURE → three payout envelopes to Writer / Checker / Designer.

---

## One-liner (DevPost)

GhostMerchant replaces virtual cards for AI agents with PayPal authorize-and-verify: hold funds, probe delivery, capture or void — then split payouts and attach dispute evidence.
