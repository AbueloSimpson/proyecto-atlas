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

