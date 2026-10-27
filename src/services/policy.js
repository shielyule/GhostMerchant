/**
 * Policy sandbox — spend ceiling, vendor trust, velocity circuit breaker.
 * Runtime overrides come from the dashboard (GET/PATCH /firewall/policy).
 */

const DEFAULT_POLICY = {
  maxAmount: 1000,
  currency: 'USD',
  maxOrdersPerMinute: 3,
  probeTimeoutMs: 3000,
  forceProbeFail: false,
  /** Personal sandbox email that must log in and click Approve */
  buyerEmail: process.env.SANDBOX_BUYER_EMAIL || '',
  blockedVendors: ['shady-saas.example', 'renewal-trap.example'],
  requireProbe: true,
  allowedCategories: ['compute', 'api_key', 'saas', 'travel', 'software'],
}

let runtimePolicy = { ...DEFAULT_POLICY }
/** @type {number[]} epoch ms of recent authorize attempts */
const recentAuthAttempts = []

export function getPolicy() {
  return { ...runtimePolicy }
}

export function updatePolicy(patch = {}) {
  const next = { ...runtimePolicy }
  if (patch.maxAmount != null) next.maxAmount = Number(patch.maxAmount)
  if (patch.currency != null) next.currency = String(patch.currency).toUpperCase()
  if (patch.maxOrdersPerMinute != null) next.maxOrdersPerMinute = Number(patch.maxOrdersPerMinute)
  if (patch.probeTimeoutMs != null) next.probeTimeoutMs = Number(patch.probeTimeoutMs)
  if (typeof patch.forceProbeFail === 'boolean') next.forceProbeFail = patch.forceProbeFail
  if (patch.buyerEmail != null) next.buyerEmail = String(patch.buyerEmail).trim()
  if (Array.isArray(patch.blockedVendors)) next.blockedVendors = patch.blockedVendors
  if (Array.isArray(patch.allowedCategories)) next.allowedCategories = patch.allowedCategories
  if (typeof patch.requireProbe === 'boolean') next.requireProbe = patch.requireProbe
  runtimePolicy = next
  return getPolicy()
}

export function resetPolicy() {
  runtimePolicy = { ...DEFAULT_POLICY }
  recentAuthAttempts.length = 0
  return getPolicy()
}

function pruneVelocity(now = Date.now()) {
  const cutoff = now - 60_000
  while (recentAuthAttempts.length && recentAuthAttempts[0] < cutoff) {
    recentAuthAttempts.shift()
  }
}

/** Call when a purchase passes static checks and is about to open an auth. */
export function recordAuthAttempt() {
  recentAuthAttempts.push(Date.now())
  pruneVelocity()
}

export function velocitySnapshot() {
  pruneVelocity()
  return {
    attemptsLastMinute: recentAuthAttempts.length,
    maxOrdersPerMinute: runtimePolicy.maxOrdersPerMinute,
    tripped: recentAuthAttempts.length >= runtimePolicy.maxOrdersPerMinute,
  }
}

export function evaluatePolicy(purchase = {}, policy = runtimePolicy) {
  pruneVelocity()
  const violations = []
  const amount = Number(purchase.amount || 0)
  const vendor = String(purchase.vendor || '').toLowerCase()
  const category = String(purchase.category || 'saas').toLowerCase()

  if (amount <= 0) violations.push('Amount must be positive')
  if (amount > policy.maxAmount) {
    violations.push(`Amount ${amount} exceeds policy max ${policy.maxAmount}`)
  }
  if (policy.blockedVendors.some((v) => vendor.includes(v))) {
    violations.push(`Vendor blocked by trust list: ${vendor}`)
  }
  if (policy.allowedCategories.length && !policy.allowedCategories.includes(category)) {
    violations.push(`Category not allowed: ${category}`)
  }

  const attempts = recentAuthAttempts.length
  if (attempts >= policy.maxOrdersPerMinute) {
    violations.push(
      `Velocity circuit breaker: ${attempts} auth attempts in 60s (max ${policy.maxOrdersPerMinute})`,
    )
  }

  return {
    allowed: violations.length === 0,
    violations,
    policy: { ...policy },
    requireProbe: policy.requireProbe !== false,
    velocity: {
      attemptsLastMinute: attempts,
      maxOrdersPerMinute: policy.maxOrdersPerMinute,
    },
  }
}

export { DEFAULT_POLICY }
