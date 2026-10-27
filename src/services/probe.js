/**
 * Pre-capture verification gate.
 * Returns { ok, reason, details } — False path triggers VOID.
 */

export async function runVerificationProbe({ probeUrl, mode } = {}) {
  const url = probeUrl || process.env.PROBE_URL || 'http://127.0.0.1:3030/demo/vendor/health'
  const forced = (mode || process.env.PROBE_MODE || 'pass').toLowerCase()

  if (forced === 'fail') {
    return {
      ok: false,
      reason: 'PROBE_MODE=fail — simulated dead/counterfeit deliverable',
      details: { forced: true, url },
    }
  }

  if (forced === 'pass' && process.env.PROBE_SKIP_HTTP === '1') {
    return {
      ok: true,
      reason: 'PROBE_MODE=pass (HTTP skipped)',
      details: { forced: true, url },
    }
  }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    const text = await res.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text }
    }

    const healthy =
      res.ok &&
      (body?.ok === true ||
        body?.healthy === true ||
        body?.status === 'ok' ||
        body?.status === 'healthy')

    return {
      ok: healthy,
      reason: healthy
        ? 'Vendor health probe passed'
        : `Vendor health probe failed (${res.status})`,
      details: { url, status: res.status, body },
    }
  } catch (err) {
    return {
      ok: false,
      reason: `Probe error: ${err.message}`,
      details: { url, error: String(err) },
    }
  }
}
