# proyecto-atlas

Índice curado de canales IPTV para la APK: streams en vivo y sin bloqueo de
[iptv-org](https://github.com/iptv-org/iptv) más canales FAST de Pluto TV (todas las
regiones), Tubi, TCL Channel y LG Channels de
[BuddyChewChew](https://github.com/BuddyChewChew), agrupados por continente → país, con
logos, EPG y un número de canal estable.

## Cómo funciona

- `scripts/build.js` obtiene `channels`, `streams`, `logos`, `regions`, `countries` y
  `blocklist` desde la API de iptv-org, descarta canales cerrados/DMCA/bloqueados por
  NSFW, y luego verifica que cada stream restante esté activo (petición GET con
  concurrencia limitada).
- `scripts/fastchannels.js` obtiene el M3U + EPG generado diariamente de Pluto TV para
  las 14 regiones (ar, br, ca, cl, de, dk, es, fr, gb, it, mx, no, se, us), el M3U + EPG
  de Tubi, los canales en español de Roku, y el M3U + EPG de TCL Channel y LG Channels
  (ambos EE. UU.), desde los repos
  [app-m3u-generator](https://github.com/BuddyChewChew/app-m3u-generator),
  [tubi-scraper](https://github.com/BuddyChewChew/tubi-scraper),
  [tcl-playlist-generator](https://github.com/BuddyChewChew/tcl-playlist-generator) y
  [lg-playlist-generator](https://github.com/BuddyChewChew/lg-playlist-generator) de
  BuddyChewChew, y verifica esos streams de la misma forma.
- Casi todo esto se combina en un árbol agrupado por continente (`regions.json`) y país,
  donde cada canal lleva su logo, EPG (si está disponible), y un índice numérico
  estable (ver Esquema de numeración más abajo). Las regiones de Latinoamérica/España de
  Pluto, los canales en español de Tubi/Roku/TCL/LG, y los géneros Movies/Sports en
  inglés de Pluto (gb/us), Roku, TCL y LG se enrutan en categorías en lugar de país - ver
  Categorías más abajo.
- Un cron de GitHub Actions (`.github/workflows/build.yml`, cada 6h) ejecuta el build y
  sube el resultado (en formato de archivos enlazados) a la rama `data` (ver Tamaño del
  repo más abajo).

## Consumiendo desde la APK

Esto es una API pequeña de archivos enlazados, no un solo JSON gigante - así la APK solo
carga en memoria la lista de países de un continente, o la lista de canales de un
país/categoría, en cada momento, en lugar de todo el dataset. Todo se sirve gratis vía
el CDN de jsDelivr (sin backend):

```
https://cdn.jsdelivr.net/gh/AbueloSimpson/proyecto-atlas@data/output/<path>
```

Empieza en `output/index.json`, que enlaza a todo lo demás:

```json
{
  "generated_at": "2026-06-23T00:00:00.000Z",
  "sources": ["..."],
  "continents": [
    { "code": "EMEA", "name": "Europe, the Middle East and Africa", "path": "continents/EMEA.json", "countryCount": 70 }
  ],
  "categories": [
    { "name": "Mexico", "path": "categories/mexico.json", "channelCount": 141 }
  ]
}
```

Nota: estos son los agrupamientos propios de `regions.json` de iptv-org, no continentes
estrictos - hay solapamiento (ej. EMEA junto con regiones más específicas como
CEE/CEU/Balkan/Benelux).

Obtén `continents/EMEA.json` para la lista de países de esa región (todavía solo
enlaces, sin canales):

```json
{
  "code": "EMEA",
  "name": "Europe, the Middle East and Africa",
  "countries": [
    { "code": "FR", "name": "France", "path": "countries/FR.json", "channelCount": 98 }
  ]
}
```

Obtén `countries/FR.json` (o `categories/mexico.json`) para la lista real de canales de
ese país/categoría - este es el único nivel que contiene los objetos de canal completos
(id, number, name, logo, url, categories, quality, provider, epg):

```json
{
  "code": "FR",
  "name": "France",
  "channels": [
    {
      "id": "FranceTV1.fr",
      "number": 1000,
      "name": "France TV 1",
      "logo": "https://...",
      "url": "https://...",
      "categories": ["general"],
      "quality": "720p",
      "provider": "iptv-org",
      "epg": []
    }
  ]
}
```

Las categorías funcionan igual, solo un nivel más superficial - `categories` en
`index.json` enlaza directo a `categories/<slug>.json` (ej.
`categories/argentina-paraguay.json`), sin archivo intermedio de continente.

Cada archivo es pequeño (a lo más unos cientos de KB incluso para países grandes), así
que no hay problema con el límite de 20MB ni necesidad de gzip como pasaría con un
archivo combinado. La caché de jsDelivr típicamente se actualiza dentro de ~12-24h tras
un push; usa la referencia de rama `@data` (no un commit fijo) si quieres que las
actualizaciones se reflejen automáticamente.

## Tamaño del repo

`master` solo contiene scripts/workflows/documentación - nunca crece por los datos
generados. El resultado generado (`output/index.json`, `output/continents/`,
`output/countries/`, `output/categories/`, más el archivo interno
`output/epg-iptvorg.json` y `registry/*.json`) vive en una rama separada `data` a la
que ambos workflows **suben con force-push un solo commit nuevo en cada corrida**, en
lugar de acumular historial. Cada corrida primero obtiene los archivos actuales de la
rama `data` (así el registro de numeración y los archivos que no se regeneran se
mantienen), y luego sobrescribe la rama con un commit nuevo con el estado más reciente.
No se necesita ninguna tarea de limpieza - no hay nada que limpiar, ya que el historial
de `data` nunca se acumula en primer lugar.

## EPG

Cada canal lleva un arreglo `epg`: próximos programas (`{ title, start, stop }`, con
timestamps ISO 8601 UTC), con un tope de 50 entradas futuras por canal. La APK puede
calcular "qué está pasando ahora" comparando `start`/`stop` contra la hora actual - sin
necesidad de backend en vivo. Las fuentes son:

- **Pluto TV / Tubi**: `i.mjh.nz` (XMLTV comprimido en gzip) y el `tubi_epg.xml` propio
  de Tubi, actualizado cada 6h junto con el build principal (ver arriba).
- **iptv-org**: no hay un EPG pre-armado para esta fuente - a diferencia del resto de
  sus datos, [iptv-org/epg](https://github.com/iptv-org/epg) es un conjunto de
  herramientas de scraping que se ejecuta uno mismo contra ~250 sitios de guías
  distintos. `.github/workflows/epg.yml` lo corre diariamente (`0 3 * * *`), limitado
  solo a los canales que realmente tenemos:
  1. `scripts/select-epg-channels.js` cruza el `guides.json` de la API de iptv-org
     (mapeo canal → sitio/site_id) contra los sitios que el scraper realmente soporta,
     produciendo un `channels.xml` curado (~11k canales, no los ~250 sitios a ciegas).
  2. El scraper (clonado de cero en cada corrida, no incluido en el repo) obtiene solo
     esos canales.
  3. `scripts/convert-epg-output.js` convierte su salida XMLTV al mismo formato JSON
     que Pluto/Tubi, escrito en `output/epg-iptvorg.json` - un archivo interno de
     traspaso, que no es parte de la API pública descrita arriba.
  4. `build.js` lee ese archivo (si existe) y le agrega el `epg` correspondiente a los
     canales que coincidan.

  Esto corre en su propio horario diario más lento, separado del cron de verificación
  de 6h, ya que es más pesado (clona + instala con npm un scraper de terceros) y
  algunos sitios de guías limitan o rechazan peticiones (esos canales simplemente
  quedan con `epg: []` ese día, sin que falle el build).

## Logos

Igual que los streams, cada URL de logo (`logo` en el objeto de canal) se verifica en
cada corrida (`scripts/lib/http.js`'s `isImageAlive` - petición HEAD, con GET como
respaldo si el host no soporta HEAD, confirmando un `200` y un `content-type` de
`image/*`). Si la URL del logo está caída (enlace roto, ruta de CDN renombrada, post de
imgur borrado, etc.), el campo `logo` queda en `null` en lugar de mostrar una imagen
rota en la APK. La mayoría de los logos de iptv-org son enlaces directos a imágenes
reales (principalmente PNG, algunos JPEG/SVG vía imgur, Wikimedia, CDNs de los propios
canales) - en una corrida típica, menos del 5% resultan caídos.

## Esquema de numeración

Cada canal recibe un número entero estable, ej. los canales de EE. UU. empiezan en
1000, el siguiente país recibe el próximo bloque libre de 100,000, etc.
(`registry/country-blocks.json` registra la base por país, `registry/numbers.json`
registra la asignación id → número). Los números son **de solo adición**: una vez
asignado, un id de canal mantiene su número entre corridas, incluso si
temporalmente sale de la lista de canales en vivo. Esto mantiene estables los
favoritos guardados / mapeos de EPG de la APK. El `id` del canal es la clave única
permanente - `Nombre.pais` para canales de iptv-org, `plutotv.<region>.<channelId>` o
`tubi.<channelId>` para las fuentes de canales FAST; `number` es solo un número
estable de visualización/sintonía superpuesto sobre eso.

## Categorías

Las regiones de Latinoamérica/España de Pluto (ar, br, cl, es, mx), los canales con
`group-title="Español"` de Tubi, los canales en español de Roku (detectados por
nombre), los grupos "En Español"/"Noticias" de TCL, los grupos "Spanish Language"/
"Latin" de LG, y los géneros Movies/Sports en inglés de Pluto (gb/us), Roku, TCL y LG
no se agrupan por país - se enrutan a la lista plana de `categories` en su lugar (ver
Consumiendo desde la APK). Por separado, los canales de Mexico/Chile/Peru/Argentina/Paraguay de iptv-org,
que están etiquetados genuinamente por país en la fuente, se **reflejan** también en la
categoría correspondiente, además de su página de país normal (mismo `id`/`number` en
ambos lugares). La lógica vive en `scripts/lib/spanish-categories.js`:

- `IPTVORG_CATEGORY_BY_COUNTRY` alimenta "Mexico" (MX), "Chile / Peru" (CL, PE), y
  "Argentina / Paraguay" (AR, PY) **solo desde iptv-org**, reflejado junto a la página
  normal `countries/<code>.json`. Las fuentes ar/cl/mx de Pluto **no** se usan aquí:
  esos tres catálogos se solapan en su mayoría entre sí (el mismo catálogo
  compartido de Latinoamérica, simplemente listado de nuevo por región) y no están
  confiablemente ligados a un país específico - hay que agregar un código de país a
  `IPTVORG_CATEGORY_BY_COUNTRY` (o tratar un canal de Pluto como caso especial)
  deliberadamente, nunca como valor predeterminado de una región completa.
- `br` y `es` son las únicas regiones de Pluto con una categoría predeterminada
  ("Brasil", "Europa") - sus catálogos son genuinamente exclusivos de la región
  (confirmado: sin solapamiento de id de canal con ninguna otra región). Todo lo demás
  de Pluto/Tubi/Roku que no tiene un valor predeterminado de región y no coincide con
  ningún género de abajo cae en "Especialidad" (no hay un bucket dedicado "EEUU" - ese
  nombre se leía como contenido general de EE. UU., pero todo lo que caía ahí era en
  español).
- Cuatro géneros en español se extraen **en todas las regiones/fuentes en español**, ya
  que tiene sentido navegarlos independientemente del país: Deportes, Peliculas,
  Noticias, Infantil. Hay dos excepciones, ambas porque el idioma real del canal no es
  español:
  - España (`es`): su grupo "Peliculas"/"Cine" se queda bajo "Europa" en su lugar, ya
    que España no es un país hispanohablante *latinoamericano* en el sentido del resto
    del bucket de Peliculas - todo lo demás de `es` (Deportes, Noticias, etc.) se sigue
    extrayendo normalmente.
  - Brasil (`br`): su grupo "Filmes" (en portugués) tampoco entra a Peliculas - tiene su
    propio bucket dedicado "Brasil Movies" en lugar de caer en el "Brasil" genérico.
- Las regiones `gb`/`us` de Pluto, Roku, TCL y LG no son parte del esquema de contenido
  en español, pero sus géneros `Movies` (o "TV & Movies" en LG) y `Sports` se extraen de
  la misma forma: Movies a una categoría aparte en inglés "Movies Eng" (separada de
  Peliculas, que es solo en español), Sports incorporado directamente al bucket
  existente de "Deportes". El grupo "Sports" de Roku en los datos de BuddyChewChew es
  poco confiable (mezcla canales que no son de deportes - dramas viejos, canales de
  películas, programas infantiles), así que solo para Roku (no para gb/us de Pluto, ni
  para TCL/LG, cuyo etiquetado es confiable) un canal solo entra a Deportes si su propio
  nombre también suena a una cadena/evento de deportes real (`ROKU_SPORTS_NAME_PATTERN`
  en `spanish-categories.js`). Todo lo demás de gb/us/TCL/LG (Comedy, News, Kids, etc.)
  se queda en su página normal `countries/GB.json` / `countries/US.json`.
- El grupo propio de `br` "TV Brasileira" (canal abierto/gratuito) tiene su propio
  bucket dedicado "Brasil TV Aberta".
- Categorías como "Bolivia / Venezuela", "Caribe", "Centro America", "Ecuador /
  Colombia", y "Chile Regionales" no se producen intencionalmente - no hay datos de
  origen (ni de iptv-org ni de Pluto/Tubi/Roku) confiablemente etiquetados para esos
  agrupamientos.

## Limitaciones conocidas

- **Geobloqueo**: la verificación de actividad solo se hace desde una sola región (el
  runner de GitHub Actions). Una respuesta 403/451 se trata como caído y se descarta,
  pero un stream que bloquea *otras* regiones mientras funciona bien desde el runner de
  GitHub no se detectará.
- **La cobertura de EPG de iptv-org es parcial**: solo los canales que el `guides.json`
  de iptv-org mapea a un sitio de guía soportado tienen uno (~11k de ~39k canales), y
  sitios individuales pueden fallar o limitar peticiones en un día dado.

## Ejecutando localmente

```
node scripts/build.js
```

Requiere Node 20+ (usa el `fetch` incorporado). No hay dependencias que instalar.
`output/` y `registry/` no están en git (ver Tamaño del repo) - ejecutar localmente
empieza con un registro vacío a menos que primero copies esos archivos desde la rama
`data` tú mismo.
