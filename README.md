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
  commits `output/streams.json` back to the repo.

## Consuming from the APK

No backend needed - fetch the committed JSON straight off GitHub via the jsDelivr CDN:

```
https://cdn.jsdelivr.net/gh/AbueloSimpson/proyecto-atlas@master/output/streams.json
```

jsDelivr caches public GitHub repo content on a real CDN, so this is fast, free, and
needs no hosting setup. jsDelivr's cache typically refreshes within ~12-24h of a push;
use the `@master` (branch) ref above rather than a commit-pinned URL if you want updates
to show up automatically.

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
     as Pluto/Tubi, written to `output/epg-iptvorg.json`.
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

> **2026-06-23 fix:** the block size used to be 1,000 per country, which the US (now
> ~2,900 channels across iptv-org + Pluto + Tubi) overflowed, silently colliding with
> the next country's block. Fixed by widening blocks to 100,000 and resetting the
> registry once - if you cached old numbers anywhere, they're invalid as of this run.

## Spanish categories

Pluto's Latin America/Spain regions (ar, br, cl, es, mx), Tubi's `group-title="Español"`
channels, and Roku's Spanish-language channels (detected by name) don't get grouped by
country - they're routed into a flat `categories` array instead (see Output shape),
**replacing** their normal country placement entirely (a channel appears in exactly one
place, never both). Logic lives in `scripts/lib/spanish-categories.js`:

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

## Output shape

```json
{
  "generated_at": "2026-06-22T00:00:00.000Z",
  "sources": [
    "https://github.com/iptv-org/iptv",
    "https://github.com/BuddyChewChew/app-m3u-generator",
    "https://github.com/BuddyChewChew/tubi-scraper"
  ],
  "continents": [
    {
      "code": "EUR",
      "name": "Europe",
      "countries": [
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
      ]
    }
  ],
  "categories": [
    {
      "name": "Mexico",
      "channels": [
        {
          "id": "plutotv.mx.5b864d0c7757980016e22fc1",
          "number": 1000,
          "name": "Pluto TV Novelas",
          "logo": "https://...",
          "url": "https://...",
          "categories": ["Novelas"],
          "quality": null,
          "provider": "plutotv",
          "epg": []
        }
      ]
    }
  ]
}
```

## Running locally

```
node scripts/build.js
```

Requires Node 20+ (uses the built-in `fetch`). No dependencies to install.
