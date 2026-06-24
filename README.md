# proyecto-atlas

Índice de canales IPTV para la APK: streams en vivo de [iptv-org](https://github.com/iptv-org/iptv)
más canales FAST de Pluto TV, Tubi, Roku, TCL Channel, LG Channels y un subconjunto de
Rakuten TV España. Cada canal lleva logo, EPG y un número de canal estable, agrupado por
país o por categoría.

## Qué hace

- Cada 6 horas, un cron de GitHub Actions descarga todas las fuentes, descarta los
  canales que no están en vivo en ese momento, y publica el resultado.
- Los canales en español de Pluto/Tubi/Roku/TCL/LG/Rakuten (y los géneros de
  Películas/Deportes en general) se agrupan por categoría en lugar de por país - ver
  más abajo.
- Cada canal recibe un número fijo que nunca cambia, aunque deje de estar disponible
  temporalmente.
- Los logos también se verifican en cada corrida; si un logo está roto, se omite en
  lugar de mostrar una imagen rota.

## Cómo consumir los datos

Todo se sirve gratis desde la rama `data` vía el CDN de jsDelivr (sin backend, sin
API key):

```
https://cdn.jsdelivr.net/gh/AbueloSimpson/proyecto-atlas@data/output/<path>
```

Empieza en `output/index.json`, que enlaza a todo lo demás:

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

Desde ahí, sigue los `path` hasta llegar a la lista de canales:

```
index.json → continents/<code>.json → countries/<code>.json   (canales aquí)
index.json → categories/<slug>.json                            (canales aquí)
```

Cada canal se ve así:

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

- `id` y `number` son permanentes - seguros para usar como clave de favoritos.
- `epg` trae hasta 50 programas futuros (cuando hay datos disponibles); compara
  `start`/`stop` con la hora actual para saber qué está pasando ahora.
- Cada archivo es pequeño (unos cientos de KB como mucho), así que la APK solo carga
  en memoria lo que necesita en cada momento, no todo el catálogo de una vez.

Más detalle de la API y el roadmap del proyecto están en la
[wiki](https://github.com/AbueloSimpson/proyecto-atlas/wiki).

## Categorías

Los canales en español de las fuentes FAST (no de iptv-org) se agrupan por categoría en
lugar de por país: Mexico, Argentina / Paraguay, Chile / Peru, Brasil, Europa, más
géneros transversales (Deportes, Peliculas, Noticias, Infantil) y un "Especialidad" para
lo que no encaja en ninguno. Los canales en inglés de Movies/Sports de esas mismas
fuentes también tienen su propia categoría ("Movies Eng" y "Deportes"). El detalle
completo de estas reglas está documentado en los comentarios de
`scripts/lib/spanish-categories.js`.

## Limitaciones conocidas

- La verificación de actividad solo se hace desde la región del runner de GitHub
  Actions - un canal bloqueado en otras regiones puede no detectarse.
- El EPG de iptv-org es parcial (no todos los canales tienen guía disponible).
- Rakuten TV España: las URLs de stream vienen de una lista de la comunidad
  (`coderfast/IPTV`) que no se actualiza tan seguido como las demás fuentes, así que
  algunos canales pueden estar caídos o ya no existir en el catálogo actual de Rakuten -
  solo se incluyen los que pasan la verificación de actividad en cada corrida. El EPG
  (cuando está disponible) sí viene fresco de la API pública de Rakuten en cada corrida.

## Ejecutar localmente

```
node scripts/build.js
```

Requiere Node 20+. No hay dependencias que instalar.
