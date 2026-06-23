# proyecto-atlas (data branch)

This branch contains **only generated data** - no scripts, no workflows. It's
force-pushed as a single fresh commit on every build run (see the main repo's
`README.md` on `master` for how the pipeline works), so there's no commit history to
browse here - just the current state.

Source code, docs, and the project wiki live on
[`master`](https://github.com/AbueloSimpson/proyecto-atlas/tree/master).

## Consuming this data

Served free via the jsDelivr CDN - no backend, no auth, no rate limit beyond
jsDelivr's own caching:

```
https://cdn.jsdelivr.net/gh/AbueloSimpson/proyecto-atlas@data/output/<path>
```

Use the `@data` branch ref (not a pinned commit) so you automatically pick up new
builds.

This is a linked-file API, not one big JSON blob - so a client only ever needs to
load one continent's country list, or one country's/category's channel list, into
memory at a time:

```
output/index.json
  └─ output/continents/<code>.json
       └─ output/countries/<code>.json   (channel objects live here)
  └─ output/categories/<slug>.json        (channel objects live here too)
```

Start at `output/index.json` - it links to every continent and every category, each
with a `path` to fetch next. Each channel object looks like:

```json
{
  "id": "FranceTV1.fr",
  "number": 1000,
  "name": "France TV 1",
  "logo": "https://...",
  "url": "https://...",
  "categories": ["general"],
  "quality": "720p",
  "provider": "iptv-org",
  "epg": [
    { "title": "Le Journal", "start": "2026-06-23T19:00:00.000Z", "stop": "2026-06-23T19:30:00.000Z" }
  ]
}
```

`id` and `number` are permanent and append-only - safe to use as a stable key across
runs. `epg` holds up to 50 upcoming programmes (ISO 8601 UTC timestamps), empty if no
guide data was available that day.

## What's in here

- `output/index.json` - entry point, links to all continents and categories.
- `output/continents/*.json` - one file per continent (iptv-org's own region
  groupings, not strict geography), links to that continent's countries.
- `output/countries/*.json` - one file per country, full channel objects.
- `output/categories/*.json` - one file per category (Spanish-language LatAm/Spain
  content, English Movies/Sports, genre buckets), full channel objects.
- `output/epg-iptvorg.json` - internal handoff file (iptv-org EPG grabber output),
  not part of the public API above.
- `registry/numbers.json`, `registry/country-blocks.json` - internal state for the
  append-only numbering scheme, not meant to be consumed directly.

Full field reference and category rules: see `README.md` and the
[wiki](https://github.com/AbueloSimpson/proyecto-atlas/wiki) on `master`.
