// Pulls Pluto TV (all regions), Tubi, and Roku channel + EPG data from
// BuddyChewChew's daily-generated playlists, liveness-checks the streams, and
// returns normalized channel objects ready to merge into build.js's output.
//
// Pluto's LatAm/Spain regions (ar/br/cl/es/mx), Tubi's "Español" group, and
// Roku's Spanish-language channels are routed into Spanish-content category
// buckets (spanishCategory) instead of the normal continent/country tree -
// see lib/spanish-categories.js.

import zlib from "node:zlib";
import { mapLimit, isAlive } from "./lib/http.js";
import { parseM3U } from "./lib/m3u.js";
import { parseXmltv } from "./lib/xmltv.js";
import { resolveSpanishCategory, isSpanishLanguageName } from "./lib/spanish-categories.js";

const M3U_BASE = "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists";
const MJH_BASE = "https://github.com/matthuisman/i.mjh.nz/raw/master";
const TUBI_EPG_URL = `${M3U_BASE}/tubi_epg.xml`;
const CONCURRENCY = 40;

const PLUTO_REGIONS = ["ar", "br", "ca", "cl", "de", "dk", "es", "fr", "gb", "it", "mx", "no", "se", "us"];
const PLUTO_SPANISH_REGIONS = new Set(["ar", "br", "cl", "es", "mx"]);

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
      fetchGzipText(`${MJH_BASE}/PlutoTV/${region}.xml.gz`),
    ]);
  } catch (err) {
    console.warn(`Skipping Pluto TV region ${region}: ${err.message}`);
    return [];
  }

  const entries = parseM3U(m3u);
  const epgByChannel = parseXmltv(epgText);
  const isSpanish = PLUTO_SPANISH_REGIONS.has(region);

  return entries.map((entry) => {
    const channelId = entry.attrs["tvg-id"];
    const groupTitle = entry.attrs["group-title"] || "";
    return {
      id: `plutotv.${region}.${channelId}`,
      provider: "plutotv",
      countryCode: isSpanish ? null : region.toUpperCase(),
      spanishCategory: isSpanish ? resolveSpanishCategory([groupTitle, entry.name], region) : null,
      name: entry.name,
      logo: entry.attrs["tvg-logo"] || null,
      url: entry.url,
      categories: groupTitle ? [groupTitle] : [],
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
    const groupTitle = entry.attrs["group-title"] || "";
    const isSpanish = groupTitle.trim().toLowerCase() === "español";
    return {
      id: `tubi.${channelId}`,
      provider: "tubi",
      countryCode: isSpanish ? null : "US",
      spanishCategory: isSpanish ? resolveSpanishCategory([entry.name, groupTitle], "tubi") : null,
      name: entry.name,
      logo: entry.attrs["tvg-logo"] || null,
      url: entry.url,
      categories: groupTitle ? [groupTitle] : [],
      quality: null,
      epg: epgByChannel.get(channelId) || [],
    };
  });
}

// Only Roku's Spanish-language channels are included - general Roku
// integration is out of scope, this is just for the Spanish category view.
async function fetchRoku() {
  let m3u, epgText;
  try {
    [m3u, epgText] = await Promise.all([
      fetchText(`${M3U_BASE}/roku_all.m3u`),
      fetchGzipText(`${MJH_BASE}/Roku/all.xml.gz`),
    ]);
  } catch (err) {
    console.warn(`Skipping Roku: ${err.message}`);
    return [];
  }

  const entries = parseM3U(m3u).filter((entry) => isSpanishLanguageName(entry.name));
  const epgByChannel = parseXmltv(epgText);

  return entries.map((entry) => {
    const channelId = entry.attrs["tvg-id"];
    const groupTitle = entry.attrs["group-title"] || "";
    return {
      id: `roku.${channelId}`,
      provider: "roku",
      countryCode: null,
      spanishCategory: resolveSpanishCategory([groupTitle, entry.name], "roku"),
      name: entry.name,
      logo: entry.attrs["tvg-logo"] || null,
      url: entry.url,
      categories: groupTitle ? [groupTitle] : [],
      quality: null,
      epg: epgByChannel.get(channelId) || [],
    };
  });
}

export async function fetchFastChannels() {
  console.log(`Fetching Pluto TV (${PLUTO_REGIONS.length} regions), Tubi, and Roku (Spanish subset)...`);
  const [plutoResults, tubiResult, rokuResult] = await Promise.all([
    Promise.all(PLUTO_REGIONS.map(fetchPlutoRegion)),
    fetchTubi(),
    fetchRoku(),
  ]);
  const candidates = [...plutoResults.flat(), ...tubiResult, ...rokuResult];

  console.log(`Checking ${candidates.length} Pluto TV / Tubi / Roku streams...`);
  const aliveFlags = await mapLimit(candidates, CONCURRENCY, (c) => isAlive(c.url));
  const live = candidates.filter((_, i) => aliveFlags[i]);
  console.log(`${live.length}/${candidates.length} Pluto TV / Tubi / Roku streams are live.`);

  return live;
}
