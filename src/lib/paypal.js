/**
 * Minimal PayPal REST helpers (sandbox).
 * Tokens expire ~8–9h — refresh via npm run token or OAuth client_credentials.
 */

const API_BASE = () => process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com'

let cachedToken = null
let cachedExpiry = 0

export async function getAccessToken() {
  // Prefer client credentials so the server never dies on an 8–9h stale MCP token in .env.
  // PAYPAL_SANDBOX_ACCESS_TOKEN is for Cursor MCP only.
  if (cachedToken && Date.now() < cachedExpiry - 60_000) {
    return cachedToken
  }

  const id = process.env.PAYPAL_CLIENT_ID
  const secret = process.env.PAYPAL_CLIENT_SECRET
  if (!id || !secret) {
    if (process.env.PAYPAL_SANDBOX_ACCESS_TOKEN) {
      return process.env.PAYPAL_SANDBOX_ACCESS_TOKEN
    }
    throw new Error('Set PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET (or PAYPAL_SANDBOX_ACCESS_TOKEN)')
  }

  const auth = Buffer.from(`${id}:${secret}`).toString('base64')
  const res = await fetch(`${API_BASE()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OAuth failed ${res.status}: ${text}`)
  }

  const data = await res.json()
  cachedToken = data.access_token
  cachedExpiry = Date.now() + (data.expires_in || 28800) * 1000
  return cachedToken
}

export async function paypalFetch(path, { method = 'GET', body, headers: extraHeaders = {} } = {}) {
  const token = await getAccessToken()
  const res = await fetch(`${API_BASE()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }

  if (!res.ok) {
    const err = new Error(`PayPal ${method} ${path} → ${res.status}`)
    err.status = res.status
    err.body = json
    throw err
  }

  return json
}

/** Sandbox Visa — lets live AUTHORIZE complete without a browser approve click. */
export const SANDBOX_DEMO_CARD = {
  number: '4111111111111111',
  expiry: '2030-12',
  security_code: '123',
  name: 'Ghost Merchant',
  billing_address: {
    address_line_1: '1 Main St',
    admin_area_2: 'San Jose',
    admin_area_1: 'CA',
    postal_code: '95131',
    country_code: 'US',
  },
}

export async function createAuthorizeOrder({
  amount,
  currency = 'USD',
  description,
  useSandboxCard = false,
}) {
  const body = {
    intent: 'AUTHORIZE',
    purchase_units: [
      {
        description: description || 'GhostMerchant procurement hold',
        amount: {
          currency_code: currency,
          value: Number(amount).toFixed(2),
        },
      },
    ],
  }
  if (useSandboxCard) {
    body.payment_source = { card: SANDBOX_DEMO_CARD }
    // Required when creating an order with payment_source in one shot
    return paypalFetch('/v2/checkout/orders', {
      method: 'POST',
      body,
      headers: { 'PayPal-Request-Id': `gm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    })
  }
  return paypalFetch('/v2/checkout/orders', { method: 'POST', body })
}

export async function getOrder(orderId) {
  return paypalFetch(`/v2/checkout/orders/${orderId}`, { method: 'GET' })
}

export async function authorizeOrder(orderId) {
  return paypalFetch(`/v2/checkout/orders/${orderId}/authorize`, { method: 'POST', body: {} })
}

export async function captureAuthorization(authorizationId) {
  return paypalFetch(`/v2/payments/authorizations/${authorizationId}/capture`, {
    method: 'POST',
    body: {},
  })
}

export async function voidAuthorization(authorizationId) {
  return paypalFetch(`/v2/payments/authorizations/${authorizationId}/void`, {
    method: 'POST',
    body: {},
  })
}

export async function createPayoutBatch({ items, emailSubject = 'GhostMerchant split' }) {
  const senderBatchId = `gm-${Date.now()}`
  return paypalFetch('/v1/payments/payouts', {
    method: 'POST',
    body: {
      sender_batch_header: {
        sender_batch_id: senderBatchId,
        email_subject: emailSubject,
      },
      items: items.map((it, i) => ({
        recipient_type: it.recipient_type || 'EMAIL',
        amount: {
          value: Number(it.amount).toFixed(2),
          currency: it.currency || 'USD',
        },
        receiver: it.receiver,
        note: it.note || 'GhostMerchant agent share',
        sender_item_id: it.sender_item_id || `item-${i}-${Date.now()}`,
      })),
    },
  })
}
