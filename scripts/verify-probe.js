#!/usr/bin/env node
/**
 * Standalone verification gate — True/False during AUTHORIZE hold window.
 * Usage:
 *   node scripts/verify-probe.js
 *   PROBE_MODE=fail node scripts/verify-probe.js
 *   node scripts/verify-probe.js http://127.0.0.1:3000/demo/vendor/health?ok=0
 */

import { runVerificationProbe } from '../src/services/probe.js'

const url = process.argv[2]
const result = await runVerificationProbe({ probeUrl: url })
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
