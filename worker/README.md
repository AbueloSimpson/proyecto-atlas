# atlas-api — Cloudflare Worker + D1 query API

An **optional, self-hosted** query API over proyecto-atlas's channel data. The maintainer
does not run this — it's here so anyone who wants a fast, queryable API (search, filters,
per-query M3U, EPG now/next) can deploy their own copy in a few minutes. Free-tier
friendly.

## How it works

```
data branch (output/db.json)  ──sync──►  D1 (SQLite)  ◄──queries──  Worker  ◄──  clients
        (rebuilt every 6h)      cron/POST   indexed table            HTTP API
```

- The build publishes `output/db.json` — a flat dump of every channel (one row per
  channel-per-group, no EPG). The Worker loads it into a **D1** database.
- Queries hit D1 (indexed, in-region), so they're fast and don't re-fetch the origin.
- D1 is refreshed by a **cron trigger** (45 min past each 6-hourly build) and on demand
  via `POST /sync`.
- EPG is fetched live from the origin JSON per request (it's large and changes often, so
  it isn't mirrored into D1).

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free works; see Costs).
- Node 18+ and [Wrangler](https://developers.cloudflare.com/workers/wrangler/): `npm i -g wrangler`.

## Deploy

```sh
cd worker
wrangler login

# 1. Create the D1 database, then paste the printed database_id into wrangler.toml.
wrangler d1 create atlas

# 2. Set a secret token that protects POST /sync (any random string).
wrangler secret put SYNC_TOKEN

# 3. Deploy.
wrangler deploy

# 4. Seed the database once (cron will keep it fresh after this).
curl -X POST "https://atlas-api.<your-subdomain>.workers.dev/sync?token=<SYNC_TOKEN>"
```

Custom domain: Cloudflare dashboard → your Worker → **Settings → Domains & Routes → Add**.

### Pointing at a different data branch

`wrangler.toml` sets `ORIGIN_BASE` to this repo's `data` branch. If you run your own
fork/build, change it to your own raw URL:

```
ORIGIN_BASE = "https://raw.githubusercontent.com/<you>/<repo>/data/output"
```

## Configuration reference

| Where | Key | Purpose |
|---|---|---|
| `wrangler.toml` `[vars]` | `ORIGIN_BASE` | Base URL of the `output/` folder to sync from. |
| `wrangler.toml` `[[d1_databases]]` | `database_id` | From `wrangler d1 create`. |
| `wrangler.toml` `[triggers]` | `crons` | Auto-sync schedule (default `45 */6 * * *`). |
| secret | `SYNC_TOKEN` | Required to call `POST /sync`. |

## Endpoints

Base = your Worker URL. All responses are JSON unless noted; all set permissive CORS.

| Method / path | Description |
|---|---|
| `GET /` | Lists all endpoints. |
| `GET /meta` | `generated_at`, `last_sync`, `row_count`. |
| `GET /stats` | Unique channel count + counts by provider and group type. |
| `GET /providers` | `[{ provider, n }]`. |
| `GET /countries` / `GET /categories` | Group list: `[{ code, name, channelCount }]`. |
| `GET /countries/:code/channels` | Channels in a country (paginated). |
| `GET /categories/:slug/channels` | Channels in a category (paginated). |
| `GET /countries/:code.m3u` / `GET /categories/:slug.m3u` | That group as a playable M3U. |
| `GET /channels` | Query across everything (see params below). |
| `GET /channels/:idOrNumber` | One channel + all its group memberships. |
| `GET /m3u` | Any `/channels` query rendered as an M3U. |
| `GET /random` | One random channel matching the filters. |
| `GET /epg/:id` | Full EPG for a channel + computed `now`/`next`. |
| `POST /sync?token=` | Refresh D1 from the origin. |

### Query parameters (`/channels`, `/m3u`, `/random`)

| Param | Example | Notes |
|---|---|---|
| `q` | `q=barça` | Case-insensitive substring match on name. |
| `provider` | `provider=lg` | `iptv-org`, `plutotv`, `tubi`, `roku`, `tcl`, `lg`, `rakuten`. |
| `type` | `type=category` | `country` or `category`. |
| `group` | `group=deportes` | Group code (country code or category slug). |
| `quality` | `quality=720p` | Exact match. |
| `sort` | `sort=number` | `name` (default) or `number`. |
| `page` / `limit` | `page=2&limit=50` | `limit` max 500 (10000 for `/m3u`). |

### Examples

```sh
# Search LG sports channels
curl "$API/channels?q=sport&provider=lg"

# All of the Deportes category as a playable playlist
curl "$API/categories/deportes.m3u"

# Any query as a playlist (English movies, sorted by number)
curl "$API/m3u?type=category&group=movies-eng&sort=number"

# One channel by its stable number, with its group memberships
curl "$API/channels/1000"

# What's on now / next for a channel
curl "$API/epg/FranceTV1.fr"
```

Example `GET /channels?q=espn&limit=1`:

```json
{
  "page": 1,
  "limit": 1,
  "total": 3,
  "channels": [
    {
      "id": "ESPNDeportes.us", "number": 100234, "name": "ESPN Deportes",
      "logo": "https://...", "url": "https://...", "quality": null, "provider": "plutotv",
      "group_type": "category", "group_code": "deportes", "group_name": "Deportes", "position": 41
    }
  ]
}
```

## Keeping D1 fresh

- **Automatic**: the cron trigger in `wrangler.toml` runs `POST /sync` internally on
  schedule. Default is 45 min past every 6th hour, matching the build cadence.
- **On demand / external scheduler**: `POST /sync?token=<SYNC_TOKEN>` from anywhere
  (a GitHub Action, another cron server, curl). Idempotent — it wipes and reloads the
  table from `db.json`.
- Check freshness anytime via `GET /meta`.

## Costs & limits

- **Workers/D1 free tier** covers typical read traffic (100k requests/day, 5M D1
  rows read/day).
- The **sync** parses a few MB of JSON and does a bulk insert (~thousands of rows). If
  the free plan's per-invocation CPU limit aborts it, upgrade to Workers Paid ($5/mo) —
  reads stay cheap; only the periodic sync is heavy.
- Inserts are chunked to 9 rows/statement (99 bound params, under D1's 100 limit) and
  batched, so a full reload is a handful of `batch()` calls.

## Troubleshooting

- `POST /sync` → `401`: `SYNC_TOKEN` not set, or wrong token.
- `/sync` → `origin db.json: 404`: `ORIGIN_BASE` wrong, or the build hasn't published
  `db.json` to that branch yet (run the build once).
- Queries return `total: 0`: D1 is empty — run `POST /sync` to seed it.
- Sync times out on free plan: enable Workers Paid, or run sync from an external
  scheduler where a longer wall-clock is fine.
