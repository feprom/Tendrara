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

**Freno de intentos y cómo desbloquear a alguien.** Desde el 2026-08-29
`eni-auth` frena **5 fallos por email en 15 minutos** (`eni_throttle_ok` /
`eni_note_attempt`). La llave es el **email, no la IP**, a propósito:
Tendrara sale a internet por una única IP pública y un cubo por IP dejaría
fuera a la planta entera de golpe — ya pasó el 2026-08-29 con `eni-invite`,
por eso allí el cubo por IP está en 40 y no en 5.

El precio de frenar por email es que **cualquiera puede dejar fuera a una
cuenta concreta durante 15 minutos** mandando 5 peticiones con su email.
Se acepta a sabiendas: es preferible a tumbar a los cuatro a la vez. Un
acierto borra los fallos previos de esa clave (migración `326`), así que
equivocarse cuatro veces y luego entrar bien **no** deja el contador
cargado. Pero el freno se comprueba **antes** que el PIN: una vez
congelada, la cuenta no se descongela tecleando el PIN bueno.

**El reinicio al acertar vale para una identidad, no para una IP**
(migración `328`). `eni_note_attempt` la comparten `eni-auth` y
`eni-invite`, y limpia los fallos previos cuando la clave identifica a
**alguien** — un email, o el `invite:<hash>` de un token, donde acertar
demuestra que quien está detrás es legítimo. En el cubo por IP de
`eni-invite` (`invite-ip:<ip>`, umbral 40) **no** se limpia nunca: una IP
no es una persona, en Tendrara la comparte toda la planta, y el acierto de
uno no dice nada de los demás. Sin esa excepción, cualquiera con una
invitación válida sin canjear podía dejar el freno anti-ariete a cero
indefinidamente repitiendo `peek`. El intento se sigue **registrando** en
todas las claves; lo que no se hace es borrar.

Para desbloquear a alguien en el acto, sin esperar los 15 minutos:

```sql
delete from public.eni_login_attempts where key = '<email en minúsculas>';
```

Cuándo se usa: alguien de los cuatro llama diciendo que le sale
«*Too many attempts*» y no puede esperar. Se borra su clave y **sólo la
suya** — nunca `delete` sin `where`, que eso vacía también los cubos de
`eni-invite`. Si el bloqueo se repite sin que la persona se esté
equivocando, alguien está sondeando ese email: mirar
`select at, ok from public.eni_login_attempts where key = '<email>' order by at desc;`
antes de borrar.

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
- **Freno de `eni-auth`, cuatro flecos** (ronda de corrección 1 de la
  Tarea 10, 2026-08-29). Ninguno es explotable hoy; se dejan escritos para
  no volver a descubrirlos:
  1. `eni-auth` no valida longitud de `email` ni de `pin` antes de
     hashear. Un cuerpo enorme se hashea igualmente.
  2. `eni_login_attempts` no se purga: crece sin límite. Falta un
     `pg_cron` que borre lo anterior a 24 h.
  3. La clave del freno de login es el email pelado, sin prefijo. Los
     cubos de `eni-invite` sí van prefijados (`invite:`, `invite-ip:`).
     Un `login:` delante evitaría cualquier colisión futura entre
     espacios de nombres en la misma tabla — y ahora importa más: desde
     la `328` el comportamiento de `eni_note_attempt` **depende del
     prefijo**, así que un espacio de nombres sin prefijo es una trampa
     para el próximo que añada un cubo.
  4. El `decoy` que iguala tiempos sólo corre cuando **no hay fila**. Una
     cuenta existente pero `active=false` se salta tanto el decoy como la
     comparación, así que responde algo antes: filtra que la cuenta
     existe pero está desactivada. Hoy no hay ninguna inactiva.
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
