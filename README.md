# proyecto-atlas

Curated IPTV channel index for the APK: live, non-blocklisted streams sourced from
[iptv-org](https://github.com/iptv-org/iptv), grouped by continent → country, with
logos and a stable per-channel number.

## How it works

- `scripts/build.js` pulls `channels`, `streams`, `logos`, `regions`, `countries`,
  and `blocklist` from the iptv-org API, drops closed/DMCA/NSFW-blocklisted channels,
  then liveness-checks every remaining stream URL (concurrency-limited GET request).
- Surviving channels are grouped by continent (`regions.json`) and country, each
  carrying its logo and a stable numeric index (see Numbering below).
- A GitHub Actions cron (`.github/workflows/build.yml`, every 6h) runs the build and
  commits `output/streams.json` back to the repo.

## Consuming from the APK

No backend needed - fetch the committed JSON straight off GitHub via the jsDelivr CDN:

```
https://cdn.jsdelivr.net/gh/<your-github-user>/proyecto-atlas@main/output/streams.json
```

jsDelivr caches public GitHub repo content on a real CDN, so this is fast, free, and
needs no hosting setup. jsDelivr's cache typically refreshes within ~12-24h of a push;
use the `@main` (branch) ref above rather than a commit-pinned URL if you want updates
to show up automatically.

## Numbering scheme

Each channel gets a stable integer number, e.g. US channels start at 1000, the next
country gets the next free block of 1000, etc. (`registry/country-blocks.json` records
the base per country, `registry/numbers.json` records the id → number assignment).
Numbers are **append-only**: once assigned, a channel id keeps its number across runs,
even if it temporarily drops out of the live list. This keeps the APK's saved
favorites / EPG mappings stable. The channel `id` (e.g. `CNN.us`, iptv-org's own slug)
is the permanent unique key; `number` is just a stable display/tuning number layered on
top of it.

## Known limitations (v1)

- **Geolocking**: there is no reliable iptv-org field for this, and the build only
  checks liveness from a single region (the GitHub Actions runner). A 403/451 response
  is treated as dead and dropped, but a stream that geo-blocks *other* regions while
  working fine from GitHub's runner will not be caught. True geolock detection needs
  active probing from multiple regions (e.g. additional checks from AWS Lambda in 2-3
  regions, flagging streams that succeed in one and fail in another) - not implemented
  yet.
- **EPG / program schedules**: out of scope for v1. iptv-org's actual programme data
  comes from a separate scraper system ([iptv-org/epg](https://github.com/iptv-org/epg))
  and would be a follow-up addition, not a static field.

## Output shape

```json
{
  "generated_at": "2026-06-22T00:00:00.000Z",
  "source": "https://github.com/iptv-org/iptv",
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
              "quality": "720p"
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
