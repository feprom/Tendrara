/* ═══════════════════════════════════════════════════════════════════════════
   tam-sym-net.js — NETWORK symbol pack  ·  v0.3.0
   ─────────────────────────────────────────────────────────────────────────

   v0.3.0 — 2026-08-11 · TRES SÍMBOLOS DEL CENSO NUEVO, la regla N-15 y la
     bandera `undoc` (CONTROL_PLANTVIEW_PLAN.md §5 / C2, cierra H-4)

     El censo del 2026-08-11 sobre plant_network (116 filas, 12 node_kind) trae
     tres valores que el pack no sabía dibujar, y ninguno se inventó:

       NET_METER   `meter` ×9 — SENTRON PAC3200 en los cuadros 480, Modbus TCP.
                   Estaba anotado como H-10 desde la verificación de topología.
       NET_VFD     `vfd` ×3 — variadores que aparecieron como vecinos LLDP el
                   2026-08-11 y NO están en ningún documento. Existen y no
                   están documentados: exactamente lo que la pantalla de
                   control tiene que enseñar, no esconder.
       NET_SERVER  `server` ×2 — la estación recolectora tiene destino: el
                   historiador en la nube (MOTHERDUCK-TIA_HIST) y el nodo de
                   flota (CTRL-NODE). `cloud` es bandera (G-5).

     La bandera `undoc` (en shell(), para todos los símbolos de caja) corta la
     esquina superior derecha en ámbar: «existe y no está documentado» — el
     estado del plan de ControlPlantView §3.3. Es bandera, no símbolo, y no
     gasta el canal color del estado.

     N-15: el estado del nodo se pinta con la rejilla NE 107 más BLANCO = sin
     información. Sin comunicación ≠ caído ≠ no sondeado ≠ cero.

     MEDIA_DEFAULT gana MODBUS_TCP (los 5 cromatógrafos y los 9 PAC3200 lo
     son; la clasificación RTU de 2026-08-05 estaba mal — ver
     NETWORK_TOPOLOGY_VERIFICATION.md §0). setMedia() acepta ahora
     `display_name`, `layer` e `ip_routable` de plant_network_media, que ya
     existe: GAP-2 está cerrado y esta tabla queda como defecto offline.
     Todo aditivo: los 18 símbolos y las 14 reglas de v0.2.2 no cambian.

   v0.2.2 — 2026-08-07 · UN SÍMBOLO: NET_CONNECTOR, y la regla N-14
     Corrección de obra sobre la hoja de opciones de Tendrara: **cada punto de
     conexión al bus es un conector Sub-D 9 que hay que comprar**, y el pack no
     lo dibujaba. El bus se trazaba entrando y saliendo del armario como si el
     cable se soldara al esclavo. Consecuencias reales de esa omisión:

       · la lista de materiales se queda corta en DOS conectores por motor a gas
         — un motor son dos estaciones DP, no una (WD +U/20);
       · la terminación desaparece del sitio donde de verdad vive. En PROFIBUS
         la resistencia 390/220/390 está DENTRO del conector, en un interruptor
         deslizante. Un conector sin ese interruptor dibujado es un extremo que
         se monta sin terminar o, peor, un tramo intermedio terminado por error,
         que parte el bus en dos sin que ninguna luz se encienda;
       · y el conector es el único punto donde se puede pinchar un maestro
         clase 2. Si no se dibuja cuál lleva hembrilla PG, el diagnóstico acaba
         sin sitio donde enchufarse el día que hace falta.

     `term` y `pg` son BANDERAS (G-5): un solo símbolo dibuja el conector de
     paso, el de extremo y el de diagnóstico. N-14 lo vuelve obligación.
     Aditivo: nada de v0.2.1 cambia.

   v0.2.1 — 2026-08-07 · UN SÍMBOLO: NET_REPEATER
     La hoja de decisión de Tendrara (TAM_gensets/drawings/PROFIBUS_OPTIONS.html)
     compara llevar el bus en cobre directo al PLC contra colgarlo de un
     acoplador PN/DP en el MCC. La opción de cobre lleva un REPETIDOR RS-485
     AISLANTE en la frontera de tierras, y el pack no sabía dibujarlo: sólo
     tenía NET_OLM (óptico) y NET_GATEWAY (cambio de protocolo). Usar
     cualquiera de los dos habría afirmado algo falso. N-13 ya nombraba al
     repetidor; ahora existe. Aditivo: nada de v0.2.0 cambia.

   La librería de símbolos y REGLAS DE CONEXIÓN para los esquemas de red de la
   planta: PLC SIMATIC, PROFINET (anillo MRP), PROFIBUS, fibra óptica, Modbus
   RTU y cableado directo. Fase 1 de NETWORK_LIBRARY_PLAN.md.

   v0.2.0 — 2026-08-07 · EL BUS DE CAMPO, y por qué hizo falta
     El pack de v0.1.0 dibuja una planta PROFINET en anillo. El proyecto de
     integración de los 9 grupos electrógenos de Tendrara al PCS
     (TAM_gensets/PROFIBUS_NETWORK_CONFIG.md) pedía un esquema que este pack no
     podía dibujar sin mentir, por tres razones concretas:

       1. No sabía decir «esclavo DP 15, 192 bytes IN, 0 OUT». Sin el tamaño de
          trama no se puede justificar el tiempo de ciclo, y sin los 0 bytes de
          salida el dibujo no dice que el bus es de sólo lectura.
       2. No sabía dibujar una dirección QUE NO ESTÁ CONFIRMADA. Y ahí estaba
          el defecto caro: la correspondencia módulo INNIO ↔ 480-GE-00n no es
          ascendente, dos motores están fijados y cinco sólo se conocen por
          conjunto. Un número plausible sobre el motor equivocado desplaza
          ~1.900 tags de PCS y nadie lo ve leyendo el dibujo. → N-12, addrChip()
       3. No tenía ni OLM, ni terminación, ni cadena margarita. Un OLM dibujado
          como empalme enseña que la fibra es gratis; un extremo de segmento sin
          terminador dibujado se monta sin terminar. → N-11, N-13

     Añade: 7 símbolos (los del bus de campo), 3 medios, 4 reglas N-10…N-13,
     chain(), dpAudit(), la marca de mazo `bundle` en link(), y el ancho
     variable en portMark(). Todo aditivo: los nueve símbolos, las nueve reglas
     y las nueve firmas de v0.1.0 no cambian.

   ESTADO — LÉELO ANTES DE ESPERAR UN DIBUJO
     Este pack dibuja NODOS y ENLACES. No dibuja la RED, porque la topología
     todavía no está en la base: `plant_network` tiene 81 nodos y 16 aristas
     utilizables (62 filas sin `linked_to`, y 3 de las 19 que lo tienen guardan
     texto libre — "Hot Oil Panel A/B", "CPU S439"). Tampoco hay direcciones IP.
     El pack está escrito para que el día que existan `plant_network_links` e
     `ip_address` no haya que tocar ninguna geometría: se conectan y dibuja.
     Lo que falta hoy está marcado GAP-1…GAP-4 más abajo, cada uno con la
     función que lo consumirá.

   POR QUÉ EL COLOR DEL MEDIO VA EN EL ENLACE Y NO EN EL NODO
     Es la regla que ordena todo lo demás, y sale de la norma de casa
     (skills/db-graphics/NORMA_COLOR_SIMBOLO.md §1):

       el NODO      dice qué es y qué sistema lo manda   → ESD amarillo, estado
       el ENLACE    dice por dónde va y con qué medio    → verde, violeta, naranja

     Un RIO de la red ESD es amarillo aunque su cable sea PROFINET verde. Teñir
     el nodo con el color del medio rompe el amarillo, y el amarillo es lo único
     que un operador tiene que leer antes que nada. Por eso los cuadraditos de
     puerto del plano (PN / FO / MB) se dibujan con `c.col` y su LETRA, nunca
     con el color del bus: la letra ya dice el medio sin gastar el canal color.

   DOS EJES INDEPENDIENTES — no los colapses
     MEDIO     qué cable es          → color y trazo      PROFINET, FO, Modbus…
     TOPOLOGÍA cómo se conectan      → geometría          ring, star, multidrop, point
     Un PROFINET puede ser anillo o estrella; un Modbus es multi-drop pero podría
     ser punto a punto. Mezclarlos en una sola tabla obliga a inventar una
     entrada por combinación, y es lo que hace que estas librerías crezcan sin
     control. `link()` recibe los dos.

   NORMA DE ORIGEN — y de dónde sale cada color
     PROFINET verde y PROFIBUS violeta son la norma PI publicada (la chaqueta
     del cable). Fibra naranja, Modbus cian y cableado gris salen del plano del
     cliente, ISD03-ING-PR01 Rev.7C. Donde chocan gana el plano: es su planta.
     Cada entrada de MEDIA lleva su `source` escrito, para que dentro de un año
     nadie tenga que volver a averiguarlo.

   PROFIBUS / PROFINET son marcas de PI e ISO 14617 es norma licenciada: NADA se
   redistribuye. Cada forma está dibujada con primitivas contra las
   descripciones publicadas, como se construye cualquier plantilla de CAD.

   API
     TamSymNet.fromRow(row)                   plant_network row → {kind, opts}
     TamSymNet.setMedia(rows)                 inyecta plant_network_media (GAP-2)
     TamSymNet.media(code)                    → {color, dash, width, topology, source}
     TamSymNet.link(x1,y1,x2,y2,o)            un enlace, ortogonal
                                              o.bundle = 75 → marca de mazo
     TamSymNet.ring(nodes,o)                  anillo MRP CERRADO
     TamSymNet.multidrop(trunk,taps,o)        troncal Modbus con derivaciones
     TamSymNet.chain(nodes,o)                 cadena margarita, sin derivaciones
                                              o.term → terminadores en los extremos
     TamSymNet.gapLink(x1,y1,x2,y2,o)         enlace desconocido — hueco visible
     TamSymNet.NET_MAP                        node_kind → kind (superficie de auditoría)
     TamSymNet.rules()                        las reglas de conexión, como dato
     TamSymNet.audit(rows)                    el pie de un esquema PROFINET
     TamSymNet.dpAudit(rows)                  el pie de un esquema de bus de campo
     TamSymNet.addrText(a) / addrChipW(a)     texto y ancho de una dirección DP

   Depende solo de tam-sym.js. Cero dependencias, offline desde file://.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const T = (typeof window !== "undefined" ? window : globalThis).TamSym;
  if (!T) throw new Error("tam-sym-net: load tam-sym.js first");

  const WHITE = "#fff";
  const ESD_FILL = "#F7C600", ESD_INK = "#8A6D00";   // mismo amarillo que proceso
  const MONO = "Consolas,monospace";

  /* ══ 1 · LOS MEDIOS ══════════════════════════════════════════════════════
     GAP-2 · `plant_network_media` no existe todavía. Esta tabla es el DEFECTO
     de arranque, no la fuente de verdad: en cuanto la migración exista, el
     renderer llama setMedia(rows) y estos valores dejan de usarse. Está aquí
     como DATO (una tabla con `source` por fila), no repartido por el código,
     precisamente para que sustituirla sea una línea y no una cacería de hex.

     `topology` es el DEFECTO del medio, no una ley: un PROFINET-MRP es anillo
     salvo que la fila diga otra cosa. La fila manda siempre. */
  const MEDIA_DEFAULT = {
    "PROFINET":      { color: "#00A64F", dash: "",      width: 2.0, topology: "star",      name: "PROFINET",         source: "PI standard — green cable jacket" },
    "PROFINET-MRP":  { color: "#00A64F", dash: "",      width: 2.0, topology: "ring",      name: "PROFINET (MRP)",   source: "PI standard + ISD03-ING-PR01 Rev.7C" },
    "PROFIBUS-DP":   { color: "#8B2FC9", dash: "",      width: 2.0, topology: "multidrop", name: "PROFIBUS DP",      source: "PI standard — violet cable jacket" },
    "PROFIBUS-PA":   { color: "#1F6FEB", dash: "",      width: 1.6, topology: "multidrop", name: "PROFIBUS PA",      source: "PI standard — blue cable jacket" },
    "FIBER_OPTIC":   { color: "#E8710A", dash: "",      width: 1.8, topology: "point",     name: "Fiber optic",      source: "ISD03-ING-PR01 Rev.7C" },
    "MODBUS_RTU":    { color: "#00B7C3", dash: "",      width: 1.4, topology: "multidrop", name: "Modbus RTU",       source: "ISD03-ING-PR01 Rev.7C" },
    /* v0.3.0 · Modbus TCP — el mismo cian que el RTU porque es el mismo
       protocolo de aplicación, pero DISCONTINUO porque viaja por Ethernet:
       el trazo dice el canal físico. Los valores espejan la fila de
       plant_network_media (la base manda vía setMedia; esto es el arranque
       offline). Los 5 cromatógrafos van intercalados en el anillo 2 con este
       medio y data_status CONFLICT — se dibuja el conflicto, no se resuelve. */
    "MODBUS_TCP":    { color: "#00B7C3", dash: "5 3",   width: 2.0, topology: "chain",     name: "Modbus TCP",       source: "plant_network_media — Rev.7C (puertos PN) + TIA (ausencia) + ingeniería 2026-08-08" },
    "HARDWIRED":     { color: "#4A4F57", dash: "",      width: 1.2, topology: "point",     name: "Hardwired",        source: "ISD03-ING-PR01 Rev.7C" },
    "ETHERNET":      { color: "#00A64F", dash: "5 3",   width: 1.6, topology: "star",      name: "Industrial Ethernet", source: "ISD03-ING-PR01 Rev.7C" },
    "CPU_RACK":      { color: "#4A4F57", dash: "",      width: 0,   topology: "rack",      name: "CPU backplane",    source: "no es un bus: contigüidad de módulos" },

    /* ── v0.2.0 · los tres medios que el dibujo de generación necesitaba ──
       Salen del proyecto Tendrara / J BL63 (integración de 9 grupos al PCS).
       Ninguno es una variante cosmética de los anteriores: cada uno es un
       CANAL FÍSICO DISTINTO que en ese dibujo coexiste con el PROFIBUS, y
       colapsarlos es exactamente el error que N-10 existe para impedir. */

    /* PROFIBUS por fibra. NO es FIBER_OPTIC con otro nombre: FIBER_OPTIC es la
       fibra de la red PROFINET del plano del cliente. Éste es un tramo de
       PROFIBUS-DP transportado por OLM, y lo que hay que poder leer del dibujo
       es que sigue siendo el MISMO bus, con las mismas direcciones, y que el
       OLM cuenta como estación (N-13). Naranja porque es fibra; el rótulo del
       enlace dice qué protocolo viaja dentro. */
    "PROFIBUS-FO":   { color: "#E8710A", dash: "",           width: 2.0, topology: "point",     name: "PROFIBUS over fibre (OLM)", source: "PI OLM guideline; naranja = fibra, ISD03-ING-PR01 Rev.7C" },

    /* Lazo analógico de reparto de carga. Marrón y trazo raya-punto porque NO
       es un bus de datos y el dibujo tiene que decirlo antes de que nadie lo
       lea: es un lazo de corriente 4–16 mA = 0–100 % Pn sobre 50 Ω que iguala
       las máquinas entre sí SIN pasar por el PCS. Dibujarlo del color de un bus
       enseñaría que el PCS puede repartir carga, y no puede. */
    "LOAD_SHARE":    { color: "#8C5A2B", dash: "10 3 2 3",   width: 1.8, topology: "multidrop", name: "Load-sharing loop (analogue)", source: "INNIO WD +U/13 — 4–16 mA = 0–100 % Pn, 50 Ω, aislado por módulo" },

    /* Ethernet interna del proveedor. El cable real es RJ45 AMARILLO, y aun
       así NO se dibuja amarillo: en esta norma el amarillo es del ESD y es lo
       único que un operador tiene que leer antes que nada (NORMA §1). Se dibuja
       ocre y punteado, y la procedencia deja escrito el porqué — es una
       desviación declarada del color de campo, no un descuido. */
    "ETHERNET_VENDOR": { color: "#7A8B00", dash: "1 3",      width: 1.4, topology: "star",      name: "Ethernet (vendor internal)", source: "INNIO WD +U/19 — RJ45 amarillo en campo; ocre aquí porque el amarillo es del ESD (NORMA §1)" }
  };
  /* El hueco. Un medio que no está en la tabla NO se dibuja con un color
     plausible: se dibuja como hueco (G-4). Gris, punteado, y se cuenta. */
  const MEDIA_GAP = { color: "#8A9099", dash: "2 3", width: 1.2, topology: "point", name: "UNKNOWN MEDIA", source: "gap" };

  let MEDIA = Object.assign({}, MEDIA_DEFAULT);

  /* setMedia — el puente a la base cuando exista (GAP-2).
     Acepta filas {media_code, color, dash, stroke_width, topology_default,
     name, source}. Sustituye, no fusiona: si la base tiene la tabla, la base
     manda entera, porque una fusión silenciosa deja medios fantasma que nadie
     puede auditar. */
  function setMedia(rows) {
    if (!rows || !rows.length) return MEDIA;
    MEDIA = {};
    rows.forEach(r => {
      const k = String(r.media_code || r.media || "").toUpperCase();
      if (!k) return;
      MEDIA[k] = {
        color: r.color || MEDIA_GAP.color,
        dash: r.dash || "",
        width: +r.stroke_width || 1.6,
        topology: r.topology_default || "point",
        /* v0.3.0 · la tabla real llama a la columna display_name; `name` se
           acepta por compatibilidad con quien ya pasaba filas a mano */
        name: r.display_name || r.name || k,
        /* v0.3.0 · la capa y la enrutabilidad son DATO de la base y el trazador
           las necesita para conmutar capas (L1/L2/L7) sin adivinar por color */
        layer: r.layer || null,
        ip_routable: r.ip_routable === true,
        source: r.source || "plant_network_media"
      };
    });
    return MEDIA;
  }
  function media(code) {
    return MEDIA[String(code || "").toUpperCase()] || MEDIA_GAP;
  }
  const mediaKnown = code => !!MEDIA[String(code || "").toUpperCase()];

  /* ══ 2 · LOS PUERTOS — el contrato que deja que un router no mire dentro ══
     REGLA DE PUERTOS. Un nodo de red no tiene "entrada" y "salida": tiene un
     switch de dos puertos, y eso es exactamente POR QUÉ un anillo MRP funciona.
     Modelarlo con un solo puerto obliga al router a inventar por dónde sigue
     la cadena, y ahí es donde un anillo se convierte en estrella sin que nadie
     lo decida.

       P1  oeste   puerto 1 del switch interno  — entra la cadena
       P2  este    puerto 2 del switch interno  — sigue la cadena
       N   norte   subida al troncal / al CPU
       S   sur     bajada a I/O de campo, o al siguiente nivel
       MB  este    Modbus RTU, cuando el nodo lo tiene
       F1/F2       fibra, en las cajas FO

     Los puertos van SIEMPRE en el borde exacto (∓w/2, ∓h/2). Un router jamás
     tiene que mirar dentro de un símbolo. */
  /* La caja: 58 × 22. El ancho lo fija el TAG MÁS LARGO DE LA PLANTA, no el
     gusto — `HOT-OIL-PANEL-A` son 15 caracteres, y a 46 px se salía por los dos
     lados y pisaba los cuadraditos de puerto. Una caja que no contiene su
     propio tag obliga al trazador a recortarlo a mano, y un tag recortado a
     mano es un tag que ya no se puede buscar en la base. */
  const W = 58, H = 22;                       // la caja de nodo del plano
  const TAG_MAX = 15;                         // cabe a 6.2 px de mono en W-6
  const P_CHAIN = {
    P1: [-W / 2, 0, "W"], P2: [W / 2, 0, "E"],
    N: [0, -H / 2, "N"], S: [0, H / 2, "S"]
  };

  /* rótulo interno de la caja: tag arriba, servicio recortado debajo.
     El plano del cliente pone el nombre del equipo ENCIMA de la caja y el tag
     DENTRO; se respeta, porque es lo que hace el dibujo reconocible (R2).
     La línea base va a 4.5 (o 1.5 con IP debajo), NO centrada: los cuadraditos
     de puerto ocupan la mitad superior de la caja, y un tag centrado se les
     mete encima. */
  function boxLabel(c) {
    const o = c.o, tag = String(o.tag || "").trim();
    let s = "";
    if (tag) s += c.txt(0, o.sub2 ? 1.5 : 4.5, tag.slice(0, TAG_MAX), 6.2, 700, "middle");
    /* GAP-4 — la IP, cuando exista la columna. Mientras no exista no se
       imprime nada: una IP plausible sería peor que ninguna (G-3). */
    if (o.sub2) s += c.txt(0, 8.4, String(o.sub2).slice(0, 15), 5.4, 400, "middle", T.SOFT);
    return s;
  }

  /* marca de puerto: el cuadradito del plano con la letra del medio dentro.
     Se dibuja con c.col, NUNCA con el color del bus — ver la cabecera.
     v0.2.0 · el ancho es un parámetro. "PN" y "MB" caben en 9; "485" y "DP"
     no salían del mismo molde, y un rótulo de puerto recortado deja de decir
     qué puerto es, que es lo único para lo que existe la marca. */
  function portMark(c, x, y, letter, w) {
    const t = String(letter);
    const bw = w || Math.max(9, t.length * 3.4 + 3.2);
    return c.rect(x - bw / 2, y - 4, bw, 8, WHITE) +
      c.txt(x, y + 2.6, t, 4.8, 700, "middle");
  }

  /* ── v0.2.0 · addrChip — LA DIRECCIÓN DE BUS, Y SU INCERTIDUMBRE ──────────
     Esto es G-3 aplicado a un número, y es la razón por la que este pack tocó
     v0.2.0. En Tendrara la correspondencia «módulo INNIO n ↔ 480-GE-00n» NO es
     ascendente: dos motores están fijados por documento y los otros cinco sólo
     se sabe que pertenecen a un CONJUNTO de direcciones. Un dibujo que imprima
     «DP 11» sobre el motor equivocado hace que ~1.900 tags de PCS se atribuyan
     a la máquina equivocada, y nadie lo detectará leyendo el dibujo, porque un
     número impreso se cree.

       addr = 15            → confirmada: chip sólido, número grande
       addr = [14,16,17]    → NO confirmada: chip punteado con el CONJUNTO y '?'
       addr = null          → desconocida: '?'

     La forma del dato ya dice el estado, así que el llamador no puede olvidar
     marcarlo: si sólo tiene un conjunto, sólo puede dibujar un conjunto. */
  const GAP_INK = T.DQ.NEEDS_REVIEW;                 // el ámbar del data_status
  const addrText = a => Array.isArray(a) ? "{" + a.join("/") + "}" : String(a == null ? "?" : a);
  /* el ancho se calcula, no se supone: {114/116/117} son 13 caracteres y el
     conjunto más largo es el que tiene que caber. Se exporta para que el
     trazador reparta la página con el ancho REAL y no con el del caso bonito */
  const addrChipW = a => Array.isArray(a)
    ? addrText(a).length * 3.9 + 15
    : Math.max(18, addrText(a).length * 5.4 + 9);
  function addrChip(c, xLeft, y, addr) {
    const set = Array.isArray(addr), t = addrText(addr);
    const w = addrChipW(addr);
    let s = c.rect(xLeft, y - 6, w, 12, WHITE, set ? "2 2" : null, 2) +
      c.txt(xLeft + (set ? (w - 9) / 2 : w / 2), y + 2.4, t, set ? 5.2 : 7.2, 700, "middle");
    if (set || addr == null)
      s += c.txt(xLeft + w - 5, y + 2.8, "?", 7.2, 700, "middle", GAP_INK);
    return s;
  }

  /* el borde: `supply` decide el estilo, igual que en el plano
     (SUPPLY BY ITF vs SUPPLY BY TAM son dos cajas distintas en su leyenda).
     Es una BANDERA, no un símbolo distinto — G-5. */
  function shell(c, w, h, fill) {
    const itf = c.o.supply && String(c.o.supply).toUpperCase() === "ITF";
    let s = c.rect(-w / 2, -h / 2, w, h, fill || WHITE, itf ? "3 2" : null, 1.5);
    /* v0.3.0 · `undoc` — «existe y no está documentado» (ControlPlantView
       §3.3): la esquina superior derecha se corta en ámbar. Es el variador
       que apareció en el LLDP y no está en ningún plano. Bandera, no símbolo
       (G-5), y no gasta el canal color del estado: el chaflán es del ÁMBAR de
       NEEDS_REVIEW porque eso es lo que la fila dice de sí misma. */
    if (c.o.undoc) {
      s += `<path d="M ${w / 2 - 8},${-h / 2} L ${w / 2},${-h / 2 + 8}" fill="none" ` +
        `stroke="${GAP_INK}" stroke-width="2.2" stroke-linecap="round"/>`;
    }
    return s;
  }
  const fillOf = c => (c.o.esd ? ESD_FILL : WHITE);

  /* ══ 3 · LOS SÍMBOLOS — nueve, uno por node_kind real más la sala de control
     Censo del 2026-08-05 sobre plant_network (81 filas): rio_skid 41,
     rio_fans 24, analyzer 5, cpu_module 5, fo_box 4, panel 2. Los seis existen
     y ninguno queda sin mapear. Los tres de sala de control (switch, IPC, WiFi)
     están en el plano pero no en la tabla todavía — GAP-3.
     Todo lo ortogonal es BANDERA, no símbolo (G-5): supply, esd, redundant. */

  /* RIO — la caja de I/O remoto. La forma base de todo el dibujo: 65 de 81
     nodos son ésta o su variante de ventiladores. */
  T.def("NET_RIO", {
    name: "Remote I/O", std: "SIMATIC ET 200", w: W, h: H, ports: P_CHAIN,
    body: c => shell(c, W, H, fillOf(c)) + boxLabel(c) +
      portMark(c, -W / 2 + 5.5, -H / 2 + 5, "PN") +
      portMark(c, W / 2 - 5.5, -H / 2 + 5, "PN")
  });

  /* RIO de ventiladores — 24 nodos. Misma caja, con la marca de hélice: son
     tantos que distinguirlos de un vistazo es lo que hace el plano legible. */
  T.def("NET_RIO_FANS", {
    name: "Remote I/O (fans)", std: "SIMATIC ET 200", w: W, h: H, ports: P_CHAIN,
    body: c => shell(c, W, H, fillOf(c)) + boxLabel(c) +
      portMark(c, -W / 2 + 5.5, -H / 2 + 5, "PN") +
      portMark(c, W / 2 - 5.5, -H / 2 + 5, "PN") +
      c.cir(0, H / 2 - 4.5, 2.6) + c.ln(-2.6, H / 2 - 4.5, 2.6, H / 2 - 4.5) +
      c.ln(0, H / 2 - 7.1, 0, H / 2 - 1.9)
  });

  /* RACK DE CPU — el S7-1500. Un slot por módulo, contiguos: el bus de fondo
     NO se dibuja como línea porque no es un cable, es contigüidad. Dibujarlo
     como bus enseña a buscar un cable que no existe — el mismo error que el
     enlace de software en el pack de instrumentos.
       o.slots = [{n:0, part:"6ES7590-…", label:"PS"}, …] */
  T.def("NET_CPU_RACK", {
    name: "CPU rack S7-1500", std: "SIMATIC S7-1500", w: 84, h: 34,
    ports: { N: [0, -17, "N"], S: [0, 17, "S"], P1: [-42, 0, "W"], P2: [42, 0, "E"] },
    body: c => {
      const slots = (c.o.slots && c.o.slots.length ? c.o.slots : [0, 1, 2, 3, 4].map(n => ({ n })));
      const n = Math.min(slots.length, 8);
      const bw = 76 / n, x0 = -38;
      let s = c.rect(-42, -17, 84, 34, WHITE, null, 1.5) +
        c.ln(-38, 13, 38, 13);                       // el perfil del rack
      for (let i = 0; i < n; i++) {
        const x = x0 + i * bw;
        /* el slot 1 es la CPU en el rack de esta planta: se marca más ancho de
           trazo, no de otro color, para que el estado siga mandando el color */
        s += c.rect(x + 0.8, -14, bw - 1.6, 26, WHITE);
        s += c.txt(x + bw / 2, 10.5, String(slots[i].n != null ? slots[i].n : i), 5.2, 700, "middle");
        if (slots[i].label) s += c.txt(x + bw / 2, -4, String(slots[i].label).slice(0, 4), 4.8, 600, "middle");
      }
      if (c.o.tag) s += c.txt(0, -20.5, String(c.o.tag), 7.2, 700, "middle");
      return s;
    }
  });

  /* CROMATÓGRAFO / analizador — 5 nodos, todos por Modbus RTU. */
  T.def("NET_ANALYZER", {
    name: "Analyzer (Modbus)", std: "—", w: W, h: H,
    ports: { MB: [W / 2, 0, "E"], W: [-W / 2, 0, "W"], N: [0, -H / 2, "N"], S: [0, H / 2, "S"] },
    body: c => shell(c, W, H, fillOf(c)) + boxLabel(c) +
      portMark(c, W / 2 - 5.5, -H / 2 + 5, "MB") +
      c.ln(-W / 2 + 4, H / 2 - 4, -W / 2 + 14, H / 2 - 4) +   // la traza del cromatograma
      c.path(`M ${-W / 2 + 4},${H / 2 - 4} l 3,-3 l 2,3 l 2,-5 l 3,5`)
  });

  /* CAJA DE FIBRA — 4 nodos, en cadena 694 → 692 → 691 → 400. */
  T.def("NET_FO_BOX", {
    name: "Fiber optic box", std: "—", w: 38, h: 20,
    ports: { F1: [-19, 0, "W"], F2: [19, 0, "E"], N: [0, -10, "N"], S: [0, 10, "S"] },
    body: c => c.rect(-19, -10, 38, 20, fillOf(c), null, 1.5) +
      (c.o.tag ? c.txt(0, 2.6, String(c.o.tag), 6.6, 700, "middle") : "") +
      portMark(c, -13, -5, "FO") + portMark(c, 13, -5, "FO")
  });

  /* PANEL DE TERCEROS — 2 nodos (Hot Oil, Babcock). El borde doble dice
     "esto no lo controlamos nosotros", que es la información útil.
     v0.2.0 · la letra del puerto es un PARÁMETRO. Estaba clavada a "MB" porque
     los dos paneles de la planta PROFINET son Modbus; el armario master de un
     grupo electrógeno se conecta por Ethernet, y un panel con la marca "MB"
     encima afirma un protocolo que ese armario no habla. Es bandera (G-5), no
     un décimo símbolo. */
  T.def("NET_PANEL", {
    name: "Vendor panel", std: "—", w: W, h: H, ports: P_CHAIN,
    body: c => shell(c, W, H, fillOf(c)) +
      c.rect(-W / 2 + 2.5, -H / 2 + 2.5, W - 5, H - 5, "none") +
      boxLabel(c) + portMark(c, W / 2 - 7.5, -H / 2 + 5, c.o.port || "MB")
  });

  /* SWITCH GESTIONADO / SCALANCE — sala de control (GAP-3: no está en la tabla).
     Los puertos se dibujan numerados porque en un anillo importa CUÁL. */
  T.def("NET_SWITCH", {
    name: "Managed switch", std: "SCALANCE", w: 52, h: 20,
    ports: { P1: [-26, 0, "W"], P2: [26, 0, "E"], N: [0, -10, "N"], S: [0, 10, "S"] },
    body: c => {
      let s = c.rect(-26, -10, 52, 20, fillOf(c), null, 1.5);
      for (let i = 0; i < 6; i++) s += c.rect(-22 + i * 7.2, 3, 5, 4.5, WHITE);
      s += c.path("M -14,-4 L -6,-4 M -8,-6 L -6,-4 L -8,-2 M 14,-4 L 6,-4 M 8,-6 L 6,-4 L 8,-2");
      if (c.o.tag) s += c.txt(0, -12.5, String(c.o.tag), 6.6, 700, "middle");
      return s;
    }
  });

  /* IPC / servidor web — sala de control (GAP-3). */
  T.def("NET_IPC", {
    name: "IPC / web server", std: "—", w: 34, h: 26,
    ports: { N: [0, -13, "N"], S: [0, 13, "S"], P1: [-17, 0, "W"], P2: [17, 0, "E"] },
    body: c => c.rect(-17, -13, 34, 20, fillOf(c), null, 1) +
      c.rect(-13, -10, 26, 14, WHITE) +
      c.ln(-8, 9, 8, 9) + c.ln(0, 7, 0, 9) +
      (c.o.tag ? c.txt(0, 1.5, String(c.o.tag).slice(0, 8), 5.6, 700, "middle") : "")
  });

  /* PUNTO DE ACCESO WiFi — sala de control (GAP-3). */
  T.def("NET_WIFI", {
    name: "Wireless AP", std: "—", w: 30, h: 22,
    ports: { N: [0, -11, "N"], S: [0, 11, "S"], P1: [-15, 0, "W"] },
    body: c => c.rect(-15, 1, 30, 10, fillOf(c), null, 1.5) +
      c.path("M -7,-2 A 9,9 0 0 1 7,-2") + c.path("M -4,-6 A 5.5,5.5 0 0 1 4,-6") +
      c.dot(0, -9.5, 1.6) +
      (c.o.tag ? c.txt(0, 8.6, String(c.o.tag).slice(0, 10), 5.2, 600, "middle") : "")
  });

  /* ══ 3c · v0.3.0 — LOS TRES DEL CENSO DE 2026-08-11 ══════════════════════
     Censo real: meter ×9, vfd ×3, server ×2. Ninguno se dibuja «parecido a
     otro»: un medidor no es un analizador (mide energía, no composición), un
     variador no es un RIO (convierte potencia, no concentra I/O) y un servidor
     no es un IPC de sala (puede ni estar en la planta). */

  /* MEDIDOR DE RED — SENTRON PAC3200 en los cuadros de 480. La cara del
     aparato: ventana de display arriba (el tag), puerto MB y la onda de
     medida abajo. 9 nodos, 5 con IP medida y 4 sin localizar — la caja imprime
     la IP cuando la fila la trae y NADA cuando no (G-3, mismo trato que GAP-4). */
  T.def("NET_METER", {
    name: "Power meter (Modbus TCP)", std: "SENTRON PAC3200", w: 50, h: 26,
    ports: { P1: [-25, 0, "W"], P2: [25, 0, "E"], N: [0, -13, "N"], S: [0, 13, "S"], MB: [25, -7, "E"] },
    body: c => {
      const o = c.o;
      let s = shell(c, 50, 26, fillOf(c));
      s += c.rect(-21, -10, 42, 11, WHITE);                       // la ventana del display
      if (o.tag) s += c.txt(0, -1.8, String(o.tag).slice(-13), 5.6, 700, "middle");
      if (o.sub2) s += c.txt(3, 9.6, String(o.sub2).slice(0, 15), 5.0, 400, "middle", T.SOFT);
      /* la onda de medida — es un aparato de MEDIDA, no de proceso */
      s += c.path("M -20,8 q 2.5,-6 5,0 t 5,0");
      s += portMark(c, 25 - 6.5, -13 + 5, "MB");
      return s;
    }
  });

  /* VARIADOR DE FRECUENCIA — el convertidor: caja partida en diagonal, onda
     arriba-izquierda (entra red), 'f' abajo-derecha (sale frecuencia variable).
     Los tres de la planta salieron del LLDP y NO están documentados: se
     dibujan con `undoc` puesto por el llamador, no aquí — el símbolo dice qué
     es, la bandera dice cómo está el dato. */
  T.def("NET_VFD", {
    name: "Variable frequency drive", std: "IEC 60617-12 (converter)", w: 54, h: 24,
    ports: { P1: [-27, 0, "W"], P2: [27, 0, "E"], N: [0, -12, "N"], S: [0, 12, "S"] },
    body: c => {
      let s = shell(c, 54, 24, fillOf(c));
      s += c.ln(27, -12, -27, 12);                                // el tabique del convertidor
      s += c.path("M -21,-4.5 q 3,-7 6,0 t 6,0");                 // ~ entra
      s += c.txt(16, 8.5, "f", 9, 700, "middle");                 // f variable sale
      if (c.o.tag) s += c.txt(0, -15, String(c.o.tag).slice(0, 14), 6.4, 700, "middle");
      return s;
    }
  });

  /* SERVIDOR / NUBE — el destino del dato fuera del PCS: historiador en la
     nube o nodo de flota. Torre con ranuras y LED; `cloud` (bandera, G-5)
     dibuja el arco de nube encima, porque «esto no está en la planta» es lo
     primero que hay que poder leer del símbolo. */
  T.def("NET_SERVER", {
    name: "Server / cloud endpoint", std: "—", w: 34, h: 30,
    ports: { N: [0, -15, "N"], S: [0, 15, "S"], P1: [-17, 0, "W"], P2: [17, 0, "E"] },
    body: c => {
      const cl = !!c.o.cloud;
      let s = "";
      if (cl) s += c.path("M -12,-9 A 7,7 0 0 1 -2,-14 A 8,8 0 0 1 12,-11 A 5.5,5.5 0 0 1 12,-2");
      s += c.rect(-10, cl ? -4 : -13, 20, cl ? 17 : 26, WHITE, null, 1.5);
      const y0 = cl ? -1 : -10;
      for (let i = 0; i < 3; i++) {
        s += c.ln(-7, y0 + i * 5.2, 3.5, y0 + i * 5.2);
        s += c.dot(6.5, y0 + i * 5.2, 1);
      }
      if (c.o.tag) s += c.txt(0, cl ? 19.5 : 18.5, String(c.o.tag).slice(0, 16), 5.6, 700, "middle");
      return s;
    }
  });

  /* ══ 3b · v0.2.0 — LOS SIETE SÍMBOLOS DE PROFIBUS-DP ═════════════════════
     Se añaden al pack, no se forkea nada (G-2). Los nueve de v0.1.0 dibujan
     una planta PROFINET en anillo; ninguno sabe decir «esclavo DP dirección
     15, 192 bytes de entrada, cero de salida», que es la frase entera del
     esquema de generación. Cada uno responde a algo que el dibujo de Tendrara
     tenía que afirmar y no podía:

       NET_DP_MASTER   quién sondea el bus, y con qué dirección
       NET_DP_SLAVE    la estación, su dirección y su carga de trama
       NET_OLM         el repetidor óptico — que es ESTACIÓN, no empalme (N-13)
       NET_TERM        la terminación de segmento, que se cablea o no se cablea
       NET_GENSET      el grupo electrógeno, gas o diésel
       NET_GATEWAY     el conversor de protocolo, cuando el equipo no habla DP
       NET_SPD         el descargador, obligatorio donde el cobre sale del edificio

     Todo lo demás sigue siendo bandera (G-5): `fuel`, `active`, `dpClass`,
     `supply`, `esd`. */

  /* MAESTRO DP — la tarjeta del PCS. La clase va DENTRO del símbolo (M1 / M2)
     porque un maestro clase 2 (un portátil de diagnóstico) no sondea: sólo
     mira, y confundirlos cambia quién es responsable de detectar el fallo de
     comunicación. */
  T.def("NET_DP_MASTER", {
    name: "PROFIBUS DP master", std: "IEC 61158 / EN 50170 (DP-V0)", w: 78, h: 26,
    ports: { P1: [-39, 0, "W"], P2: [39, 0, "E"], N: [0, -13, "N"], S: [0, 13, "S"] },
    body: c => {
      const cls = c.o.dpClass == null ? 1 : c.o.dpClass;
      let s = shell(c, 78, 26, fillOf(c));
      s += c.rect(-35, -8, 20, 16, WHITE) + c.txt(-25, 3, "M" + cls, 8.4, 700, "middle");
      s += addrChip(c, -11, -0.5, c.o.addr);
      if (c.o.tag) s += c.txt(0, -16.5, String(c.o.tag).slice(0, 18), 6.6, 700, "middle");
      return s;
    }
  });

  /* ESCLAVO DP — la estación. Dos datos y sólo dos: la DIRECCIÓN (que puede no
     estar confirmada, y entonces se ve) y el TAMAÑO DE TRAMA, porque es lo que
     fija el tiempo de ciclo y lo que hay que configurar módulo a módulo en el
     maestro. `dir` imprime el sentido: 'IN' es lo normal en un esclavo de sólo
     monitorización, y verlo escrito es lo que impide que alguien suponga que
     por ahí se puede mandar (N-10). */
  /* El ancho, 104, NO es estético: lo fija el conjunto más largo que este
     proyecto puede imprimir, {114/116/117}, más "192 B IN". Dimensionar la caja
     por el caso confirmado —que sólo necesita 76— haría que justo las
     direcciones dudosas salieran recortadas o pisadas, que es exactamente el
     dato que N-12 existe para que se vea. */
  T.def("NET_DP_SLAVE", {
    name: "PROFIBUS DP slave", std: "IEC 61158 / EN 50170 (DP-V0)", w: 104, h: 20,
    ports: { P1: [-52, 0, "W"], P2: [52, 0, "E"], N: [0, -10, "N"], S: [0, 10, "S"] },
    body: c => {
      let s = shell(c, 104, 20, fillOf(c));
      s += addrChip(c, -48, 0, c.o.addr);
      if (c.o.bytes != null)
        s += c.txt(48, 2.6, c.o.bytes + " B " + (c.o.dir || "IN"), 6, 600, "end");
      return s;
    }
  });

  /* OLM — módulo de enlace óptico. UN puerto RS-485 y DOS canales ópticos, que
     es lo que permite cerrar el anillo. Se dibuja como CAJA, no como empalme,
     porque un OLM es una estación del presupuesto de retardo del bus y de la
     cuenta de repetidores por segmento: dibujarlo como una unión enseña que la
     fibra es gratis, y no lo es (N-13). */
  /* `mirror` — la bandera que decide de qué lado entra la fibra. Un OLM de sala
     de control tiene el cobre a la izquierda y la fibra a la derecha; uno de
     campo lo tiene al revés. Sin la bandera, uno de los dos dibuja las marcas
     de puerto contra el sentido real del cableado, y una marca de puerto que
     contradice al trazo es peor que ninguna: el lector se fía de la marca.
     Los puertos existen en LOS DOS lados (E1/E2 eléctricos, F1/F2 ópticos)
     para que el trazador enganche del lado que le toca sin mirar dentro. */
  T.def("NET_OLM", {
    name: "PROFIBUS optical link module", std: "PI OLM", w: 56, h: 32,
    ports: { E1: [-28, 0, "W"], E2: [28, 0, "E"], N: [0, -16, "N"], S: [0, 16, "S"],
             F1: [28, -9, "E"], F2: [28, 9, "E"] },
    body: c => {
      const mir = !!c.o.mirror;
      const ex = mir ? 28 - 10 : -28 + 10;          // el puerto RS-485
      const ox = mir ? -28 + 9 : 28 - 9;            // los dos canales ópticos
      let s = shell(c, 56, 32, fillOf(c));
      s += portMark(c, ex, -16 + 6.5, "485", 15);
      s += c.cir(ox, -8, 3.4, WHITE) + c.txt(ox, -6.2, "1", 4.6, 700, "middle");
      s += c.cir(ox, 8, 3.4, WHITE) + c.txt(ox, 9.8, "2", 4.6, 700, "middle");
      s += c.txt(mir ? 4 : -4, 5.5, "OLM", 9, 700, "middle");
      if (c.o.tag) s += c.txt(0, -19, String(c.o.tag).slice(0, 14), 6.4, 700, "middle");
      return s;
    }
  });

  /* REPETIDOR RS-485 — v0.2.1. La regla N-13 ya decía «un repetidor u OLM es
     una estación», y el pack sólo tenía el OLM: para dibujar un repetidor de
     cobre había que usar el símbolo óptico (afirma una fibra que no existe) o
     el NET_GATEWAY (afirma un cambio de protocolo que no ocurre). Las dos
     mentiras son del tipo que esta librería existe para impedir, así que el
     símbolo faltaba de verdad.

     Lo que hay que poder leer de él son dos cosas y sólo dos: que EL MISMO BUS
     sigue a los dos lados —dos puertos 485, ninguna sigla de protocolo— y si
     hay o no BARRERA GALVÁNICA, que es la razón por la que se pone uno donde
     no hace falta por longitud. `isolated` es bandera (G-5): el mismo símbolo
     dibuja el repetidor barato y el aislante, y el tabique punteado aparece
     sólo cuando la fila lo dice. Cada lado es un segmento con su propia
     terminación, y por eso el llamador tiene que dibujar dos NET_TERM (N-11). */
  T.def("NET_REPEATER", {
    name: "RS-485 repeater", std: "EN 50170 / IEC 61158", w: 56, h: 26,
    ports: { P1: [-28, 0, "W"], P2: [28, 0, "E"], N: [0, -13, "N"], S: [0, 13, "S"] },
    body: c => {
      let s = shell(c, 56, 26, fillOf(c));
      s += portMark(c, -28 + 10, -13 + 6, "485", 15);
      s += portMark(c, 28 - 10, -13 + 6, "485", 15);
      /* el tabique de aislamiento: punteado y de lado a lado, porque lo que
         separa son los dos sistemas de tierra, no dos trozos de electrónica */
      if (c.o.isolated) s += c.ln(0, -13, 0, 13, "2 2");
      s += c.txt(0, 8, "REP", 7.6, 700, "middle");
      return s;
    }
  });

  /* TERMINACIÓN DE SEGMENTO — la red 390/220/390 alimentada de los 5 V del
     conector. Tiene símbolo propio y no es una decoración: un extremo de
     segmento sin terminador DIBUJADO es un extremo que se cableará sin
     terminar, y un RS-485 sin terminar a 1,5 Mbit/s no falla del todo — falla
     a ratos, que es peor (N-11). `active` marca el terminador alimentado a
     24 V, el que sigue terminando aunque el equipo del extremo se apague. */
  T.def("NET_TERM", {
    name: "Bus terminator 390/220/390", std: "EN 50170 / IEC 61158", w: 24, h: 26,
    ports: { A: [-12, 0, "W"] },
    body: c => {
      let s = c.ln(-12, 0, -3, 0) + c.rect(-3, -9, 7, 18, WHITE);
      s += c.ln(0.5, -9, 0.5, -12) + c.ln(-3.5, -12, 4.5, -12);       // +5 V
      s += c.ln(0.5, 9, 0.5, 12) + c.ln(-3.5, 12, 4.5, 12);            // DGND
      if (c.o.active) s += c.cir(9.5, 0, 3.6, WHITE) + c.txt(9.5, 2.2, "A", 5, 700, "middle");
      return s;
    }
  });

  /* CONECTOR DE BUS Sub-D 9 — v0.2.2. El punto de conexión físico, y la pieza
     que más veces se cae de una lista de materiales de PROFIBUS porque el
     dibujo la da por supuesta.

     Se dibuja como el propio conector: la carcasa en D, cara ancha al cable y
     cara estrecha —los 9 contactos— hacia el equipo. Tres cosas y sólo tres
     tienen que poder leerse de él:

       PASO o EXTREMO   `term`. La resistencia va DENTRO del conector, con
                        interruptor deslizante. Puesto a ON el bus saliente
                        QUEDA AISLADO: por eso el símbolo cierra el puerto este
                        con un tabique en vez de seguir la línea. Un conector
                        con el interruptor a ON en mitad de la cadena parte el
                        bus; uno a OFF en un extremo lo deja sin terminar. Es la
                        misma pieza y el error es invisible salvo aquí.
       HEMBRILLA PG     `pg`. El único enchufe para un maestro clase 2. Dibujar
                        cuáles la llevan es lo que decide si se puede
                        diagnosticar el bus el día que falla.
       CUÁNTOS HAY      uno por estación, y un motor a gas son dos.

     No lleva `active`: eso es del NET_TERM alimentado a 24 V, que es otra pieza
     y otra decisión (terminar aunque el armario esté sin tensión). */
  T.def("NET_CONNECTOR", {
    name: "PROFIBUS bus connector Sub-D 9", std: "EN 50170 / IEC 61158", w: 22, h: 20,
    ports: { P1: [-11, -4, "W"], P2: [11, -4, "E"], S: [0, 10, "S"] },
    body: c => {
      const term = !!c.o.term;
      /* la carcasa en D: ancha arriba (entra y sale el cable), estrecha abajo
         (la cara de 9 contactos que se atornilla al equipo) */
      let s = c.path("M -11,-10 L 11,-10 L 7.5,10 L -7.5,10 Z", WHITE);
      /* la fila de contactos — tres puntos bastan para que se lea "conector"
         y no "caja". Nueve a esta escala serían una mancha. */
      s += c.dot(-3.4, 6.2, 1) + c.dot(0, 6.2, 1) + c.dot(3.4, 6.2, 1);
      /* la entrada de cable por el oeste; por el este sólo si el bus SIGUE */
      s += c.ln(-11, -4, -7, -4);
      if (term) {
        /* interruptor a ON: tabique en el este. El bus saliente queda aislado,
           que es literalmente lo que hace la función de desconexión */
        s += c.ln(7.6, -9.4, 7.6, 1);
        s += c.txt(2.6, -2.2, "T", 7, 700, "middle");
      } else {
        s += c.ln(7, -4, 11, -4);
      }
      /* la hembrilla PG, encima: el sitio donde se pincha el ProfiTrace */
      if (c.o.pg) s += c.rect(-4, -15, 8, 5, WHITE) + c.dot(0, -12.5, 1);
      return s;
    }
  });

  /* GRUPO ELECTRÓGENO — motor + alternador. El combustible es BANDERA, no un
     segundo símbolo (G-5): `fuel:'diesel'` cambia el rótulo del motor y pone el
     borde punteado, que en este pack ya significa «no es nuestro alcance»
     (misma convención que `supply:'ITF'` en shell()). Así los dos diésel de
     cliente se leen distintos de los siete Jenbacher sin gastar el canal color,
     que sigue siendo del estado. */
  T.def("NET_GENSET", {
    name: "Generating set", std: "IEC 60617-06", w: 54, h: 26,
    ports: { N: [0, -13, "N"], S: [0, 13, "S"], P1: [-27, 0, "W"], P2: [27, 0, "E"] },
    body: c => {
      const dsl = String(c.o.fuel || "gas").toLowerCase() === "diesel";
      let s = c.rect(-27, -11, 27, 22, WHITE, dsl ? "3 2" : null);
      s += c.txt(-13.5, 3, dsl ? "DSL" : "GAS", 7.6, 700, "middle");
      s += c.ln(0, 0, 4, 0);
      s += c.cir(15, 0, 11, WHITE) + c.txt(15, 4, "G", 11, 700, "middle");
      return s;
    }
  });

  /* PASARELA DE PROTOCOLO — el conversor que se pone cuando el equipo no habla
     el bus. El tabique vertical y las dos siglas son el símbolo entero: lo que
     hay que leer es QUÉ entra y QUÉ sale, porque una pasarela es siempre un
     punto donde el mapa de datos se re-numera y donde alguien tendrá que
     mantener una tabla a mano. */
  T.def("NET_GATEWAY", {
    name: "Protocol gateway", std: "—", w: 58, h: 22,
    ports: { P1: [-29, 0, "W"], P2: [29, 0, "E"], N: [0, -11, "N"], S: [0, 11, "S"] },
    body: c => shell(c, 58, 22, fillOf(c)) +
      c.ln(0, -11, 0, 11) +
      c.txt(-14.5, 3, String(c.o.from || "MB").slice(0, 4), 6.6, 700, "middle") +
      c.txt(14.5, 3, String(c.o.to || "DP").slice(0, 4), 6.6, 700, "middle") +
      c.path("M -5,-6.5 L 5,-6.5 M 2.5,-9 L 5,-6.5 L 2.5,-4") +
      (c.o.duplex ? c.path("M 5,7 L -5,7 M -2.5,4.5 L -5,7 L -2.5,9.5") : "")
  });

  /* DESCARGADOR — protección contra sobretensiones en el bus. Obligatorio en
     cada entrada de edificio o contenedor donde un cable de señal sale del
     sistema de tierras común. Va en el pack de RED y no en el eléctrico porque
     lo que protege aquí es un par de datos, y quien dibuja el bus es quien
     tiene que acordarse de ponerlo: si sólo existiera en el unifilar, no
     aparecería nunca en un esquema de red. */
  T.def("NET_SPD", {
    name: "Surge protective device", std: "IEC 60617-07", w: 22, h: 28,
    ports: { A: [0, -14, "N"], B: [0, 14, "S"] },
    body: c => c.ln(0, -14, 0, -8) + c.rect(-6.5, -8, 13, 16, WHITE) +
      c.path("M 0,-4.5 L 0,3.5 M -3.2,0.3 L 0,3.5 L 3.2,0.3") +
      c.ln(0, 8, 0, 14)
  });

  /* ══ 4 · LAS REGLAS DE CONEXIÓN ══════════════════════════════════════════
     Las nueve reglas van aquí como DATO (rules()) y no solo como comentario,
     para que la hoja de aprobación las imprima y la pasada de conformidad las
     recorra sin que nadie las transcriba a mano. Una regla transcrita a mano
     se queda obsoleta — misma razón que la leyenda autogenerada (G-7). */
  const RULES = [
    ["N-1", "Ortogonal siempre",
     "Un enlace de red se dibuja con tramos horizontales y verticales. Una diagonal en un esquema de red se lee como un error de dibujo, igual que en un P&ID."],
    ["N-2", "Medio y topología son ejes independientes",
     "El medio da color y trazo; la topología da geometría. link() recibe los dos y no deduce uno del otro. La fila manda sobre el defecto del medio."],
    ["N-3", "El anillo se dibuja CERRADO",
     "MRP significa redundancia: si el trazo no vuelve al origen, el dibujo afirma una estrella. Es el error más dañino de esta disciplina, porque el operador que investiga por qué NO cayó el enlace necesita ver el retorno. ring() con menos de 3 nodos no es un anillo y lo declara."],
    ["N-4", "El color del medio va en el enlace, nunca en el nodo",
     "El nodo lleva el amarillo ESD y el color de estado. Teñir el nodo con el color del bus rompe el amarillo, que es lo único que hay que leer antes que nada."],
    ["N-5", "Dos puertos, no uno",
     "Un nodo de anillo expone P1 y P2 — el switch de dos puertos que hace posible el MRP. Un solo puerto obliga al router a inventar por dónde sigue la cadena."],
    ["N-6", "El bus de fondo del rack no es un cable",
     "Los módulos de un rack se dibujan contiguos, sin línea entre ellos. Dibujar el backplane como bus enseña a buscar un cable que no existe."],
    ["N-7", "Cada derivación de un multi-drop lleva su punto",
     "Sin el punto, una derivación y un cruce se dibujan igual, y el lector no puede saber si el cromatógrafo cuelga del troncal o solo lo cruza."],
    ["N-8", "Un enlace desconocido se dibuja como hueco, no se omite",
     "gapLink() traza gris punteado con '?' y se cuenta en el pie. Hoy son ~65 de 81 nodos: omitirlos daría un dibujo limpio que afirma que la red está completa (G-4)."],
    ["N-9", "Redundante se dibuja doble",
     "Dos trazos paralelos, no un trazo más gordo. El grosor ya lo usa el medio, y un canal que significa dos cosas no significa ninguna."],
    /* ── v0.2.0 · las cuatro que salieron del esquema de generación ─────── */
    ["N-10", "El bus de datos y el camino de mando son dos canales, siempre",
     "Cuando un bus es de sólo lectura, el mando viaja por otro sitio — cableado, casi siempre. Dibujarlos con el mismo trazo, o dibujar sólo el bus porque es el bonito, enseña que se puede mandar por el bus. En Tendrara el interface list lo PROHÍBE por escrito: 0 bytes de salida y ningún uso crítico ni de seguridad. Un dibujo que no muestre las dos vías está afirmando lo contrario de lo que dice el documento."],
    ["N-11", "Cada extremo de segmento lleva su terminador dibujado",
     "La terminación es cableado que alguien monta o no monta. Un extremo sin terminador en el dibujo es un extremo que se montará sin terminar, y un RS-485 sin terminar no falla del todo: falla a ratos. Se dibuja NET_TERM en los dos extremos de cada segmento de cobre, y en ninguna otra parte."],
    ["N-12", "Una dirección no confirmada se dibuja como CONJUNTO, no como número",
     "Es G-3 aplicado a un número. addrChip() acepta un array y entonces imprime {14/16/17} con borde punteado y '?'. Un número plausible sobre el equipo equivocado se cree, no se cuestiona, y arrastra todo el mapa de tags detrás. La forma del dato obliga: quien sólo tiene un conjunto sólo puede dibujar un conjunto."],
    ["N-13", "Un repetidor u OLM es una estación y se dibuja como caja",
     "Consume presupuesto de retardo, cuenta en el máximo de repetidores en cascada y es un punto de fallo con su propia alimentación. Dibujarlo como un empalme o como un simple cambio de color de la línea enseña que la fibra es gratis."],
    /* ── v0.2.2 · la que salió de revisar la lista de materiales ────────── */
    ["N-14", "Cada punto de conexión al bus es un CONECTOR, y se dibuja y se cuenta",
     "Un bus que entra y sale de un símbolo sin conector dibujado afirma que el cable se solda al esclavo. No se solda: se atornilla a un Sub-D 9 que hay que comprar, uno por estación —y un motor a gas son DOS estaciones, no una—. Además la resistencia de terminación vive DENTRO de ese conector, en un interruptor deslizante: sin el conector dibujado no hay dónde leer si el extremo queda terminado, ni cuál lleva hembrilla PG para pinchar un maestro clase 2. Se dibuja NET_CONNECTOR en cada toma; los equipos que reciben el cable en BORNE DE TORNILLO —repetidor RS-485, terminador activo— no llevan, y esa diferencia es de compra."],
    /* ── v0.3.0 · la del estado, escrita antes de que exista el estado ───── */
    ["N-15", "El estado del nodo se pinta con la rejilla NE 107 más BLANCO = sin información",
     "No se inventan semáforos: fallo, control de funcionamiento, fuera de especificación y mantenimiento requerido son los cuatro iconos NE 107, y el quinto estado es nuestro — BLANCO, sin información. La ausencia de dato tiene color propio porque sin comunicación ≠ caído ≠ no sondeado ≠ cero: cuatro cosas distintas, cuatro tratamientos. Un nodo sin señal enlazada se queda blanco, no verde, y un rango no sondeado se dibuja gris claro, nunca «caído» (G-3 aplicado al estado)."]
  ];
  const rules = () => RULES.map(r => ({ id: r[0], title: r[1], why: r[2] }));

  /* orto — la polilínea de N-1. route 'hv' | 'vh' | 'direct' (solo si comparten
     eje). Se construye UNA path para que el guion corra continuo por la esquina
     en vez de reiniciarse en cada tramo. */
  function orthoPts(x1, y1, x2, y2, route) {
    if (Math.abs(x1 - x2) < 0.6 || Math.abs(y1 - y2) < 0.6) return [[x1, y1], [x2, y2]];
    if (route === "vh") return [[x1, y1], [x1, y2], [x2, y2]];
    return [[x1, y1], [x2, y1], [x2, y2]];       // 'hv' por defecto
  }
  const dOf = pts => pts.map((p, i) => (i ? "L " : "M ") + (Math.round(p[0] * 100) / 100) + "," + (Math.round(p[1] * 100) / 100)).join(" ");

  function stroke(d, m, o) {
    return `<path d="${d}" fill="none" stroke="${o.color || m.color}" ` +
      `stroke-width="${o.width || m.width || 1.6}"` +
      ((o.dash != null ? o.dash : m.dash) ? ` stroke-dasharray="${o.dash != null ? o.dash : m.dash}"` : "") +
      ` stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  /* link — UN enlace.
       o.media     'PROFINET-MRP' | 'FIBER_OPTIC' | … (obligatorio en la práctica)
       o.route     'hv' | 'vh' | 'direct'
       o.redundant true → doble trazo (N-9)
       o.arrow     false por defecto: una red no tiene sentido de flujo. Se pone
                   solo donde el plano lo pone (una bajada a I/O).
       o.label     'PN32' — el link_id, que es como el plano los referencia
     Si el medio no está en la tabla, cae en MEDIA_GAP y el enlace sale gris
     punteado: un medio inventado sería peor que un hueco (N-8). */
  function link(x1, y1, x2, y2, o) {
    o = o || {};
    const m = media(o.media);
    const pts = orthoPts(x1, y1, x2, y2, o.route);
    const d = dOf(pts);
    let s = stroke(d, m, o);
    if (o.redundant) {                                    // N-9
      const off = (m.width || 1.6) + 1.4;
      const vert = Math.abs(x2 - x1) < Math.abs(y2 - y1);
      s += stroke(dOf(pts.map(p => vert ? [p[0] + off, p[1]] : [p[0], p[1] + off])), m, o);
    }
    if (o.arrow) {
      const n = pts.length, ex = pts[n - 1][0], ey = pts[n - 1][1];
      const a = Math.atan2(ey - pts[n - 2][1], ex - pts[n - 2][0]) * 180 / Math.PI;
      s += `<path d="M-4.5,-3 L1,0 L-4.5,3 Z" fill="${o.color || m.color}" transform="translate(${ex},${ey}) rotate(${a})"/>`;
    }
    if (o.label || o.bundle != null) {
      /* el rótulo sobre el tramo más largo, con halo blanco, para que se lea
         aunque cruce otro enlace */
      let bi = 1, bl = -1;
      for (let i = 1; i < pts.length; i++) {
        const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (L > bl) { bl = L; bi = i; }
      }
      const mx = (pts[bi][0] + pts[bi - 1][0]) / 2, my = (pts[bi][1] + pts[bi - 1][1]) / 2;
      /* v0.2.0 · la marca de mazo. Una barra oblicua con un número es la
         convención de toda la vida para «aquí van n conductores», y es la
         diferencia entre un dibujo que insinúa «hay cableado» y uno que dice
         75 cables por motor — que es un dato de compra, no una decoración.
         Es BANDERA sobre el mismo enlace, no un medio nuevo (G-5). */
      if (o.bundle != null) {
        const vert = Math.abs(pts[bi][0] - pts[bi - 1][0]) < 0.6;
        const c2 = o.color || m.color;
        s += `<path d="${vert ? `M ${mx - 5},${my + 5} L ${mx + 5},${my - 5}`
                             : `M ${mx - 5},${my + 5} L ${mx + 5},${my - 5}`}" ` +
          `fill="none" stroke="${c2}" stroke-width="1.4" stroke-linecap="round"/>`;
        s += `<text x="${mx + (vert ? 9 : 7)}" y="${my - (vert ? 0 : 6)}" text-anchor="start" ` +
          `font-family="${MONO}" font-size="6" font-weight="700" paint-order="stroke" ` +
          `stroke="#fff" stroke-width="2.6" fill="${c2}">${T.esc(o.bundle)}</text>`;
      }
      if (o.label)
        s += `<text x="${mx}" y="${my - (o.bundle != null ? 12 : 3)}" text-anchor="middle" ` +
          `font-family="${MONO}" font-size="5.6" ` +
          `font-weight="600" paint-order="stroke" stroke="#fff" stroke-width="2.6" ` +
          `fill="${o.color || m.color}">${T.esc(o.label)}</text>`;
    }
    return s;
  }

  /* gapLink — N-8. El enlace que la base no sabe. No es decoración: es la
     forma de que 65 nodos sin topología se vean como 65 huecos y no como una
     red completa. Devuelve también el conteo por el pie, vía o.count. */
  function gapLink(x1, y1, x2, y2, o) {
    o = o || {};
    const pts = orthoPts(x1, y1, x2, y2, o.route);
    const mx = (pts[0][0] + pts[pts.length - 1][0]) / 2, my = (pts[0][1] + pts[pts.length - 1][1]) / 2;
    return stroke(dOf(pts), MEDIA_GAP, { dash: "2 3" }) +
      `<text x="${mx}" y="${my - 3}" text-anchor="middle" font-family="${MONO}" font-size="7" ` +
      `font-weight="700" paint-order="stroke" stroke="#fff" stroke-width="3" fill="${MEDIA_GAP.color}">?</text>`;
  }

  /* ring — N-3. `nodes` = [{x,y}, …] en el orden del anillo, y el CIERRE es
     obligatorio: el último vuelve al primero.
     Con menos de 3 nodos no hay anillo — devuelve el enlace punto a punto y
     pone `notRing:true` en o.report, para que el pie lo diga en vez de que el
     dibujo finja una redundancia que no existe. */
  function ring(nodes, o) {
    o = o || {};
    const n = (nodes || []).filter(Boolean);
    if (n.length < 2) return "";
    if (n.length < 3) {
      if (o.report) o.report.notRing = true;
      return link(n[0].x, n[0].y, n[1].x, n[1].y, o);
    }
    let s = "";
    for (let i = 0; i < n.length; i++) {
      const a = n[i], b = n[(i + 1) % n.length];
      const closing = (i === n.length - 1);
      s += link(a.x, a.y, b.x, b.y, Object.assign({}, o, {
        /* el tramo de cierre lleva su propio rótulo, no el del anillo, para que
           se vea que es el retorno y no un enlace más */
        label: closing ? (o.closeLabel || "MRP") : null,
        route: closing ? (o.closeRoute || "vh") : o.route
      }));
    }
    if (o.report) o.report.ringNodes = n.length;
    return s;
  }

  /* multidrop — N-7. Un troncal y sus derivaciones, cada una con su punto.
       trunk = {x1,y1,x2,y2}   taps = [{x,y}, …] */
  function multidrop(trunk, taps, o) {
    o = o || {};
    const m = media(o.media);
    let s = link(trunk.x1, trunk.y1, trunk.x2, trunk.y2, o);
    const horiz = Math.abs(trunk.y2 - trunk.y1) < Math.abs(trunk.x2 - trunk.x1);
    (taps || []).forEach(t => {
      const jx = horiz ? t.x : trunk.x1, jy = horiz ? trunk.y1 : t.y;
      s += stroke(dOf([[jx, jy], [t.x, t.y]]), m, o);
      s += `<circle cx="${jx}" cy="${jy}" r="2" fill="${o.color || m.color}"/>`;  // el punto
    });
    return s;
  }

  /* chain — v0.2.0 · LA CADENA MARGARITA, QUE NO ES UN MULTI-DROP.
     Un segmento PROFIBUS-DP a 1,5 Mbit/s NO admite derivaciones: el cable entra
     y sale por el mismo conector de cada estación, bus-in / bus-out. En
     geometría eso es una polilínea que ATRAVIESA los nodos, no un troncal con
     ramitas colgando — y la diferencia no es de estilo: multidrop() dibuja
     exactamente la topología que la especificación física prohíbe («no stubs»).
     Tener las dos funciones separadas es lo que impide dibujar la prohibida por
     comodidad.

       nodes  [{x, y, w}, …] en ORDEN FÍSICO — el del tablero, nunca el del tag
              `w` es el ANCHO del símbolo: el enlace sale del puerto P2 (x+w/2)
              y entra por el P1 del siguiente (x−w/2). Sin `w` se usan los
              puntos tal cual, para quien ya pasa coordenadas de puerto.
              Trazar de centro a centro mete el cable POR DENTRO del símbolo, y
              un bus que atraviesa una caja se lee como que la caja está en
              medio del segmento en vez de ser una estación con dos puertos —
              es N-5 roto por el lado del trazador.
       o.term true → coloca NET_TERM en los dos extremos (N-11)

     Los nodos los dibuja el llamador; esto son los enlaces y, si se pide, las
     terminaciones. */
  function chain(nodes, o) {
    o = o || {};
    const n = (nodes || []).filter(Boolean);
    if (n.length < 2) { if (o.report) o.report.notChain = true; return ""; }
    const right = p => p.x + (p.w ? p.w / 2 : 0);
    const left = p => p.x - (p.w ? p.w / 2 : 0);
    let s = "";
    for (let i = 1; i < n.length; i++)
      s += link(right(n[i - 1]), n[i - 1].y, left(n[i]), n[i].y,
        Object.assign({}, o, { label: i === 1 ? o.label : null, bundle: null }));
    if (o.term) {
      /* el muñón llega hasta el PUERTO del terminador (su port A está a -12 del
         centro), no hasta su centro: una línea que entra por dentro del símbolo
         se lee como que el terminador está en medio del bus, no en el extremo */
      const g = o.termGap == null ? 26 : o.termGap;
      const a = n[0], z = n[n.length - 1];
      const ax = left(a), zx = right(z);
      s += link(ax - g + 12, a.y, ax, a.y, Object.assign({}, o, { label: null }));
      s += link(zx, z.y, zx + g - 12, z.y, Object.assign({}, o, { label: null }));
      s += T.draw("NET_TERM", { x: ax - g, y: a.y, rot: 180, active: o.activeTerm !== false, strokeWidth: 1.3, color: o.color });
      s += T.draw("NET_TERM", { x: zx + g, y: z.y, active: o.activeTerm !== false, strokeWidth: 1.3, color: o.color });
    }
    if (o.report) { o.report.chainNodes = n.length; o.report.chainHops = n.length - 1; }
    return s;
  }

  /* ══ 5 · EL PUENTE — plant_network row → símbolo ═════════════════════════
     Un solo objeto plano. Es la superficie de auditoría (SKILL §4): cualquiera
     lee diez líneas y ve exactamente qué afirma el dibujo sobre el dato.
     Censo corrido el 2026-08-05: los 6 valores existen, ninguno sin mapear. */
  const NET_MAP = {
    rio_skid:   "NET_RIO",
    rio_fans:   "NET_RIO_FANS",
    analyzer:   "NET_ANALYZER",
    cpu_module: "NET_CPU_RACK",
    fo_box:     "NET_FO_BOX",
    panel:      "NET_PANEL",
    /* sala de control — GAP-3 CERRADO el 2026-08-08: ya son filas de la tabla */
    switch:     "NET_SWITCH",
    ipc:        "NET_IPC",
    wifi:       "NET_WIFI",
    /* v0.3.0 · el censo de 2026-08-11 (116 filas, 12 kinds) — cierra H-4 */
    meter:      "NET_METER",
    vfd:        "NET_VFD",
    server:     "NET_SERVER",
    /* v0.2.0 · bus de campo DP. Estos siete valores NO salen de un censo de
       plant_network: salen de `plant_bus_nodes` y `plant_genset_modules`, que
       GENSET_DB_INTEGRATION_PLAN.md §2.2 todavía no ha creado. Van aquí con el
       nombre que tendrán, para que el día de la migración el puente ya exista
       y nadie tenga que inventárselo con prisa — GAP-5. */
    dp_master:  "NET_DP_MASTER",
    dp_slave:   "NET_DP_SLAVE",
    olm:        "NET_OLM",
    repeater:   "NET_REPEATER",
    terminator: "NET_TERM",
    genset:     "NET_GENSET",
    gateway:    "NET_GATEWAY",
    spd:        "NET_SPD"
  };

  /* fromRow — SIEMPRE con la fila en la mano, nunca desde el tag.
     El defecto que pintó 2.648 válvulas con cuerpo genérico salió justo de
     comparar tags crudos (la planta escribe `100-HV-001`, no `HV-001`).

     `network` decide el amarillo, y NO el medio (N-4):
        ESD  → amarillo, esdSource:'network'
        PCS  → blanco
     GAP-1 · `linked_to` es texto libre: 62 de 81 filas vacías y 3 sin resolver.
             fromRow marca `topologyKnown:false` para que el trazador sepa que
             ese nodo va a necesitar gapLink().
     GAP-4 · no hay columna de IP. En cuanto exista (`ip_address`), aparece sola
             en la segunda línea de la caja: el hueco está reservado, no hay que
             tocar geometría. Mientras no exista, la caja no imprime una IP
             plausible — G-3. */
  function fromRow(row, o) {
    row = row || {}; o = o || {};
    const kindRaw = String(row.node_kind || "").toLowerCase();
    const kind = NET_MAP[kindRaw] || "UNKNOWN";
    const esd = String(row.network || "").trim().toUpperCase() === "ESD";
    return {
      kind,
      opts: Object.assign({
        tag: row.node_tag || "",
        sub2: row.ip_address || null,                 // GAP-4 — reservado
        label: o.label !== false && row.service ? String(row.service) : null,
        supply: row.supply || null,                   // bandera de borde (G-5)
        esd,
        color: esd ? ESD_INK : "#333",
        strokeWidth: 1.3,
        media: row.media || null,
        esdSource: row.network ? "network" : "gap",
        kindSource: NET_MAP[kindRaw] ? "node_kind" : "gap",
        topologyKnown: !!row.linked_to,               // GAP-1
        mediaKnown: mediaKnown(row.media),            // GAP-2
        title: [row.node_tag, row.service, row.network, row.media, row.part_number]
          .filter(Boolean).join(" · ")
      }, o)
    };
  }

  /* audit — lo que el pie del dibujo tiene que imprimir (G-4). Se le pasan las
     filas y devuelve los conteos, para que nadie los cuente a mano ni los
     olvide. Los mismos números que saca tools/norm_check.sql. */
  function audit(rows) {
    const r = { nodes: 0, unmappedKind: [], noTopology: 0, unknownMedia: [], esdNodes: 0, byMedia: {} };
    (rows || []).forEach(row => {
      r.nodes++;
      const k = String(row.node_kind || "").toLowerCase();
      if (!NET_MAP[k] && r.unmappedKind.indexOf(k) < 0) r.unmappedKind.push(k);
      if (!row.linked_to) r.noTopology++;
      const m = String(row.media || "").toUpperCase();
      if (!mediaKnown(m) && r.unknownMedia.indexOf(m) < 0) r.unknownMedia.push(m);
      if (String(row.network || "").toUpperCase() === "ESD") r.esdNodes++;
      r.byMedia[m] = (r.byMedia[m] || 0) + 1;
    });
    return r;
  }

  /* dpAudit — v0.2.0 · el pie de un esquema de BUS DE CAMPO, que no cuenta lo
     mismo que audit(). Un dibujo PROFINET se audita por nodos sin topología;
     un PROFIBUS-DP se audita por lo que impide ponerlo en marcha:

       stations       maestros + esclavos + repetidores — el número que decide
                      si cabe en el HSA y en el presupuesto de ciclo (N-13)
       unresolvedAddr direcciones que sólo se conocen como conjunto (N-12).
                      Éste es el número que hay que llevar a la puesta en marcha
       inputBytes     la carga real de trama, que es lo que fija el ciclo
       outputBytes    en un bus de sólo lectura DEBE salir 0. Imprimirlo es la
                      forma de que nadie tenga que fiarse de que alguien lo leyó
       byRole         reparto por papel, para cuadrar contra el interface list

     rows = [{role:'master'|'slave'|'repeater', addr, bytes_in, bytes_out, …}] */
  function dpAudit(rows) {
    const r = { stations: 0, masters: 0, slaves: 0, repeaters: 0,
                unresolvedAddr: 0, unknownAddr: 0, inputBytes: 0, outputBytes: 0,
                byRole: {}, addrUsed: [] };
    (rows || []).forEach(n => {
      const role = String(n.role || "slave").toLowerCase();
      r.stations++; r.byRole[role] = (r.byRole[role] || 0) + 1;
      if (role === "master") r.masters++;
      else if (role === "repeater" || role === "olm") r.repeaters++;
      else r.slaves++;
      if (Array.isArray(n.addr)) r.unresolvedAddr++;
      else if (n.addr == null) r.unknownAddr++;
      else r.addrUsed.push(n.addr);
      r.inputBytes += (+n.bytes_in || 0);
      r.outputBytes += (+n.bytes_out || 0);
    });
    /* una dirección duplicada no es un aviso: es un bus que no arranca */
    r.duplicateAddr = r.addrUsed.filter((a, i) => r.addrUsed.indexOf(a) !== i);
    return r;
  }

  const API = {
    fromRow, NET_MAP, audit, dpAudit, rules, RULES,
    setMedia, media, mediaKnown, MEDIA_DEFAULT,
    link, gapLink, ring, multidrop, chain,
    /* addrText/addrChipW se exportan y addrChip NO: los dos primeros son
       cálculo de ancho y texto, que el trazador necesita para repartir la
       página; el tercero necesita un contexto de dibujo y sólo tiene sentido
       dentro de un body(). Exportarlo invitaría a fabricar un `c` de mentira. */
    addrText, addrChipW,
    NODES: ["NET_CPU_RACK", "NET_RIO", "NET_RIO_FANS", "NET_ANALYZER",
            "NET_FO_BOX", "NET_PANEL", "NET_SWITCH", "NET_IPC", "NET_WIFI",
            /* v0.2.0 — el bus de campo */
            "NET_DP_MASTER", "NET_DP_SLAVE", "NET_OLM", "NET_TERM",
            "NET_GENSET", "NET_GATEWAY", "NET_SPD",
            /* v0.2.1 */
            "NET_REPEATER",
            /* v0.2.2 */
            "NET_CONNECTOR",
            /* v0.3.0 — el censo de 2026-08-11 */
            "NET_METER", "NET_VFD", "NET_SERVER"],
    version: "0.3.0"
  };
  const root = (typeof window !== "undefined") ? window : globalThis;
  root.TamSymNet = API;
})();
