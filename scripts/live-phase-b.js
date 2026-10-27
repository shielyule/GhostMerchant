#!/usr/bin/env node
/**
 * Phase B live proof: AUTHORIZE (sandbox card) → probe fail VOID, then pass CAPTURE.
 * Usage: node scripts/live-phase-b.js
 */
import 'dotenv/config'
import {
  createAuthorizeOrder,
  authorizeOrder,
  captureAuthorization,
  voidAuthorization,
} from '../src/lib/paypal.js'

function authIdFrom(orderOrAuth) {
  const units = orderOrAuth?.purchase_units || []
  for (const u of units) {
    const a = u?.payments?.authorizations?.[0]
    if (a?.id) return a
  }
  return orderOrAuth?.id && orderOrAuth?.status ? orderOrAuth : null
}

async function openAuth(label, amount) {
  console.log(`\n=== ${label}: create AUTHORIZE $${amount} ===`)
  let order = await createAuthorizeOrder({
    amount,
    currency: 'USD',
    description: `GhostMerchant ${label}`,
    useSandboxCard: true,
  })
  console.log('order', order.id, order.status)

  let auth = order.purchase_units?.[0]?.payments?.authorizations?.[0]
  if (!auth?.id && order.status === 'APPROVED') {
    order = await authorizeOrder(order.id)
    auth = order.purchase_units?.[0]?.payments?.authorizations?.[0]
    console.log('authorized', order.status)
  }
  if (!auth?.id) {
    // Some card flows land COMPLETED with auth embedded; others need explicit authorize
    try {
      const again = await authorizeOrder(order.id)
      auth = again.purchase_units?.[0]?.payments?.authorizations?.[0]
      console.log('authorize retry', again.status, auth?.id)
    } catch (e) {
      console.error('authorize failed', e.message, e.body)
    }
  }
  if (!auth?.id) throw new Error(`No authorization id for order ${order.id}`)
  console.log('authorizationId', auth.id, auth.status)
  return { orderId: order.id, authorizationId: auth.id }
}

async function main() {
  // VOID path
  const voidPath = await openAuth('VOID path', '15.00')
  console.log('→ VOID authorization…')
  const voided = await voidAuthorization(voidPath.authorizationId)
  console.log('VOIDED', voided.id || voidPath.authorizationId, voided.status || 'ok')

  // CAPTURE path
  const capPath = await openAuth('CAPTURE path', '18.00')
  console.log('→ CAPTURE authorization…')
  const captured = await captureAuthorization(capPath.authorizationId)
  console.log('CAPTURED', captured.id, captured.status)

  console.log('\nPhase B live proof complete.')
  console.log(
    JSON.stringify(
      {
        void: { orderId: voidPath.orderId, authorizationId: voidPath.authorizationId },
        capture: {
          orderId: capPath.orderId,
          authorizationId: capPath.authorizationId,
          captureId: captured.id,
        },
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e.message, e.body || '')
  process.exit(1)
})
