// Minimal XMLTV parser - extracts only what we need (programme channel/start/stop/title),
// not a general-purpose XML parser. Attribute order on <programme> varies between sources
// (e.g. i.mjh.nz uses channel/start/stop, iptv-org/epg grabbers use start/stop/channel),
// so attributes are parsed generically rather than matched in a fixed position.

const PROGRAMME_BLOCK_RE = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
const ATTR_RE = /([\w-]+)="([^"]*)"/g;
const TITLE_RE = /<title[^>]*>([^<]*)<\/title>/;
const DATE_RE = /^(\d{14})\s*([+-]\d{4})?$/;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" };

function decodeEntities(text) {
  return text.replace(/&(#?\w+);/g, (m, e) => (ENTITIES[e] !== undefined ? ENTITIES[e] : m));
}

function parseAttrs(attrText) {
  const attrs = {};
  for (const match of attrText.matchAll(ATTR_RE)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseXmltvDate(raw) {
  const match = DATE_RE.exec(raw.trim());
  if (!match) return null;
  const [, yyyymmddhhmmss, offset = "+0000"] = match;
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

  for (const block of text.matchAll(PROGRAMME_BLOCK_RE)) {
    const attrs = parseAttrs(block[1]);
    const titleMatch = TITLE_RE.exec(block[2]);
    if (!attrs.channel || !attrs.start || !attrs.stop || !titleMatch) continue;

    const start = parseXmltvDate(attrs.start);
    const stop = parseXmltvDate(attrs.stop);
    if (!start || !stop || stop.getTime() < now) continue;

    if (!byChannel.has(attrs.channel)) byChannel.set(attrs.channel, []);
    byChannel.get(attrs.channel).push({
      title: decodeEntities(titleMatch[1].trim()),
      start: start.toISOString(),
      stop: stop.toISOString(),
    });
  }

  for (const programmes of byChannel.values()) {
    programmes.sort((a, b) => new Date(a.start) - new Date(b.start));
    programmes.length = Math.min(programmes.length, maxPerChannel);
  }

  return byChannel;
}
