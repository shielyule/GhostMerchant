#!/usr/bin/env node
/**
 * Local dry-run of the GhostMerchant gate (no PayPal settle unless IDs passed).
 *   npm run demo:void
 *   npm run demo:capture
 */

import 'dotenv/config'

const outcome = process.argv.includes('--outcome')
  ? process.argv[process.argv.indexOf('--outcome') + 1]
  : 'fail'

const base = process.env.PUBLIC_BASE_URL?.includes('ngrok')
  ? `http://127.0.0.1:${process.env.PORT || 3030}`
  : process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3030}`

const purchase = {
  amount: 500,
  currency: 'USD',
  vendor: 'api-keys.demo',
  category: 'api_key',
  description: 'GhostMerchant demo — digital API key',
  probeMode: outcome === 'pass' ? 'pass' : 'fail',
  promptContract: 'Buy a working production API key under $500; reject if health check fails.',
  agentTrace: [
    { role: 'buyer_agent', text: 'Purchasing Pro API key for $500' },
    { role: 'ghostmerchant', text: 'Policy OK — opening AUTHORIZE hold' },
  ],
}

const res = await fetch(`${base}/firewall/run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    purchase,
    dryRun: true,
    probeMode: purchase.probeMode,
  }),
})

const json = await res.json()
console.log(JSON.stringify(json, null, 2))
console.error(`\nExpected outcome: ${outcome === 'pass' ? 'WOULD_CAPTURE' : 'WOULD_VOID'} → got ${json.status}`)
