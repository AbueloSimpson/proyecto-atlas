const CHECK_TIMEOUT_MS = 8000;

// Simple concurrency-limited mapper.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Liveness check only (single region: the GitHub Actions runner).
export async function isAlive(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (proyecto-atlas checker)" },
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Confirms a logo URL actually resolves to an image, not a dead link or an
// HTML page (some sources go stale - renamed CDN paths, deleted imgur posts,
// etc.). Tries HEAD first since it's cheap; some hosts don't support it
// (405/501), so it falls back to GET without reading the body.
export async function isImageAlive(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const opts = {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (proyecto-atlas checker)" },
    };
    let res = await fetch(url, { ...opts, method: "HEAD" });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { ...opts, method: "GET" });
    }
    if (!res.ok) return false;
    const contentType = res.headers.get("content-type") || "";
    return contentType.startsWith("image/");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// check-host.net is a free, no-signup service that fetches a URL from nodes
// in various countries and reports the HTTP status seen there. Used as a
// vantage point outside the US to confirm a stream is geolocked to the USA
// (some FAST sports streams enforce this) rather than just assuming it from
// the hostname - a 403 here, combined with the stream already having passed
// the liveness check from the US-based GitHub Actions runner, means it only
// plays inside the US. br1 (São Paulo) is the only South American node
// check-host.net offers.
const CHECK_HOST_NODE = "br1.node.check-host.net";
const CHECK_HOST_POLL_ATTEMPTS = 6;
const CHECK_HOST_POLL_DELAY_MS = 2500;

// Returns true if the stream is geolocked to the USA (check-host.net's
// Brazil node got a 403 fetching it), false if it got through cleanly from
// Brazil too, or null if the check itself was inconclusive (submit/poll
// failure, or no result within the poll window) - a third-party service
// hiccup shouldn't be confused with an actual not-geolocked result, so
// callers should decide how to treat null themselves.
export async function checkBlockedFromBrazil(url) {
  try {
    const submitRes = await fetch(
      `https://check-host.net/check-http?host=${encodeURIComponent(url)}&node=${CHECK_HOST_NODE}`,
      { headers: { Accept: "application/json" } }
    );
    if (!submitRes.ok) return null;
    const { request_id, ok } = await submitRes.json();
    if (!ok || !request_id) return null;

    for (let attempt = 0; attempt < CHECK_HOST_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, CHECK_HOST_POLL_DELAY_MS));
      const resultRes = await fetch(`https://check-host.net/check-result/${request_id}`, {
        headers: { Accept: "application/json" },
      });
      if (!resultRes.ok) continue;
      const result = await resultRes.json();
      const nodeResult = result[CHECK_HOST_NODE];
      if (!nodeResult) continue;
      const [requestType, , , httpCode] = nodeResult[0];
      return requestType === 0 && httpCode === "403";
    }
    return null;
  } catch {
    return null;
  }
}
