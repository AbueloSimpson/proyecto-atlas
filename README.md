# proyecto-atlas

IPTV channel index for the APK: live streams from [iptv-org](https://github.com/iptv-org/iptv)
plus FAST channels from Pluto TV, Tubi, Roku, TCL Channel, LG Channels, and a subset of
Rakuten TV Spain. Each channel has a logo, EPG, and a stable channel number, grouped by
country or by category.

## What it does

- Every 6 hours, a GitHub Actions cron job downloads all sources, drops channels that
  aren't live at that moment, and publishes the result.
- Spanish-language channels from Pluto/Tubi/Roku/TCL/LG/Rakuten (plus the Movies/Sports
  genres in general) are grouped by category instead of by country - see below.
- Each channel gets a fixed number that never changes, even if it goes temporarily
  unavailable.
- Logos are also checked on every run; if a logo is broken, it's omitted instead of
  showing a broken image.

## How to consume the data

Everything is served for free from the `data` branch via the jsDelivr CDN (no backend,
no API key):

```
https://cdn.jsdelivr.net/gh/AbueloSimpson/proyecto-atlas@data/output/<path>
```

Start at `output/index.json`, which links to everything else:

```json
{
  "generated_at": "2026-06-23T00:00:00.000Z",
  "continents": [
    { "code": "EMEA", "name": "Europe, the Middle East and Africa", "path": "continents/EMEA.json", "countryCount": 70 }
  ],
  "categories": [
    { "name": "Mexico", "path": "categories/mexico.json", "channelCount": 141 }
  ]
}
```

From there, follow the `path` values until you reach the channel list:

```
index.json → continents/<code>.json → countries/<code>.json   (channels here)
index.json → categories/<slug>.json                            (channels here)
```

Each channel looks like this:

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

- `id` and `number` are permanent - safe to use as a favorites key.
- `epg` carries up to 50 upcoming programs (when data is available); compare
  `start`/`stop` against the current time to know what's airing now.
- Each file is small (a few hundred KB at most), so the APK only loads what it needs
  into memory at any given time, not the whole catalog at once.

More API detail and the project roadmap are on the
[wiki](https://github.com/AbueloSimpson/proyecto-atlas/wiki).

## Categories

Spanish-language channels from the FAST sources (not iptv-org) are grouped by category
instead of by country: Mexico, Argentina / Paraguay, Chile, Peru, Brasil, Europa, plus
cross-country genres (Deportes, Peliculas, Noticias, Infantil, Estilo de Vida, Anime,
Educativos, Music, Entretenimiento). Entretenimiento covers ar/cl/mx's general groups
(Series, Comedia, Curiosidad, Policiaco) that don't fit any other genre - es/br have
their own similarly-named groups, but those stay with the rest of that region's content
instead. Brasil's Portuguese-language content is kept out of these
Spanish-language genres: Peliculas, Anime, Estilo de Vida, and Infantil each have a
dedicated "Brasil"-flavored bucket instead (Brasil Movies, Anime BR, Estilo de Vida BR,
Infantil BR), and Anime also splits out Spain's own catalog (Anime ES) the same way.
English-language Movies/Sports channels from those same sources also get their own
category ("Movies Eng" and "Deportes").
"Especialidad" is the overflow bucket for Spanish content (ar/cl/mx) that doesn't match
any genre. Pluto TV's other third-language regions (German, Danish, French, Italian,
Norwegian, Swedish) keep their normal country page for everything else, but each pulls
its own movies group out into a dedicated category - Alemania Movies, Dinamarca Movies,
Francia Movies, Italia Movies, Noruega Movies, and Suecia Movies. The full detail of
these rules is documented in the comments in `scripts/lib/spanish-categories.js`.

Every LG/TCL channel that lands in one of these categories (not the hundreds that fall
through to the plain US country page - those aren't tracked here), plus any other
provider's Deportes channel on an Amagi CDN (`*.amagi.tv`), is verified against
check-host.net's São Paulo, Brazil node to detect if it's geolocked to the USA - LG/TCL
are known to enforce this on some channels, and Amagi confirms it directly, so a channel
can pass the liveness check (run from a US-based GitHub Actions runner) but still be
unwatchable for anyone outside the US. Confirmed (or inconclusive) channels are pulled
out of their normal category into "Geolocked USA Sports" (if they were Deportes) or the
generic "Geolocked USA" (everything else). Each verdict is cached by channel id in
`registry/geoblock-brazil.json` (persisted on the `data` branch like the other
registries) and reused for about a month before being
re-checked, so later runs only hit the public service for new or stale entries.

## Known limitations

- Liveness checks only run from the GitHub Actions runner's region - a channel blocked
  in other regions might not be detected.
- iptv-org's EPG is partial (not every channel has a guide available).
- Rakuten TV Spain: stream URLs come from a community list (`coderfast/IPTV`) that
  doesn't get updated as often as the other sources, so some channels may be down or no
  longer exist in Rakuten's current catalog - only the ones that pass the liveness check
  on each run are included. The EPG (when available) does come fresh from Rakuten's
  public API on every run.

## Running locally

```
node scripts/build.js
```

Requires Node 20+. No dependencies to install.
