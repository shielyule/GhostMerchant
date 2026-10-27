import 'dotenv/config'
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  runPoisonPillFlow,
  settleExisting,
  getSession,
  listSessions,
  getDashboardState,
  tryResumeAwaitingApprovals,
} from './services/firewall.js'
import { getPolicy, updatePolicy, resetPolicy } from './services/policy.js'
import { runVerificationProbe } from './services/probe.js'
import { createPayoutBatch } from './lib/paypal.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '../public')

const app = express()
const PORT = Number(process.env.PORT || 3030)

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf
    },
  }),
)

app.use(express.static(publicDir))

const webhookEvents = []

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ghostmerchant', ts: new Date().toISOString() })
})

app.get('/demo/vendor/health', (req, res) => {
  const q = req.query.ok
  const mode = process.env.PROBE_MODE || 'pass'
  const ok = q === '0' || q === 'false' ? false : q === '1' || q === 'true' ? true : mode !== 'fail'
  if (!ok) {
    return res.status(503).json({
      ok: false,
      healthy: false,
      status: 'dead_key',
      message: 'API key invalid, rate-limited, or counterfeit',
    })
  }
  res.json({ ok: true, healthy: true, status: 'healthy', license: 'active' })
})

app.post('/probe', async (req, res) => {
  const result = await runVerificationProbe(req.body || {})
  res.status(result.ok ? 200 : 422).json(result)
})

app.get('/firewall/dashboard', (_req, res) => {
  // Detect PayPal buyer approval without a manual “I’ve approved” click
  void tryResumeAwaitingApprovals()
  res.json(getDashboardState())
})

app.get('/firewall/policy', (_req, res) => {
  res.json({ policy: getPolicy() })
})

app.patch('/firewall/policy', (req, res) => {
  res.json({ policy: updatePolicy(req.body || {}) })
})

app.post('/firewall/policy/reset', (_req, res) => {
  res.json({ policy: resetPolicy() })
})

app.post('/firewall/run', async (req, res) => {
  try {
    const useSandboxCard = Boolean(req.body?.useSandboxCard ?? req.body?.createOrder)
    const session = await runPoisonPillFlow(req.body?.purchase || req.body || {}, {
      createOrder: Boolean(req.body?.createOrder),
      authorize: Boolean(req.body?.authorize),
      useSandboxCard,
      splitPayouts: req.body?.splitPayouts !== false,
      orderId: req.body?.orderId,
      authorizationId: req.body?.authorizationId,
      probeMode: req.body?.probeMode,
      probeDelayMs: req.body?.probeDelayMs,
      dryRun: req.body?.dryRun !== false && !req.body?.authorizationId && !req.body?.createOrder,
      sessionId: req.body?.sessionId,
    })
    res.json(session)
  } catch (err) {
    console.error('[firewall/run]', err.message, err.body)
    res.status(err.status || 500).json({ error: err.message, body: err.body })
  }
})

app.post('/firewall/settle', async (req, res) => {
  try {
    const session = await settleExisting({
      sessionId: req.body?.sessionId,
      authorizationId: req.body?.authorizationId,
      probeMode: req.body?.probeMode,
      probeDelayMs: req.body?.probeDelayMs,
    })
    res.json(session)
  } catch (err) {
    console.error('[firewall/settle]', err.message, err.body)
    res.status(err.status || 500).json({ error: err.message, body: err.body })
  }
})

/** After buyer approves a wallet order: authorize → probe → CAPTURE/VOID */
app.post('/firewall/continue', async (req, res) => {
  try {
    const existing = req.body?.sessionId ? getSession(req.body.sessionId) : null
    if (!existing?.orderId) {
      return res.status(400).json({ error: 'sessionId with orderId required' })
    }
    const session = await runPoisonPillFlow(existing.purchase || {}, {
      sessionId: existing.id,
      orderId: existing.orderId,
      authorize: true,
      useSandboxCard: false,
      splitPayouts: req.body?.splitPayouts !== false,
      probeMode: req.body?.probeMode,
      probeDelayMs: req.body?.probeDelayMs ?? 2000,
      dryRun: false,
    })
    res.json(session)
  } catch (err) {
    console.error('[firewall/continue]', err.message, err.body)
    res.status(err.status || 500).json({ error: err.message, body: err.body })
  }
})

app.get('/firewall/sessions', (_req, res) => {
  res.json({ sessions: listSessions() })
})

app.get('/firewall/sessions/:id', (req, res) => {
  const s = getSession(req.params.id)
  if (!s) return res.status(404).json({ error: 'not found' })
  res.json(s)
})

app.post('/webhooks/paypal', async (req, res) => {
  const event = req.body || {}
  const record = {
    receivedAt: new Date().toISOString(),
    event_type: event.event_type,
    id: event.id,
    resource_type: event.resource_type,
    summary: event.summary,
    resource: event.resource,
  }
  webhookEvents.unshift(record)
  if (webhookEvents.length > 100) webhookEvents.pop()

  console.log('[webhook]', record.event_type, record.id)

  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const splits =
      req.query.demo_split === '1'
        ? [
            { receiver: process.env.PAYOUT_AGENT_A, amount: '10.00', note: 'Code Writer share' },
            { receiver: process.env.PAYOUT_AGENT_B, amount: '7.50', note: 'Security Scanner share' },
            { receiver: process.env.PAYOUT_AGENT_C, amount: '5.00', note: 'Docs Synthesizer share' },
          ].filter((x) => x.receiver)
        : null

    if (splits?.length) {
      try {
        const payout = await createPayoutBatch({ items: splits })
        record.payout = payout
        console.log('[payout]', payout.batch_header?.payout_batch_id)
      } catch (err) {
        record.payoutError = err.message
        console.error('[payout error]', err.message, err.body)
      }
    }
  }

  res.status(200).json({ received: true, event_type: event.event_type })
})

app.get('/webhooks/paypal/events', (_req, res) => {
  res.json({ events: webhookEvents })
})

function buildDossier(req) {
  const session = req.body?.sessionId ? getSession(req.body.sessionId) : null
  return {
    generatedAt: new Date().toISOString(),
    product: 'GhostMerchant',
    dispute_reason: req.body?.reason || 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    orderId: req.body?.orderId || session?.orderId,
    authorizationId: session?.authorizationId,
    captureId: req.body?.captureId || session?.captureId,
    evidence: {
      prompt_contract: session?.forensic?.promptContract || req.body?.promptContract,
      agent_trace: session?.forensic?.agentTrace || req.body?.agentTrace || [],
      policy_evaluation: session?.forensic?.policy,
      probe_result: session?.forensic?.probe || session?.probe,
      firewall_log: session?.log || [],
      pipeline_stages: session?.stages,
      status: session?.status,
      payout: session?.payout || null,
    },
    paypal_disputes_note:
      'Structured evidence pack for Disputes API — not a claim of win-rate.',
  }
}

app.post('/disputes/dossier', (req, res) => {
  res.json(buildDossier(req))
})

/** Submit dossier notes as dispute evidence (needs a real sandbox dispute_id). */
app.post('/disputes/submit', async (req, res) => {
  try {
    const disputeId = req.body?.disputeId
    if (!disputeId) {
      return res.status(400).json({ error: 'disputeId required (from sandbox buyer dispute or list_disputes)' })
    }
    const dossier = buildDossier(req)
    const notes = [
      'GhostMerchant automated forensic evidence pack',
      `reason: ${dossier.dispute_reason}`,
      `orderId: ${dossier.orderId || 'n/a'}`,
      `captureId: ${dossier.captureId || 'n/a'}`,
      `status: ${dossier.evidence.status || 'n/a'}`,
      `probe: ${JSON.stringify(dossier.evidence.probe_result || {})}`,
      `prompt: ${dossier.evidence.prompt_contract || 'n/a'}`,
      `trace: ${JSON.stringify(dossier.evidence.agent_trace || [])}`,
    ]
      .join('\n')
      .slice(0, 2000)

    const { getAccessToken } = await import('./lib/paypal.js')
    const token = await getAccessToken()
    const base = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com'
    const disputePath = `/v1/customer/disputes/${encodeURIComponent(disputeId)}`

    // HATEOAS: only call provide-evidence when PayPal exposes that link
    const detail = await fetch(`${base}${disputePath}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }).then((r) => r.json())

    const canProvide = (detail.links || []).some((l) => l.rel === 'provide_evidence' || l.rel === 'provide-evidence')
    if (!canProvide) {
      return res.json({
        submitted: false,
        disputeId,
        dossier,
        dispute: {
          status: detail.status,
          dispute_state: detail.dispute_state,
          dispute_life_cycle_stage: detail.dispute_life_cycle_stage,
          reason: detail.reason,
          links: (detail.links || []).map((l) => l.rel),
        },
        note:
          'Case exists. PayPal is not requesting seller evidence yet (typical for early INQUIRY / UNDER_REVIEW). Dossier is ready; resubmit when status is WAITING_FOR_SELLER_RESPONSE.',
      })
    }

    // provide-evidence requires multipart/form-data with JSON `input` part
    const form = new FormData()
    form.append(
      'input',
      new Blob(
        [
          JSON.stringify({
            evidences: [{ evidence_type: 'OTHER', notes }],
          }),
        ],
        { type: 'application/json' },
      ),
    )

    const submitRes = await fetch(`${base}${disputePath}/provide-evidence`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    const text = await submitRes.text()
    let result = null
    try {
      result = text ? JSON.parse(text) : null
    } catch {
      result = { raw: text }
    }
    if (!submitRes.ok) {
      return res.status(submitRes.status).json({ error: 'provide-evidence failed', body: result, dossier })
    }
    res.json({ submitted: true, disputeId, dossier, result })
  } catch (err) {
    console.error('[disputes/submit]', err.message, err.body)
    res.status(err.status || 500).json({ error: err.message, body: err.body })
  }
})

app.get('/disputes/list', async (_req, res) => {
  try {
    const { paypalFetch } = await import('./lib/paypal.js')
    const result = await paypalFetch('/v1/customer/disputes?page_size=10')
    res.json(result)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, body: err.body })
  }
})

app.listen(PORT, () => {
  console.log(`GhostMerchant listening on http://127.0.0.1:${PORT}`)
  console.log(`Dashboard: http://127.0.0.1:${PORT}/`)
  console.log(
    `Webhook URL (after tunnel): ${process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`}/webhooks/paypal`,
  )
})
