# CLAUDE.md — eni

Reglas de la casa para cualquier sesión que trabaje sobre `D:\Calude\TAM_Training\eni`.
Léelas antes de tocar nada.

## 1. Qué es esto

Un subproyecto con **git propio** dentro de `D:\Calude\TAM_Training`
(`eni/.git`, separado del `.git` de `publish/` y de la ausencia de git en la
raíz de `TAM_Training`). Consume los datos generales de TAM Training —
mismo proyecto Supabase, mismas imágenes de marca en `/images/`— pero se
gobierna solo: su propia historia, sus propias reglas, su propio contrato.
No es un módulo de formación; es la plataforma de comisionamiento E&I de
Tendrara Micro-LNG.

## 2. Antes de tocar nada

Este repo **tiene historia**: `git log` antes de asumir que algo no se ha
intentado ya. Se commitea — nunca más `index.html.bak11` ni un `.diff` a
mano; si necesitas un punto de retorno, es un commit. `.bak*` y `.diff` están
en `.gitignore` porque la historia de mano que sustituyen sigue en
`_attic/`, fuera del árbol versionado.

## 3. Publicación — el manifiesto no despublica

`sync.ps1` (en la raíz de `TAM_Training`) copia **todo fichero suelto que
haya en la raíz de `eni/`** a `publish/eni/`, sin lista curada — ver
`sync.ps1:22-37`. Es una mejora deliberada sobre la lista de 10 ficheros a
mano que existía antes: ya no se puede olvidar publicar un fichero nuevo.

Pero el manifiesto **sólo copia, nunca borra**. Un fichero que quites de la
raíz de la fuente **sigue servido** en `publish/eni/` hasta que alguien lo
borre allí a mano. Prueba viva de esto: `publish/eni/index=A.html`, un
fichero que **nunca existió** en la fuente y que ninguna sincronización va a
retirar sola. Antes de dar una limpieza de raíz por terminada, comprueba
`publish/eni/` — no basta con que la fuente esté limpia.

**Cualquier fichero que dejes en la raíz de `eni/` se publica**, lo quieras
o no: un borrador, una prueba, un `.html` de trabajo. Los borradores van a
`docs/` o a `_attic/`, nunca a la raíz. Las subcarpetas (`demo/`, `tools/`,
`_attic/`, `docs/`, `supabase/`, `.git/`) están excluidas explícitamente en
`sync.ps1` y no se publican.

## 4. Edge Functions

El repo (`eni/supabase/functions/`) **no** es la fuente de verdad de lo
desplegado — es un rescate del cuerpo vivo del 2026-08-29. Antes de editar
cualquier función, saca su cuerpo real con `get_edge_function` y compáralo
con el fichero; si difieren, alguien desplegó sin pasar por el repo y lo
desplegado gana hasta que se demuestre lo contrario.

Las cuatro funciones son **dos familias de identidad distintas**, no una:
`eni-auth` y `doc-url` son el login del Navigator (tabla `eni_users`, PIN
`sha256(email:pin)`, JWT propio de 30 días); `set-pin` y `first-time-pin`
pertenecen al sistema de formación (códigos TND, Supabase Auth con emails
sintéticos) y están en este repositorio sólo porque no tenían copia en
ningún otro sitio. Detalle completo, no lo repitas aquí:
`supabase/functions/README.md`.

## 5. Regla G-1 y su excepción

**G-1: cada disciplina tiene su contenedor bajo `eni/`, nada nuevo dentro de
`index.html`.** `index.html` ya son 6.064 líneas / 430 KB y es la zona de
colisión entre agentes (ver backlog, E3); crecerlo por dentro agrava
exactamente el problema que E3 existe para resolver.

**Excepción ratificada por Mario Mendizábal, 2026-08-29:** la vista
**EI95 · People** (panel de invitaciones y cuentas, sólo ADMIN) vive dentro
de `index.html`, no en un `people.html` propio. Es una excepción puntual a
G-1, no una derogación de la regla — la razón de fondo (nada nuevo en
`index.html`) sigue vigente para todo lo demás.

## 6. Mapa de superficies

- **8 páginas vivas** en la raíz — ver `README.md`.
- **9 librerías `tam-*.js` + `doc-manifest.js`** en la raíz, consumidas por
  las páginas vivas.
- `eni/demo/` — 9 `*-demo.html`, hojas de aprobación de packs, nunca
  publicadas.
- `eni/tools/` — utilería de generación/verificación (`gen_sld_review.js`,
  `check_sld_layout.js`), no publicada.
- `eni/docs/` — handoffs, specs, planes; no publicada.
- `eni/supabase/functions/` — rescate de las 4 Edge Functions; no publicada
  como tal (se despliega aparte).
- **`eni/controlPlantView/`** (`demo.html`, `snapshot.js`,
  `tam-flow-net.js`) — material de demo del pack de RED, **nunca estuvo
  publicado**. Sólo lo menciona `demo/tam-sym-net-demo.html` dentro de una
  etiqueta `<code>` (no es un enlace vivo). Se anota aquí para que nadie lo
  redescubra por sorpresa creyendo que es huérfano.

## 7. Verificación antes de publicar

1. Abrir cada página tocada en Chrome — **consola limpia**, sin errores rojos.
2. `diff` de la fuente contra `publish/eni/` antes de sincronizar — el
   manifiesto no avisa de lo que sobra (§3).
3. Si hay otros agentes escribiendo en `eni/` a la vez: `git status` en
   `publish/` antes de publicar, y commit **acotado** a lo tuyo — ver §8,
   riesgo de `sync.ps1`.

## 8. Cuentas y acceso

Sólo por invitación (E2). `eni_users` **no se escribe desde el navegador**:
no hay `INSERT` de `anon`/`authenticated` sobre esa tabla. El PIN se
hashea `sha256(email:pin)` — sin sal, ver backlog. La sesión es un JWT
propio de `eni-auth` (HS256, 30 días), no Supabase Auth.

## 9. Backlog (fuera de alcance de este ciclo, con su motivo)

- **E3** — partir `index.html` (6.064 líneas) en vistas por disciplina, sin
  build. Motivo: es la zona de colisión entre agentes; el manifiesto de
  publicación (§3) ya no lo permite crecer sin control, pero el fichero en
  sí sigue siendo el cuello de botella.
- **E4** — gate automático de render: Chrome headless, consola limpia,
  enlaces vivos, antes de cada publicación. Motivo: hoy la verificación de
  §7 es manual y depende de que alguien se acuerde.
- `SELECT` de `anon` sobre los emails de `eni_users`. Se mantiene a
  propósito porque la atribución de verificaciones y CRs lo usa; no se
  cierra sin dar otra vía a esa atribución primero.
- Hash de PIN sin sal (4-8 dígitos, `sha256(email:pin)`). Cambiarlo es una
  migración de credenciales de las 4 cuentas vivas, no una obra de este
  ciclo.
- Envío automático del link de invitación por correo. El gancho queda en
  el diseño de E2; el proveedor de correo (dominio verificado, rebotes) no
  se monta para el volumen actual — se copia y pega por Teams/WhatsApp.
- **Riesgo conocido y aparcado, con motivo:** `sync.ps1` publica haciendo
  `git add -A` dentro de `publish/`, que es un **repositorio compartido**
  con los módulos de formación. El 2026-08-29 esto arrastró al sitio vivo
  un fichero de otra sesión que no tenía nada que ver con `eni`. Arreglarlo
  de raíz toca la lógica que publica también los módulos de formación, así
  que es un CR propio, no parte de este ciclo. Mientras tanto: `git status`
  en `publish/` antes de publicar (§7), y commit acotado a lo que
  corresponde a esta sesión.
