// Builds a curated channels.xml for iptv-org/epg's grabber, containing exactly
// one guide-site mapping per live iptv-org channel (not all 248 sites blindly).
// Usage: node scripts/select-epg-channels.js <output-path>

import fs from "node:fs/promises";

const API = "https://iptv-org.github.io/api";
const SITES_URL = "https://api.github.com/repos/iptv-org/epg/contents/sites";

function escapeXml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "proyecto-atlas" } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) throw new Error("Usage: node select-epg-channels.js <output-path>");

  console.log("Fetching channels, guides, and supported site list...");
  const [channels, guides, siteDirs] = await Promise.all([
    fetchJson(`${API}/channels.json`),
    fetchJson(`${API}/guides.json`),
    fetchJson(SITES_URL),
  ]);

  const liveChannelIds = new Set(channels.filter((c) => !c.closed).map((c) => c.id));
  const supportedSites = new Set(siteDirs.filter((d) => d.type === "dir").map((d) => d.name));

  // One guide entry per channel: first guide whose site is actually supported by the grabber.
  const chosenByChannel = new Map();
  for (const guide of guides) {
    if (chosenByChannel.has(guide.channel)) continue;
    if (!liveChannelIds.has(guide.channel)) continue;
    if (!supportedSites.has(guide.site)) continue;
    chosenByChannel.set(guide.channel, guide);
  }

  console.log(`Matched ${chosenByChannel.size}/${liveChannelIds.size} channels to a supported guide site.`);

  const bySite = new Map();
  for (const guide of chosenByChannel.values()) {
    bySite.set(guide.site, (bySite.get(guide.site) || 0) + 1);
  }
  const top = [...bySite.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log("Top sites by channel count:", top);

  const lines = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<channels>"];
  for (const guide of chosenByChannel.values()) {
    const lang = guide.lang || "en";
    lines.push(
      `  <channel site="${escapeXml(guide.site)}" site_id="${escapeXml(guide.site_id)}" lang="${escapeXml(lang)}" xmltv_id="${escapeXml(guide.channel)}">${escapeXml(guide.site_name || guide.channel)}</channel>`
    );
  }
  lines.push("</channels>");

  await fs.writeFile(outputPath, lines.join("\n"));
  console.log(`Wrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
