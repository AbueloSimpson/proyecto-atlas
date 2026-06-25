# proyecto-atlas

IPTV channel index for the APK. Sources: [iptv-org](https://github.com/iptv-org/iptv),
Pluto TV, Tubi, Roku, TCL Channel, LG Channels, Rakuten TV Spain. Each channel has a
logo, EPG, and a stable number, grouped by country or category.

## What it does

- Cron every 6h: fetches all sources, drops dead channels, publishes the result.
- Spanish-language FAST channels + Movies/Sports genres are grouped by category, not
  country.
- Channel numbers are permanent.
- Dead logos are nulled out, not shown broken.

## Consuming the data

```
https://raw.githubusercontent.com/AbueloSimpson/proyecto-atlas/data/output/<path>
```

(Use this, not jsDelivr's `@data` alias - it's unreliable for this branch.)

Entry point: `output/index.json`

```json
{
  "generated_at": "2026-06-23T00:00:00.000Z",
  "continents": [{ "code": "EMEA", "name": "...", "path": "continents/EMEA.json", "countryCount": 70 }],
  "categories": [{ "name": "Mexico", "path": "categories/mexico.json", "channelCount": 141 }]
}
```

```
index.json → continents/<code>.json → countries/<code>.json   (channels)
index.json → categories/<slug>.json                            (channels)
```

Each `countries/<code>.json` / `categories/<slug>.json` has a matching `.m3u` file
(same name, `m3uPath` in the index) - usable directly in any IPTV player.

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

- `id`/`number`: permanent, safe as a favorites key.
- `epg`: up to 50 upcoming programs.

Full API/category detail: [wiki](https://github.com/AbueloSimpson/proyecto-atlas/wiki).

## Categories

Country buckets: Mexico, Argentina / Paraguay, Chile, Peru, Brasil, Europa.

Genres: Deportes, Peliculas, Noticias, Infantil, Estilo de Vida, Anime, Educativos,
Music, Entretenimiento, Movies Eng, Especialidad.

Brasil/Spain splits: Brasil Movies, Anime BR, Estilo de Vida BR, Infantil BR, Anime ES.

Third-language Pluto regions (movies only): Alemania Movies, Dinamarca Movies, Francia
Movies, Italia Movies, Noruega Movies, Suecia Movies.

Geolocking: Geolocked USA, Geolocked USA Sports.

Full rules: `scripts/lib/spanish-categories.js`, `scripts/build.js`.

## Known limitations

- Liveness only checked from the GitHub Actions runner's region.
- iptv-org EPG coverage is partial.
- Rakuten TV Spain stream list (`coderfast/IPTV`) updates infrequently.

## Running locally

```
node scripts/build.js
```

Requires Node 20+.
