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
  regions (ar, br, ca, cl, de, dk, es, fr, gb, it, mx, no, se, us) and Tubi's M3U + EPG,
  from BuddyChewChew's [app-m3u-generator](https://github.com/BuddyChewChew/app-m3u-generator)
  and [tubi-scraper](https://github.com/BuddyChewChew/tubi-scraper) repos, and
  liveness-checks those streams the same way.
- Both sources are merged into one tree grouped by continent (`regions.json`) and
  country, each channel carrying its logo, EPG (where available), and a stable numeric
  index (see Numbering below).
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

Pluto TV and Tubi channels carry an `epg` array: upcoming programmes
(`{ title, start, stop }`, ISO 8601 UTC timestamps), capped at 50 future entries per
channel, sourced from Pluto's EPG (via `i.mjh.nz`, gzipped XMLTV) and Tubi's own
`tubi_epg.xml`. The APK can compute "what's on now" by comparing `start`/`stop` against
the current time - no live backend needed. iptv-org-sourced channels don't have program
schedules (that data lives in a separate scraper system,
[iptv-org/epg](https://github.com/iptv-org/epg), not pulled in here), so their `epg` is
always `[]`.

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

## Known limitations

- **Geolocking**: liveness is only checked from a single region (the GitHub Actions
  runner). A 403/451 response is treated as dead and dropped, but a stream that
  geo-blocks *other* regions while working fine from GitHub's runner will not be caught.
- **EPG** is only available for Pluto TV / Tubi channels, not iptv-org ones (see above).

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
  ]
}
```

## Running locally

```
node scripts/build.js
```

Requires Node 20+ (uses the built-in `fetch`). No dependencies to install.
