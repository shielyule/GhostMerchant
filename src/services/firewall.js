/**
 * GhostMerchant core loop:
 * policy → AUTHORIZE → probe → CAPTURE | VOID
 */

import {
  evaluatePolicy,
  getPolicy,
  recordAuthAttempt,
  velocitySnapshot,
} from './policy.js'
import { runVerificationProbe } from './probe.js'
import {
  createAuthorizeOrder,
  getOrder,
  authorizeOrder,
  captureAuthorization,
  voidAuthorization,
  createPayoutBatch,
} from '../lib/paypal.js'

const sessions = new Map()
/** Prevents double authorize/probe when dashboard polls while a resume is in flight. */
const resumingApprovals = new Set()

const STAGES = ['policy', 'authorize', 'probe', 'settle']

function authIdFromAuthorizeResult(result) {
  const units = result?.purchase_units || []
  for (const u of units) {
    const auths = u?.payments?.authorizations || []
    if (auths[0]?.id) return auths[0].id
  }
  return null
}

function captureIdFromSettlement(settlement) {
  return settlement?.id || settlement?.purchase_units?.[0]?.payments?.captures?.[0]?.id || null
}

function baseSession(id, purchase) {
  return {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'PENDING',
    stage: 'policy',
    stages: Object.fromEntries(STAGES.map((s) => [s, 'pending'])),
    purchase,
    orderId: null,
    authorizationId: null,
    captureId: null,
    approveLink: null,
    probe: null,
    settlement: null,
    log: [],
    outcome: null,
    forensic: null,
    probeStartedAt: null,
    probeEndsAt: null,
  }
}

function save(session) {
  session.updatedAt = new Date().toISOString()
  sessions.set(session.id, session)
  return session
}

function push(session, step, data) {
  session.log.push({ at: new Date().toISOString(), step, ...data })
}

function setStage(session, stage, state) {
  session.stage = stage
  session.stages[stage] = state
}

export function getSession(id) {
  return sessions.get(id) || null
}

export function listSessions() {
  return [...sessions.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function getDashboardState() {
  const policy = getPolicy()
  return {
    policy,
    velocity: velocitySnapshot(),
    sessions: listSessions(),
    buyerEmail: policy.buyerEmail || process.env.SANDBOX_BUYER_EMAIL || '',
  }
}

/**
 * @param {object} purchase
 * @param {object} opts
 * @param {boolean} [opts.createOrder]
 * @param {boolean} [opts.authorize]
 * @param {boolean} [opts.useSandboxCard] — live AUTHORIZE without browser approve (sandbox Visa)
 * @param {boolean} [opts.splitPayouts] — after CAPTURE, payout to PAYOUT_AGENT_* emails
 * @param {string} [opts.orderId]
 * @param {string} [opts.authorizationId]
 * @param {string} [opts.probeMode]
 * @param {boolean} [opts.dryRun]
 * @param {number} [opts.probeDelayMs] — simulate probe countdown for dashboard (default 0; demo uses ~2500)
 */
export async function runPoisonPillFlow(purchase, opts = {}) {
  const id = opts.sessionId || crypto.randomUUID()
  const existing = sessions.get(id)
  const session = existing || baseSession(id, purchase)
  session.purchase = { ...purchase }
  save(session)

  setStage(session, 'policy', 'running')
  const policy = evaluatePolicy(purchase)
  push(session, 'policy', { policy })
  session.forensic = {
    promptContract: purchase.promptContract || null,
    agentTrace: purchase.agentTrace || [],
    policy,
    probe: null,
  }

  if (!policy.allowed) {
    setStage(session, 'policy', 'blocked')
    session.status = 'POLICY_BLOCKED'
    session.outcome = 'blocked_before_authorize'
    return save(session)
  }

  setStage(session, 'policy', 'passed')
  recordAuthAttempt()

  let order = null
  let authorizationId = opts.authorizationId || session.authorizationId || null
  let orderId = opts.orderId || session.orderId || null

  setStage(session, 'authorize', 'running')

  if (!authorizationId && opts.createOrder) {
    order = await createAuthorizeOrder({
      amount: purchase.amount,
      currency: purchase.currency || 'USD',
      description: purchase.description || `GhostMerchant:${purchase.vendor || 'vendor'}`,
      useSandboxCard: Boolean(opts.useSandboxCard),
    })
    orderId = order.id
    session.orderId = orderId
    authorizationId = authIdFromAuthorizeResult(order)
    const approve = (order.links || []).find((l) => l.rel === 'approve')
    session.approveLink = approve?.href || null
    push(session, 'order_created', {
      orderId,
      status: order.status,
      authorizationId,
      links: order.links,
      sandboxCard: Boolean(opts.useSandboxCard),
    })
  }

  if (orderId && !authorizationId && (opts.authorize || opts.useSandboxCard)) {
    try {
      const authResult = await authorizeOrder(orderId)
      authorizationId = authIdFromAuthorizeResult(authResult)
      push(session, 'authorized', { orderId, authorizationId, status: authResult.status })
    } catch (err) {
      push(session, 'authorize_error', { message: err.message, body: err.body })
    }
  }

  session.orderId = orderId
  session.authorizationId = authorizationId

  if (authorizationId) {
    setStage(session, 'authorize', 'passed')
  } else if (orderId) {
    setStage(session, 'authorize', 'awaiting_approval')
    setStage(session, 'probe', 'pending')
    setStage(session, 'settle', 'pending')
    session.status = 'AWAITING_APPROVAL'
    session.buyerEmail =
      purchase.buyerEmail || getPolicy().buyerEmail || process.env.SANDBOX_BUYER_EMAIL || ''
    push(session, 'awaiting_authorization', {
      message:
        'Order created. Approve in PayPal as the Sandbox buyer shown on this line — GhostMerchant will detect approval and continue automatically.',
      orderId,
      approveLink: session.approveLink,
      buyerEmail: session.buyerEmail,
    })
    // Stop here — tryResumeAwaitingApprovals() polls PayPal until APPROVED, then continues
    return save(session)
  } else if (!opts.dryRun) {
    setStage(session, 'authorize', 'awaiting_approval')
    push(session, 'awaiting_authorization', {
      message: 'No authorizationId yet. Use createOrder, MCP, or paste an authorizationId to settle.',
    })
  } else {
    setStage(session, 'authorize', 'simulated')
  }

  save(session)

  // Probe window (dashboard countdown)
  const policyNow = getPolicy()
  const delay =
    opts.probeDelayMs != null
      ? Number(opts.probeDelayMs)
      : Math.min(Number(policyNow.probeTimeoutMs) || 0, 8000)

  setStage(session, 'probe', 'running')
  session.status = authorizationId ? 'PROBING' : session.status === 'AWAITING_APPROVAL' ? 'AWAITING_APPROVAL' : 'PROBING'
  session.probeStartedAt = new Date().toISOString()
  session.probeEndsAt = new Date(Date.now() + Math.max(delay, 0)).toISOString()
  save(session)

  if (delay > 0) {
    await new Promise((r) => setTimeout(r, delay))
  }

  const forcedFail = policyNow.forceProbeFail
  const probeMode = forcedFail ? 'fail' : purchase.probeMode || opts.probeMode
  const probe = await runVerificationProbe({
    probeUrl: purchase.probeUrl,
    mode: probeMode,
  })
  session.probe = probe
  session.forensic.probe = probe
  push(session, 'probe', probe)
  setStage(session, 'probe', probe.ok ? 'passed' : 'failed')
  save(session)

  setStage(session, 'settle', 'running')
  let settlement = null
  if (authorizationId) {
    if (probe.ok) {
      settlement = await captureAuthorization(authorizationId)
      session.captureId = captureIdFromSettlement(settlement)
      push(session, 'capture', { authorizationId, capture: settlement })
      setStage(session, 'settle', 'captured')
      session.status = 'CAPTURED'
      session.outcome = 'capture'

      if (opts.splitPayouts !== false) {
        const payout = await maybeSplitPayouts(session, purchase)
        if (payout) {
          session.payout = payout
          push(session, 'payouts', payout)
        }
      }
    } else {
      settlement = await voidAuthorization(authorizationId)
      push(session, 'void', { authorizationId, void: settlement })
      setStage(session, 'settle', 'voided')
      session.status = 'VOIDED'
      session.outcome = 'void'
    }
  } else {
    // Dry-run / awaiting auth — show intended outcome on conveyor
    if (probe.ok) {
      setStage(session, 'settle', 'would_capture')
      session.status = orderId && !authorizationId ? 'AWAITING_APPROVAL' : 'WOULD_CAPTURE'
      session.outcome = 'capture'
    } else {
      setStage(session, 'settle', 'would_void')
      session.status = orderId && !authorizationId ? 'AWAITING_APPROVAL' : 'WOULD_VOID'
      session.outcome = 'void'
    }
  }

  session.settlement = settlement
  return save(session)
}

export async function settleExisting({ sessionId, authorizationId, probeMode, probeDelayMs, splitPayouts }) {
  const existing = sessionId ? sessions.get(sessionId) : null
  const purchase = existing?.purchase || {
    amount: 1,
    currency: 'USD',
    vendor: 'api-keys.demo',
    category: 'api_key',
    description: 'GhostMerchant settle',
  }
  return runPoisonPillFlow(purchase, {
    sessionId: sessionId || crypto.randomUUID(),
    authorizationId,
    orderId: existing?.orderId,
    probeMode,
    probeDelayMs,
    splitPayouts,
  })
}

/**
 * Poll PayPal for wallet orders stuck on AWAITING_APPROVAL.
 * When the buyer has Approved (order status APPROVED), authorize → probe → settle.
 * Fire-and-forget safe: skips sessions already resuming.
 */
export async function tryResumeAwaitingApprovals() {
  const awaiting = listSessions().filter((s) => s.status === 'AWAITING_APPROVAL' && s.orderId)
  for (const existing of awaiting) {
    if (resumingApprovals.has(existing.id)) continue
    try {
      const order = await getOrder(existing.orderId)
      existing.paypalOrderStatus = order.status
      save(existing)

      // Buyer finished PayPal checkout — order is ready to authorize
      if (order.status !== 'APPROVED' && order.status !== 'COMPLETED') continue

      resumingApprovals.add(existing.id)
      push(existing, 'buyer_approved_detected', {
        orderId: existing.orderId,
        paypalStatus: order.status,
      })
      save(existing)

      const policy = getPolicy()
      await runPoisonPillFlow(existing.purchase || {}, {
        sessionId: existing.id,
        orderId: existing.orderId,
        authorize: true,
        useSandboxCard: false,
        splitPayouts: true,
        probeDelayMs: Math.min(Number(policy.probeTimeoutMs) || 2000, 8000),
        dryRun: false,
      })
    } catch (err) {
      console.error('[resume-approval]', existing.id, err.message, err.body)
      push(existing, 'resume_error', { message: err.message, body: err.body })
      save(existing)
    } finally {
      resumingApprovals.delete(existing.id)
    }
  }
}

async function maybeSplitPayouts(session, purchase) {
  const receivers = [
    { key: 'A', receiver: process.env.PAYOUT_AGENT_A, note: 'Code Writer share', weight: 0.4 },
    { key: 'B', receiver: process.env.PAYOUT_AGENT_B, note: 'Security Scanner share', weight: 0.35 },
    { key: 'C', receiver: process.env.PAYOUT_AGENT_C, note: 'Docs Synthesizer share', weight: 0.25 },
  ].filter((r) => r.receiver)

  if (!receivers.length) {
    return {
      skipped: true,
      reason: 'Set PAYOUT_AGENT_A/B/C sandbox emails in .env to enable micro-splits',
    }
  }

  const total = Number(purchase.amount || 0)
  const currency = purchase.currency || 'USD'
  // Keep ~10% platform fee so agent splits stay under captured amount
  const distributable = Math.max(Number((total * 0.9).toFixed(2)), 0.01)
  let remaining = distributable
  const items = receivers.map((r, i) => {
    let amount
    if (i === receivers.length - 1) {
      amount = remaining
    } else {
      amount = Number((distributable * r.weight).toFixed(2))
      remaining = Number((remaining - amount).toFixed(2))
    }
    return {
      receiver: r.receiver,
      amount: amount.toFixed(2),
      currency,
      note: r.note,
      sender_item_id: `${session.id}-${r.key}`,
    }
  })

  try {
    const batch = await createPayoutBatch({
      items,
      emailSubject: 'GhostMerchant agent split',
    })
    return {
      skipped: false,
      payout_batch_id: batch.batch_header?.payout_batch_id,
      batch_status: batch.batch_header?.batch_status,
      items,
      raw: batch,
    }
  } catch (err) {
    return {
      skipped: false,
      error: err.message,
      body: err.body,
      items,
    }
  }
}
