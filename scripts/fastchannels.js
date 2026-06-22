// Pulls Pluto TV (all regions) and Tubi channel + EPG data from BuddyChewChew's
// daily-generated playlists, liveness-checks the streams, and returns normalized
// channel objects ready to merge into the same continent/country tree build.js uses.

import zlib from "node:zlib";
import { mapLimit, isAlive } from "./lib/http.js";
import { parseM3U } from "./lib/m3u.js";
import { parseXmltv } from "./lib/xmltv.js";

const M3U_BASE = "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists";
const EPG_BASE = "https://github.com/matthuisman/i.mjh.nz/raw/master/PlutoTV";
const TUBI_EPG_URL = `${M3U_BASE}/tubi_epg.xml`;
const CONCURRENCY = 40;

const PLUTO_REGIONS = ["ar", "br", "ca", "cl", "de", "dk", "es", "fr", "gb", "it", "mx", "no", "se", "us"];

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

async function fetchGzipText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return zlib.gunzipSync(buf).toString("utf8");
}

async function fetchPlutoRegion(region) {
  let m3u, epgText;
  try {
    [m3u, epgText] = await Promise.all([
      fetchText(`${M3U_BASE}/plutotv_${region}.m3u`),
      fetchGzipText(`${EPG_BASE}/${region}.xml.gz`),
    ]);
  } catch (err) {
    console.warn(`Skipping Pluto TV region ${region}: ${err.message}`);
    return [];
  }

  const entries = parseM3U(m3u);
  const epgByChannel = parseXmltv(epgText);

  return entries.map((entry) => {
    const channelId = entry.attrs["tvg-id"];
    return {
      id: `plutotv.${region}.${channelId}`,
      provider: "plutotv",
      countryCode: region.toUpperCase(),
      name: entry.name,
      logo: entry.attrs["tvg-logo"] || null,
      url: entry.url,
      categories: entry.attrs["group-title"] ? [entry.attrs["group-title"]] : [],
      quality: null,
      epg: epgByChannel.get(channelId) || [],
    };
  });
}

async function fetchTubi() {
  let m3u, epgText;
  try {
    [m3u, epgText] = await Promise.all([fetchText(`${M3U_BASE}/tubi_all.m3u`), fetchText(TUBI_EPG_URL)]);
  } catch (err) {
    console.warn(`Skipping Tubi: ${err.message}`);
    return [];
  }

  const entries = parseM3U(m3u);
  const epgByChannel = parseXmltv(epgText);

  return entries.map((entry) => {
    const channelId = entry.attrs["tvg-id"];
    return {
      id: `tubi.${channelId}`,
      provider: "tubi",
      countryCode: "US",
      name: entry.name,
      logo: entry.attrs["tvg-logo"] || null,
      url: entry.url,
      categories: entry.attrs["group-title"] ? [entry.attrs["group-title"]] : [],
      quality: null,
      epg: epgByChannel.get(channelId) || [],
    };
  });
}

export async function fetchFastChannels() {
  console.log(`Fetching Pluto TV (${PLUTO_REGIONS.length} regions) and Tubi...`);
  const plutoResults = await Promise.all(PLUTO_REGIONS.map(fetchPlutoRegion));
  const tubiResult = await fetchTubi();
  const candidates = [...plutoResults.flat(), ...tubiResult];

  console.log(`Checking ${candidates.length} Pluto TV / Tubi streams...`);
  const aliveFlags = await mapLimit(candidates, CONCURRENCY, (c) => isAlive(c.url));
  const live = candidates.filter((_, i) => aliveFlags[i]);
  console.log(`${live.length}/${candidates.length} Pluto TV / Tubi streams are live.`);

  return live;
}
