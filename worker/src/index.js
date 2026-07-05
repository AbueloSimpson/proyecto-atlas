// atlas-api: Cloudflare Worker + D1 query API over proyecto-atlas's data branch.
// D1 is refreshed from <ORIGIN_BASE>/db.json by the cron trigger in
// wrangler.toml, or on demand via POST /sync?token=<SYNC_TOKEN>.

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-sync-token",
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=300",
      ...CORS,
      ...extra,
    },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status, { "cache-control": "no-store" });
}

// ---------------------------------------------------------------- sync

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS channels (
    id TEXT NOT NULL, number INTEGER NOT NULL, name TEXT NOT NULL,
    logo TEXT, url TEXT NOT NULL, quality TEXT, provider TEXT NOT NULL,
    group_type TEXT NOT NULL, group_code TEXT NOT NULL, group_name TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (id, group_type, group_code)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_channels_group ON channels(group_type, group_code, position)`,
  `CREATE INDEX IF NOT EXISTS idx_channels_provider ON channels(provider)`,
  `CREATE INDEX IF NOT EXISTS idx_channels_number ON channels(number)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
];

const ROWS_PER_STMT = 9; // 9 rows x 11 cols = 99 bound params (D1 max 100)
const STMTS_PER_BATCH = 40;

async function doSync(env) {
  const res = await fetch(`${env.ORIGIN_BASE}/db.json`);
  if (!res.ok) throw new Error(`origin db.json: ${res.status}`);
  const { generated_at, channels } = await res.json();
  if (!Array.isArray(channels) || channels.length === 0) throw new Error("origin db.json is empty");

  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  await env.DB.prepare("DELETE FROM channels").run();

  const stmts = [];
  for (let i = 0; i < channels.length; i += ROWS_PER_STMT) {
    const chunk = channels.slice(i, i + ROWS_PER_STMT);
    const placeholders = chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",");
    stmts.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO channels
         (id, number, name, logo, url, quality, provider, group_type, group_code, group_name, position)
         VALUES ${placeholders}`
      ).bind(
        ...chunk.flatMap((c) => [
          c.id, c.number, c.name, c.logo ?? null, c.url, c.quality ?? null,
          c.provider, c.group_type, c.group_code, c.group_name, c.position,
        ])
      )
    );
  }
  for (let i = 0; i < stmts.length; i += STMTS_PER_BATCH) {
    await env.DB.batch(stmts.slice(i, i + STMTS_PER_BATCH));
  }

  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('generated_at', ?)").bind(generated_at),
    env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync', ?)").bind(new Date().toISOString()),
    env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('row_count', ?)").bind(String(channels.length)),
  ]);
  return channels.length;
}

async function handleSync(url, request, env) {
  const token = url.searchParams.get("token") || request.headers.get("x-sync-token");
  if (!env.SYNC_TOKEN || token !== env.SYNC_TOKEN) return err("unauthorized", 401);
  const synced = await doSync(env);
  return json({ synced }, 200, { "cache-control": "no-store" });
}

// ---------------------------------------------------------------- queries

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function buildFilters(params, forced = {}) {
  const where = [];
  const args = [];
  const q = params.get("q");
  if (q) {
    where.push("name LIKE ? COLLATE NOCASE");
    args.push(`%${q}%`);
  }
  const provider = params.get("provider");
  if (provider) {
    where.push("provider = ?");
    args.push(provider.toLowerCase());
  }
  const quality = params.get("quality");
  if (quality) {
    where.push("quality = ?");
    args.push(quality);
  }
  const type = forced.type || params.get("type");
  if (type) {
    if (type !== "country" && type !== "category") throw new Error("type must be country|category");
    where.push("group_type = ?");
    args.push(type);
  }
  const group = forced.group || params.get("group");
  if (group) {
    where.push("group_code = ?");
    args.push(group);
  }
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", args };
}

async function listChannels(env, params, forced = {}, maxLimit = 500, defaultLimit = 100) {
  const { whereSql, args } = buildFilters(params, forced);
  const sort = params.get("sort");
  let orderSql = forced.group ? "ORDER BY position" : "ORDER BY name COLLATE NOCASE";
  if (sort === "name") orderSql = "ORDER BY name COLLATE NOCASE";
  else if (sort === "number") orderSql = "ORDER BY number";

  const limit = clamp(parseInt(params.get("limit"), 10) || defaultLimit, 1, maxLimit);
  const page = Math.max(parseInt(params.get("page"), 10) || 1, 1);
  const offset = (page - 1) * limit;

  const total = (await env.DB.prepare(`SELECT COUNT(*) n FROM channels ${whereSql}`).bind(...args).first()).n;
  const { results } = await env.DB.prepare(`SELECT * FROM channels ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
    .bind(...args, limit, offset)
    .all();
  return { page, limit, total, channels: results };
}

function toM3U(rows) {
  const lines = ["#EXTM3U"];
  for (const c of rows) {
    const attrs = [
      `tvg-id="${c.id}"`,
      `tvg-chno="${c.number}"`,
      c.logo ? `tvg-logo="${c.logo}"` : null,
      `group-title="${(c.group_name || "").replace(/"/g, "'")}"`,
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(`#EXTINF:-1 ${attrs},${c.name}`);
    lines.push(c.url);
  }
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "content-type": "audio/x-mpegurl",
      "cache-control": "public, max-age=300",
      ...CORS,
    },
  });
}

async function listGroups(env, type) {
  const { results } = await env.DB.prepare(
    `SELECT group_code code, group_name name, COUNT(*) channelCount
     FROM channels WHERE group_type = ? GROUP BY group_code, group_name ORDER BY group_name`
  )
    .bind(type)
    .all();
  return json(results);
}

async function channelDetail(env, key) {
  const asNumber = /^\d+$/.test(key) ? parseInt(key, 10) : -1;
  const { results } = await env.DB.prepare("SELECT * FROM channels WHERE id = ? OR number = ?")
    .bind(key, asNumber)
    .all();
  if (results.length === 0) return err("channel not found", 404);
  const { id, number, name, logo, url, quality, provider } = results[0];
  return json({
    id, number, name, logo, url, quality, provider,
    groups: results.map((r) => ({ type: r.group_type, code: r.group_code, name: r.group_name })),
  });
}

async function handleEpg(env, id) {
  const row = await env.DB.prepare(
    "SELECT * FROM channels WHERE id = ? ORDER BY CASE group_type WHEN 'category' THEN 0 ELSE 1 END LIMIT 1"
  )
    .bind(id)
    .first();
  if (!row) return err("channel not found", 404);

  const filePath =
    row.group_type === "category" ? `categories/${row.group_code}.json` : `countries/${row.group_code}.json`;
  const res = await fetch(`${env.ORIGIN_BASE}/${filePath}`, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) return err(`origin: ${res.status}`, 502);
  const data = await res.json();
  const ch = (data.channels || []).find((c) => c.id === id);
  const epg = (ch && ch.epg) || [];

  const nowMs = Date.now();
  const current = epg.find((p) => new Date(p.start).getTime() <= nowMs && nowMs < new Date(p.stop).getTime()) || null;
  const next = epg.find((p) => new Date(p.start).getTime() > nowMs) || null;
  return json({ id, name: row.name, now: current, next, epg });
}

async function handleStats(env) {
  const providers = (
    await env.DB.prepare("SELECT provider, COUNT(*) n FROM channels GROUP BY provider ORDER BY n DESC").all()
  ).results;
  const groups = (
    await env.DB.prepare("SELECT group_type, COUNT(DISTINCT group_code) n FROM channels GROUP BY group_type").all()
  ).results;
  const uniqueChannels = (await env.DB.prepare("SELECT COUNT(DISTINCT id) n FROM channels").first()).n;
  return json({ uniqueChannels, providers, groups });
}

async function handleMeta(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM meta").all();
  return json(Object.fromEntries(results.map((r) => [r.key, r.value])), 200, { "cache-control": "no-store" });
}

function apiIndex() {
  return json({
    endpoints: [
      "GET /meta",
      "GET /stats",
      "GET /providers",
      "GET /countries | /categories",
      "GET /countries/:code/channels | /categories/:slug/channels",
      "GET /countries/:code.m3u | /categories/:slug.m3u",
      "GET /channels?q=&provider=&type=&group=&quality=&sort=name|number&page=&limit=",
      "GET /channels/:idOrNumber",
      "GET /m3u?<same filters as /channels>",
      "GET /random?<same filters as /channels>",
      "GET /epg/:id",
      "POST /sync?token=",
    ],
  });
}

// ---------------------------------------------------------------- router

async function route(url, env) {
  const parts = url.pathname.split("/").filter(Boolean);
  const params = url.searchParams;

  if (parts.length === 0) return apiIndex();

  if (parts[0] === "meta") return handleMeta(env);
  if (parts[0] === "stats") return handleStats(env);
  if (parts[0] === "providers") {
    const { results } = await env.DB.prepare(
      "SELECT provider, COUNT(*) n FROM channels GROUP BY provider ORDER BY n DESC"
    ).all();
    return json(results);
  }

  for (const [route, type] of [
    ["countries", "country"],
    ["categories", "category"],
  ]) {
    if (parts[0] !== route) continue;
    if (parts.length === 1) return listGroups(env, type);
    if (parts.length === 2 && parts[1].endsWith(".m3u")) {
      const code = decodeURIComponent(parts[1].slice(0, -4));
      const { channels } = await listChannels(env, params, { type, group: code }, 10000, 10000);
      return toM3U(channels);
    }
    if (parts.length === 3 && parts[2] === "channels") {
      const code = decodeURIComponent(parts[1]);
      return json(await listChannels(env, params, { type, group: code }));
    }
    return err("not found", 404);
  }

  if (parts[0] === "channels") {
    if (parts.length === 1) return json(await listChannels(env, params));
    return channelDetail(env, decodeURIComponent(parts.slice(1).join("/")));
  }

  if (parts[0] === "m3u" && parts.length === 1) {
    const { channels } = await listChannels(env, params, {}, 10000, 5000);
    return toM3U(channels);
  }

  if (parts[0] === "random" && parts.length === 1) {
    const { whereSql, args } = buildFilters(params);
    const row = await env.DB.prepare(`SELECT * FROM channels ${whereSql} ORDER BY RANDOM() LIMIT 1`)
      .bind(...args)
      .first();
    if (!row) return err("no channels match", 404);
    return json(row, 200, { "cache-control": "no-store" });
  }

  if (parts[0] === "epg" && parts.length >= 2) {
    return handleEpg(env, decodeURIComponent(parts.slice(1).join("/")));
  }

  return err("not found", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      if (request.method === "POST" && url.pathname === "/sync") return await handleSync(url, request, env);
      if (request.method !== "GET") return err("method not allowed", 405);
      return await route(url, env);
    } catch (e) {
      return err(e.message || String(e), 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(doSync(env));
  },
};
