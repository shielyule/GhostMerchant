#!/usr/bin/env node
/**
 * Print a sandbox access token (expires ~8–9 hours).
 * Requires PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET in .env
 */

import 'dotenv/config'

const id = process.env.PAYPAL_CLIENT_ID
const secret = process.env.PAYPAL_CLIENT_SECRET
const base = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com'

if (!id || !secret) {
  console.error('Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in .env')
  process.exit(1)
}

const auth = Buffer.from(`${id}:${secret}`).toString('base64')
const res = await fetch(`${base}/v1/oauth2/token`, {
  method: 'POST',
  headers: {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: 'grant_type=client_credentials',
})

const data = await res.json()
if (!res.ok) {
  console.error(data)
  process.exit(1)
}

console.log(data.access_token)
console.error(`expires_in=${data.expires_in}s (~${Math.round(data.expires_in / 3600)}h)`)
console.error('Paste into Cursor: Customize → Plugins → PayPal → Configure')
console.error('Or set PAYPAL_SANDBOX_ACCESS_TOKEN for MCP (.mcp.json uses Bearer ${PAYPAL_SANDBOX_ACCESS_TOKEN})')
