// Pulls Pluto TV (all regions), Tubi, Roku, TCL Channel, and LG Channels data
// from BuddyChewChew's daily-generated playlists, liveness-checks the
// streams, and returns normalized channel objects ready to merge into
// build.js's output.
//
// Pluto's LatAm/Spain regions (ar/br/cl/es/mx), Tubi's "Español" group, Roku's
// Spanish-language channels, TCL's "En Español"/"Noticias" groups, and LG's
// "Spanish Language"/"Latin" groups are routed into Spanish-content category
// buckets (category) instead of the normal continent/country tree. Pluto's
// gb/us regions, Roku, TCL, and LG also pull their Movies/Sports genres into
// category buckets the same way (Movies Eng, Deportes) - see
// lib/spanish-categories.js. Pluto's remaining third-language regions
// (de/dk/fr/it/no/se - German/Danish/French/Italian/Norwegian/Swedish) are
// routed into "Especialidad" instead of their own country page.

import zlib from "node:zlib";
import { mapLimit, isAlive } from "./lib/http.js";
import { parseM3U } from "./lib/m3u.js";
import { parseXmltv } from "./lib/xmltv.js";
import {
  resolveSpanishCategory,
  resolveEnglishCategory,
  isSpanishLanguageName,
} from "./lib/spanish-categories.js";

const M3U_BASE = "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists";
const MJH_BASE = "https://github.com/matthuisman/i.mjh.nz/raw/master";
const TUBI_EPG_URL = `${M3U_BASE}/tubi_epg.xml`;
const TCL_BASE = "https://raw.githubusercontent.com/BuddyChewChew/tcl-playlist-generator/main";
const RAKUTEN_ES_M3U_URL = "https://raw.githubusercontent.com/coderfast/IPTV/main/rakutentv.m3u";
const RAKUTEN_API_URL = "https://gizmo.rakuten.tv/v3/live_channels";
const CONCURRENCY = 40;

const PLUTO_REGIONS = ["ar", "br", "ca", "cl", "de", "dk", "es", "fr", "gb", "it", "mx", "no", "se", "us"];
const PLUTO_SPANISH_REGIONS = new Set(["ar", "br", "cl", "es", "mx"]);
// de/dk/fr/it/no/se are genuinely third-language (German, Danish, French,
// Italian, Norwegian, Swedish) - routed into "Especialidad" instead of their
// own country page. "ca" is left out: Pluto Canada's main feed is English, so
// it keeps its own CA country page like gb/us.
const PLUTO_THIRD_LANGUAGE_REGIONS = new Set(["de", "dk", "fr", "it", "no", "se"]);

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
  const isThirdLanguage = PLUTO_THIRD_LANGUAGE_REGIONS.has(region);

  return entries.map((entry) => {
    const channelId = entry.attrs["tvg-id"];
    const groupTitle = entry.attrs["group-title"] || "";
    const category = isSpanish
      ? resolveSpanishCategory([groupTitle, entry.name], region)
      : isThirdLanguage
      ? "Especialidad"
      : resolveEnglishCategory(groupTitle, region);
    return {
      id: `plutotv.${region}.${channelId}`,
      rawChannelId: channelId,
      provider: "plutotv",
      countryCode: category ? null : region.toUpperCase(),
      category,
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
      category: isSpanish ? resolveSpanishCategory([entry.name, groupTitle], "tubi") : null,
      name: entry.name,
      logo: entry.attrs["tvg-logo"] || null,
      url: entry.url,
      categories: groupTitle ? [groupTitle] : [],
      quality: null,
      epg: epgByChannel.get(channelId) || [],
    };
  });
}

// Only Roku's Spanish-language channels, plus its Movies/Sports genres
// (English, routed the same way as Pluto's gb/us - see resolveEnglishCategory)
// are included - general Roku integration is out of scope beyond that.
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

  const entries = parseM3U(m3u).filter((entry) => {
    const groupTitle = entry.attrs["group-title"] || "";
    return isSpanishLanguageName(entry.name) || resolveEnglishCategory(groupTitle, "roku", entry.name) != null;
  });
  const epgByChannel = parseXmltv(epgText);

  return entries.map((entry) => {
    const channelId = entry.attrs["tvg-id"];
    const groupTitle = entry.attrs["group-title"] || "";
    const isSpanish = isSpanishLanguageName(entry.name);
    const category = isSpanish
      ? resolveSpanishCategory([groupTitle, entry.name], "roku")
      : resolveEnglishCategory(groupTitle, "roku", entry.name);
    return {
      id: `roku.${channelId}`,
      provider: "roku",
      countryCode: null,
      category,
      name: entry.name,
      logo: entry.attrs["tvg-logo"] || null,
      url: entry.url,
      categories: groupTitle ? [groupTitle] : [],
      quality: null,
      epg: epgByChannel.get(channelId) || [],
    };
  });
}

// TCL Channel's "En Español" and "Noticias" groups are Spanish-language (its
// English news lives in a separate "News & Opinion" group, so this doesn't
// catch anything English) - routed the same way as Tubi's "Español" group.
// Its English Movies/Sports groups are clean (unlike Roku's mislabeled one),
// so they get the same plain Movies Eng / Deportes treatment as Pluto's gb/us.
const TCL_SPANISH_GROUPS = new Set(["en español", "en espanol", "noticias"]);

async function fetchTcl() {
  let m3u, epgText;
  try {
    [m3u, epgText] = await Promise.all([
      fetchText(`${TCL_BASE}/tcl.m3u8`),
      fetchText(`${TCL_BASE}/tcl_epg.xml`),
    ]);
  } catch (err) {
    console.warn(`Skipping TCL: ${err.message}`);
    return [];
  }

  const entries = parseM3U(m3u);
  const epgByChannel = parseXmltv(epgText);

  return entries.map((entry) => {
    const channelId = entry.attrs["tvg-id"];
    const groupTitle = entry.attrs["group-title"] || "";
    const groupKey = groupTitle.trim().toLowerCase();
    const isSpanish = TCL_SPANISH_GROUPS.has(groupKey) || isSpanishLanguageName(entry.name);
    const category = isSpanish
      ? resolveSpanishCategory([groupTitle, entry.name], "tcl")
      : resolveEnglishCategory(groupTitle, "tcl");
    return {
      id: `tcl.${channelId}`,
      provider: "tcl",
      countryCode: category ? null : "US",
      category,
      name: entry.name,
      logo: entry.attrs["tvg-logo"] || null,
      url: entry.url,
      categories: groupTitle ? [groupTitle] : [],
      quality: null,
      epg: epgByChannel.get(channelId) || [],
    };
  });
}

// LG Channels (US only) - small "Spanish Language"/"Latin" groups, same
// treatment as TCL. Its "Sports" and "TV & Movies" groups are clean, like
// TCL/Pluto's gb/us, so no Roku-style name filter is needed.
const LG_BASE = "https://raw.githubusercontent.com/BuddyChewChew/lg-playlist-generator/main";
const LG_SPANISH_GROUPS = new Set(["spanish language", "latin"]);

async function fetchLg() {
  let m3u, epgText;
  try {
    [m3u, epgText] = await Promise.all([
      fetchText(`${LG_BASE}/lg_channels_us.m3u`),
      fetchText(`${LG_BASE}/lg_channels_us.xml`),
    ]);
  } catch (err) {
    console.warn(`Skipping LG Channels: ${err.message}`);
    return [];
  }

  const entries = parseM3U(m3u);
  const epgByChannel = parseXmltv(epgText);

  return entries.map((entry) => {
    const channelId = entry.attrs["tvg-id"];
    const groupTitle = entry.attrs["group-title"] || "";
    const groupKey = groupTitle.trim().toLowerCase();
    const isSpanish = LG_SPANISH_GROUPS.has(groupKey) || isSpanishLanguageName(entry.name);
    const category = isSpanish
      ? resolveSpanishCategory([groupTitle, entry.name], "lg")
      : resolveEnglishCategory(groupTitle, "lg");
    return {
      id: `lg.${channelId}`,
      provider: "lg",
      countryCode: category ? null : "US",
      category,
      name: entry.name,
      logo: entry.attrs["tvg-logo"] || null,
      url: entry.url,
      categories: groupTitle ? [groupTitle] : [],
      quality: null,
      epg: epgByChannel.get(channelId) || [],
    };
  });
}

// Real Spain stream URLs come from coderfast/IPTV's rakutentv.m3u (a
// community-maintained list, last touched Feb 2025 - not auto-refreshed like
// BuddyChewChew's repos, but its ad-stitched Amagi/MediaTailor URLs are
// stable, plain HLS with no DRM, confirmed still live). Rakuten's own public
// API (gizmo.rakuten.tv) never gives a playable URL at all - only metadata -
// so it's used here only to enrich EPG, matched back to the m3u by
// normalized channel name (the two sources don't share an id scheme).
function normalizeRakutenName(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findRakutenEpgMatch(name, apiByNormName) {
  const norm = normalizeRakutenName(name);
  if (apiByNormName.has(norm)) return apiByNormName.get(norm);
  for (const [key, channel] of apiByNormName) {
    if (norm.includes(key) || key.includes(norm)) return channel;
  }
  return null;
}

function buildRakutenEpg(livePrograms) {
  const now = Date.now();
  return (livePrograms || [])
    .filter((p) => p.title && p.starts_at && p.ends_at && new Date(p.ends_at).getTime() >= now)
    .map((p) => ({
      title: p.title,
      start: new Date(p.starts_at).toISOString(),
      stop: new Date(p.ends_at).toISOString(),
    }))
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, 50);
}

async function fetchRakutenApiByNormName() {
  // Matches BuddyChewChew's UK script exactly - the API 400s unless
  // epg_starts_at is truncated to the top of the hour and epg_ends_at is
  // midnight-aligned, each paired with its own unix-timestamp field.
  const now = new Date();
  const epgStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const epgEnd = new Date(midnight.getTime() + 3 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().replace(/\.\d{3}Z$/, ".000Z");
  const params = new URLSearchParams({
    classification_id: "5", // broadest non-adult rating threshold - returns the full catalog
    device_identifier: "web",
    device_stream_audio_quality: "2.0",
    device_stream_hdr_type: "NONE",
    device_stream_video_quality: "FHD",
    epg_duration_minutes: "360",
    epg_starts_at: fmt(epgStart),
    epg_starts_at_timestamp: String(epgStart.getTime() / 1000),
    epg_ends_at: fmt(epgEnd),
    epg_ends_at_timestamp: String(epgEnd.getTime() / 1000),
    locale: "es",
    market_code: "es",
    per_page: "250",
  });
  const res = await fetch(`${RAKUTEN_API_URL}?${params}`);
  if (!res.ok) throw new Error(`Rakuten ES API: ${res.status}`);
  const data = (await res.json()).data || [];
  return new Map(data.map((ch) => [normalizeRakutenName(ch.title), ch]));
}

async function fetchRakutenEs() {
  let m3uText, apiByNormName;
  try {
    [m3uText, apiByNormName] = await Promise.all([
      fetchText(RAKUTEN_ES_M3U_URL),
      fetchRakutenApiByNormName().catch((err) => {
        console.warn(`Rakuten Spain EPG unavailable: ${err.message}`);
        return new Map();
      }),
    ]);
  } catch (err) {
    console.warn(`Skipping Rakuten Spain: ${err.message}`);
    return [];
  }

  const entries = parseM3U(m3uText);
  let withEpg = 0;

  const channels = entries.map((entry) => {
    const groupTitle = entry.attrs["group-title"] || "";
    const apiMatch = findRakutenEpgMatch(entry.name, apiByNormName);
    if (apiMatch) withEpg++;
    return {
      id: `rakuten.${entry.attrs["tvg-id"] || normalizeRakutenName(entry.name)}`,
      provider: "rakuten",
      countryCode: null,
      category: resolveSpanishCategory([groupTitle, entry.name], "es"),
      name: entry.name,
      logo: entry.attrs["tvg-logo"] || null,
      url: entry.url,
      categories: groupTitle ? [groupTitle] : [],
      quality: null,
      epg: apiMatch ? buildRakutenEpg(apiMatch.live_programs) : [],
    };
  });

  console.log(`Rakuten Spain: ${channels.length} channels (${withEpg} matched to live EPG data).`);
  return channels;
}

export async function fetchFastChannels() {
  console.log(
    `Fetching Pluto TV (${PLUTO_REGIONS.length} regions), Tubi, Roku (Spanish subset), TCL, LG, and Rakuten Spain...`
  );
  const [plutoResults, tubiResult, rokuResult, tclResult, lgResult, rakutenResult] = await Promise.all([
    Promise.all(PLUTO_REGIONS.map(fetchPlutoRegion)),
    fetchTubi(),
    fetchRoku(),
    fetchTcl(),
    fetchLg(),
    fetchRakutenEs(),
  ]);
  // Pluto's ar/cl/mx LatAm catalogs share most of the same channels (identical
  // Pluto channel id and stream URL, just relisted in each region's m3u) - keep
  // only the first occurrence (in PLUTO_REGIONS order) of each one so it isn't
  // inserted 2-3x over into the same category bucket.
  const seenPlutoIds = new Set();
  const plutoDeduped = plutoResults.flat().filter((c) => {
    if (!c.category) return true;
    if (seenPlutoIds.has(c.rawChannelId)) return false;
    seenPlutoIds.add(c.rawChannelId);
    return true;
  });

  const candidates = [...plutoDeduped, ...tubiResult, ...rokuResult, ...tclResult, ...lgResult, ...rakutenResult];

  console.log(`Checking ${candidates.length} Pluto TV / Tubi / Roku / TCL / LG / Rakuten streams...`);
  const aliveFlags = await mapLimit(candidates, CONCURRENCY, (c) => isAlive(c.url));
  const live = candidates.filter((_, i) => aliveFlags[i]);
  console.log(`${live.length}/${candidates.length} Pluto TV / Tubi / Roku / TCL / LG / Rakuten streams are live.`);

  return live;
}
