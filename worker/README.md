# atlas-api (Cloudflare Worker + D1)

Query API over the `data` branch. D1 holds a flat copy of every channel, re-synced from
`output/db.json` by cron (45 min past each build) or on demand.

## Deploy

```
npm i -g wrangler
wrangler login
wrangler d1 create atlas          # paste database_id into wrangler.toml
wrangler secret put SYNC_TOKEN
wrangler deploy
curl -X POST "https://<worker-url>/sync?token=<SYNC_TOKEN>"   # seed
```

Custom domain: Cloudflare dashboard → Worker → Settings → Domains & Routes.

Note: the sync parses a few MB of JSON - if the free plan's CPU limit kills it,
Workers Paid ($5/mo) covers it.

## Endpoints

- `GET /` - endpoint list
- `GET /meta` - generated_at, last_sync, row_count
- `GET /stats`, `GET /providers`
- `GET /countries`, `GET /categories` - group lists with counts
- `GET /countries/:code/channels`, `GET /categories/:slug/channels`
- `GET /countries/:code.m3u`, `GET /categories/:slug.m3u`
- `GET /channels?q=&provider=&type=&group=&quality=&sort=name|number&page=&limit=`
- `GET /channels/:idOrNumber` - single channel + its group memberships
- `GET /m3u?<same filters as /channels>` - any query as a playable M3U
- `GET /random?<same filters>`
- `GET /epg/:id` - full EPG + computed now/next
- `POST /sync?token=` - manual D1 refresh
