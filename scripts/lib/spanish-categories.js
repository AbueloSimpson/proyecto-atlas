// Maps Pluto TV (ar/br/cl/es/mx) + Tubi/Roku Spanish-language channels into
// Spanish-language category buckets, replacing their normal country grouping.
// Only a handful of universal genres (Deportes, Peliculas, Noticias, Infantil)
// get pulled out across all regions, since those are the ones that make sense
// to browse independent of country - everything else falls to the region's
// default bucket below, or "Especialidad" if it has none.

// Region's default bucket when no priority genre matches. Only br/es get one:
// their Pluto catalogs are genuinely region-exclusive (confirmed no channel-id
// overlap with the other regions). ar/cl/mx's catalogs mostly overlap with each
// other (the same shared Latin America catalog, just relisted per region) and
// aren't reliably tied to one specific country, so they're deliberately left
// out here - "Mexico" / "Chile / Peru" / "Argentina / Paraguay" are reserved
// for genuinely country-tagged iptv-org channels instead (see
// IPTVORG_CATEGORY_BY_COUNTRY in build.js). Tubi/Roku have no country signal
// at all, so they were never given a default either.
export const REGION_DEFAULT_CATEGORY = {
  br: "Brasil",
  es: "Europa",
};

// Checked in order against group-title (Pluto/Roku) and channel name (Tubi,
// where the group-title is just a generic "Español" tag with no genre signal).
const PRIORITY_GENRES = [
  { category: "Deportes", pattern: /deportes|esportes|sports|f[uú]tbol/i },
  { category: "Peliculas", pattern: /pel[ií]culas|filmes|\bcine\b|movie/i },
  { category: "Noticias", pattern: /noticias|not[ií]cias|\bnews\b/i },
  { category: "Infantil", pattern: /infantil|\bkids\b|nickelodeon/i },
];

// br's "free-to-air Brazilian TV" group gets its own dedicated bucket.
const BR_FREE_TV_GROUP = "tv brasileira";

export function resolveSpanishCategory(signals, regionKey) {
  const texts = (Array.isArray(signals) ? signals : [signals]).filter(Boolean);

  if (regionKey === "br" && texts.some((t) => t.trim().toLowerCase() === BR_FREE_TV_GROUP)) {
    return "Brasil TV Aberta";
  }

  for (const { category, pattern } of PRIORITY_GENRES) {
    if (texts.some((t) => pattern.test(t))) return category;
  }

  return REGION_DEFAULT_CATEGORY[regionKey] || "Especialidad";
}

export function isSpanishLanguageName(name) {
  return /español|espanol|\bspanish\b|latino/i.test(name);
}

// iptv-org channels are genuinely country-tagged at the source, so the
// "Mexico" / "Chile / Peru" / "Argentina / Paraguay" category buckets are fed
// from there (in addition to those channels' normal country page) rather than
// from Pluto's shared LatAm catalog. Add a country code here only as a
// deliberate special case, not as a default for an entire provider/region.
export const IPTVORG_CATEGORY_BY_COUNTRY = {
  MX: "Mexico",
  CL: "Chile / Peru",
  PE: "Chile / Peru",
  AR: "Argentina / Paraguay",
  PY: "Argentina / Paraguay",
};
