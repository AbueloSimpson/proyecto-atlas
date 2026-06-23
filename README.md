# proyecto-atlas

Curated IPTV channel index for the APK: live, non-blocklisted streams from
[iptv-org](https://github.com/iptv-org/iptv) plus Pluto TV (all regions) and Tubi FAST
channels from [BuddyChewChew](https://github.com/BuddyChewChew), grouped by continent →
country, with logos, EPG, and a stable per-channel number.

## How it works

- `scripts/build.js` pulls `channels`, `streams`, `logos`, `regions`, `countries`, and
  `blocklist` from the iptv-org API, drops closed/DMCA/NSFW-blocklisted channels, then
  liveness-checks every remaining stream URL (concurrency-limited GET request).
- `scripts/fastchannels.js` pulls Pluto TV's daily-generated M3U + EPG for all 14
  regions (ar, br, ca, cl, de, dk, es, fr, gb, it, mx, no, se, us), Tubi's M3U + EPG, and
  Roku's Spanish-language channels, from BuddyChewChew's
  [app-m3u-generator](https://github.com/BuddyChewChew/app-m3u-generator) and
  [tubi-scraper](https://github.com/BuddyChewChew/tubi-scraper) repos, and
  liveness-checks those streams the same way.
- Most of this is merged into one tree grouped by continent (`regions.json`) and
  country, each channel carrying its logo, EPG (where available), and a stable numeric
  index (see Numbering below). Pluto's Latin America/Spain regions, Tubi's Spanish
  channels, and Roku's Spanish channels are routed into Spanish-content category
  buckets instead - see Spanish categories below.
- A GitHub Actions cron (`.github/workflows/build.yml`, every 6h) runs the build and
  pushes the linked-file output below to the `data` branch (see Repo size below).

## Consuming from the APK

This is a small linked-file API, not one big JSON blob - so the APK only ever loads
one continent's country list, or one country's/category's channel list, into memory at
a time, rather than the entire dataset. Everything is served free via the jsDelivr CDN
(no backend needed):

```
https://cdn.jsdelivr.net/gh/AbueloSimpson/proyecto-atlas@data/output/<path>
```

Start at `output/index.json`, which links to everything else:

```json
{
  "generated_at": "2026-06-23T00:00:00.000Z",
  "sources": ["..."],
  "continents": [
    { "code": "EMEA", "name": "Europe, the Middle East and Africa", "path": "continents/EMEA.json", "countryCount": 70 }
  ],
  "categories": [
    { "name": "Mexico", "path": "categories/mexico.json", "channelCount": 141 }
  ]
}
```

Note these are iptv-org's own `regions.json` groupings, not strict continents - some
overlap (e.g. EMEA alongside narrower CEE/CEU/Balkan/Benelux regions).

Fetch `continents/EMEA.json` to get that region's country list (still just links, no
channels yet):

```json
{
  "code": "EMEA",
  "name": "Europe, the Middle East and Africa",
  "countries": [
    { "code": "FR", "name": "France", "path": "countries/FR.json", "channelCount": 98 }
  ]
}
```

Fetch `countries/FR.json` (or `categories/mexico.json`) to get the actual channel list
for just that one country/category - this is the only level that contains full channel
objects (id, number, name, logo, url, categories, quality, provider, epg):

```json
{
  "code": "FR",
  "name": "France",
  "channels": [
    {
      "id": "FranceTV1.fr",
      "number": 1000,
      "name": "France TV 1",
      "logo": "https://...",
      "url": "https://...",
      "categories": ["general"],
      "quality": "720p",
      "provider": "iptv-org",
      "epg": []
    }
  ]
}
```

Categories work the same way, just one level shallower - `index.json`'s `categories`
links straight to `categories/<slug>.json` (e.g. `categories/argentina-paraguay.json`),
no intermediate continent file.

Each file is small (a few hundred KB at most even for large countries), so there's no
20MB-cap or gzip concerns the way one combined file would have. jsDelivr's cache
typically refreshes within ~12-24h of a push; use the `@data` (branch) ref above rather
than a commit-pinned URL if you want updates to show up automatically.

## Repo size

`master` only ever contains scripts/workflows/docs - it never grows from data churn.
Generated output (`output/index.json`, `output/continents/`, `output/countries/`,
`output/categories/`, plus the internal `output/epg-iptvorg.json` and
`registry/*.json`) lives on a separate `data` branch that both workflows **force-push a
single fresh commit to on every run**, rather than accumulating commit history. Each
run fetches the current `data` branch's files first (so the numbering registry and
whichever files it doesn't regenerate carry forward), then overwrites the branch with
one new commit containing the latest state. No pruning job needed - there's nothing to
prune, since history on `data` never accumulates in the first place.

## EPG

Every channel carries an `epg` array: upcoming programmes (`{ title, start, stop }`,
ISO 8601 UTC timestamps), capped at 50 future entries per channel. The APK can compute
"what's on now" by comparing `start`/`stop` against the current time - no live backend
needed. Sourced from:

- **Pluto TV / Tubi**: `i.mjh.nz` (gzipped XMLTV) and Tubi's own `tubi_epg.xml`,
  refreshed every 6h alongside the main build (see above).
- **iptv-org**: there's no pre-built EPG output for this source - unlike the rest of
  their data, [iptv-org/epg](https://github.com/iptv-org/epg) is a scraper toolkit you
  run yourself against ~250 different guide websites. `.github/workflows/epg.yml` runs
  it daily (`0 3 * * *`), scoped to only the channels we actually carry:
  1. `scripts/select-epg-channels.js` cross-references the iptv-org API's `guides.json`
     (channel → site/site_id mapping) against the grabber's actually-supported sites,
     producing a curated `channels.xml` (~11k channels, not all ~250 sites blindly).
  2. The grabber (cloned fresh each run, not vendored) grabs just those channels.
  3. `scripts/convert-epg-output.js` converts its XMLTV output to the same JSON shape
     as Pluto/Tubi, written to `output/epg-iptvorg.json` - an internal handoff file,
     not part of the public API above.
  4. `build.js` reads that file (if present) and attaches matching channels' `epg`.

  This runs on its own slower daily schedule, decoupled from the 6h liveness-check
  cron, since it's heavier (clones + npm-installs a third-party scraper) and some guide
  sites rate-limit or reject requests (those channels just get `epg: []` for that day,
  not a failed build).

## Numbering scheme

Each channel gets a stable integer number, e.g. US channels start at 1000, the next
country gets the next free block of 100,000, etc. (`registry/country-blocks.json`
records the base per country, `registry/numbers.json` records the id → number
assignment). Numbers are **append-only**: once assigned, a channel id keeps its number
across runs, even if it temporarily drops out of the live list. This keeps the APK's
saved favorites / EPG mappings stable. The channel `id` is the permanent unique key -
`Name.country` for iptv-org channels, `plutotv.<region>.<channelId>` or
`tubi.<channelId>` for the FAST-channel sources; `number` is just a stable
display/tuning number layered on top of it.

## Spanish categories

Pluto's Latin America/Spain regions (ar, br, cl, es, mx), Tubi's `group-title="Español"`
channels, and Roku's Spanish-language channels (detected by name) don't get grouped by
country - they're routed into the flat `categories` list instead (see Consuming from
the APK), **replacing** their normal country placement entirely (a channel appears in
exactly one place, never both). Logic lives in `scripts/lib/spanish-categories.js`:

- Each region defaults into its own bucket: `ar` → "Argentina / Paraguay", `br` →
  "Brasil", `cl` → "Chile / Peru", `es` → "Europa", `mx` → "Mexico", Tubi/Roku →
  "EEUU".
- Four genres get pulled out **across all regions**, since those make sense to browse
  independent of country: Deportes, Peliculas, Noticias, Infantil. Everything else
  (Entretenimiento, Novelas, Series, Música, etc.) stays under the region's bucket.
- `br`'s own "TV Brasileira" (free-to-air) group gets a dedicated "Brasil TV Aberta"
  bucket.
- Categories like "Bolivia / Venezuela", "Caribe", "Centro America", "Ecuador /
  Colombia", and "Chile Regionales" are intentionally not produced - Pluto/Tubi/Roku
  simply don't offer feeds for those countries, so there's no source data to fill them.

## Known limitations

- **Geolocking**: liveness is only checked from a single region (the GitHub Actions
  runner). A 403/451 response is treated as dead and dropped, but a stream that
  geo-blocks *other* regions while working fine from GitHub's runner will not be caught.
- **iptv-org EPG coverage is partial**: only channels iptv-org's `guides.json` maps to a
  supported guide site get one (~11k of ~39k channels), and individual sites can fail or
  rate-limit on any given day.

## Running locally

```
node scripts/build.js
```

Requires Node 20+ (uses the built-in `fetch`). No dependencies to install. `output/` and
`registry/` aren't tracked in git (see Repo size) - running locally starts with an empty
registry unless you first copy those files down from the `data` branch yourself.
