// Minimal M3U/M3U8 parser for #EXTINF + URL pairs - just enough for the
// BuddyChewChew-style playlists we consume (tvg-id, tvg-logo, group-title, name).

const ATTR_RE = /([\w-]+)="([^"]*)"/g;

export function parseM3U(text) {
  const lines = text.split("\n").map((l) => l.trim());
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXTINF")) continue;

    const attrs = {};
    for (const match of lines[i].matchAll(ATTR_RE)) {
      attrs[match[1]] = match[2];
    }
    const name = lines[i].split(",").pop().trim();

    let url = null;
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j] || lines[j].startsWith("#")) continue;
      url = lines[j];
      break;
    }
    if (url) entries.push({ attrs, name, url });
  }

  return entries;
}
