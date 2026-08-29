# eni — TAM E&I Navigator

Plataforma de comisionamiento eléctrico e instrumentación para Tendrara
Micro-LNG: consulta viva de activos, verificaciones, planos y GA sobre los
datos generales de TAM Training (proyecto Supabase `ymmmsovcjitlryuqwcrr`).

## Páginas vivas

| Página | Publicada en | Qué es |
|---|---|---|
| `index.html` | `/eni/index.html` | Navigator principal: FLOC, activos, verificaciones, CRs, documentos, lazos |
| `account.html` | `/eni/account.html` | Login del Navigator (email + PIN) |
| `plant.html` | `/eni/plant.html` | Plant Navigator: mapa de planta por área/tren |
| `online.html` | `/eni/online.html` | Planta en vivo: valores de proceso desde el historiador |
| `daily.html` | `/eni/daily.html` | Daily Report de comisionamiento E&I (`plant_verifications` vs `plant_io_list`) |
| `gasin.html` | `/eni/gasin.html` | Phase 0 / Gas In: avance PCS por área |
| `ga-elec.html` | `/eni/ga-elec.html` | GA eléctrico: mini-GA de área con overlay de posiciones |
| `sld_review.html` | `/eni/sld_review.html` | Render de revisión del single-line eléctrico |

Las 9 librerías `.js` de la raíz (`doc-manifest.js`, `tam-disc.js`,
`tam-flow.js`, `tam-loop.js`, `tam-sym.js`, `tam-sym-elec.js`,
`tam-sym-inst.js`, `tam-sym-net.js`, `tam-sym-proc.js`), los 5 `.png` de
previsualización y los 2 `.json` de single-line (`sld_edges.json`,
`sld_nodes.json`) son consumidos por una o más de esas 8 páginas.

## Cómo se publica

Por manifiesto, desde `sync.ps1` (raíz de `D:\Calude\TAM_Training`): el
bloque `# --- 0. ENI viewer` copia **todo fichero suelto en la raíz de
`eni/`** a `publish/eni/`, sin lista curada. Ver `eni/CLAUDE.md` §3 antes de
dejar nada nuevo en la raíz — se publica sin que nadie lo pida.

Las subcarpetas (`demo/`, `tools/`, `_attic/`, `docs/`, `supabase/`) **no**
se publican: `sync.ps1` sólo copia ficheros, no directorios.

## Cómo se abre en local

Las páginas son HTML estático con `supabase-js` por CDN; basta abrirlas con
un servidor de ficheros (`file://` no basta porque cargan `/supabase-config.js`
con ruta absoluta). Ejemplo desde la raíz de `TAM_Training`:

```
python -m http.server 8000
# http://localhost:8000/eni/index.html
```

`ga-elec.html` es la excepción: usa rutas relativas (`../supabase-config.js`,
`../images/ga/...`) porque en producción se sirve desde una subruta.

## Edge Functions

Viven en `eni/supabase/functions/`. El repo **no** es la fuente de verdad de
lo desplegado: antes de editar una función, saca su cuerpo vivo con
`get_edge_function` y compáralo con el fichero — si difieren, gana lo
desplegado hasta que se demuestre lo contrario. Detalle completo de las
cuatro funciones (dos familias de identidad distintas) en
`supabase/functions/README.md`.
