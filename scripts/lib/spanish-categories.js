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
    if (!texts.some((t) => pattern.test(t))) continue;
    // Spain's movies aren't from a Spanish-speaking *country* in the same sense
    // as the rest of Peliculas - keep them with the rest of Spain's content
    // instead, falling through to the "es" region default (Europa).
    if (category === "Peliculas" && regionKey === "es") continue;
    // br's "Filmes" channels are Portuguese, not Spanish - they shouldn't land
    // in the Spanish-language Peliculas bucket either. Give them their own
    // dedicated bucket instead of just falling back to the generic "Brasil".
    if (category === "Peliculas" && regionKey === "br") return "Brasil Movies";
    return category;
  }

  return REGION_DEFAULT_CATEGORY[regionKey] || "Especialidad";
}

export function isSpanishLanguageName(name) {
  return /español|espanol|\bspanish\b|latino/i.test(name);
}

// Pluto's English-language regions (gb, us), Roku, and TCL Channel aren't part
// of the Spanish-content scheme at all, except for these two genres pulled out
// the same way: English movies get their own "Movies Eng" bucket (kept
// separate from Peliculas, which is Spanish-language films only), while
// English sports gets folded directly into the existing "Deportes" bucket
// rather than a separate English one.
const ENGLISH_CATEGORY_REGIONS = new Set(["gb", "us", "roku", "tcl"]);

const ENGLISH_GENRES = [
  // /movies/ (not anchored) also catches LG's "TV & Movies" group.
  { category: "Movies Eng", pattern: /movies/i },
  { category: "Deportes", pattern: /^sports$/i },
];

// Roku's "Sports" group-title is an unreliable catch-all in BuddyChewChew's
// data - it lumps in plenty of non-sports channels (old TV dramas, movie
// channels, kids shows). Pluto's gb/us "Sports" group doesn't have this
// problem, so this only gates Roku: a channel only counts as Deportes if its
// own name also looks like a genuine sports network/event.
const ROKU_SPORTS_NAME_PATTERN =
  /sports?|deportes|\bnba\b|\bnfl\b|\bmlb\b|\bnhl\b|espn|golf|tennis|nascar|\bufc\b|\bmma\b|wrestling|boxing|racing|nhra|bassmaster|olympic|\bliga\b|\bcup\b|fight|combat|billiard|gladiators|fishing|hunting|x games|red bull/i;

export function resolveEnglishCategory(groupTitle, regionKey, name = "") {
  if (!ENGLISH_CATEGORY_REGIONS.has(regionKey)) return null;
  const text = (groupTitle || "").trim();
  for (const { category, pattern } of ENGLISH_GENRES) {
    if (!pattern.test(text)) continue;
    if (category === "Deportes" && regionKey === "roku" && !ROKU_SPORTS_NAME_PATTERN.test(name)) {
      return null;
    }
    return category;
  }
  return null;
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
