// Minimal XMLTV parser - extracts only what we need (programme channel/start/stop/title),
// not a general-purpose XML parser. Good enough for the consistent i.mjh.nz / BuddyChewChew output.

const PROGRAMME_RE =
  /<programme channel="([^"]+)" start="(\d{14}) ([+-]\d{4})" stop="(\d{14}) ([+-]\d{4})"[^>]*>\s*<title[^>]*>([^<]*)<\/title>/g;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" };

function decodeEntities(text) {
  return text.replace(/&(#?\w+);/g, (m, e) => (ENTITIES[e] !== undefined ? ENTITIES[e] : m));
}

function parseXmltvDate(yyyymmddhhmmss, offset) {
  const y = yyyymmddhhmmss.slice(0, 4);
  const mo = yyyymmddhhmmss.slice(4, 6);
  const d = yyyymmddhhmmss.slice(6, 8);
  const h = yyyymmddhhmmss.slice(8, 10);
  const mi = yyyymmddhhmmss.slice(10, 12);
  const s = yyyymmddhhmmss.slice(12, 14);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset.slice(0, 3)}:${offset.slice(3)}`);
}

// Returns Map<channelId, Array<{title, start, stop}>>, future programmes only, sorted, capped.
export function parseXmltv(text, { maxPerChannel = 50 } = {}) {
  const byChannel = new Map();
  const now = Date.now();

  for (const match of text.matchAll(PROGRAMME_RE)) {
    const [, channelId, startRaw, startOffset, stopRaw, stopOffset, title] = match;
    const stop = parseXmltvDate(stopRaw, stopOffset);
    if (stop.getTime() < now) continue;

    if (!byChannel.has(channelId)) byChannel.set(channelId, []);
    byChannel.get(channelId).push({
      title: decodeEntities(title.trim()),
      start: parseXmltvDate(startRaw, startOffset).toISOString(),
      stop: stop.toISOString(),
    });
  }

  for (const programmes of byChannel.values()) {
    programmes.sort((a, b) => new Date(a.start) - new Date(b.start));
    programmes.length = Math.min(programmes.length, maxPerChannel);
  }

  return byChannel;
}
