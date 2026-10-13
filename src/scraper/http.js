const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch() with a user agent, timeout and a few retries on 429/5xx. */
async function fetchText(url, { userAgent, retries = 3, timeoutMs = 30000, accept } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          Accept: accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}`);
        err.permanent = true;
        throw err;
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (err.permanent || attempt === retries) break;
      await sleep(2000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

module.exports = { fetchText, sleep };
