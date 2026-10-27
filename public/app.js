const $ = (id) => document.getElementById(id)

const STAGE_META = [
  { key: 'policy', title: 'Policy' },
  { key: 'authorize', title: 'Authorize' },
  { key: 'probe', title: 'Probe' },
  { key: 'settle', title: 'Settle' },
]

let state = { sessions: [], policy: {}, velocity: {} }
let selectedId = null
/** When true, polling must NOT overwrite Policy sandbox inputs (was wiping checkbox / Save race). */
let policyDirty = false
let policyFormReady = false
/** While a Run is in flight, keep showing the fresh pipeline — not the previous session. */
let runInFlight = false

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || res.statusText)
  return json
}

function moneyLabel(amount, currency = 'USD') {
  const code = currency || 'USD'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(Number(amount || 0))
  } catch {
    return `${code} ${Number(amount || 0).toFixed(2)}`
  }
}

function fillPolicyForm(policy, { syncDemoCurrency = false } = {}) {
  $('policyCurrency').value = policy.currency || 'USD'
  $('maxAmount').value = policy.maxAmount ?? 1000
  $('maxOrdersPerMinute').value = policy.maxOrdersPerMinute ?? 3
  $('probeTimeoutMs').value = policy.probeTimeoutMs ?? 3000
  $('forceProbeFail').checked = Boolean(policy.forceProbeFail)
  if (syncDemoCurrency && !policyDirty) {
    $('demoCurrency').value = policy.currency || 'USD'
  }
  policyFormReady = true
}

function markPolicyDirty() {
  if (!policyFormReady) return
  policyDirty = true
  $('policyHint').textContent = 'Unsaved changes — click Save policy'
  $('policyHint').classList.add('warn')
}

function clearPolicyDirty() {
  policyDirty = false
  $('policyHint').classList.remove('warn')
}

function renderVelocity(v, policy) {
  const pill = $('velocityPill')
  const n = v?.attemptsLastMinute ?? 0
  const max = policy?.maxOrdersPerMinute ?? v?.maxOrdersPerMinute ?? 3
  pill.textContent = `Velocity ${n}/${max} per min`
  pill.classList.toggle('hot', Boolean(v?.tripped) || n >= max)
}

function probeProgress(session) {
  if (!session?.probeStartedAt || !session?.probeEndsAt) return 0
  if (session.stages?.probe !== 'running') return session.stages?.probe === 'passed' || session.stages?.probe === 'failed' ? 100 : 0
  const start = Date.parse(session.probeStartedAt)
  const end = Date.parse(session.probeEndsAt)
  const now = Date.now()
  if (end <= start) return 100
  return Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100))
}

function pipelinePlainEnglish(session) {
  const status = session.status || ''
  const violations = session.forensic?.policy?.violations || []
  const probe = session.probe || session.forensic?.probe

  if (status === 'POLICY_BLOCKED' || session.stages?.policy === 'blocked') {
    const why = violations.length
      ? violations.join(' · ')
      : 'This purchase broke a corporate spending rule.'
    return {
      tone: 'bad',
      title: 'Stopped at the front door',
      body: `GhostMerchant never asked PayPal for money. ${why} Think of it like a company card that refuses the swipe before the terminal even beeps.`,
    }
  }

  if (status === 'VOIDED' || session.stages?.settle === 'voided') {
    const probeWhy = probe?.reason || 'the delivery check failed'
    return {
      tone: 'bad',
      title: 'Poison pill — hold released, $0 charged',
      body: `PayPal placed a temporary hold, then GhostMerchant checked the “goods” (API key / download). That check failed (${probeWhy}), so the hold was VOIDED. No capture, no chargeback dance — money never settled.`,
    }
  }

  if (status === 'WOULD_VOID' || session.stages?.settle === 'would_void') {
    return {
      tone: 'bad',
      title: 'Would void (dry-run)',
      body: 'Same story as a poison pill, but this was a practice run with no real PayPal authorization. Flip Mode to Live to void a real hold.',
    }
  }

  if (session.stages?.probe === 'failed' && !['VOIDED', 'WOULD_VOID', 'CAPTURED', 'WOULD_CAPTURE'].includes(status)) {
    return {
      tone: 'bad',
      title: 'Delivery check failed',
      body: probe?.reason || 'The canary probe said this purchase looks unhealthy.',
    }
  }

  if (status === 'CAPTURED' || session.stages?.settle === 'captured') {
    const payout = session.payout
    let payoutLine = ''
    if (payout?.payout_batch_id) {
      payoutLine = ` Agent micro-splits went out as payout batch ${payout.payout_batch_id}.`
    } else if (payout?.skipped) {
      payoutLine = ' (Payouts skipped — add PAYOUT_AGENT emails in .env.)'
    } else if (payout?.error) {
      payoutLine = ` (Payout error: ${payout.error})`
    }
    return {
      tone: 'good',
      title: 'All clear — funds captured',
      body: `Probe passed, so GhostMerchant told PayPal to CAPTURE the hold. The purchase is settled.${payoutLine}`,
    }
  }

  if (status === 'WOULD_CAPTURE') {
    return {
      tone: 'good',
      title: 'Would capture (dry-run)',
      body: 'Probe looked healthy. In Live mode this would settle money with PayPal CAPTURE.',
    }
  }

  if (status === 'AWAITING_APPROVAL') {
    const buyer = session.buyerEmail || state.buyerEmail || state.policy?.buyerEmail || ''
    return {
      tone: 'bad',
      title: 'Blocked — approve in PayPal',
      body: buyer
        ? `Open Approve in PayPal while logged into sandbox.paypal.com as ${buyer}. GhostMerchant polls PayPal and continues automatically once approved — no button.`
        : 'Approve in PayPal as the Personal sandbox buyer. GhostMerchant continues automatically once PayPal shows the order approved.',
    }
  }

  return null
}

function renderConveyor(session) {
  const el = $('conveyor')
  if (!session) {
    el.className = 'conveyor empty'
    el.innerHTML = '<p class="empty-msg">No active transaction — fire a purchase to watch the belt.</p>'
    return
  }

  el.className = 'conveyor'
  const progress = probeProgress(session)
  const explain = pipelinePlainEnglish(session)
  el.innerHTML =
    STAGE_META.map(({ key, title }) => {
      const st = session.stages?.[key] || 'pending'
      const active = session.stage === key ? ' active' : ''
      const bar =
        key === 'probe' && st === 'running'
          ? `<div class="bar"><i style="width:${progress}%"></i></div>`
          : ''
      return `<div class="stage ${st}${active}">
        <div class="label">${title}</div>
        <div class="name">${labelForStage(key, st)}</div>
        <div class="state">${st}</div>
        ${bar}
      </div>`
    }).join('') +
    `<div class="session-meta" style="grid-column:1/-1">
      <span>status <strong>${session.status}</strong></span>
      ${
        session.status === 'AWAITING_APPROVAL'
          ? `<span>Sandbox buyer (Approve as) <code class="buyer-inline">${escapeHtml(
              session.buyerEmail || state.buyerEmail || state.policy?.buyerEmail || 'sb-….@personal.example.com',
            )}</code></span>`
          : ''
      }
      <span>amount ${moneyLabel(session.purchase?.amount, session.purchase?.currency)}</span>
      <span>order ${session.orderId || '—'}</span>
      <span>auth ${session.authorizationId || '—'}</span>
      <span>capture ${session.captureId || '—'}</span>
      ${
        session.payout?.payout_batch_id
          ? `<span>payout ${session.payout.payout_batch_id}</span>`
          : session.payout?.skipped
            ? `<span>payout skipped (set PAYOUT_AGENT_*)</span>`
            : session.payout?.error
              ? `<span>payout error</span>`
              : ''
      }
      ${session.approveLink ? `<a href="${session.approveLink}" target="_blank" rel="noopener">Approve in PayPal ↗</a>` : ''}
    </div>` +
    (explain
      ? `<div class="pipeline-explain ${explain.tone}" style="grid-column:1/-1">
          <strong>${escapeHtml(explain.title)}</strong>
          <p>${escapeHtml(explain.body)}</p>
        </div>`
      : '')
}

function labelForStage(key, st) {
  if (key === 'policy' && st === 'blocked') return 'Blocked'
  if (key === 'authorize' && st === 'awaiting_approval') return 'Awaiting buyer'
  if (key === 'probe' && st === 'running') return 'Canary running'
  if (key === 'settle' && (st === 'voided' || st === 'would_void')) return 'Poison pill'
  if (key === 'settle' && (st === 'captured' || st === 'would_capture')) return 'Funds settle'
  return key
}

function renderRows(sessions) {
  const body = $('sessionRows')
  if (!sessions.length) {
    body.innerHTML = '<tr><td colspan="5">No sessions yet</td></tr>'
    return
  }
  body.innerHTML = sessions
    .map((s) => {
      const ids = [s.orderId && `o:${s.orderId}`, s.authorizationId && `a:${s.authorizationId}`, s.captureId && `c:${s.captureId}`]
        .filter(Boolean)
        .join('<br>')
      return `<tr data-id="${s.id}">
        <td><span class="status ${s.status}">${s.status}</span></td>
        <td>${moneyLabel(s.purchase?.amount, s.purchase?.currency)}</td>
        <td>${escapeHtml(s.purchase?.vendor || '—')}</td>
        <td class="ids">${ids || '—'}</td>
        <td class="ids">${s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString() : '—'}</td>
      </tr>`
    })
    .join('')

  body.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => openDossier(tr.dataset.id))
  })
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

async function openDossier(id) {
  selectedId = id
  const dossier = await api('/disputes/dossier', {
    method: 'POST',
    body: JSON.stringify({ sessionId: id }),
  })
  $('dossier').textContent = JSON.stringify(dossier, null, 2)
  $('drawer').hidden = false
}

async function refresh() {
  try {
    state = await api('/firewall/dashboard')
    if (state.buyerEmail && state.policy && !state.policy.buyerEmail) {
      state.policy.buyerEmail = state.buyerEmail
    }
    // Never stomp the form while the user is editing — that caused the untick / frantic-Save bug.
    if (!policyDirty) {
      fillPolicyForm(state.policy, { syncDemoCurrency: true })
    }
    renderVelocity(state.velocity, state.policy)
    // Don't yank the conveyor back to an old session while Run is in progress
    if (runInFlight && selectedId === 'pending-run') {
      // keep optimistic pipeline from startRunPipeline()
    } else {
      const active =
        state.sessions.find((s) => ['PROBING', 'PENDING', 'AWAITING_APPROVAL'].includes(s.status)) ||
        state.sessions[0] ||
        null
      if (selectedId && selectedId !== 'pending-run') {
        const sel = state.sessions.find((s) => s.id === selectedId)
        renderConveyor(sel || active)
      } else {
        renderConveyor(active)
      }
    }
    renderRows(state.sessions)
    $('pollPill').textContent = `Updated ${new Date().toLocaleTimeString()}`
  } catch (err) {
    $('pollPill').textContent = `Poll error: ${err.message}`
  }
}

$('savePolicy').addEventListener('click', async () => {
  try {
    const saved = await api('/firewall/policy', {
      method: 'PATCH',
      body: JSON.stringify({
        currency: $('policyCurrency').value,
        maxAmount: Number($('maxAmount').value),
        maxOrdersPerMinute: Number($('maxOrdersPerMinute').value),
        probeTimeoutMs: Number($('probeTimeoutMs').value),
        forceProbeFail: $('forceProbeFail').checked,
      }),
    })
    state.policy = saved.policy
    clearPolicyDirty()
    fillPolicyForm(saved.policy, { syncDemoCurrency: true })
    renderVelocity(state.velocity, saved.policy)
    $('policyHint').textContent = 'Policy saved'
    await refresh()
  } catch (err) {
    $('policyHint').textContent = err.message
  }
})

;['policyCurrency', 'maxAmount', 'maxOrdersPerMinute', 'probeTimeoutMs', 'forceProbeFail'].forEach((id) => {
  const el = $(id)
  el.addEventListener('input', markPolicyDirty)
  el.addEventListener('change', markPolicyDirty)
})

$('policyCurrency').addEventListener('change', () => {
  // Keep purchase currency in sync when user changes corporate default (unless they already picked one mid-edit on demo — always sync on policy currency change is fine)
  $('demoCurrency').value = $('policyCurrency').value
})

function startRunPipeline(purchase) {
  runInFlight = true
  selectedId = 'pending-run'
  const optimistic = {
    id: 'pending-run',
    status: 'PENDING',
    stage: 'policy',
    stages: { policy: 'running', authorize: 'pending', probe: 'pending', settle: 'pending' },
    purchase,
    orderId: null,
    authorizationId: null,
    captureId: null,
    probeStartedAt: new Date().toISOString(),
    probeEndsAt: new Date(Date.now() + (Number($('probeTimeoutMs').value) || 2500)).toISOString(),
  }
  renderConveyor(optimistic)
}

$('runDemo').addEventListener('click', async () => {
  const mode = $('demoMode').value
  const currency = $('demoCurrency').value || state.policy?.currency || 'USD'
  const purchase = {
    amount: Number($('demoAmount').value),
    currency,
    vendor: $('demoVendor').value || 'api-keys.demo',
    category: 'api_key',
    description: 'GhostMerchant dashboard purchase',
    promptContract: 'Buy a working API key; void if health probe fails.',
    agentTrace: [
      {
        role: 'buyer_agent',
        text: `Requesting ${moneyLabel($('demoAmount').value, currency)} from ${$('demoVendor').value}`,
      },
      { role: 'ghostmerchant', text: 'Entering policy → authorize → probe pipeline' },
    ],
    probeMode: mode === 'dry-capture' ? 'pass' : mode === 'dry-void' ? 'fail' : undefined,
  }

  const body = {
    purchase,
    probeDelayMs: Number($('probeTimeoutMs').value) || 2500,
  }

  if (mode === 'live-order' || mode === 'live-wallet') {
    body.createOrder = true
    body.useSandboxCard = mode === 'live-order'
    body.dryRun = false
    body.splitPayouts = true
  } else {
    body.dryRun = true
  }

  if (mode === 'live-wallet') {
    purchase.buyerEmail = state.buyerEmail || state.policy?.buyerEmail || ''
  }

  try {
    $('runDemo').disabled = true
    startRunPipeline(purchase)
    const session = await api('/firewall/run', { method: 'POST', body: JSON.stringify(body) })
    selectedId = session.id
    runInFlight = false
    renderConveyor(session)
    await refresh()
  } catch (err) {
    runInFlight = false
    alert(err.message)
    await refresh()
  } finally {
    $('runDemo').disabled = false
  }
})

$('closeDrawer').addEventListener('click', () => {
  $('drawer').hidden = true
})

const HELP = {
  'header-velocity': {
    title: 'Velocity pill',
    why: 'Shows how “hot” the buyer agent is right now — how many purchase attempts hit the firewall in the last 60 seconds.',
    fields: [
      ['Number (e.g. 1/3)', 'Attempts this minute vs your max. If it hits the max, new buys are blocked (circuit breaker).'],
      ['Red / hot style', 'Means the runaway limit is tripped or nearly tripped — the 3am loop protection.'],
    ],
  },
  'header-poll': {
    title: 'Polling pill',
    why: 'The dashboard refreshes itself every ~1.5 seconds so the conveyor moves without you hitting reload.',
    fields: [
      ['Updated time', 'Last successful refresh from the GhostMerchant server.'],
      ['Poll error…', 'Server is down or unreachable — check that npm run dev is still running on port 3030.'],
    ],
  },
  policy: {
    title: 'Policy sandbox',
    why: 'These are the corporate rules the AI buyer must obey before PayPal money can move. Change them, hit Save, then run a purchase to see blocks or poison pills.',
    fields: [
      ['Default currency', 'Corporate default (USD/GBP/EUR/…). New purchases inherit this; you can still override per purchase below.'],
      ['Max single order', 'Hard ceiling per purchase in that currency. A 500 buy fails policy if you set max to 100.'],
      ['Max velocity / min', 'Circuit breaker: more than this many auth attempts in 60 seconds → POLICY_BLOCKED. Stops overnight agent loops. Updates the top-right Velocity pill after Save.'],
      ['Probe window (ms)', 'How long the “Probe” stage shows a countdown on the conveyor (demo theater). Real probe still runs; this just paces the UI.'],
      ['Poison pill / Force probe fail', 'When checked + Saved, the delivery check always fails → poison pill (VOID / WOULD_VOID). Uncheck + Save for a healthy delivery path.'],
      ['Save policy', 'Writes the rules into the live server. Tip: change fields, then Save — the form no longer resets every 1.5s while you edit.'],
    ],
  },
  demo: {
    title: 'Fire agent purchase',
    why: 'This pretends an autonomous agent just tried to buy something. GhostMerchant runs it through policy → authorize → probe → settle.',
    fields: [
      ['Amount', 'Value of the fake (or live) order. Compared against Max single order.'],
      ['Currency', 'This purchase’s currency (PayPal currency_code). Defaults from Policy sandbox; change here for one-off buys.'],
      ['Vendor', 'Who the agent wants to pay. Some names (e.g. shady-saas.example) are blocked by trust list.'],
      ['Mode: Dry-run → VOID', 'No real PayPal charge. Forces a failed probe so you see Poison pill / WOULD_VOID. What you just ran.'],
      ['Mode: Dry-run → CAPTURE', 'No real PayPal charge. Probe passes → WOULD_CAPTURE (green settle).'],
      ['Mode: Live sandbox card', 'Fast real AUTHORIZE with a test Visa (no login). Great for VOID/CAPTURE demos. Payments usually won’t show in a Personal sandbox inbox — hard to dispute.'],
      ['Mode: Live PayPal wallet', 'Creates an approve link. When status is AWAITING_APPROVAL, Live Pipeline shows which Personal email must Approve.'],
      ['Run through firewall', 'Resets the pipeline, then runs. Watch Live pipeline + Sessions update.'],
    ],
  },
  pipeline: {
    title: 'Live pipeline',
    why: 'The conveyor belt judges stare at: one transaction moving left → right. Your failed probe ended on Settle = poison pill.',
    fields: [
      ['1 Policy', 'Spend limits, vendor trust, velocity. Blocked = never opens a PayPal hold.'],
      ['2 Authorize', 'PayPal AUTHORIZE hold (or “simulated” in dry-run). Live mode may show Awaiting buyer + Approve link.'],
      ['3 Probe', 'Canary check that the digital good works (API key health). Failed = red — what you saw.'],
      ['4 Settle', 'CAPTURE (green, money settles) or VOID / poison pill (crimson, hold released, $0 charged). Dry-run says WOULD_… until a real authorizationId exists.'],
      ['Red / green explainer box', 'Under the belt: plain-English “what just happened” when something is blocked, voided, or captured.'],
      ['IDs under the belt', 'order / auth / capture IDs from PayPal when live — proof for the demo video.'],
    ],
  },
  sessions: {
    title: 'Sessions',
    why: 'History of every firewall run this server process has seen. Click a row to open the dispute forensics drawer.',
    fields: [
      ['Status', 'POLICY_BLOCKED, PROBING, WOULD_VOID, VOIDED, CAPTURED, AWAITING_APPROVAL, etc.'],
      ['Amount / Vendor', 'What the agent tried to buy.'],
      ['Order / Auth', 'PayPal identifiers when live. Empty or partial on dry-runs.'],
      ['Updated', 'Last time that session changed stage.'],
      ['Click a row', 'Opens Dispute forensics — the evidence pack we’d send to PayPal Disputes.'],
    ],
  },
  dossier: {
    title: 'Dispute forensics',
    why: 'If a bad merchant slips past (or we voided for cause), this JSON is the “black box” evidence: prompt, policy, probe, firewall log — ready to map to PayPal Disputes API.',
    fields: [
      ['prompt_contract', 'What the agent was allowed to buy.'],
      ['agent_trace', 'Short transcript of buyer vs GhostMerchant.'],
      ['policy_evaluation', 'Why it passed or failed corporate rules.'],
      ['probe_result', 'Delivery health check — your fail reason lives here.'],
      ['firewall_log', 'Step-by-step timeline of the pipeline.'],
    ],
  },
}

function renderHelp(key) {
  const cfg = HELP[key]
  if (!cfg) return ''
  const fields = cfg.fields
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
    .join('')
  return `<h3>${escapeHtml(cfg.title)}</h3><p class="why">${escapeHtml(cfg.why)}</p><dl>${fields}</dl>`
}

function closeHelp() {
  const pop = $('helpPopover')
  pop.hidden = true
  document.querySelectorAll('.info-btn[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'))
}

function openHelp(btn) {
  const key = btn.dataset.help
  const pop = $('helpPopover')
  const body = $('helpBody')
  const wasOpen = !pop.hidden && pop.dataset.key === key

  closeHelp()
  if (wasOpen) return

  body.innerHTML = renderHelp(key)
  pop.dataset.key = key
  pop.hidden = false
  btn.setAttribute('aria-expanded', 'true')

  const rect = btn.getBoundingClientRect()
  const pad = 8
  const width = Math.min(360, window.innerWidth - 24)
  let left = rect.right - width
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12))
  let top = rect.bottom + pad
  pop.style.left = `${left}px`
  pop.style.top = `${top}px`

  requestAnimationFrame(() => {
    const h = pop.getBoundingClientRect().height
    if (top + h > window.innerHeight - 12) {
      top = Math.max(12, rect.top - h - pad)
      pop.style.top = `${top}px`
    }
  })
}

document.querySelectorAll('.info-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    openHelp(btn)
  })
})

$('helpClose').addEventListener('click', closeHelp)

document.addEventListener('click', (e) => {
  const pop = $('helpPopover')
  if (pop.hidden) return
  if (pop.contains(e.target) || e.target.closest('.info-btn')) return
  closeHelp()
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeHelp()
})

fillPolicyForm({
  currency: 'USD',
  maxAmount: 1000,
  maxOrdersPerMinute: 3,
  probeTimeoutMs: 3000,
  forceProbeFail: false,
})
refresh()
setInterval(refresh, 1500)
