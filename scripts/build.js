// Builds output/streams.json: live, non-blocklisted IPTV channels from iptv-org,
// grouped by continent -> country, with logos and a stable numeric index for the APK.

import fs from "node:fs/promises";
import path from "node:path";

const API = "https://iptv-org.github.io/api";
const CONCURRENCY = 40;
const CHECK_TIMEOUT_MS = 8000;

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1");
const REGISTRY_PATH = path.join(ROOT, "registry", "numbers.json");
const BLOCKS_PATH = path.join(ROOT, "registry", "country-blocks.json");
const OUTPUT_PATH = path.join(ROOT, "output", "streams.json");

async function fetchJson(name) {
  const res = await fetch(`${API}/${name}.json`);
  if (!res.ok) throw new Error(`Failed to fetch ${name}: ${res.status}`);
  return res.json();
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

// Simple concurrency-limited mapper.
async function mapLimit(items, limit, fn) {
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
// 403/451 are treated as blocked/dead rather than confirmed geolocked -
// real multi-region geolock detection is not implemented yet (see README).
async function isAlive(url) {
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

function pickLogo(logosByChannel, channelId) {
  const candidates = logosByChannel.get(channelId) || [];
  if (candidates.length === 0) return null;
  const inUse = candidates.find((l) => l.in_use);
  return (inUse || candidates[0]).url;
}

// Assigns a stable per-country block of 1000 numbers, persisted across runs.
function getCountryBase(blocks, countryCode) {
  if (blocks[countryCode] != null) return blocks[countryCode];
  const used = Object.values(blocks);
  const nextBase = used.length === 0 ? 1000 : Math.max(...used) + 1000;
  blocks[countryCode] = nextBase;
  return nextBase;
}

// Assigns a stable channel number, append-only - never reassigns an existing id.
function getChannelNumber(registry, blocks, countryCode, channelId) {
  if (registry[channelId] != null) return registry[channelId];
  const base = getCountryBase(blocks, countryCode);
  const used = new Set(
    Object.entries(registry)
      .filter(([, num]) => num >= base && num < base + 1000)
      .map(([, num]) => num)
  );
  let n = base;
  while (used.has(n)) n++;
  registry[channelId] = n;
  return n;
}

async function main() {
  console.log("Fetching iptv-org data...");
  const [channels, streams, logos, regions, countries, blocklist] = await Promise.all([
    fetchJson("channels"),
    fetchJson("streams"),
    fetchJson("logos"),
    fetchJson("regions"),
    fetchJson("countries"),
    fetchJson("blocklist"),
  ]);

  const blockedChannelIds = new Set(blocklist.map((b) => b.channel));
  const channelsById = new Map(channels.map((c) => [c.id, c]));
  const countryNameByCode = new Map(countries.map((c) => [c.code, c.name]));

  const regionByCountry = new Map();
  for (const region of regions) {
    for (const code of region.countries) {
      if (!regionByCountry.has(code)) regionByCountry.set(code, region);
    }
  }

  const logosByChannel = new Map();
  for (const logo of logos) {
    if (!logosByChannel.has(logo.channel)) logosByChannel.set(logo.channel, []);
    logosByChannel.get(logo.channel).push(logo);
  }

  const candidates = streams.filter((s) => {
    const channel = channelsById.get(s.channel);
    return channel && !channel.closed && !blockedChannelIds.has(s.channel) && s.url;
  });

  console.log(`Checking ${candidates.length} streams (concurrency ${CONCURRENCY})...`);
  const aliveFlags = await mapLimit(candidates, CONCURRENCY, (s) => isAlive(s.url));
  const liveStreams = candidates.filter((_, i) => aliveFlags[i]);
  console.log(`${liveStreams.length}/${candidates.length} streams are live.`);

  const registry = await readJsonIfExists(REGISTRY_PATH, {});
  const blocks = await readJsonIfExists(BLOCKS_PATH, {});

  // continent code -> { region, countries: Map<countryCode, channels[]> }
  const continents = new Map();

  for (const stream of liveStreams) {
    const channel = channelsById.get(stream.channel);
    const countryCode = channel.country;
    if (!countryCode) continue;

    const region = regionByCountry.get(countryCode);
    const continentKey = region ? region.code : "UNK";
    const continentName = region ? region.name : "Unknown";

    if (!continents.has(continentKey)) {
      continents.set(continentKey, { code: continentKey, name: continentName, countries: new Map() });
    }
    const continent = continents.get(continentKey);

    if (!continent.countries.has(countryCode)) {
      continent.countries.set(countryCode, {
        code: countryCode,
        name: countryNameByCode.get(countryCode) || countryCode,
        channels: [],
      });
    }

    const number = getChannelNumber(registry, blocks, countryCode, channel.id);

    continent.countries.get(countryCode).channels.push({
      id: channel.id,
      number,
      name: channel.name,
      logo: pickLogo(logosByChannel, channel.id),
      url: stream.url,
      categories: channel.categories,
      quality: stream.quality || null,
    });
  }

  const output = {
    generated_at: new Date().toISOString(),
    source: "https://github.com/iptv-org/iptv",
    continents: [...continents.values()]
      .map((c) => ({
        code: c.code,
        name: c.name,
        countries: [...c.countries.values()]
          .map((country) => ({
            ...country,
            channels: country.channels.sort((a, b) => a.number - b.number),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2));
  await fs.writeFile(BLOCKS_PATH, JSON.stringify(blocks, null, 2));

  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
