# proyecto-atlas (data branch)

Generated data only - force-pushed fresh each build, no history. Code/docs/wiki live on
[`master`](https://github.com/AbueloSimpson/proyecto-atlas/tree/master).

## Consuming this data

```
https://raw.githubusercontent.com/AbueloSimpson/proyecto-atlas/data/output/<path>
```

(Not jsDelivr's `@data` alias - unreliable for this branch.)

```
output/index.json
  └─ output/continents/<code>.json
       └─ output/countries/<code>.json   (channels)
  └─ output/categories/<slug>.json        (channels)
```

Channel object:

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
  "epg": [{ "title": "Le Journal", "start": "2026-06-23T19:00:00.000Z", "stop": "2026-06-23T19:30:00.000Z" }]
}
```

`id`/`number` are permanent. `epg` holds up to 50 upcoming programs.

## Files

- `output/index.json` - entry point.
- `output/continents/*.json`, `output/countries/*.json` - geography tree.
- `output/categories/*.json` - genre/region buckets.
- `output/epg-iptvorg.json` - internal, not part of the public API.
- `registry/*.json` - internal numbering state, not for direct use.

Full reference: `README.md` and [wiki](https://github.com/AbueloSimpson/proyecto-atlas/wiki) on `master`.
