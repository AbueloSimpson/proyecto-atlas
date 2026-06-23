// Maps Pluto TV (ar/br/cl/es/mx) + Tubi/Roku Spanish-language channels into
// Spanish-language category buckets, replacing their normal country grouping.
// Each region defaults into its own country/regional bucket; only a handful
// of universal genres (Deportes, Peliculas, Noticias, Infantil) get pulled
// out across all regions, since those are the ones that make sense to browse
// independent of country. Everything else (Entretenimiento, Novelas, Series,
// Música, etc.) stays under the country bucket.

// Region's default bucket when no priority genre matches.
export const REGION_DEFAULT_CATEGORY = {
  ar: "Argentina / Paraguay",
  br: "Brasil",
  cl: "Chile / Peru",
  es: "Europa",
  mx: "Mexico",
  tubi: "EEUU",
  roku: "EEUU",
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
