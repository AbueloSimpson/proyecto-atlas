// Builds output/streams.json: live, non-blocklisted IPTV channels from iptv-org plus
// Pluto TV / Tubi FAST channels (via fastchannels.js), grouped by continent -> country,
// with logos, EPG, and a stable numeric index for the APK.

import fs from "node:fs/promises";
import path from "node:path";
import { mapLimit, isAlive, isImageAlive, checkBlockedFromBrazil } from "./lib/http.js";
import { fetchFastChannels } from "./fastchannels.js";
import { IPTVORG_CATEGORY_BY_COUNTRY } from "./lib/spanish-categories.js";

const API = "https://iptv-org.github.io/api";
const CONCURRENCY = 40;

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1");
const REGISTRY_PATH = path.join(ROOT, "registry", "numbers.json");
const BLOCKS_PATH = path.join(ROOT, "registry", "country-blocks.json");
const OUTPUT_DIR = path.join(ROOT, "output");
const IPTVORG_EPG_PATH = path.join(OUTPUT_DIR, "epg-iptvorg.json");

// Filesystem/URL-safe slug for category names like "Argentina / Paraguay".
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

function pickLogo(logosByChannel, channelId) {
  const candidates = logosByChannel.get(channelId) || [];
  if (candidates.length === 0) return null;
  const inUse = candidates.find((l) => l.in_use);
  return (inUse || candidates[0]).url;
}

// Per-country block size. Must comfortably exceed the channel count of the
// largest single country (US already has ~2900 between iptv-org + Pluto + Tubi).
const COUNTRY_BLOCK_SIZE = 100000;

// Assigns a stable per-country block, persisted across runs.
function getCountryBase(blocks, countryCode) {
  if (blocks[countryCode] != null) return blocks[countryCode];
  const used = Object.values(blocks);
  const nextBase = used.length === 0 ? 1000 : Math.max(...used) + COUNTRY_BLOCK_SIZE;
  blocks[countryCode] = nextBase;
  return nextBase;
}

// Assigns a stable channel number, append-only - never reassigns an existing id.
function getChannelNumber(registry, blocks, countryCode, channelId) {
  if (registry[channelId] != null) return registry[channelId];
  const base = getCountryBase(blocks, countryCode);
  const used = new Set(
    Object.entries(registry)
      .filter(([, num]) => num >= base && num < base + COUNTRY_BLOCK_SIZE)
      .map(([, num]) => num)
  );
  let n = base;
  while (used.has(n)) {
    n++;
    if (n >= base + COUNTRY_BLOCK_SIZE) {
      throw new Error(`Country block for ${countryCode} exhausted (>${COUNTRY_BLOCK_SIZE} channels)`);
    }
  }
  registry[channelId] = n;
  return n;
}

function toChannelEntry(channel, number) {
  return {
    id: channel.id,
    number,
    name: channel.name,
    logo: channel.logo,
    url: channel.url,
    categories: channel.categories,
    quality: channel.quality,
    provider: channel.provider || "iptv-org",
    epg: channel.epg || [],
  };
}

// Inserts a normalized channel into either the continents -> countries -> channels
// tree, or - if it carries a category (Pluto LatAm/Spain/Movies-Eng/Sports, Tubi's
// "Español" group, Roku's Spanish-language channels) - into the flat category
// buckets instead, replacing its normal country grouping entirely (see
// lib/spanish-categories.js). Assigns a stable number either way, sharing the same
// registry/blocks store (category names and country codes never collide).
function insertChannel(tree, channel) {
  const { continents, categories, regionByCountry, countryNameByCode, registry, blocks } = tree;

  if (channel.category) {
    const categoryName = channel.category;
    if (!categories.has(categoryName)) categories.set(categoryName, []);
    const number = getChannelNumber(registry, blocks, categoryName, channel.id);
    categories.get(categoryName).push(toChannelEntry(channel, number));
    return;
  }

  const countryCode = channel.countryCode;
  if (!countryCode) return;

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
  continent.countries.get(countryCode).channels.push(toChannelEntry(channel, number));
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

  const tree = {
    continents: new Map(), // continent code -> { code, name, countries: Map<countryCode, {channels}> }
    categories: new Map(), // Spanish-content category name -> channels[]
    regionByCountry,
    countryNameByCode,
    registry,
    blocks,
  };

  // Produced separately (and less often) by .github/workflows/epg.yml, which runs
  // iptv-org/epg's own grabber - see scripts/select-epg-channels.js and
  // scripts/convert-epg-output.js. Absent until that workflow has run at least once.
  const iptvorgEpg = await readJsonIfExists(IPTVORG_EPG_PATH, {});

  // A channel can have multiple live stream mirrors in iptv-org's data -
  // keep just the first live one so each channel id appears exactly once.
  const seenChannelIds = new Set();
  for (const stream of liveStreams) {
    const channel = channelsById.get(stream.channel);
    if (seenChannelIds.has(channel.id)) continue;
    seenChannelIds.add(channel.id);

    const normalized = {
      id: channel.id,
      countryCode: channel.country,
      name: channel.name,
      logo: pickLogo(logosByChannel, channel.id),
      url: stream.url,
      categories: channel.categories,
      quality: stream.quality || null,
      provider: "iptv-org",
      epg: iptvorgEpg[channel.id] || [],
    };

    insertChannel(tree, normalized);

    // Mexico / Chile-Peru / Argentina-Paraguay categories mirror these
    // genuinely country-tagged iptv-org channels alongside their normal
    // country page - see IPTVORG_CATEGORY_BY_COUNTRY.
    const categoryName = IPTVORG_CATEGORY_BY_COUNTRY[channel.country];
    if (categoryName) {
      insertChannel(tree, { ...normalized, countryCode: null, category: categoryName });
    }
  }

  const fastChannels = await fetchFastChannels();

  // Amagi-hosted streams (now.amagi.tv and its various per-channel subdomains)
  // enforce strict US geo-IP blocking, even though the GitHub Actions runner
  // (US-based) plays them fine in the liveness check above - so they show up
  // as "live" here but are unwatchable for anyone outside the US. Rather than
  // just assuming every Amagi host is blocked, each Deportes candidate is
  // verified against check-host.net's São Paulo, Brazil node (see
  // checkBlockedFromBrazil in lib/http.js) and only moved into "Geolocked USA
  // Sports" if that check actually confirms (or can't rule out) a block.
  const amagiDeportesChannels = fastChannels.filter(
    (c) => c.category === "Deportes" && /amagi\.tv/i.test(c.url)
  );
  console.log(`Verifying ${amagiDeportesChannels.length} Amagi-hosted Deportes streams against a Brazil node...`);
  const blockedFromBrazilFlags = await mapLimit(amagiDeportesChannels, 5, (c) => checkBlockedFromBrazil(c.url));
  let geoblockedCount = 0;
  amagiDeportesChannels.forEach((channel, i) => {
    // Treat an inconclusive check (null) the same as confirmed-blocked: it
    // matches the Amagi hostname pattern already confirmed accurate in spot
    // checks, so silently leaving it in Deportes on a flaky third-party
    // response would be the worse failure mode.
    if (blockedFromBrazilFlags[i] !== false) {
      channel.category = "Geolocked USA Sports";
      geoblockedCount++;
    }
  });
  console.log(`${geoblockedCount}/${amagiDeportesChannels.length} confirmed (or inconclusive) geo-blocked from Brazil.`);

  for (const channel of fastChannels) {
    insertChannel(tree, channel);
  }

  const { continents, categories } = tree;

  // Check that every kept channel's logo URL actually resolves to an image -
  // some go stale (renamed CDN paths, deleted imgur posts, etc.), which would
  // otherwise show up as a broken image in the APK. Dedupe by URL first since
  // the iptv-org country/category mirror (see above) reuses the same logo.
  const allChannelEntries = [];
  for (const continent of continents.values()) {
    for (const country of continent.countries.values()) allChannelEntries.push(...country.channels);
  }
  for (const channelsArr of categories.values()) allChannelEntries.push(...channelsArr);

  const logoUrls = [...new Set(allChannelEntries.map((c) => c.logo).filter(Boolean))];
  console.log(`Checking ${logoUrls.length} unique logo URLs...`);
  const logoAliveFlags = await mapLimit(logoUrls, CONCURRENCY, (url) => isImageAlive(url));
  const deadLogos = new Set(logoUrls.filter((_, i) => !logoAliveFlags[i]));
  let nulledLogoCount = 0;
  for (const entry of allChannelEntries) {
    if (entry.logo && deadLogos.has(entry.logo)) {
      entry.logo = null;
      nulledLogoCount++;
    }
  }
  console.log(`${deadLogos.size}/${logoUrls.length} logo URLs are dead (nulled out on ${nulledLogoCount} channels).`);

  // Linked-file API: index.json links to continents/<code>.json (which link to
  // countries/<code>.json), and to categories/<slug>.json - so the APK only ever
  // loads one continent's country list, or one country's/category's channels, into
  // memory at a time instead of the entire dataset.
  const continentsDir = path.join(OUTPUT_DIR, "continents");
  const countriesDir = path.join(OUTPUT_DIR, "countries");
  const categoriesDir = path.join(OUTPUT_DIR, "categories");
  await fs.mkdir(continentsDir, { recursive: true });
  await fs.mkdir(countriesDir, { recursive: true });
  await fs.mkdir(categoriesDir, { recursive: true });

  const sortedContinents = [...continents.values()].sort((a, b) => a.name.localeCompare(b.name));
  const continentIndex = [];

  for (const continent of sortedContinents) {
    const sortedCountries = [...continent.countries.values()].sort((a, b) => a.name.localeCompare(b.name));
    const countryLinks = [];

    for (const country of sortedCountries) {
      const channels = country.channels.sort((a, b) => a.number - b.number);
      await fs.writeFile(
        path.join(countriesDir, `${country.code}.json`),
        JSON.stringify({ code: country.code, name: country.name, channels }, null, 2)
      );
      countryLinks.push({
        code: country.code,
        name: country.name,
        path: `countries/${country.code}.json`,
        channelCount: channels.length,
      });
    }

    await fs.writeFile(
      path.join(continentsDir, `${continent.code}.json`),
      JSON.stringify({ code: continent.code, name: continent.name, countries: countryLinks }, null, 2)
    );
    continentIndex.push({
      code: continent.code,
      name: continent.name,
      path: `continents/${continent.code}.json`,
      countryCount: countryLinks.length,
    });
  }

  const sortedCategories = [...categories.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const categoryIndex = [];

  for (const [name, rawChannels] of sortedCategories) {
    const channels = rawChannels.sort((a, b) => a.number - b.number);
    const slug = slugify(name);
    await fs.writeFile(
      path.join(categoriesDir, `${slug}.json`),
      JSON.stringify({ name, channels }, null, 2)
    );
    categoryIndex.push({ name, path: `categories/${slug}.json`, channelCount: channels.length });
  }

  const index = {
    generated_at: new Date().toISOString(),
    sources: [
      "https://github.com/iptv-org/iptv",
      "https://github.com/BuddyChewChew/app-m3u-generator",
      "https://github.com/BuddyChewChew/tubi-scraper",
    ],
    continents: continentIndex,
    // Spanish-language content (Pluto's ar/br/cl/es/mx, Tubi's "Español" group,
    // Roku's Spanish channels) - grouped by category instead of country, replacing
    // their normal country placement entirely. See lib/spanish-categories.js.
    categories: categoryIndex,
  };

  await fs.writeFile(path.join(OUTPUT_DIR, "index.json"), JSON.stringify(index, null, 2));
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2));
  await fs.writeFile(BLOCKS_PATH, JSON.stringify(blocks, null, 2));

  const totalCountries = continentIndex.reduce((n, c) => n + c.countryCount, 0);
  console.log(
    `Wrote output/index.json linking ${continentIndex.length} continents (${totalCountries} countries) ` +
      `and ${categoryIndex.length} categories.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
