const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelay(attempt, retryAfterHeader) {
  const exp = BASE_DELAY_MS * Math.pow(2, attempt);
  if (!retryAfterHeader) return exp;

  const asSeconds = Number.parseFloat(retryAfterHeader);
  if (Number.isFinite(asSeconds)) {
    return Math.max(exp, Math.round(asSeconds * 1000));
  }

  const asDate = Date.parse(retryAfterHeader);
  if (!Number.isNaN(asDate)) {
    return Math.max(exp, asDate - Date.now());
  }

  return exp;
}

export async function fetchWithRetry(url, options = {}, meta = {}) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok) {
        return response;
      }

      const status = response.status;
      const transient = status === 408 || status === 425 || status === 429 || status >= 500;
      if (transient && attempt < MAX_RETRIES) {
        const delay = computeDelay(attempt, response.headers.get("retry-after"));
        const label = meta.label || url;
        console.warn(`[retry] ${label} -> ${status}, waiting ${Math.ceil(delay / 1000)}s`);
        await sleep(delay);
        continue;
      }

      return response;
    } catch (err) {
      const retryable = err instanceof Error && err.name === "TypeError";
      if (retryable && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        const label = meta.label || url;
        console.warn(`[retry] ${label} -> ${err.message}, waiting ${Math.ceil(delay / 1000)}s`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Failed to fetch after retries: ${url}`);
}

export async function readJsonOrThrow(response, context) {
  if (response.ok) {
    return response.json();
  }

  let body = "";
  try {
    body = await response.text();
  } catch {
    // no-op
  }

  throw new Error(`${context} failed (${response.status}): ${body.slice(0, 500)}`);
}
