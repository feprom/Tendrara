/* ═══════════════════════════════════════════════════════════════════════════
   tam-flow.js — Tendrara process-flow diagram library
   ─────────────────────────────────────────────────────────────────────────
   ONE renderer for every process-flow representation, generated DIRECTLY from
   the database topology layer (migrations 048/049):

     plant_service_classes  → line colours / dash / category  (was SVC_STYLE)
     plant_process_links    → area↔area crossings (v_plant_block)
     v_area_flows           → per-area IN/OUT with HMB values per case
     v_area_energy          → duty / electric power per area
     plant_area_trains      → main equipment chain per unit (unit-summary)

   Same graphic language as Module 101 (plant map · area block · unit summary).
   No dependencies. Works in the ENI viewer, in training modules, standalone.

   API (all renderers return an SVG string; cards return HTML):
     TamFlow.load(sb)                    → data bundle from a supabase client
     TamFlow.fromViewer(DB)             → data bundle from the ENI viewer DB
     TamFlow.plantMap(data, opts)       → plant block diagram (opts.highlight)
     TamFlow.areaBlock(data, code, o)   → area process block (IN | skids | OUT)
     TamFlow.unitSummary(data, code, o) → Manual §3.1 unit-flow diagram
     TamFlow.hmbCards(data, code, o)    → IN / DUTY / OUT HMB cards (html)
     TamFlow.svcClass(data, code)       → service class {color,dash,width,…}

   ELECTRICAL SINGLE-LINE (phase 11, v1.1.0 — v_sld_nodes / v_sld_edges):
     v1.2.0 — symbol geometry now comes from tam-sym.js + tam-sym-elec.js.
     Load those two BEFORE this file. Without them the legacy inline glyphs
     still draw, so the page degrades instead of breaking.
     TamFlow.sldSymbolStyle = 'IEC' (default) | 'BOX'
     TamFlow.loadSld(sb)                → {nodes, edges} bundle, indexed
     TamFlow.sldFromViewer(DB)          → same bundle from the ENI viewer DB
     TamFlow.sldBoards(sld)             → [{tag,doc_no,busbars,positions,loads}]
     TamFlow.sld(sld, boardTag, opts)   → one Power Center single-line (html)

   opts.case: 'C1S' | 'C1W' | 'C2S' | 'C2W'  (default 'C1W')
   opts.onNavigate / opts.onEquip: names of global fns for inline onclick.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const MONO = "Consolas,monospace", SANS = "Segoe UI,Arial";
  const INK = "#15171A", SOFT = "#4A4F57", LINE = "#C9CED4", CRIMSON = "#C8102E";
  const FALLBACK_CLASS = { color: "#4A4F57", dash: "", stroke_width: 1.5, category: "OTHER", name: "LINE" };

  /* ── tiny helpers ─────────────────────────────────────────────────────── */
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const clip = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const n1 = v => v == null ? "—" : (+v).toLocaleString("en-US", { maximumFractionDigits: 1 });
  const n0 = v => v == null ? "—" : Math.round(+v).toLocaleString("en-US");

  /* ── v1.30.0 · el suelo de legibilidad ───────────────────────────────────
     La paleta oficial de Tendrara ya vive en plant_service_classes.color —
     muestreada de la leyenda del cliente, no aproximada a ojo. Pero una leyenda
     de P&ID se dibuja para RELLENOS sobre un plano con trazo negro, y aquí
     los colores son LÍNEAS sobre papel blanco. Tres de ellos no sobreviven:

       LNG        #DCDCDC   luminancia .86 — invisible
       AMONIACO   #00FFFF   .79
       GAS INERTE #BFFF00   .87
       GAS        #FFBF00   .75 — legible en pantalla, malo en proyector

     La respuesta NO es retocar la paleta en la base: ahí está el estándar de
     planta y tiene que seguir estándolo. readable() baja la luminancia al
     máximo dibujable **conservando el tono**, escalando los tres canales por
     igual. El dato guarda lo que dice el cliente; el renderer garantiza que se
     vea. Misma separación que design-vs-live: una fuente, dos presentaciones. */
  const LUM_MAX = 0.55;
  const _readCache = new Map();
  function readable(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return hex;
    if (_readCache.has(hex)) return _readCache.get(hex);
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    let out = hex;
    if (lum > LUM_MAX) {
      const k = LUM_MAX / lum;
      out = "#" + [r, g, b].map(v => Math.round(v * k).toString(16).padStart(2, "0")).join("");
    }
    _readCache.set(hex, out);
    return out;
  }

  function svcClass(data, code) {
    const c = (data._svcIdx && data._svcIdx.get(code)) || FALLBACK_CLASS;
    /* one wrap, cached, so the LINE and its LEGEND swatch can never disagree */
    if (c && c.color && !c._readable) {
      c._readable = true;
      c._rawColor = c.color;
      c.color = readable(c.color);
    }
    return c;
  }
  function areaName(data, code) {
    const a = (data._areaIdx && data._areaIdx.get(String(code)));
    return a ? (a.description || "") : "";
  }
  function indexData(data) {
    data._svcIdx = new Map((data.classes || []).map(c => [c.service_code, c]));
    data._areaIdx = new Map((data.areas || []).map(a => [String(a.area_code), a]));
    return data;
  }

  /* value chip from a v_area_flows row's hmb jsonb: "16.6 MMSCFD · 46.0 barg · 4.6 °C" */
  function hmbChip(row, kase) {
    const h = row && row.hmb && (row.hmb[kase] || row.hmb.ALL);
    if (!h) return "";
    const parts = [];
    if (h.std_gas_flow_mmscfd != null && h.std_gas_flow_mmscfd >= 0.05)
      parts.push(n1(h.std_gas_flow_mmscfd) + " MMSCFD");
    else if (h.mass_flow_kg_h != null && h.mass_flow_kg_h > 0)
      parts.push(n0(h.mass_flow_kg_h) + " kg/h");
    if (h.pressure_barg != null) parts.push(n1(h.pressure_barg) + " barg");
    if (h.temperature_c != null) parts.push(n1(h.temperature_c) + " °C");
    return parts.join(" · ");
  }
  /* pick the "main" flow of an area for a direction: plant main path first, then
     by category priority (so loop/hub units like 340/360/370/410 still render) */
  function pickMain(rows, dir) {
    const pri = ["PRODUCT", "ENERGY", "REFRIGERANT", "CHEMICAL", "WATER"];
    return rows.find(f => f.direction === dir && f.is_main) ||
      pri.map(c => rows.find(f => f.direction === dir && f.category === c && f.hmb) ||
                   rows.find(f => f.direction === dir && f.category === c)).find(Boolean);
  }
  /* v1.18.0 — markerUnits="userSpaceOnUse".
     SVG's DEFAULT is markerUnits="strokeWidth", so an arrowhead is scaled by
     the line it terminates. The main process path is drawn at stroke-width 3
     and the side routes at 1.6, which meant the plant map printed arrowheads
     at two different sizes — the fat ones on the main path being roughly the
     size of a unit label. An arrowhead is punctuation: it says "direction",
     not "importance", and it has no business changing size with the pipe.
     Fixed geometry, one size everywhere. */
  function arrowMarker(id, color) {
    /* v1.24.0 — 9→7.4. This marker terminates the SIDE routes; the main path
       draws its own head explicitly and keeps the larger one. That difference
       is the point: a 9-unit head on a 1.5-unit context line is a blob, and
       when every arrow on the sheet is the same size nothing is subordinate. */
    return `<marker id="${id}" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="8" refX="7.4" refY="3.4" orient="auto"><path d="M0,0 L7.4,3.4 L0,6.8 Z" fill="${color}"/></marker>`;
  }
  function markerDefs(colors) {
    return `<defs>${[...new Set(colors)].map(c => arrowMarker("tf-" + c.replace("#", ""), c)).join("")}</defs>`;
  }
  const mref = c => `url(#tf-${c.replace("#", "")})`;

  /* ── v1.27.0 · tint(): the fluid's own colour, at the quiet level ─────────
     v1.26.0 muted every secondary line to ONE grey, which fixed the noise but
     threw the fluid away with it. Mario: "las líneas secundarias con el mismo
     % de blanco, ponle el color de proceso que le toca."

     Exactly right, and it is the better answer: the thing that made the sheet
     shout was VALUE, not hue. Mixing each service colour toward white by a
     fixed fraction keeps every secondary line at the same quiet value — so
     nothing competes with the product path — while the hue still says which
     fluid it is. One knob, applied identically to all of them, so no line can
     end up louder than its neighbours by accident.

     SIDE_TINT = 0.38 is the fraction that takes the house ink #4A4F57 to the
     #8B939C of v1.26.0, so the sheet keeps exactly the weight Mario approved. */
  function tint(hex, t) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const mix = v => Math.round(v + (255 - v) * t);
    const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
    return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
  }
  const SIDE_TINT = 0.38;

  /* ── v1.18.0 · orthogonal routing with LINE HOPS ─────────────────────────
     Two pipes that cross on a block diagram and simply overlap are ambiguous:
     the reader cannot tell a crossing from a tee. Every drafting standard
     answers it the same way — one of them hops. The convention adopted here,
     and it has to be ONE convention or it is worse than none:

         the HORIZONTAL run hops over the VERTICAL run.

     This is what Mario circled twice on the plant map: the BOG recycle coming
     down into U310 crossing the U340 run, and the fuel-gas bypass crossing the
     drop into U370. Neither was wrong data — both were unreadable geometry.

     hopPath() takes an orthogonal point list and the vertical segments of
     EVERY OTHER route, and returns one <path> d-string with a 4-unit arc at
     each genuine crossing. It walks the points in order, so the direction —
     and therefore the marker-end — survives; a right-to-left run flips the
     sweep flag so the arc still bulges upward. Crossings within CORNER units
     of the segment's own ends are ignored: that is a corner, not a crossing. */
  const HOP_R = 4, HOP_CORNER = 7;
  function segmentsOf(pts) {
    const v = [], h = [];
    for (let i = 1; i < pts.length; i++) {
      const [xa, ya] = pts[i - 1], [xb, yb] = pts[i];
      if (Math.abs(xa - xb) < 0.5 && Math.abs(ya - yb) > 0.5) v.push({ x: xa, y1: Math.min(ya, yb), y2: Math.max(ya, yb) });
      else if (Math.abs(ya - yb) < 0.5 && Math.abs(xa - xb) > 0.5) h.push({ y: ya, x1: Math.min(xa, xb), x2: Math.max(xa, xb) });
    }
    return { v, h };
  }
  function hopPath(pts, others) {
    let d = `M ${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [xa, ya] = pts[i - 1], [xb, yb] = pts[i];
      if (Math.abs(ya - yb) > 0.5 || Math.abs(xa - xb) < 0.5) { d += ` L ${xb},${yb}`; continue; }
      const lo = Math.min(xa, xb) + HOP_CORNER, hi = Math.max(xa, xb) - HOP_CORNER;
      let xs = others
        .filter(sg => sg.x > lo && sg.x < hi && ya > sg.y1 + 0.5 && ya < sg.y2 - 0.5)
        .map(sg => sg.x);
      xs = [...new Set(xs)].sort((p, q) => (xb > xa ? p - q : q - p));
      /* y is down, so sweep 1 bulges up when travelling left→right */
      const sweep = xb > xa ? 1 : 0, dir = xb > xa ? 1 : -1;
      xs.forEach(cx => {
        d += ` L ${cx - HOP_R * dir},${ya} A ${HOP_R},${HOP_R} 0 0 ${sweep} ${cx + HOP_R * dir},${ya}`;
      });
      d += ` L ${xb},${yb}`;
    }
    return d;
  }

  /* ── data loading ─────────────────────────────────────────────────────── */
  async function load(sb) {
    const all = async (t, order) => {
      let q = sb.from(t).select("*"); if (order) q = q.order(order);
      const { data, error } = await q;
      if (error) { console.warn("tam-flow: " + t + ": " + error.message); return []; }
      return data || [];
    };
    const [areas, classes, links, flows, energy, trains, equipment, skids, instruments, valves, media] = await Promise.all([
      all("plant_areas", "area_code"), all("plant_service_classes", "sort_order"),
      all("v_plant_block"), all("v_area_flows"), all("v_area_energy"),
      all("plant_area_trains", "seq"), all("plant_equipment", "tag"), all("plant_skids", "tag"),
      all("plant_instruments", "tag"), all("plant_valves", "tag"), all("v_exchanger_media")
    ]);
    return indexData({ areas, classes, links, flows, energy, trains, equipment, skids, instruments, valves, media });
  }
  function fromViewer(DB) {
    return indexData({
      areas: DB.areas || [], classes: DB.svcClasses || [], links: DB.plinks || [],
      flows: DB.aflows || [], energy: DB.aenergy || [], trains: DB.trains || [],
      equipment: DB.equip || [], skids: DB.skids || [],
      instruments: DB.inst || [], valves: DB.valves || [], media: DB.xmedia || []
    });
  }

  /* ── ESD / safety symbology ─────────────────────────────────────────────
     ESD-actuated valves (SDV/BDV/XV/UV…) draw in the ESD yellow family;
     process control valves (FV/PV/LV/TV/PCV…) stay white. The COLOUR rule is
     unchanged since v1.0; what changed in v1.18.0 is the SHAPE. */
  const ESD_YELLOW = "#F7C600";
  const isEsd = s => /^(SDV|BDV|XV|XEV|UV|SDEV|BDEV|ESD)/.test(String(s || "").trim());

  /* ── v1.18.0 · valves are ISO bow-ties, drawn by the process pack ────────
     WHAT WAS WRONG, and why it was worth a version
     Every valve on every process diagram was a ROTATED SQUARE. A diamond says
     "some valve is here"; it cannot say whether the thing closing on you is a
     modulating control valve or an ESD valve, because a diamond has nowhere to
     put an actuator. On a training slide that distinction IS the lesson.
     The pack (tam-sym-proc.js) draws the ISO 14617-8 body — bow-tie on the
     pipe axis — with the actuator that says what moves it.

     DELEGATION, NOT A FORK (G-1/G-2)
     If the pack is loaded we call it. If it is not, we fall back to the legacy
     diamond, byte-identical to v1.17.0, so no page that has not yet added the
     <script> can break. That is the same pattern phase 2 used for sldGlyph().

     THE LABEL IS SPLIT, NOT CLIPPED
     `inline_element` carries things like "PV-2001 · 45 barg". Printed as one
     centred string under a valve it overran the neighbouring equipment box —
     the defect Mario circled on slide 7. The tag and its datum are two
     different things, so they go in the kernel's two different slots: label
     (tag, bold) and sub (datum, small). Half the width, and the datum now
     reads as a datum. */
  function valveGlyph(x, y, label, labelPos) {   // labelPos: 'above' | 'below'
    const raw = String(label == null ? "" : label).trim();
    const tag = raw.split(" · ")[0].split(" ")[0];
    const sub = raw.slice(tag.length).replace(/^\s*·?\s*/, "") || null;
    const P = (typeof TamSymProc !== "undefined") ? TamSymProc : null;
    const S = (typeof TamSym !== "undefined") ? TamSym : null;
    if (P && S) {
      const f = P.fromTag(tag, { labelPos: labelPos === "below" ? "below" : "above", sub });
      /* the tag stays machine-findable for the live layer, exactly as before */
      return `<g data-live-kind="valve" data-tag="${esc(tag)}">` +
        S.draw(f.kind, Object.assign({ x, y }, f.opts)) + `</g>`;
    }
    const esd = isEsd(tag), r = esd ? 6 : 8;
    const ly = labelPos === "below" ? y + r + 22 : y - r - 12;
    return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" transform="rotate(45 ${x} ${y})"
      fill="${esd ? ESD_YELLOW : "#fff"}" stroke="${esd ? "#8A6D00" : "#333"}" stroke-width="1.4"/>
      <text x="${x}" y="${ly}" text-anchor="middle" font-family="${MONO}" font-size="7.4"
        font-weight="${esd ? 700 : 400}" fill="${esd ? "#8A6D00" : "#333"}" data-live-kind="valve" data-tag="${esc(tag)}">${esc(raw)}</text>`;
  }
  const diamond = valveGlyph;                  // legacy name, one call site left

  /* ── v1.18.0 · a valve is INSERTED IN the line, never laid ON it ──────────
     The old code drew one straight line across the whole gap and then painted
     the diamond on top of it, so the pipe ran visibly through the valve body
     and the arrowhead of the run landed inside the symbol. Both are drawing
     errors an operator reads as "the valve is not in this line".

     procLine() breaks the run at the valve's own ports (which is the only
     reason the pack guarantees ports on the pipe axis), and gives the
     arrowhead its clearance from the box it points at.

     valveW is read from the pack's geometry, not hardcoded: a redrawn symbol
     of a different width re-spaces the line by itself. Same rule the SLD
     learned the hard way when stY was pinned to 26 units.                   */
  const ARROW_GAP = 6;                         // tip-to-box clearance, main path
  /* v1.24.0 — the side routes carry a smaller head (7.4 vs 9.2) and a thinner
     line, so the main path's clearance left them visibly short of the box. Side
     by side with a headless branch, which touches the box, that reads as a
     drawing error rather than as breathing room. The clearance has to scale
     with the head it is clearing. */
  const SIDE_GAP = 2;
  function procLine(x1, x2, y, color, valveTag, labelPos) {
    const P = (typeof TamSymProc !== "undefined") ? TamSymProc : null;
    const halfW = P ? P.A : 8;
    const end = x2 - ARROW_GAP;
    if (!valveTag) return `<line x1="${x1}" y1="${y}" x2="${end}" y2="${y}" stroke="${color}" stroke-width="3" marker-end="${mref(color)}"/>`;
    /* keep the symbol off both ends: a valve hard against a box reads as part
       of it. 14 units minimum on each side, centred when the gap allows. */
    const vx = Math.max(x1 + halfW + 14, Math.min(end - halfW - 14, (x1 + end) / 2));
    return `<line x1="${x1}" y1="${y}" x2="${vx - halfW}" y2="${y}" stroke="${color}" stroke-width="3"/>` +
      `<line x1="${vx + halfW}" y1="${y}" x2="${end}" y2="${y}" stroke="${color}" stroke-width="3" marker-end="${mref(color)}"/>` +
      valveGlyph(vx, y, valveTag, labelPos);
  }
  /* instrument TAP: dot on the pipe + leader + tag — unambiguous line association */
  function tap(x, y, tag, below, color) {
    const c = color || "#0B5CAD";
    const ly = below ? y + 18 : y - 12;
    return `<circle cx="${x}" cy="${y}" r="2.4" fill="${c}" stroke="#fff" stroke-width="0.6"/>` +
      `<line x1="${x}" y1="${y + (below ? 3 : -3)}" x2="${x}" y2="${ly + (below ? -7 : 3)}" stroke="${c}" stroke-width="0.7"/>` +
      `<text x="${x}" y="${ly}" text-anchor="middle" font-family="${MONO}" font-size="6.6" fill="${c}" data-live-kind="inst" data-tag="${esc(tag)}">${esc(tag)}</text>`;
  }
  /* group PSV-2001A + PSV-2001B → PSV-2001A/B */
  function groupAB(tags) {
    const by = new Map();
    (tags || []).forEach(t => {
      const m = /^(.*?)([A-D])$/.exec(t);
      const k = m ? m[1] : t;
      if (!by.has(k)) by.set(k, []);
      if (m) by.get(k).push(m[2]);
    });
    return [...by.entries()].map(([k, sfx]) => sfx.length ? k + sfx.sort().join("/") : k);
  }
  /* key instruments / safety valves of an equipment group (index `equipment` field + service text) */
  const _matches = (r, tags) =>
    (r.equipment && tags.includes(String(r.equipment).trim())) ||
    (r.service && tags.some(t => String(r.service).toUpperCase().includes(t.toUpperCase())));
  const MEDIUM_RX = /HOT OIL|AMMONIA|NH3|STEAM|LUBE OIL/;   // heating/cooling media
  function equipKeyInstruments(data, tags, max, unit) {
    const KEY = /^(PT|PDT|TT|LT|LIT|FT|AT)-/;
    const m = (data.instruments || []).filter(i => !i.removed && KEY.test(i.tag || "") && _matches(i, tags)
      && (unit == null || i.unit == null || String(i.unit) === String(unit))   // same unit only
      && !MEDIUM_RX.test(String(i.service || "").toUpperCase()));        // media go to the utility line
    return [...new Set(m.map(i => i.tag))].sort().slice(0, max || 6);
  }
  /* instruments measuring the MEDIUM that feeds this equipment ("HOT OIL TO E-201…") —
     drawn beside the utility (aux) arrow of the destination box. */
  function mediumInstruments(data, tags) {
    const m = (data.instruments || []).filter(i => {
      if (i.removed || !/^(TT|TE|TG|TI|TIC|PT|PG|PI|PIC|PDT|FT|FE)-/.test(i.tag || "")) return false;
      const svc = String(i.service || "").toUpperCase();
      return MEDIUM_RX.test(svc) && tags.some(t => svc.includes(t.toUpperCase()));
    });
    return [...new Set(m.map(i => i.tag))].sort().slice(0, 4);
  }
  function equipSafetyValves(data, tags) {
    const m = (data.valves || []).filter(v => !v.removed && /^(PSV|TSV|VSV)-/.test(v.tag || "") && _matches(v, tags));
    return groupAB([...new Set(m.map(v => v.tag))].sort()).slice(0, 3);
  }
  /* flow-origin rule (mirrors v_instrument_flow_origin): which equipment does a
     flow instrument measure the outlet of? Parsed from the index service text;
     transmitters inherit their flow element's service via `equipment`. */
  function flowOrigin(data, tag) {
    const by = t => (data.instruments || []).find(i => (i.tag || "").trim() === t && !i.removed);
    const i = by(tag);
    if (!i) return null;
    let svc = String(i.service || "").toUpperCase();
    const fe = i.equipment ? by(String(i.equipment).trim()) : null;
    if (fe && fe.service) svc = String(fe.service).toUpperCase() || svc;
    const m = /FROM ([A-Z]{1,3}-[0-9]+[A-Z]?)/.exec(svc) || /^([A-Z]{1,3}-[0-9]+[A-Z]?) OUTLET/.exec(svc);
    return m ? m[1] : null;
  }
  /* port association (053): T/P instruments whose service names the equipment AND the
     port — "E-201 OUTLET TEMPERATURE", "V-202 GAS OUTLET TEMPERATURE" → drawn on the
     equipment's inlet/outlet line segment, not inside the box. */
  function portInstruments(data, tags) {
    const res = { INLET: [], OUTLET: [] };
    (data.instruments || []).forEach(i => {
      if (i.removed || !/^(TT|TE|TG|TI|TIC|PT|PG|PI|PIC|PDT)-/.test(i.tag || "")) return;
      const svc = String(i.service || "").toUpperCase();
      if (MEDIUM_RX.test(svc)) return;         // medium instruments live on the utility line
      const org = (/FROM ([A-Z]{1,3}-[0-9]+[A-Z]?)/.exec(svc) || /^([A-Z]{1,3}-[0-9]+[A-Z]?) /.exec(svc) || [])[1];
      if (!org || !tags.includes(org)) return;
      const port = /INLET/.test(svc) ? "INLET" : /OUTLET/.test(svc) ? "OUTLET" : null;
      if (port) res[port].push(i.tag);
    });
    res.INLET = [...new Set(res.INLET)].slice(0, 3);
    res.OUTLET = [...new Set(res.OUTLET)].slice(0, 3);
    return res;
  }

  /* ═════════════════════════════════════════════════════════════════════
     1 · PLANT MAP — all process areas, main path on the centre line
     ═════════════════════════════════════════════════════════════════════ */
  function plantMap(data, opts) {
    opts = opts || {};
    const kase = opts.case || "C1W";
    const hi = opts.highlight != null ? String(opts.highlight) : null;
    const nav = opts.onNavigate;
    const links = data.links || [];
    const hideCat = new Set(opts.showAll ? [] : ["UTILITY", "DRAIN", "RELIEF", "OTHER"]);

    /* main chain from is_main links */
    const mains = links.filter(l => l.is_main).sort((a, b) => (a.display_rank || 0) - (b.display_rank || 0));
    const chain = [];           // [{kind:'ext'|'area', label, name}]
    mains.forEach(l => {
      const f = l.from_area ? { kind: "area", label: l.from_area } : { kind: "ext", label: l.from_ext };
      const t = l.to_area ? { kind: "area", label: l.to_area } : { kind: "ext", label: l.to_ext };
      if (!chain.length) chain.push(f);
      else if (chain[chain.length - 1].label !== f.label) chain.push(f);
      chain.push(t);
    });
    const chainAreas = new Set(chain.filter(c => c.kind === "area").map(c => c.label));

    /* side areas grouped top/bottom by dominant category of their visible links */
    const sideLinks = links.filter(l =>
      !l.is_main && !hideCat.has(l.category) &&
      l.from_area && l.to_area &&
      (chainAreas.has(l.from_area) !== chainAreas.has(l.to_area)));
    const sideAreas = new Map();  // area → {cats:Set, partners:[chain areas]}
    sideLinks.forEach(l => {
      const side = chainAreas.has(l.from_area) ? l.to_area : l.from_area;
      if (chainAreas.has(side)) return;
      if (!sideAreas.has(side)) sideAreas.set(side, { cats: new Set(), partners: [] });
      const s = sideAreas.get(side);
      s.cats.add(l.category);
      s.partners.push(chainAreas.has(l.from_area) ? l.from_area : l.to_area);
    });

    /* geometry */
    /* v1.18.0 — the side bands were 130px tall and carrying five lanes, so
       every crossing landed on top of a unit label. Taller sheet, wider
       bands: the routes did not change, the room they get did. */
    const W = 1000, H = 452, BW = 108, BH = 58, mainY = 236;
    const SIDE_W = 1.5;          // context lines
    /* ── v1.26.0 · overview draws the context in ONE muted ink ──────────────
       Mario: "todas las líneas que no sean del proceso principal deben ser de
       color tenue… un plomo oscuro pero que no llene la visión."

       Colour is the loudest channel there is, and seven fluids each shouting
       their own hue drowned the one line the slide is about. Muting them costs
       nothing NOW — and only now — because since v1.25 every trunk is labelled
       with its fluid IN WORDS: HOT OIL, PROCESS WATER, NH3, CORROSION
       INHIBITOR. The colour had become a second, weaker copy of the label.
       Say it once, in the channel that survives a projector and a photocopy.

       This is a PRESENTATION rule and it lives only in the overview branch.
       `full` — what the viewer draws — keeps the fluid colours from
       plant_service_classes untouched. The data did not change. */
    const SIDE_INK = "#8B939C";
    const MAIN_W = 2.6;          // the plant's product path — the subject
    const BOX_SW = 1.2;          // box outline: a frame, not a pipe
    const nodePos = new Map();
    /* ── v1.21.0 · the battery limits stop eating a full slot ────────────────
       Every chain node used to get the same width, including the two EXTERNAL
       endpoints — which are a right-aligned label and a dashed tick, not a box.
       Two of the seven slots were paying box rent for a caption, and the five
       real units were squeezed to a 16-unit gap because of it.
       An ext endpoint now gets EXTW, and everything it gives back goes to the
       process units, where the pipe actually needs the room. */
    const EXTW = 92;
    const nExt = chain.filter(c => c.kind === "ext").length;
    const nBox = chain.length - nExt;
    const slot = nBox ? (W - 60 - nExt * EXTW) / nBox : 0;
    let cx0 = 30;
    chain.forEach(c => {
      const wSlot = c.kind === "ext" ? EXTW : slot;
      if (!nodePos.has(c.label))
        nodePos.set(c.label, { x: cx0 + (wSlot - BW) / 2, y: mainY, kind: c.kind });
      cx0 += wSlot;
    });
    /* ── v1.24.0 · which row a side unit goes on ──────────────────────────
       Mario, looking at the crowded top band: "bajando 370 talvez".

       The row used to be decided by the FLUID CATEGORY — PRODUCT and
       REFRIGERANT up, everything else down. That is a property of what flows,
       and it has nothing to do with whether the drawing works: it put U370,
       whose trunk spans almost the whole sheet, on the same band as U410, U340
       and U360, so four wide runs stacked in one place and every one of them
       crossed the others.

       The row is a LAYOUT decision, so it is decided by layout: a unit goes on
       the row where its horizontal span overlaps FEWER trunks already placed
       there. Widest spans are placed first, because they are the ones with no
       freedom left once the band is full. The category survives only as the
       tie-break, which is the right weight for it — it is a preference, not a
       constraint.

       A span is [min, max] of its partners' x, and those come from the chain,
       which is already positioned. So the cost is knowable before placing —
       no iteration, no guessing. */
    const spanOf = st => {
      const xs = st.partners.map(pp => (nodePos.get(pp) || { x: W / 2 }).x);
      return xs.length ? [Math.min(...xs), Math.max(...xs)] : [W / 2, W / 2];
    };
    const overlaps = (arr, sp) => arr.filter(o => o[0] < sp[1] && sp[0] < o[1]).length;
    /* ── v1.28.0 · el PAPEL manda la banda, el solapamiento manda el sitio ──
       Mario, on the tangle under U310: "BOG entering 310 should be in the
       middle, too many lines together."

       He is pointing at a symptom of v1.24. That version replaced "row by
       fluid category" with "row by span overlap", which fixed crowding but
       threw out meaning with it — so U360, whose BOG is a PROCESS RECYCLE back
       into 310, was filed at the bottom among the sinks (water, flare,
       inhibitor), and its trunk had to climb the full height of the sheet to
       reach U310 exactly where the process water comes down. Four lines in one
       place, and none of them related.

       Neither rule was right alone. A unit's ROLE says which BAND it belongs
       in; the span overlap says WHERE IN THAT BAND it sits. v1.24 was letting
       one criterion answer both questions and only one of them was its own.

         above the chain — what the process gives back: recycles and
                           refrigerant (PRODUCT / REFRIGERANT)
         below the chain — what leaves it and does not come back: energy,
                           water, chemicals, sinks

       So BOG joins NH3 on the cold side, which is where an operator already
       thinks it lives, and U310's underside is left to the process water alone.
       Overlap still breaks ties and still orders each band, so the crossing
       count v1.24 bought is not given back. */
    const roleTop = st => {
      const c = st.cats;
      if (c.has("REFRIGERANT")) return true;
      if (c.has("ENERGY") || c.has("WATER") || c.has("CHEMICAL")) return false;
      return c.has("PRODUCT");
    };
    const tops = [], bots = [], tSpan = [], bSpan = [];
    [...sideAreas.entries()]
      .map(([a, st]) => ({ a, st, sp: spanOf(st) }))
      .sort((p, q) => (q.sp[1] - q.sp[0]) - (p.sp[1] - p.sp[0]))     // widest first
      .forEach(({ a, st, sp }) => {
        const band = roleTop(st);
        /* overlap only gets a vote when the role is genuinely mixed */
        const mixed = st.cats.has("PRODUCT") && (st.cats.has("ENERGY") || st.cats.has("WATER"));
        const ct = overlaps(tSpan, sp), cb = overlaps(bSpan, sp);
        const useTop = mixed && ct !== cb ? ct < cb : band;
        (useTop ? tops : bots).push([a, st]);
        (useTop ? tSpan : bSpan).push(sp);
      });
    const place = (arr, y) => {
      arr.map(([a, s]) => {
        const xs = s.partners.map(p => (nodePos.get(p) || { x: W / 2 }).x);
        return [a, xs.reduce((u, v) => u + v, 0) / (xs.length || 1)];
      }).sort((p, q) => p[1] - q[1]).forEach(([a, x], i, all) => {
        let px = Math.max(20, Math.min(W - BW - 20, x));
        if (i > 0) { const prev = nodePos.get(all[i - 1][0]); if (prev && px < prev.x + BW + 24) px = prev.x + BW + 24; }
        nodePos.set(a, { x: px, y, kind: "area" });
      });
    };
    place(tops, 42); place(bots, 372);

    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">`;
    const colors = new Set(["#4A4F57", SOFT, SIDE_INK]);
    sideLinks.forEach(l => {
      const c = svcClass(data, l.service_code).color;
      colors.add(c); colors.add(tint(c, SIDE_TINT));       // overview draws the tint
    });
    mains.forEach(l => colors.add(svcClass(data, l.service_code).color));
    s += markerDefs([...colors]);

    /* flows by link id (for value chips) */
    const flowById = new Map();
    (data.flows || []).forEach(f => { if (!flowById.has(f.id)) flowById.set(f.id, f); });

    /* main-path arrows (chips drawn later, above the node layer) */
    const chips = [];
    mains.forEach(l => {
      const f = nodePos.get(l.from_area || l.from_ext), t = nodePos.get(l.to_area || l.to_ext);
      if (!f || !t) return;
      const st = svcClass(data, l.service_code);
      /* ── v1.21.0 · the main path is a SPINE, not six stubs ──────────────
         Chain boxes sit ~16 units apart. The run was drawn edge-to-edge inside
         that gap, so after subtracting the arrow clearance there were 8 units
         of line carrying an 11-unit arrowhead: the head was LONGER than the
         pipe it terminated. Every one of those six gaps is what Mario ringed
         in yellow, and he ringed them because they do not read as a process
         line — they read as loose triangles between boxes.

         A process line does not stop at a box, it goes THROUGH it. So the
         segment is now drawn centre-to-centre and the boxes, which are opaque
         and painted afterwards, cover the middle. What is left visible in the
         gap is one continuous pipe with a head on it. The head is placed
         explicitly at the gap centre instead of riding marker-end, because
         marker-end lands where the LINE ends and the line now ends under a box.

         v1.18.0's battery-limit fix survives: an external endpoint still
         departs from its drawn tick, not from a box that is not there. */
      const y = mainY + BH / 2;
      const x1 = f.kind === "ext" ? f.x + BW - 4 : f.x + BW / 2;
      const x2 = t.kind === "ext" ? t.x + 4 : t.x + BW / 2;
      s += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${st.color}" stroke-width="${MAIN_W}"/>`;
      /* arrowhead centred in the visible gap between the two boxes */
      const gA = f.kind === "ext" ? f.x + BW - 4 : f.x + BW;
      const gB = t.kind === "ext" ? t.x + 4 : t.x;
      s += `<path d="M0,-4.6 L9.2,0 L0,4.6 Z" fill="${st.color}" transform="translate(${(gA + gB) / 2 - 4.6},${y})"/>`;
      const chip = hmbChip(flowById.get(l.id), kase).split(" · ")[0];   // short: flow only
      if (chip) chips.push([(x1 + x2) / 2, mainY + BH + 13, (l.stream_code ? l.stream_code + " · " : "") + chip]);
    });

    /* side routes (orthogonal) — geometry first, ink second.
       v1.18.0: the routes are COMPUTED into a list, then drawn, because a hop
       needs to know about every other route and you cannot know that while you
       are still emitting strings one at a time. */
    /* ═══ v1.19.0 · detail:'overview' — TRUNK BUNDLING ═══════════════════════
       Mario, on the v1.18.0 map: "demasiado detalle para un overview".
       He is right, and the fix is NOT to hide links — it is to stop drawing a
       separate polyline for every one of them.

       33 side links between 7 side areas and the chain became 19 polylines,
       and 19 polylines fanning across one sheet is a hairball no matter how
       clean each individual route is. But look at what those 19 actually are:
       U410 feeds 200 AND 330; U530 receives from 200, 310 AND 330. That is not
       19 relationships. That is 7 units, each with a bundle.

       So an overview draws ONE TRUNK per (side area, direction): a single stem
       out of the side box, one horizontal run, and a short branch into each
       chain unit it actually touches. Every link is still on the drawing —
       nothing is filtered, nothing is dropped, G-4 intact — but the eye reads
       "U410 serves these two units" as one gesture instead of two crossings.

       'full' (the default) keeps the v1.18.0 behaviour, so the viewer does not
       change under anyone. The training deck asks for 'overview'.            */
    if (opts.detail === "overview") {
      /* ═══ OVERVIEW — one trunk per side area ════════════════════════════════
         Three rules, each of them a defect Mario found and none of them
         cosmetic. They are listed in the order they were learned.

         1 · ONE TRUNK PER AREA (v1.19/1.20). plant_process_links is a table of
             LINES; 33 side links became 19 polylines because the map drew one
             per line. But U410 feeding 200 AND 330 is not two relationships,
             it is one bundle. Keying by (area, direction) still gave U410 two
             parallel gold trunks, so the key is the AREA and direction moved
             onto the terminals:  AN ARROWHEAD MARKS A DESTINATION.  A branch
             is headed at its chain box when that unit receives; the stem is
             headed at the side box when the side unit receives. Never a head
             at the lane — a corner is not a destination. Heads at both ends
             means bidirectional, on ONE line.

         2 · ONE DESTINATION → A STRAIGHT DROP (v1.22). U120 feeds exactly one
             unit and was still drawn as a bundle: stem, corner, run, corner,
             branch. A dog-leg between two boxes that are nearly in line invites
             the reader to look for the reason the pipe turns, and there is
             none. The side box slides under its entry point first — only if
             the seat is free, otherwise the honest dog-leg stays.

         3 · THE HORIZONTAL HOPS (v1.22). Making the drops straight put them
             across other trunks' lanes, which re-introduced the very ambiguity
             hopPath() was written for. Same convention as everywhere else:
             the horizontal hops over the vertical. Which is why this branch is
             TWO passes — you cannot know what to hop over while you are still
             emitting the thing that has to hop.

         Nothing is filtered. Every one of the 33 links is on the sheet; what
         changed is that they are grouped. G-4 intact — the footer prints the
         count, so the grouping is visible rather than assumed.               */
      /* ── v1.29.0 · un haz se nombra por su SERVICIO DOMINANTE ─────────────
         Mario: "¿BOG y fuel gas son lo mismo? revisar el concepto."

         No lo son, y la base nunca dijo que lo fueran. Son tres clases
         distintas, con categoría y color propios:

           BG · BOIL-OFF GAS   · PRODUCT   verde   — lo que se evapora del LNG
           FG · FUEL GAS       · ENERGY    naranja — gas que se quema
           NG · NATURAL GAS    · PRODUCT   carmesí

         Están emparentados —el BOG acaba en parte en la red de fuel gas— pero
         uno es una CORRIENTE y el otro un SERVICIO. El que los hacía parecer
         intercambiables era el dibujo, y el defecto lo metí yo en v1.25.0:
         trunkLabel() bautizaba un haz entero con UNA de sus descripciones, la
         primera que casara con una lista de patrones. Resultado:

           · el haz de U360 lleva BG×2 (al sobrecalentador) y NG×2 (el reciclo
             de vuelta a U310) y se imprimía "BOG" — la mitad no lo es;
           · el de U370 lleva NG×6 y DC×2 y se imprimía "FUEL GAS" porque UNA de
             las seis descripciones empieza por "Fuel gas" — y entre las otras
             hay "N2-rich gas to E-372", que no es fuel gas de ninguna manera.

         Y el color lo elegía `[...codes][0]`, o sea el ORDEN DE INSERCIÓN del
         Set: U360 salía carmesí (NG) cuando su clase dominante es BG (verde).

         Ahora: la clase DOMINANTE del haz por número de líneas, desempate por
         sort_order. Su `name` es la etiqueta —está en la tabla, no hay que
         adivinarlo de una descripción— y su `color` es el tono. Si el haz
         lleva más clases, se imprime "+N": un haz mixto no puede presentarse
         como si fuera puro. */
      function domCode(codes, links) {
        const cnt = new Map();
        (links || []).forEach(l => { if (l.service_code) cnt.set(l.service_code, (cnt.get(l.service_code) || 0) + 1); });
        const list = [...(codes || [])];
        if (!list.length) return null;
        return list.sort((x, y) =>
          (cnt.get(y) || 0) - (cnt.get(x) || 0) ||
          ((svcClass(data, x).sort_order || 99) - (svcClass(data, y).sort_order || 99)))[0];
      }
      function trunkLabel(links, codes, dom) {
        const st = svcClass(data, dom);
        const nm = (st && st.name) ? String(st.name) : (dom || "");
        const extra = Math.max(0, [...(codes || [])].length - 1);
        return clip(nm, 22) + (extra ? " +" + extra : "");
      }

      const trunks = new Map();          // sideArea → {partners: Map(chainA→{out,in}), codes}
      sideLinks.forEach(l => {
        const sideA = chainAreas.has(l.from_area) ? l.to_area : l.from_area;
        const chainA = chainAreas.has(l.from_area) ? l.from_area : l.to_area;
        if (!trunks.has(sideA)) trunks.set(sideA, { sideA, partners: new Map(), codes: new Set(), links: [] });
        trunks.get(sideA).links.push(l);
        const tr = trunks.get(sideA);
        if (!tr.partners.has(chainA)) tr.partners.set(chainA, { out: false, in: false, codes: new Set() });
        tr.partners.get(chainA)[l.from_area === sideA ? "out" : "in"] = true;
        if (l.service_code) { tr.codes.add(l.service_code); tr.partners.get(chainA).codes.add(l.service_code); }
      });

      /* ── v1.23.0 · PORTS BY FLUID ────────────────────────────────────────
         Mario: "la conexión de la unidad 530 entra a cada unidad por el mismo
         puerto; correspondería crearle a cada unit puertos de entrada por tipo
         de fluido que se intercambia."

         Right, and it is a modelling gap rather than a drawing one. Every
         connection entered its box at the centre, so on U310 the oily water
         and the natural gas arrived at the same point. A box with one hole in
         it says every fluid is the same fluid.

         A unit now has PORTS, and the position of a port is decided by the
         FLUID, from `plant_service_classes.sort_order` — the same table that
         already decides the colour. Not by drawing order, which would move a
         port whenever an unrelated link was added, and not hardcoded, which is
         the rule the process side has held since the service classes landed.

         The allocation is PER BOX over the fluids that actually reach it,
         ordered by that global sort_order. So the ORDER is canonical
         everywhere — hydrocarbon before utility before water, left to right,
         on every unit — while a box with two connections still gets two
         well-separated ports instead of eight slivers. Consistency of
         sequence, not of absolute position: a diagram is not a nozzle
         orientation drawing.

         The highlighted unit allocates its top ports in the right 58 % of the
         edge, because the "you are here" tab owns the left 86 units and an
         arrowhead underneath it is an arrowhead nobody sees (v1.20.0). */
      const svcRank = c => {
        const k = (data._svcIdx || new Map()).get(c);
        return k && k.sort_order != null ? +k.sort_order : 999;
      };
      const bestCode = set => [...(set || [])].sort((a, b) => svcRank(a) - svcRank(b))[0] || "XX";
      /* edge → ordered list of fluid codes reaching that box on that edge */
      const portsOf = new Map();                 // "label|top"|"label|bot" → [code,…]
      const addPort = (label, top, code) => {
        const k = label + "|" + (top ? "T" : "B");
        if (!portsOf.has(k)) portsOf.set(k, new Set());
        portsOf.get(k).add(code);
      };
      trunks.forEach(tr => {
        const sp = nodePos.get(tr.sideA); if (!sp) return;
        const top = sp.y < mainY;
        tr.partners.forEach((d, chainA) => addPort(chainA, top, bestCode(d.codes)));
      });
      const portList = (label, top) => {
        const k = label + "|" + (top ? "T" : "B");
        return [...(portsOf.get(k) || new Set())].sort((a, b) => svcRank(a) - svcRank(b));
      };
      /* x of a fluid's port on a box edge */
      const portX = (p, label, top, code) => {
        const list = portList(label, top);
        const i = Math.max(0, list.indexOf(code));
        const x0 = p.x + 14, x1 = p.x + BW - 14;
        return list.length <= 1 ? (x0 + x1) / 2
          : x0 + (x1 - x0) * (i + 0.5) / list.length;
      };


      /* slide single-partner side boxes under their entry point (rule 2) */
      trunks.forEach(tr => {
        if (tr.partners.size !== 1) return;
        const sp = nodePos.get(tr.sideA), [pa] = [...tr.partners.keys()], pp = nodePos.get(pa);
        if (!sp || !pp) return;
        /* line the box up with ITS OWN PORT, not with the box centre — the two
           stopped being the same thing in v1.23.0 */
        const want = portX(pp, pa, sp.y < mainY, bestCode(tr.partners.get(pa).codes)) - BW / 2;
        const clash = [...nodePos.entries()].some(([lb, q]) =>
          lb !== tr.sideA && q.y === sp.y && Math.abs(q.x - want) < BW + 24);
        if (!clash) sp.x = Math.max(8, Math.min(W - BW - 8, want));
      });

      /* ── pass 1 · geometry only ─────────────────────────────────────────── */
      const items = [];
      let laneT = 0, laneB = 0;
      trunks.forEach(tr => {
        const sp = nodePos.get(tr.sideA); if (!sp) return;
        const px = [...tr.partners.entries()]
          .map(([a, d]) => ({ a, p: nodePos.get(a), d })).filter(e => e.p);
        if (!px.length) return;
        const top = sp.y < mainY;
        const dom = domCode(tr.codes, tr.links);
        tr.dom = dom;
        const st = svcClass(data, dom);
        const sEdge = top ? sp.y + BH : sp.y;
        const cEdge = top ? mainY : mainY + BH;
        const it = { tr, st, top, sEdge, cEdge, px, v: [] };
        if (px.length === 1) {
          it.kind = "straight";
          it.vx = Math.max(sp.x + 12, Math.min(sp.x + BW - 12,
            portX(px[0].p, px[0].a, top, bestCode(px[0].d.codes))));
          it.v.push({ x: it.vx, y1: Math.min(sEdge, cEdge), y2: Math.max(sEdge, cEdge) });
        } else {
          it.kind = "bundle";
          const lane = top ? laneT++ : laneB++;
          it.ym = top ? mainY - 26 - lane * 15 : mainY + BH + 34 + lane * 15;
          it.lane = lane;
          it.stemX = sp.x + BW / 2;
          it.bx = px.map(e => portX(e.p, e.a, top, bestCode(e.d.codes)));
          it.x1 = Math.min(it.stemX, ...it.bx);
          it.x2 = Math.max(it.stemX, ...it.bx);
          it.v.push({ x: it.stemX, y1: Math.min(sEdge, it.ym), y2: Math.max(sEdge, it.ym) });
          it.bx.forEach(x => it.v.push({ x, y1: Math.min(cEdge, it.ym), y2: Math.max(cEdge, it.ym) }));
        }
        items.push(it);
      });

      /* ── pass 2 · ink, with the horizontals hopping every other vertical ── */
      const allV = items.flatMap(it => it.v);
      items.forEach(it => {
        const st = it.st, top = it.top;
        /* ── v1.24.0 · ink hierarchy ────────────────────────────────────────
           Every line on the sheet was carrying the same weight, so the plant's
           main product path — the thing the slide is about — competed with the
           utility that feeds one exchanger. Side trunks drop to SIDE_W and the
           main path keeps its own weight: the fluid colours are untouched
           (they are data, from plant_service_classes), only the emphasis
           changes. Subject at full strength, context one step back. */
        /* no fluid dash here either: on this sheet DASH has exactly one
           meaning — "aggregate, not a pipe" — and a channel carrying two
           meanings is worth less than a channel carrying none. */
        const ink = tint(st.color, SIDE_TINT);
        const stroke = `stroke="${ink}" stroke-width="${SIDE_W}"`;
        const head = `${stroke} marker-end="${mref(ink)}"`;
        let g = `<g><title>${esc(it.tr.sideA + " ↔ " + [...it.tr.partners.keys()].join(", ") + " · " + [...it.tr.codes].join(" "))}</title>`;
        if (it.kind === "straight") {
          const e = it.px[0], vx = it.vx;
          g += `<line x1="${vx}" y1="${it.sEdge}" x2="${vx}" y2="${it.cEdge}" ${stroke}/>`;
          if (e.d.out) g += `<line x1="${vx}" y1="${it.sEdge}" x2="${vx}" y2="${it.cEdge + (top ? -SIDE_GAP : SIDE_GAP)}" ${head}/>`;
          if (e.d.in) g += `<line x1="${vx}" y1="${it.cEdge}" x2="${vx}" y2="${it.sEdge + (top ? SIDE_GAP : -SIDE_GAP)}" ${head}/>`;
          /* v1.28.0 — twice now this label has been positioned as a fraction
             of the drop and twice the drop changed under it: first into the
             lane band, then onto the row of HMB flow chips. Both times the
             cause was the same — it was anchored to a length that other rules
             are free to change.

             It anchors to the SIDE BOX instead. That end is fixed (the side
             row's y), it is below every lane and every chip by construction,
             and it puts the name of the fluid right next to the unit that
             sends it — CORROSION INHIBITOR beside UNIT 120. */
          g += `<text x="${vx + 6}" y="${it.sEdge + (top ? 14 : -12)}" font-family="${MONO}" font-size="7.4" fill="${ink}"
            paint-order="stroke" stroke="#fff" stroke-width="3">${esc(trunkLabel(it.tr.links, it.tr.codes, it.tr.dom))}</text>`;
        } else {
          const mine = new Set(it.v.map(sg => sg.x + ":" + sg.y1));
          const others = allV.filter(sg => !mine.has(sg.x + ":" + sg.y1));
          g += `<line x1="${it.stemX}" y1="${it.sEdge}" x2="${it.stemX}" y2="${it.ym}" ${stroke}/>`;
          g += `<path d="${hopPath([[it.x1, it.ym], [it.x2, it.ym]], others)}" fill="none" ${stroke}/>`;
          if (it.px.some(e => e.d.in))
            g += `<line x1="${it.stemX}" y1="${it.ym}" x2="${it.stemX}" y2="${it.sEdge + (top ? SIDE_GAP : -SIDE_GAP)}" ${head}/>`;
          it.px.forEach((e, k) => {
            const bx2 = it.bx[k];
            /* the arrow clearance is only owed when there IS an arrow; without
               a head the branch has to reach the box or it reads as a stub */
            const yEnd = it.cEdge + (e.d.out ? (top ? -SIDE_GAP : SIDE_GAP) : 0);
            g += `<line x1="${bx2}" y1="${it.ym}" x2="${bx2}" y2="${yEnd}" ${e.d.out ? head : stroke}/>`;
          });
          const codes = trunkLabel(it.tr.links, it.tr.codes, it.tr.dom);
          g += `<text x="${it.x1 + (it.x2 - it.x1) * (it.lane % 2 ? 0.66 : 0.34)}" y="${it.ym - 4}" text-anchor="middle" font-family="${MONO}" font-size="7.4" fill="${ink}"
            paint-order="stroke" stroke="#fff" stroke-width="3">${esc(codes)}</text>`;
        }
        s += g + `</g>`;
      });

      /* ── v1.25.0 · the relief header, aggregated ─────────────────────────
         The footer used to end with "utilities/relief/drains hidden", which was
         honest but expensive: 99 of 179 links were off the sheet, and the
         biggest group of them — 39 PSV discharges from 9 units into the flare —
         is the one an operator most needs to know exists.

         Drawing 39 lines is out of the question. So it is drawn as ONE line,
         and the line is explicitly NOT a pipe: no fluid colour, grey, dashed,
         and labelled with its own count. Dash is safe HERE and nowhere else —
         plant_service_classes already assigns a dash to 5 fluids, so dash means
         "this fluid" on any coloured line. A grey line carries no fluid, so a
         grey dash cannot be confused with one: it reads "this is a summary".

         That is the rule, and it is worth stating because it is the trap:
             dash + fluid colour = that fluid's line style   (data)
             dash + grey         = an aggregate, not a pipe  (drawing)         */
      const reliefs = links.filter(l => l.category === "RELIEF" && l.to_area && nodePos.has(l.to_area));
      const reliefUnits = new Set(reliefs.map(l => l.from_area).filter(Boolean)).size;
      if (reliefs.length) {
        const dest = reliefs[0].to_area, dp = nodePos.get(dest);
        const from = [...new Set(reliefs.map(l => l.from_area).filter(Boolean))];
        /* the chain units only say WHERE the line starts; the count is the
           whole header, side units included — otherwise the label would
           under-report the very thing it exists to report */
        const xs = from.filter(a => chainAreas.has(a))
          .map(a => nodePos.get(a)).filter(Boolean).map(q => q.x + BW / 2);
        if (dp && xs.length) {
          /* ONE line, and it starts in a GAP between two units — never on a
             box. A dashed line leaving U330's edge would say "U330 relieves to
             the flare", which is false: nine units do. Leaving from the gap
             attributes it to the header, not to a unit, and the label carries
             the count. This is the same reason the example sheet puts its
             flare box off to one side. */
          const top = dp.y < mainY;
          const chainXs = chain.filter(c => c.kind !== "ext")
            .map(c => nodePos.get(c.label)).filter(Boolean).sort((u, v) => u.x - v.x);
          const gaps = chainXs.slice(1).map((q, i) => (chainXs[i].x + BW + q.x) / 2);
          const mid = xs.reduce((u, v) => u + v, 0) / xs.length;
          const sx = gaps.length ? gaps.reduce((g, h) => Math.abs(h - mid) < Math.abs(g - mid) ? h : g) : mid;
          /* the lane band is bounded by the side row, and with three bundles
             already on this side the naive lane fell BELOW the flare box: the
             final drop became 3 units long and the arrowhead a stub. Clamp to
             stay clear of the row it is heading for. */
          const lane = (top ? laneT : laneB) + 1;
          const raw = top ? mainY - 26 - lane * 15 : mainY + BH + 34 + lane * 15;
          const ym = top ? Math.min(raw, dp.y + BH + 20) : Math.max(raw, 0) && Math.min(raw, dp.y - 22);
          const dx = dp.x + BW - 22;
          const g = `stroke="${SIDE_INK}" stroke-width="1.3" stroke-dasharray="5 3.5"`;
          s += `<g opacity=".9"><title>${esc(reliefs.length + " PSV / relief lines · " + from.join(", ") + " → " + dest)}</title>
            <line x1="${sx}" y1="${top ? mainY : mainY + BH}" x2="${sx}" y2="${ym}" ${g}/>
            <path d="${hopPath([[sx, ym], [dx, ym]], allV)}" fill="none" ${g}/>
            <line x1="${dx}" y1="${ym}" x2="${dx}" y2="${(top ? dp.y + BH : dp.y) + (top ? SIDE_GAP : -SIDE_GAP)}" ${g} marker-end="${mref(SIDE_INK)}"/>
            <text x="${(sx + dx) / 2}" y="${ym - 4}" text-anchor="middle" font-family="${MONO}" font-size="7.2" fill="${SIDE_INK}"
              paint-order="stroke" stroke="#fff" stroke-width="3">HP/LP RELIEFS</text></g>`;
        }
      }

      s += drawNodes();
      s += `<text x="20" y="${H - 8}" font-family="${MONO}" font-size="7.5" fill="${SOFT}">OVERVIEW · ${sideLinks.length} LINKS IN ${trunks.size} TRUNKS + ${reliefs.length} RELIEF LINES FROM ${reliefUnits} UNITS AGGREGATED · DASH = AGGREGATE, NOT A PIPE · HMB ${esc(kase)} · utilities &amp; drains hidden</text></svg>`;
      return s;
    }

    /* ── v1.18.0 · one route per (pair, category), not one per LINE ──────────
       plant_process_links is a LINE-level table: U310→U230 can be four relief
       lines with four service codes, and the map was drawing four parallel
       polylines between the same two boxes. On a block diagram that is noise —
       the reader is being asked to count pipes on a drawing whose whole job is
       to hide pipes. One route carries the pair, and its label lists the
       service codes it stands for, so nothing is hidden, only merged.
       G-4 still holds: what got merged is printed, never silently dropped. */
    const byPair = new Map();
    sideLinks.forEach(l => {
      const k = l.from_area + "|" + l.to_area + "|" + (l.category || "");
      if (!byPair.has(k)) byPair.set(k, []);
      byPair.get(k).push(l);
    });
    const mergedLinks = [...byPair.values()].map(g => {
      const rep = g.find(l => l.hmb) || g[0];
      const codes = [...new Set(g.map(l => l.service_code).filter(Boolean))];
      return Object.assign({}, rep, {
        service_code: codes.slice(0, 2).join("/") + (codes.length > 2 ? "+" + (codes.length - 2) : ""),
        _n: g.length
      });
    });

    const routes = [];
    let laneTop = 0, laneBot = 0;
    mergedLinks.forEach((l, i) => {
      const f = nodePos.get(l.from_area), t = nodePos.get(l.to_area);
      if (!f || !t) return;
      const st = svcClass(data, (l.hmb ? l.service_code : l.service_code).split("/")[0]);
      const up = (chainAreas.has(l.from_area) ? t : f).y < mainY;
      const cx = a => a.x + BW / 2;
      const off = ((i % 5) - 2) * 11;
      const x1 = cx(f) + off, x2 = cx(t) + off;
      const y1 = f.y + (f.y < t.y ? BH : 0), y2 = t.y + (t.y < f.y ? BH : 0) + (t.y < f.y ? 2 : -2);
      /* lanes: one per route on each side, 13 apart. The old (i%3)*8 put three
         routes on the same lane as soon as there were four of them, which is
         exactly when you need them separated. */
      const lane = up ? (laneTop++) : (laneBot++);
      const ym = up ? Math.min(f.y, t.y) + BH + 20 + (lane % 5) * 13
                    : Math.max(f.y, t.y) - 20 - (lane % 5) * 13;
      routes.push({ pts: [[x1, y1], [x1, ym], [x2, ym], [x2, y2]], st, l, ym,
        lx: x1 + (x2 - x1) * (i % 2 ? 0.68 : 0.32) });
    });
    /* every vertical run on the sheet, including the main-path verticals, so a
       horizontal hops over anything it genuinely crosses */
    const allV = routes.flatMap(r => segmentsOf(r.pts).v);
    routes.forEach((r, i) => {
      const mine = new Set(segmentsOf(r.pts).v.map(sg => sg.x + ":" + sg.y1));
      const others = allV.filter(sg => !mine.has(sg.x + ":" + sg.y1));
      s += `<g><title>${esc((r.l.service_name || "") + " " + (r.l.description || ""))}</title>
        <path d="${hopPath(r.pts, others)}" fill="none" stroke="${r.st.color}"
          stroke-width="${Math.min(SIDE_W, r.st.stroke_width || 1.6)}" ${r.st.dash ? `stroke-dasharray="${r.st.dash}"` : ""} marker-end="${mref(r.st.color)}"/>
        <text x="${r.lx}" y="${r.ym - 4}" text-anchor="middle" font-family="${MONO}" font-size="7" fill="${r.st.color}"
          paint-order="stroke" stroke="#fff" stroke-width="2.4">${esc(r.l.service_code)}${r.l._n > 1 ? " ×" + r.l._n : ""}</text></g>`;
    });

    /* nodes + chips — extracted in v1.19.0 so the 'overview' branch and the
       'full' branch share one node layer instead of growing a second copy */
    function drawNodes() {
      let s = "";
      nodePos.forEach((p, label) => {
        if (p.kind === "ext") {
          /* the battery limit is now DRAWN — a dashed boundary the run departs
             from — instead of only being named. Same tick the P&IDs use. */
          const bx0 = p.x + BW - 4, ym0 = p.y + BH / 2;
          s += `<text x="${bx0 - 8}" y="${ym0 - 12}" text-anchor="end" font-family="${MONO}" font-size="8.6" fill="${SOFT}">${esc(clip(label.split("(")[0].trim(), 18))}</text>
                <text x="${bx0 - 8}" y="${ym0 - 2}" text-anchor="end" font-family="${MONO}" font-size="7" fill="${SOFT}">battery limit</text>
                <line x1="${bx0}" y1="${ym0 - 20}" x2="${bx0}" y2="${ym0 + 20}" stroke="${SOFT}" stroke-width="1.2" stroke-dasharray="4 3"/>`;
          return;
        }
        const isHi = hi === label;
        s += `<g ${nav ? `style="cursor:pointer" onclick="${nav}('area/${esc(label)}')"` : ""}>
          <rect x="${p.x}" y="${p.y}" width="${BW}" height="${BH}" rx="6" fill="${isHi ? CRIMSON : "#fff"}" stroke="${isHi ? CRIMSON : "#D6DAE0"}" stroke-width="${BOX_SW}"/>
          <text x="${p.x + BW / 2}" y="${p.y + (isHi ? 23 : 25)}" text-anchor="middle" font-family="${SANS}" font-size="13.5" font-weight="700" fill="${isHi ? "#fff" : INK}">UNIT ${esc(label)}</text>
          <text x="${p.x + BW / 2}" y="${p.y + (isHi ? 37 : 40)}" text-anchor="middle" font-family="${SANS}" font-size="7.4" fill="${isHi ? "#ffd9df" : SOFT}">${esc(clip(areaName(data, label), 24))}</text>`;
      /* ── v1.23.0 · the marker moved INSIDE the box ──────────────────────
           It started centred above (v1.19), which swallowed the arrowhead of
           the branch entering this very box. It became a solid left tab
           (v1.20), which held until the box grew PORTS (v1.23): an 86-unit tab
           on a 108-unit edge left nowhere for them, so HO into U200 vanished
           under it again, and NG with it. Two rounds of shuffling one label
           around the same 20 px is the signal that the label is in the wrong
           place entirely.

           A "you are here" mark belongs TO the thing it marks, so it goes in
           the box. The edge is now free for ports at any scale, and this
           cannot regress: there is no geometry left for it to collide with. */
        if (isHi) s += `<text x="${p.x + BW / 2}" y="${p.y + 51}" text-anchor="middle" font-family="${MONO}" font-size="7.6" font-weight="700" fill="#fff" opacity=".92">▼ YOU ARE HERE</text>`;
        s += `</g>`;
      });
      /* main-path value chips on top, with a soft halo so they stay readable */
      chips.forEach(([x, y, txt]) => {
        s += `<text x="${x}" y="${y}" text-anchor="middle" font-family="${MONO}" font-size="7.4" fill="${SOFT}" stroke="#fff" stroke-width="3.6" paint-order="stroke">${esc(txt)}</text>`;
      });
      return s;
    }

    s += drawNodes();
    s += `<text x="20" y="${H - 8}" font-family="${MONO}" font-size="7.5" fill="${SOFT}">GENERATED FROM plant_process_links · HMB CASE ${esc(kase)} · utilities/relief/drains hidden</text></svg>`;
    return s;
  }

  /* ═════════════════════════════════════════════════════════════════════
     2 · AREA BLOCK — IN column | skids/equipment | OUT column, with HMB
     ═════════════════════════════════════════════════════════════════════ */
  function areaBlock(data, code, opts) {
    opts = opts || {};
    const kase = opts.case || "C1W";
    const nav = opts.onNavigate, onEq = opts.onEquip;
    code = String(code);

    /* group flows by direction + other endpoint */
    const rows = (data.flows || []).filter(f => String(f.area_code) === code);
    const groups = new Map();
    rows.forEach(f => {
      const k = f.direction + "|" + (f.other_label || "?");
      if (!groups.has(k)) groups.set(k, {
        dir: f.direction, label: f.other_label || "?", area: f.other_area,
        name: f.other_area_name || "", links: [], svcs: new Map()
      });
      const g = groups.get(k);
      g.links.push(f);
      g.svcs.set(f.service_code, (g.svcs.get(f.service_code) || 0) + 1);
    });
    const pick = g => {   // representative link: main first, then curated HMB, then lowest class sort
      return g.links.find(l => l.is_main) || g.links.find(l => l.hmb) ||
        g.links.slice().sort((a, b) => (svcClass(data, a.service_code).sort_order || 99) - (svcClass(data, b.service_code).sort_order || 99))[0];
    };
    const gs = [...groups.values()].map(g => {
      g.rep = pick(g);
      g.chip = hmbChip(g.rep, kase);
      g.meters = [...new Set(g.links.flatMap(l => l.meter_tags || []))];
      g.ctrls = [...new Set(g.links.flatMap(l => l.control_tags || []))];
      g.h = 34 + (g.chip ? 11 : 0) + (g.meters.length + g.ctrls.length ? 11 : 0);
      return g;
    }).sort((a, b) => (b.rep.is_main - a.rep.is_main) || (b.links.length - a.links.length));
    const ins = gs.filter(g => g.dir === "IN"), outs = gs.filter(g => g.dir === "OUT");

    /* centre: skids + equipment */
    const eq = (data.equipment || []).filter(r => String(r.area_code) === code);
    const by = new Map();
    eq.forEach(r => { const k = (r.skid_tag || "").trim(); if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
    const skidDesc = t => { const s = (data.skids || []).find(x => (x.tag || "").trim() === t); return s ? (s.description || "") : ""; };
    const skids = [...by.entries()]
      .sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0])))
      .map(([t, r]) => ({ tag: t || null, desc: t ? skidDesc(t) : "LOOSE / FIELD EQUIPMENT", rows: r.sort((x, y) => String(x.tag).localeCompare(String(y.tag))) }));

    const W = 1000, GX = [8, 250], CX = 300, CW = 400, OX = 752, GGAP = 10;
    const MAXTAGS = 9;
    const skidH = s => { const shown = Math.min(s.rows.length, MAXTAGS), rws = Math.ceil(shown / 3) + (s.rows.length > MAXTAGS ? 1 : 0); return 26 + rws * 12 + 6; };
    const cInner = skids.reduce((n, x) => n + skidH(x) + 8, 0);
    const cH = Math.max(88, 40 + cInner + 6);
    const colH = arr => arr.reduce((n, g) => n + g.h + GGAP, 0);
    const H = Math.max(cH, colH(ins), colH(outs)) + 56;
    const cTop = 28 + Math.max(0, (H - 56 - cH) / 2);

    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">`;
    s += markerDefs(gs.map(g => svcClass(data, g.rep.service_code).color));

    /* centre box */
    s += `<g><rect x="${CX}" y="${cTop}" width="${CW}" height="${cH}" rx="8" fill="#fff" stroke="${LINE}" stroke-width="1.6"/>
      <rect x="${CX}" y="${cTop}" width="4" height="${cH}" rx="2" fill="${CRIMSON}" opacity=".85"/>
      <text x="${CX + 14}" y="${cTop + 20}" font-family="${MONO}" font-size="15" font-weight="700" fill="${CRIMSON}">${esc(code)}</text>
      <text x="${CX + 14}" y="${cTop + 32}" font-family="${SANS}" font-size="8" font-weight="700" fill="${INK}">${esc(clip(areaName(data, code), 52))}</text>`;
    let sy = cTop + 40;
    skids.forEach(sk => {
      const h = skidH(sk), shown = sk.rows.slice(0, MAXTAGS);
      s += `<g><rect x="${CX + 12}" y="${sy}" width="${CW - 24}" height="${h}" rx="5" fill="#F7F8FA" stroke="#E2E5E9"/>
        <text x="${CX + 20}" y="${sy + 13}" font-family="${MONO}" font-size="9.5" font-weight="700" fill="${sk.tag ? "#0B5CAD" : SOFT}">${esc(sk.tag || "LOOSE")}</text>
        <text x="${CX + 20}" y="${sy + 22}" font-family="${SANS}" font-size="6.8" fill="${SOFT}">${esc(clip(sk.desc || "", 64))}</text>`;
      shown.forEach((r, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        s += `<text x="${CX + 20 + col * ((CW - 44) / 3)}" y="${sy + 35 + row * 12}" font-family="${MONO}" font-size="8.4" fill="#0B5CAD" ${onEq ? `style="cursor:pointer" onclick="${onEq}('${esc((r.tag || "").trim())}')"` : ""}><title>${esc(r.service || "")}</title>${esc(clip(r.tag || "", 16))}</text>`;
      });
      if (sk.rows.length > MAXTAGS)
        s += `<text x="${CX + 20}" y="${sy + 35 + Math.ceil(MAXTAGS / 3) * 12}" font-family="${MONO}" font-size="7.6" fill="${SOFT}">+${sk.rows.length - MAXTAGS} more…</text>`;
      s += "</g>"; sy += h + 8;
    });
    s += "</g>";

    /* flow groups */
    const drawGroup = (g, y0, side, ye) => {
      const st = svcClass(data, g.rep.service_code);
      const bx = side === "in" ? GX[0] : OX, tx = bx + 8;
      const yg = y0 + g.h / 2;
      const isExt = !g.area;
      const svcTxt = [...g.svcs.entries()].slice(0, 3).map(([k, v]) => k + "×" + v).join(" · ") || "—";
      const tip = (g.rep.description || "") + (g.rep.stream_code ? " · HMB " + g.rep.stream_code : "");
      let o = `<g ${(!isExt && nav) ? `style="cursor:pointer" onclick="${nav}('area/${esc(g.area)}')"` : ""}>
        <title>${esc(tip || g.label)}</title>
        <rect x="${bx}" y="${y0}" width="240" height="${g.h}" rx="5" fill="#fff" stroke="${LINE}"${g.rep.is_main ? ` stroke-width="1.6"` : ""}/>
        <rect x="${bx}" y="${y0}" width="3" height="${g.h}" rx="1.5" fill="${st.color}"/>
        <text x="${tx}" y="${y0 + 13}" font-family="${MONO}" font-size="9.5" font-weight="700" fill="${CRIMSON}">${isExt ? "◈" : esc(g.label)}</text>
        <text x="${tx + (isExt ? 14 : 30)}" y="${y0 + 13}" font-family="${SANS}" font-size="7" font-weight="700" fill="${INK}">${esc(clip(isExt ? g.label : areaName(data, g.area), isExt ? 34 : 30))}</text>
        <text x="${tx}" y="${y0 + 24}" font-family="${MONO}" font-size="7.2" fill="${SOFT}">${g.links.length} line${g.links.length > 1 ? "s" : ""} · ${esc(svcTxt)}</text>`;
      let ly = y0 + 24;
      if (g.chip) { ly += 11; o += `<text x="${tx}" y="${ly}" font-family="${MONO}" font-size="7.4" font-weight="700" fill="${st.color}">${esc((g.rep.stream_code ? g.rep.stream_code + " · " : "") + g.chip)}</text>`; }
      if (g.meters.length || g.ctrls.length) {
        ly += 11;
        o += `<text x="${tx}" y="${ly}" font-family="${MONO}" font-size="7.2" fill="#0B5CAD">${esc([g.meters.length ? "◉ " + g.meters.join(",") : "", g.ctrls.length ? "⧫ " + g.ctrls.join(",") : ""].filter(Boolean).join("  "))}</text>`;
      }
      o += `</g>`;
      const mid = side === "in" ? (GX[1] + CX) / 2 : (OX - 4 + CX + CW) / 2;
      const x1 = side === "in" ? GX[1] - 2 : CX + CW, x2 = side === "in" ? CX - 2 : OX - 4;
      o += `<polyline points="${x1},${side === "in" ? yg : ye} ${mid},${side === "in" ? yg : ye} ${mid},${side === "in" ? ye : yg} ${x2},${side === "in" ? ye : yg}" fill="none"
        stroke="${st.color}" stroke-width="${st.stroke_width || 1.5}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ""} marker-end="${mref(st.color)}"/>`;
      return o;
    };
    let y = 28; ins.forEach((g, i) => { s += drawGroup(g, y, "in", cTop + ((i + 0.5) * cH / Math.max(1, ins.length))); y += g.h + GGAP; });
    y = 28; outs.forEach((g, i) => { s += drawGroup(g, y, "out", cTop + ((i + 0.5) * cH / Math.max(1, outs.length))); y += g.h + GGAP; });
    if (!ins.length) s += `<text x="${GX[0]}" y="${cTop + cH / 2}" font-family="${MONO}" font-size="8" fill="${SOFT}">NO INBOUND LINKS DIGITIZED</text>`;
    if (!outs.length) s += `<text x="${OX}" y="${cTop + cH / 2}" font-family="${MONO}" font-size="8" fill="${SOFT}">NO OUTBOUND LINKS DIGITIZED</text>`;
    s += `<text x="${GX[0]}" y="16" font-family="${MONO}" font-size="8.5" letter-spacing=".12em" fill="${SOFT}">IN — FROM</text>
          <text x="${OX}" y="16" font-family="${MONO}" font-size="8.5" letter-spacing=".12em" fill="${SOFT}">OUT — TO</text>
          <text x="${W - 8}" y="${H - 6}" text-anchor="end" font-family="${MONO}" font-size="7" fill="${SOFT}">plant_process_links · HMB ${esc(kase)} · ◉ meter · ⧫ control</text></svg>`;
    return s;
  }

  /* ═════════════════════════════════════════════════════════════════════
     3 · UNIT SUMMARY — Manual §3.1: inputs → equipment train → outputs
     ═════════════════════════════════════════════════════════════════════ */
  function unitSummary(data, code, opts) {
    opts = opts || {};
    const kase = opts.case || "C1W";
    code = String(code);
    const train = (data.trains || []).filter(t => String(t.area_code) === code).sort((a, b) => a.seq - b.seq);
    if (!train.length)
      return `<svg viewBox="0 0 1000 60" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto"><text x="500" y="34" text-anchor="middle" font-family="${MONO}" font-size="10" fill="${SOFT}">UNIT ${esc(code)} — EQUIPMENT TRAIN NOT CURATED YET (plant_area_trains)</text></svg>`;

    const rows = (data.flows || []).filter(f => String(f.area_code) === code);
    const mainIn = pickMain(rows, "IN"), mainOut = pickMain(rows, "OUT");
    /* the train line is drawn in the MAIN PRODUCT's class colour (single source of
       truth: plant_service_classes — no hardcoded "gas" fluid) */
    const mainRef = mainOut || mainIn;
    const mc = mainRef ? svcClass(data, mainRef.service_code).color : "#333";
    const waters = rows.filter(f => f.direction === "OUT" && f !== mainOut &&
      (f.category === "WATER" || ["WC", "DC"].includes(f.service_code)));
    const inChip = hmbChip(mainIn, kase), outChip = hmbChip(mainOut, kase);
    /* every meter/control already allocated to a link of this area (drawn on lines, not in boxes) */
    const linkMeterSet = new Set(rows.flatMap(f => [...(f.meter_tags || []), ...(f.control_tags || [])]));

    const W = 1000, H = 360;
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">`;
    const cols = ["#333", "#0B5CAD", "#1F8A4C", "#B26A00", mc];
    rows.forEach(r => cols.push(svcClass(data, r.service_code).color));
    s += markerDefs(cols);

    /* unit boundary */
    s += `<rect x="96" y="98" width="812" height="182" rx="8" fill="#FAFBFC" stroke="${CRIMSON}" stroke-width="1.5" stroke-dasharray="5 4"/>
          <text x="106" y="115" font-family="${MONO}" font-size="10" font-weight="700" fill="${CRIMSON}">UNIT ${esc(code)} · ${esc(areaName(data, code))}</text>`;

    /* feed in */
    const inLabel = mainIn ? (mainIn.other_label || "") : "";
    s += `<text x="6" y="176" font-family="${MONO}" font-size="9" fill="#333">${esc(clip(inLabel.split("(")[0] || "FEED", 12))}</text>`;
    if (inChip) s += `<text x="6" y="188" font-family="${MONO}" font-size="7.4" fill="#666"
                        data-live-kind="hmb" data-stream="${esc(mainIn.stream_code || "")}" data-case="${esc(kase)}">${esc(clip(inChip, 20))}</text>
                      <text x="6" y="198" font-family="${MONO}" font-size="7.4" fill="#666">${esc(mainIn && mainIn.stream_code ? "HMB " + mainIn.stream_code + " · " + kase : "")}</text>`;

    /* train geometry */
    const n = train.length, bw = 120, y0 = 173, bh = 64, x0 = 120;
    const gap = n > 1 ? (778 - x0 - n * bw) / (n - 1) : 0;
    const bx = i => x0 + i * (bw + gap);
    const my = y0 + 32;

    /* inlet run — the inline element of step 1 (typically the plant inlet SDV)
       is INSERTED in it by procLine, not painted over it (v1.18.0) */
    s += procLine(66, bx(0), my, mc, train[0] && train[0].inline_element, "below");
    /* segment chips: outlet instruments of box i + inlet instruments of box i+1 share
       the same line segment (V-202 outlet ≡ E-201 inlet). Collected per segment k. */
    const ports = train.map(t => portInstruments(data, t.equipment_tags || []));
    const placedPortTags = new Set(ports.flatMap(p => [...p.INLET, ...p.OUTLET]));
    const segChips = [];                       // k = 0..n  (before box k / after box k-1)
    for (let k = 0; k <= n; k++) {
      const chips = [...(k > 0 ? ports[k - 1].OUTLET : []), ...(k < n ? ports[k].INLET : [])];
      if (chips.length) segChips.push([k, chips]);
    }
    segChips.forEach(([k, chips]) => {
      if (k === n) return;                     // last-segment chips join the outlet line
      const x1 = k === 0 ? 72 : bx(k - 1) + bw + 6, x2 = k === 0 ? bx(0) - 8 : bx(k) - 8;
      const hasDia = k === 0 ? !!(train[0] && train[0].inline_element) : !!(train[k] && train[k].inline_element);
      const cxSeg = (x1 + x2) / 2;
      chips.forEach((tag, ci) => {
        let fx = x1 + (x2 - x1) * (ci + 1) / (chips.length + 1);
        /* v1.18.0 — the ISO valve is wider than the old diamond AND carries a
           two-line label, so the keep-out that cleared the diamond no longer
           cleared the symbol. Read the width from the pack. */
        const keep = ((typeof TamSymProc !== "undefined") ? TamSymProc.A : 8) + 17;
        if (hasDia && Math.abs(fx - cxSeg) < keep) fx += (fx <= cxSeg ? -keep - 2 : keep + 2);
        /* …and then clamp, because pushing a chip clear of the valve is what
           pushed TT-2002 under the E-201 box and printed it as "2002". The tag
           is centred, so the half-width has to stay inside the segment. */
        const hw = String(tag).length * 2.1 + 3;
        fx = Math.max(x1 + hw, Math.min(x2 - hw, fx));
        s += tap(fx, my, tag, true);           // dot ON the line, tag below with leader
      });
    });
    const lastSegChips = (segChips.find(([k]) => k === n) || [null, []])[1];
    train.forEach((t, i) => {
      const x = bx(i);
      /* segment BEFORE this box, with this step's inline element inserted in it */
      if (i > 0) s += procLine(x - gap, x, my, mc, t.inline_element, "above");
      s += `<rect x="${x}" y="${y0}" width="${bw}" height="${bh}" rx="5" fill="#fff" stroke="${CRIMSON}" stroke-width="1.6"/>
            <text x="${x + bw / 2}" y="${y0 + 22}" text-anchor="middle" font-family="${SANS}" font-size="14" font-weight="700" fill="${INK}">${esc(t.display_tag)}</text>`;
      const svc = (data.equipment || []).find(e => (t.equipment_tags || []).includes((e.tag || "").trim()));
      s += `<text x="${x + bw / 2}" y="${y0 + 35}" text-anchor="middle" font-family="${SANS}" font-size="7.4" fill="${SOFT}">${esc(clip(svc ? svc.service : "", 27))}</text>`;
      /* key instruments of this equipment group — future live-value hooks (data-live-tags).
         Flow meters allocated to a LINK are drawn on their line, never inside the box. */
      const keyInst = equipKeyInstruments(data, t.equipment_tags || [], 6, code)
        .filter(tg => !linkMeterSet.has(tg) && !placedPortTags.has(tg));
      if (keyInst.length) {
        const rows2 = [keyInst.slice(0, 3), keyInst.slice(3, 6)].filter(a => a.length);
        rows2.forEach((rw, ri) => {
          s += `<text x="${x + bw / 2}" y="${y0 + 47 + ri * 9}" text-anchor="middle" font-family="${MONO}" font-size="6.4" fill="#0B5CAD"
            data-live-kind="inst" data-live-tags="${esc(rw.join(","))}">${esc(rw.join(" · "))}</text>`;
        });
      }
      /* safety valves above the box, right corner (yellow — relief/ESD family) */
      const psvs = equipSafetyValves(data, t.equipment_tags || []);
      if (psvs.length)
        s += `<text x="${x + 2}" y="${y0 - 5}" font-family="${MONO}" font-size="6.8" font-weight="700" fill="#8A6D00"
          data-live-kind="psv" data-live-tags="${esc(psvs.join(","))}">⌃ ${esc(psvs.join(" · "))}</text>`;
      if (t.caption) s += `<text x="${x + bw / 2}" y="${y0 + bh + 19}" text-anchor="middle" font-family="${MONO}" font-size="7.6" fill="${CRIMSON}" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(t.caption)}</text>`;
      /* ── exchanger media: medium IN (conditions) + medium OUT (conditions) ──
         One pattern for EVERY exchanger (plant_equipment_media / v_exchanger_media):
         supply arrow down, return arrow up, design conditions on each, duty chip.
         Live SCADA replaces the design values through the data-live hooks and the
         efficiency = duty / m·Δh comes from the same pair of lines. */
      const med = (data.media || []).filter(mm => (t.equipment_tags || []).includes(mm.equipment_tag)
        && (!mm.case_code || mm.case_code === kase));
      if (med.length) {
        const mr = med[0], mst = svcClass(data, mr.service_code);
        const cxm = x + bw / 2;
        s += `<line x1="${cxm - 16}" y1="${y0 - 28}" x2="${cxm - 16}" y2="${y0 - 2}" stroke="${mst.color}" stroke-width="1.8" marker-end="${mref(mst.color)}"/>
              <line x1="${cxm + 16}" y1="${y0 - 2}"  x2="${cxm + 16}" y2="${y0 - 28}" stroke="${mst.color}" stroke-width="1.8" marker-end="${mref(mst.color)}"/>
              <text x="${cxm}" y="${y0 - 38}" text-anchor="middle" font-family="${MONO}" font-size="7.4" font-weight="700" fill="${mst.color}"
                data-live-kind="duty" data-tag="${esc(mr.equipment_tag)}">${esc(mst.name)} · Q ${esc(n1(mr.duty_kw))} kW (${esc(kase)}) · ${esc(n1(mr.design_delta_kw))} design</text>
              <text x="${cxm - 20}" y="${y0 - 22}" text-anchor="end" font-family="${MONO}" font-size="6.6" fill="${mst.color}"
                data-live-kind="hmb" data-stream="${esc(mr.supply_stream || "")}" data-field="temperature_c">${esc((mr.supply_stream ? mr.supply_stream + " · " : "") + n1(mr.supply_temp_c) + " °C")}</text>
              ${(mr.supply_tags || []).length ? `<circle cx="${cxm - 16}" cy="${y0 - 15}" r="2.2" fill="#0B5CAD" stroke="#fff" stroke-width="0.5"/>
                <line x1="${cxm - 18}" y1="${y0 - 15}" x2="${cxm - 21}" y2="${y0 - 15}" stroke="#0B5CAD" stroke-width="0.7"/>` : ""}
              <text x="${cxm - 22}" y="${y0 - 12}" text-anchor="end" font-family="${MONO}" font-size="6.2" fill="#0B5CAD"
                data-live-kind="inst" data-live-tags="${esc((mr.supply_tags || []).join(","))}">${esc(groupAB(mr.supply_tags || []).join(" · "))}</text>
              <text x="${cxm + 20}" y="${y0 - 22}" font-family="${MONO}" font-size="6.6" fill="${mst.color}"
                data-live-kind="hmb" data-stream="${esc(mr.return_stream || "")}" data-field="temperature_c">${esc((mr.return_stream ? mr.return_stream + " · " : "") + n1(mr.return_temp_c) + " °C")}</text>
              ${(mr.return_tags || []).length ? `<circle cx="${cxm + 16}" cy="${y0 - 15}" r="2.2" fill="#0B5CAD" stroke="#fff" stroke-width="0.5"/>
                <line x1="${cxm + 18}" y1="${y0 - 15}" x2="${cxm + 21}" y2="${y0 - 15}" stroke="#0B5CAD" stroke-width="0.7"/>` : ""}
              <text x="${cxm + 22}" y="${y0 - 12}" font-family="${MONO}" font-size="6.2" fill="#0B5CAD"
                data-live-kind="inst" data-live-tags="${esc((mr.return_tags || []).join(","))}">${esc(groupAB(mr.return_tags || []).join(" · "))}</text>`;
      }
      /* medium instruments fallback (no curated media row yet) + non-medium aux notes */
      const medInst = med.length ? [] : mediumInstruments(data, t.equipment_tags || []);
      const auxIsMedium = t.aux_note && /hot oil|nh3|ammonia|kW/i.test(t.aux_note);
      if (t.aux_note && !(med.length && auxIsMedium)) {
        const up = !/blowdown|flare|drain/i.test(t.aux_note);
        const ay = y0 - 33;
        const col = /hot oil|kW/i.test(t.aux_note) ? "#B26A00" : /inhibitor|chem/i.test(t.aux_note) ? "#7A3FB3" : "#B26A00";
        s += `<line x1="${x + bw / 2}" y1="${ay + 8}" x2="${x + bw / 2}" y2="${y0 - 2}" stroke="${col}" stroke-width="1.5" marker-end="${mref(up ? col : col)}"/>
              <text x="${x + bw / 2}" y="${ay + 2}" text-anchor="middle" font-family="${MONO}" font-size="7.6" fill="${col}">${esc(t.aux_note)}</text>`;
      }
      if (medInst.length)
        s += `<text x="${x + bw / 2 + 6}" y="${y0 - 14}" font-family="${MONO}" font-size="6.4" fill="#B26A00"
          data-live-kind="inst" data-live-tags="${esc(medInst.join(","))}">${esc(medInst.join(" · "))}</text>`;
    });

    /* outlet: control diamond + destination box */
    const xEnd = bx(n - 1) + bw;
    const outSt = mainOut ? svcClass(data, mainOut.service_code) : null;
    const oc = outSt ? outSt.color : mc;
    const ctrl = mainOut && (mainOut.control_tags || [])[0];
    s += procLine(xEnd, W - 90, my, oc, ctrl, "above");
    if (mainOut) {
      s += `<rect x="${W - 90}" y="${my - 21}" width="82" height="42" rx="5" fill="#FBE9EC" stroke="${CRIMSON}" stroke-width="1.5"/>
            <text x="${W - 49}" y="${my - 2}" text-anchor="middle" font-family="${SANS}" font-size="12" font-weight="700" fill="${CRIMSON}">${esc(mainOut.other_area ? "U" + mainOut.other_area : clip(mainOut.other_label, 9))}</text>
            <text x="${W - 49}" y="${my + 11}" text-anchor="middle" font-family="${SANS}" font-size="7" fill="${SOFT}">${esc(clip(mainOut.other_area_name || "", 14))}</text>`;
      if (outChip) s += `<text x="${W - 8}" y="${my + 32}" text-anchor="end" font-family="${MONO}" font-size="7.6" fill="#333"
        data-live-kind="hmb" data-stream="${esc(mainOut.stream_code || "")}" data-case="${esc(kase)}">${esc((mainOut.stream_code ? mainOut.stream_code + " · " : "") + outChip)}</text>`;
    }

    /* boundary flow meters + last-segment instruments as taps ON the main line */
    const inM = mainIn && (mainIn.meter_tags || [])[0];
    if (inM) s += tap(84, my, inM, true);
    const outM = mainOut && (mainOut.meter_tags || [])[0];
    [...(outM ? [outM] : []), ...lastSegChips].forEach((tag, i) => {
      s += tap(xEnd + 16 + i * 40, my, tag, true);
    });

    /* bottom outputs — one drop PER METER, hanging from its ORIGIN equipment box
       (rule of v_instrument_flow_origin: "WATER OUTLET FROM V-201" → the line
       leaves V-201's box and carries FT-2011; V-202's water carries FT-2021) */
    const drops = [];
    waters.forEach(f => {
      const meters = (f.meter_tags && f.meter_tags.length) ? f.meter_tags : [null];
      meters.forEach(m => {
        const org = m ? flowOrigin(data, m) : null;
        const ti = org ? train.findIndex(t => (t.equipment_tags || []).includes(org)) : -1;
        drops.push({ f, m, ti, org });
      });
    });
    const perBox = new Map(); let fallbackSlot = 0;
    drops.slice(0, 4).forEach(d => {
      const st = svcClass(data, d.f.service_code);
      const kIdx = perBox.get(d.ti) || 0; perBox.set(d.ti, kIdx + 1);
      const x = d.ti >= 0 ? bx(d.ti) + bw / 2 + (kIdx ? (kIdx % 2 ? -18 : 18) * Math.ceil(kIdx / 2) : 0)
                          : (150 + (fallbackSlot++) * 620);
      const left = kIdx % 2 === 1;              // alternate label side for same-box drops
      const anchor = left ? `text-anchor="end"` : "";
      const tx = left ? x - 8 : x + 8;
      const chip = hmbChip(d.f, kase);
      const dest = d.f.other_area ? "U" + d.f.other_area : (d.f.other_label || "");
      s += `<line x1="${x}" y1="${y0 + bh}" x2="${x}" y2="316" stroke="${st.color}" stroke-width="1.6" marker-end="${mref(st.color)}"/>`;
      if (d.m) s += `<circle cx="${x}" cy="285" r="2.2" fill="#0B5CAD" stroke="#fff" stroke-width="0.5"/>
        <line x1="${x + (left ? -3 : 3)}" y1="285" x2="${tx + (left ? 2 : -2)}" y2="285" stroke="#0B5CAD" stroke-width="0.7"/>
        <text x="${tx}" y="288" ${anchor} font-family="${MONO}" font-size="7.2" fill="#0B5CAD" data-live-kind="meter" data-tag="${esc(d.m)}">${esc(d.m)}</text>`;
      s += `<text x="${tx}" y="299" ${anchor} font-family="${MONO}" font-size="8" fill="${st.color}">${esc(clip((d.org ? d.org + " " : "") + (st.name || "").toLowerCase() + " → " + dest, 34))}</text>`;
      if (chip) s += `<text x="${tx}" y="309" ${anchor} font-family="${MONO}" font-size="7.2" fill="${st.color}"
        data-live-kind="hmb" data-stream="${esc(d.f.stream_code || "")}" data-case="${esc(kase)}">${esc((d.f.stream_code ? d.f.stream_code + " · " : "") + chip)}</text>`;
    });

    /* legend — ONLY fluids from plant_service_classes (no hardcoded entries) */
    const cats = [...new Map(rows.map(r => {
      const st = svcClass(data, r.service_code);
      return [st.name.toLowerCase(), st.color];
    })).entries()].slice(0, 6);
    let lx = 120;
    cats.forEach(([nm, col]) => {
      s += `<line x1="${lx}" y1="344" x2="${lx + 20}" y2="344" stroke="${col}" stroke-width="3"/>
            <text x="${lx + 25}" y="347" font-family="${MONO}" font-size="8" fill="#666">${esc(clip(nm, 18))}</text>`;
      lx += 32 + nm.length * 5.4;
    });
    s += `<text x="${W - 8}" y="347" text-anchor="end" font-family="${MONO}" font-size="7" fill="${SOFT}">plant_area_trains + plant_process_links · HMB ${esc(kase)}</text></svg>`;
    return s;
  }

  /* ═════════════════════════════════════════════════════════════════════
     4 · HMB CARDS — IN · DUTY · OUT  (html, module-101 style)
     ═════════════════════════════════════════════════════════════════════ */
  function hmbCards(data, code, opts) {
    opts = opts || {};
    const kase = opts.case || "C1W";
    code = String(code);
    const rows = (data.flows || []).filter(f => String(f.area_code) === code);
    const mainIn = pickMain(rows, "IN"), mainOut = pickMain(rows, "OUT");
    const en = (data.energy || []).filter(e => String(e.area_code) === code);
    const eNow = en.find(e => e.case_code === kase);
    const duties = en.filter(e => e.thermal_duty_kw != null).map(e => e.thermal_duty_kw);

    const card = (cls, title, sub, kv) => `
      <div style="flex:1;min-width:220px;border:1px solid #C9CED4;border-radius:8px;overflow:hidden;background:#fff">
        <div style="display:flex;justify-content:space-between;padding:6px 10px;font:700 10px ${MONO};letter-spacing:.06em;color:#fff;background:${cls}">
          <span>${title}</span><span>${sub}</span></div>
        <div style="padding:6px 10px">${kv.map(([k, v]) => `
          <div style="display:flex;justify-content:space-between;border-bottom:1px dotted #E2E5E9;padding:3px 0">
            <span style="font:400 10px ${SANS};color:#4A4F57">${k}</span>
            <span style="font:700 10.5px ${MONO};color:#15171A">${v}</span></div>`).join("")}
        </div></div>`;

    const flowKv = f => {
      const h = f && f.hmb && (f.hmb[kase] || f.hmb.ALL);
      if (!h) return [["No HMB stream curated", "—"]];
      // each value carries live-binding hooks: swap textContent when SCADA/live data arrives
      const live = (field, txt) => `<span data-live-kind="hmb" data-stream="${esc(f.stream_code || "")}" data-field="${field}" data-case="${esc(kase)}">${txt}</span>`;
      const kv = [];
      kv.push(["Flow", live("flow", (h.std_gas_flow_mmscfd >= 0.05 ? n1(h.std_gas_flow_mmscfd) + " MMSCFD · " : "") + n0(h.mass_flow_kg_h) + " kg/h")]);
      kv.push(["Pressure", live("pressure_barg", n1(h.pressure_barg) + " barg")]);
      kv.push(["Temperature", live("temperature_c", n1(h.temperature_c) + " °C")]);
      return kv;
    };
    const cards = [];
    if (mainIn) cards.push(card("#1F6FB8", "▶ IN · " + esc(clip((mainIn.other_label || "").split("(")[0].trim(), 18)) + (mainIn.stream_code ? " (" + mainIn.stream_code + ")" : ""),
      (mainIn.meter_tags || []).map(esc).join(" "), flowKv(mainIn)));
    if (en.length) {
      const kv = [];
      if (eNow && eNow.thermal_duty_kw != null) kv.push(["Duty (" + kase + ")", n1(eNow.thermal_duty_kw) + " kW"]);
      if (duties.length > 1) kv.push(["Duty (all cases)", n1(Math.min(...duties)) + " – " + n1(Math.max(...duties)) + " kW"]);
      if (eNow && eNow.electric_power_kw != null) kv.push(["Electric", n1(eNow.electric_power_kw) + " kW"]);
      if (eNow && eNow.by_equipment) kv.push(["Equipment", esc(Object.keys(eNow.by_equipment).join(" · "))]);
      cards.push(card("#B26A00", "◈ ENERGY · U" + esc(code), "thermal / electric", kv));
    }
    if (mainOut) cards.push(card("#1F8A4C", "▶ OUT · " + esc(clip((mainOut.other_label || "").split("(")[0].trim(), 18)) + (mainOut.stream_code ? " (" + mainOut.stream_code + ")" : ""),
      (mainOut.control_tags || []).map(esc).join(" "), flowKv(mainOut)));
    /* utility & energy feeds card: what the area CONSUMES (lines + duty, no HMB values on utilities) */
    const feeds = rows.filter(f => f.direction === "IN" && (f.category === "UTILITY" || f.category === "ENERGY" || f.category === "CHEMICAL"));
    if (feeds.length) {
      const bySvc = new Map();
      feeds.forEach(f => {
        const k = f.service_code;
        if (!bySvc.has(k)) bySvc.set(k, { name: f.service_name, n: 0, from: new Set(), meters: new Set() });
        const s = bySvc.get(k); s.n++; if (f.other_label) s.from.add(f.other_label);
        (f.meter_tags || []).forEach(m => s.meters.add(m));
      });
      const kv = [...bySvc.entries()].map(([k, s]) =>
        [esc(s.name), esc(k + "×" + s.n + " · from " + [...s.from].map(x => String(x).split(" ")[0]).join(",") + ([...s.meters].length ? " · ◉" + [...s.meters].join(",") : ""))]);
      cards.push(card("#4A4F57", "◈ UTILITIES & FEEDS · U" + esc(code), "consumption", kv));
    }
    if (!cards.length) return "";
    return `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">${cards.join("")}</div>`;
  }

  /* ══ SINGLE-LINE DIAGRAM · ELD03 electrical (phase 11) ═══════════════════
     Data: v_sld_nodes / v_sld_edges (migration 152 series).

     ONE diagram per switchboard. Each busbar of the board gets a band:

         sources          GE-00n, or a feeder on another Power Center
            │
         incomers         positions that FEED the busbar
         ═══════          BUSBAR
            │
         positions        outgoing feeders, in display_rank order
            │
         loads            the served asset

     display_rank is 1000 + sheet_no*100 + column_index for feeder positions,
     so ordering by it reproduces the paper drawing's column order exactly.
     Bus couplers are NORMALLY OPEN and are drawn dashed (rule from Round 4).

     Two data cautions, both handled here rather than assumed away:
      · v_sld_edges also carries fibre/Modbus network links whose endpoints are
        not electrical nodes. Only edges with BOTH endpoints in v_sld_nodes are
        drawable; the rest are counted and reported, never silently dropped.
      · Nothing is invented. A position with no busbar edge and no load edge is
        drawn as it stands; an off-sheet target is labelled as off-sheet.      */

  /* v1.7.0 — PADX is the LEFT GUTTER, and it only has to hold the busbar name
     ("BUSBAR IA" at 12 px ≈ 66 px) and its tag underneath (≈ 74 px), both
     printed from x = 8. At 148 it held ~70 px of nothing and the drawing
     started well right of the page edge; Mario bracketed exactly that. */
  /* v1.14.3 — 92, a 15% tightening of the old 108. It only became reachable
     once the printed CT ratio came off the metering assembly (that label, not
     the split ways, was what collided at 96 and below). Verified by sweeping
     `check_sld_layout.js` over 92..108: 0 collisions on all four boards at the
     shipping zoom. Do not tighten further without re-running that sweep. */
  const SLD_COL = 92, SLD_PADX = 112, SLD_BAND = 312;
  /* how far past the last column a bus-to-bus tie stands. Measured against the
     CT ratio of a metering assembly, which is the thing that reaches furthest
     out of a column (~45 px) — see v1.7.0 note in the band pre-pass. */
  const SLD_TIE_DX = 46;
  const SLD_L2_DY = 62;                 // drop from a served board to what IT feeds   // PADX = left gutter for the busbar label
  const SLD_SRC_Y = 14, SLD_INC_Y = 78, SLD_BUS_Y = 146, SLD_OUT_Y = 182, SLD_LOAD_Y = 250;
  /* v1.3.0 — extra conductor length between a position and the busbar when a
     metering assembly (CT + analyser) has to be drawn on that segment. Applied
     per band and only on the side that actually carries one, so a board with no
     meters is byte-identical to v1.2.0. */
  const SLD_MTR_DY = 40;
  /* extra conductor between an outgoing way and its load when a starting
     device (contactor / soft starter / drive) has to be drawn on it */
  const SLD_START_DY = 40;
  /* how tall a starting symbol is, in symbol units, and how much room beyond the
     26-unit baseline it needs. Read from the pack so the geometry lives in one
     place: add a taller symbol and the layout follows it. */
  function startH(kind) {
    const K = (typeof window !== "undefined" ? window : globalThis).TamSym;
    const sp = K && K.spec && K.spec(kind);
    return (sp && sp.h) ? sp.h : 26;
  }
  const startExtra = kind => Math.max(0, startH(kind) - 26) * 0.92;
  /* the two ways OUT of a starting symbol that has them (BL / BR), in page
     coordinates, or null. A symbol with a single B port returns null and the
     renderer falls back to one trunk plus a branch bar. */
  function startOuts(kind, cx, cy) {
    const K = (typeof window !== "undefined" ? window : globalThis).TamSym;
    if (!K || !K.ports || !K.spec || !K.spec(kind)) return null;
    const p = K.ports(kind, { x: cx, y: cy, scale: 0.92 * Z() });
    return (p && p.BL && p.BR) ? [p.BL, p.BR] : null;
  }

  /* ── v1.4.0 · ONE ZOOM KNOB ──────────────────────────────────────────────
     Mario: "all the icons, it is too small" and "make the small text bold and
     at least 20% bigger". Both are the same complaint — the information-bearing
     marks are small relative to the page — so both hang off one number.

       TamFlow.sldZoom = 1.0   the v1.3.0 drawing, exactly
       TamFlow.sldZoom = 1.3   symbols and small text +30%

     SYMBOLS and TEXT scale by Z. LAYOUT scales by only 55 % of that, which is
     the whole point: scaling everything equally is just a zoom and changes
     nothing. Growing the marks faster than the grid is what makes them legible.
     The value was chosen by rendering the sweep, not by taste — see the
     verification. */
  let sldZoom = 1.3;
  /* ── v1.15.0 · where a busbar RUNS OUT OF PAGE ───────────────────────────
     Mario: "cuando una barra sea más ancha que la pantalla, al final ponga una
     etiqueta y continúe en una nueva fila".

     This is the MATCHLINE, the oldest convention on a large drawing: a run too
     long for the sheet is cut, the cut is named, and the run starts again lower
     down carrying the name it was cut at. Every ELD03 sheet does it; the viewer
     was the only thing pretending a bar could be arbitrarily wide, and the cost
     was a horizontal scrollbar that hid whole sections of a board.

     0 / null = measure the window at draw time. A number = a fixed page width
     in CSS px, which is what a reproducible export wants. */
  let sldWrapWidth = 0;
  const Z  = () => sldZoom;                       // symbols + text
  const G  = () => 1 + (sldZoom - 1) * 0.55;      // layout grid
  const gx = n => +(n * G()).toFixed(1);          // a layout distance
  const zy = n => +(n * Z()).toFixed(1);          // a symbol-relative distance
  /* a small font size: scaled, and never below 8 px — below that a bold face
     stops helping and the label is decoration rather than information */
  const ts = n => Math.max(8, +(n * Z()).toFixed(1));
  const SLD_BOXW = 86, SLD_BOXH = 34;
  const SLD_STATUS = { VERIFIED: "#1F8A4C", NEEDS_REVIEW: "#B26A00", CONFLICT: CRIMSON };
  const SLD_BUSCOL = "#0B5CAD";          // busbar / power path
  const SLD_ROTARY = new Set(["MOTOR", "PUMP", "COMPRESSOR", "GENERATOR", "FAN", "BLOWER"]);
  /* v1.10.0 — the starting methods v_sld_nodes can name, and how to say them.
     A value outside this map draws nothing rather than guessing a symbol. */
  const SLD_START = new Map([["CONTACTOR", "Contactor"], ["SOFT_STARTER", "Soft starter"],
                             ["SOFT_STARTER_2C", "Soft starter, two interlocked contactors"],
                             ["VFD", "Variable-frequency drive"]]);

  /* ── data ─────────────────────────────────────────────────────────────── */
  async function loadSld(sb) {
    const all = async (t, order) => {
      let q = sb.from(t).select("*"); if (order) q = q.order(order);
      const { data, error } = await q;
      if (error) { console.warn("tam-flow/sld: " + t + ": " + error.message); return []; }
      return data || [];
    };
    /* v1.16.2 — a third, small view: the APPARENT power of anything that has a
       declared power factor (migration 191). It is fetched separately and
       merged by tag rather than added to v_sld_nodes, because that view is 7350
       characters and CREATE OR REPLACE only lets you append to it — the handoff
       marks it as trap country. `all()` already returns [] and warns on error,
       so an older database with no such view degrades to "apparent power
       unknown" instead of breaking the page. */
    const [nodes, edges, rating] = await Promise.all([
      all("v_sld_nodes", "display_rank"), all("v_sld_edges"), all("v_sld_source_rating")]);
    const kva = new Map(rating.map(r => [r.tag, r]));
    nodes.forEach(n => { const r = kva.get(n.tag);
      if (r) { n.power_factor = r.power_factor; n.apparent_kva = r.apparent_kva; } });
    const S = indexSld({ nodes, edges });
    /* v1.16.3 — whether the ratings ARRIVED is its own fact, and the summary has
       to be able to tell it from "this source declares no power factor". The
       first time this shipped, PostgREST had not yet picked the new view into
       its schema cache, the fetch came back empty, and every card announced
       "6 sources with no declared power factor" — a confident statement about
       the plant produced by a stale cache. Wrong in the worst way: it read as
       data. A missing SOURCE of truth and a missing VALUE are different, and
       the card now says which one it is. */
    S._hasRating = rating.length > 0;
    return S;
  }
  function sldFromViewer(DB) {
    return indexSld({ nodes: DB.sldNodes || [], edges: DB.sldEdges || [] });
  }
  function indexSld(sld) {
    sld.nodes = sld.nodes || []; sld.edges = sld.edges || [];
    sld._byTag = new Map(sld.nodes.map(n => [n.tag, n]));
    sld._kids = new Map();
    sld.nodes.forEach(n => {
      if (!n.parent_tag || n.parent_tag === n.tag) return;
      if (!sld._kids.has(n.parent_tag)) sld._kids.set(n.parent_tag, []);
      sld._kids.get(n.parent_tag).push(n);
    });
    const drawable = e => sld._byTag.has(e.from_tag) && sld._byTag.has(e.to_tag);
    sld._edges = sld.edges.filter(drawable);
    sld._skipped = sld.edges.filter(e => !drawable(e));
    sld._out = new Map(); sld._in = new Map();
    sld._edges.forEach(e => {
      if (!sld._out.has(e.from_tag)) sld._out.set(e.from_tag, []);
      if (!sld._in.has(e.to_tag)) sld._in.set(e.to_tag, []);
      sld._out.get(e.from_tag).push(e); sld._in.get(e.to_tag).push(e);
    });
    return sld;
  }
  /* the switchboard a node sits on, or "" if it is not under one */
  function sldBoardOf(sld, n) {
    if (!n) return "";
    if (n.symbol_kind === "SWITCHBOARD") return n.tag;
    let cur = n, hops = 0;
    while (cur && cur.parent_tag && cur.parent_tag !== cur.tag && hops++ < 6) {
      const up = sld._byTag.get(cur.parent_tag);
      if (!up) return String(cur.parent_tag).replace(/-(BB|F).*$/, "");
      if (up.symbol_kind === "SWITCHBOARD") return up.tag;
      cur = up;
    }
    return "";
  }
  const sldOut = (sld, tag) => sld._out.get(tag) || [];
  const sldIn = (sld, tag) => sld._in.get(tag) || [];
  const isBusbar = n => n && (n.symbol_kind === "BUSBAR" || n.symbol_kind === "BUSBAR_INVERTER");
  const byRank = (a, b) => (a.display_rank || 0) - (b.display_rank || 0) ||
    String(a.tag).localeCompare(String(b.tag));

  /* "480-JG-691-FMC1" on board "480-JG-691" → ".MC1"   (the paper column code) */
  function sldPosCode(tag, board) {
    let t = String(tag || "");
    if (board && t.indexOf(board + "-") === 0) t = t.slice(board.length + 1);
    return /^F./.test(t) ? "." + t.slice(1) : t;
  }
  /* "480-JG-691-BBIA" → "IA" */
  function sldBusCode(tag, board) {
    let t = String(tag || "");
    if (board && t.indexOf(board + "-") === 0) t = t.slice(board.length + 1);
    return t.replace(/^BB/, "") || t;
  }

  /* boards present in the data, for a picker */
  function sldBoards(sld) {
    return sld.nodes.filter(n => n.symbol_kind === "SWITCHBOARD").sort(byRank)
      .map(b => {
        const bus = (sld._kids.get(b.tag) || []).filter(isBusbar);
        const pos = bus.reduce((a, bb) => a.concat(sld._kids.get(bb.tag) || []), []);
        return {
          tag: b.tag, doc_no: b.doc_no, voltage_v: b.voltage_v,
          busbars: bus.length, positions: pos.length,
          loads: pos.reduce((n, p) => n + (sld._kids.get(p.tag) || []).length, 0)
        };
      });
  }

  /* ── symbols ──────────────────────────────────────────────────────────────
     v1.2.0: the symbol geometry moved OUT of this renderer into the symbol
     packs (`tam-sym.js` + `tam-sym-elec.js`). This function is now a delegate.

     Why: an inline switch cannot carry ports, state, data quality or measured
     values, and it cannot be shared with the process side. The packs can.
     See GRAPHICS_LIBRARY_PLAN.md.

     The legacy switch is KEPT as the fallback, deliberately: if the packs fail
     to load, EI06 degrades to exactly what it drew before rather than to a
     blank page. Delete it only after the packs have shipped and been verified.

     TamFlow.sldSymbolStyle selects the switching-device form:
       'IEC'  breaker as the IEC cross-on-contact; disconnector, switch-
              disconnector and contactor drawn distinctly          ← default
       'BOX'  the square shorthand every switching device used to get, now
              FILLED when closed and hollow when open
     Set TamFlow.sldSymbolStyle = 'BOX' before rendering to go back.           */
  let sldSymbolStyle = "IEC";
  let _symUsed = null;                 // symbol kinds drawn in the current sld() call

  /* v1.12.0 — `fam` is v_sld_nodes.breaker_family (migration 177): 'ACB' for a
     3WA/3WL air circuit breaker, 'MCCB' for a 3VA moulded-case one. Fourteen
     positions carry an ACB — the gas and diesel incomers, the three couplers
     and the two transformer feeders .212 / .213 — and every one of them was
     drawing as a moulded-case breaker, because ELEC_MAP keys on symbol_kind and
     symbol_kind only knows that the row is a FEEDER.
     The view names the FAMILY, a fact off the type code; which symbol that
     deserves is decided here, in the one place a column value meets a symbol. */
  function sldGlyph(kind, cx, cy, col, open, fam) {
    if (_symUsed) _symUsed.add(String(kind || "").toUpperCase());
    const S = (typeof window !== "undefined" ? window : globalThis).TamSym;
    if (S && S.ELEC_MAP && S.draw) {
      let k = S.ELEC_MAP[String(kind || "").toUpperCase()] || "UNKNOWN";
      /* A POSITION IS ITS DEVICE, NOT ITS LOAD. `.212` and `.213` carry
         feeder_kind='TRANSFORMER' — which says what the way SERVES — so they
         were drawn as transformers, with the transformer 480-TR-001 drawn
         again underneath as the load. The same object twice, and the 3WA1120
         air circuit breaker that is actually in the cubicle appeared nowhere.
         A cubicle that holds a MAIN_BREAKER is drawn as that breaker. */
      if (fam && k === "TRANSFORMER") k = "CIRCUIT_BREAKER";
      k = sldFamSym(k, fam);
      if (sldSymbolStyle === "BOX" && (k === "CIRCUIT_BREAKER" || k === "ACB_DRAWOUT"))
        k = "CIRCUIT_BREAKER_BOX";
      if (_symUsed) _symUsed.add(k);
      return S.draw(k, { x: cx, y: cy, color: col, open: !!open,
                         state: open ? "OPEN" : "DESIGN", scale: 0.92 * Z() });
    }
    return sldGlyphLegacy(kind, cx, cy, col, open);
  }

  /* ── v1.13.0 · familia de aparato -> simbolo, SIN tabla que mantener ──────
     Mario: "esto no deberia ser en programacion solo DB". De acuerdo. Antes
     habia un `if` por familia, asi que cada familia nueva pedia una linea de
     codigo. Ahora, si el pack tiene un simbolo REGISTRADO con el nombre de la
     familia, se usa ese y ya esta: 'FUSE_SWITCH' dibuja FUSE_SWITCH sin tocar
     nada. Solo quedan los dos alias donde el nombre de la familia y el del
     simbolo difieren de verdad. */
  const SLD_FAM_ALIAS = { ACB: "ACB_DRAWOUT", MCCB: "CIRCUIT_BREAKER" };
  function sldFamSym(k, fam) {
    if (!fam || k !== "CIRCUIT_BREAKER") return k;
    const S = (typeof window !== "undefined" ? window : globalThis).TamSym;
    const alias = SLD_FAM_ALIAS[fam];
    if (alias) return alias;
    return (S && S.spec && S.spec(fam)) ? fam : k;
  }

  /* v1.9.0 — where a conductor must STOP so it touches the symbol.
     Mario: "los motores tampoco llegan a conectarse con el cable". The drop
     line ended at a hard-coded offset while the glyph was drawn at 0.92·Z with
     its own radius, so a motor (r = 12) left a ~6 px gap and the load looked
     unconnected. The pack already publishes every symbol's ports; ask it,
     rather than guessing an offset that is right for one symbol and wrong for
     the rest. Falls back to the old constant if the packs are absent (G-8). */
  function sldPortY(kind, cx, cy, key, fam) {
    const S = (typeof window !== "undefined" ? window : globalThis).TamSym;
    if (S && S.ELEC_MAP && S.ports) {
      let k = S.ELEC_MAP[String(kind || "").toUpperCase()] || "UNKNOWN";
      if (fam && k === "TRANSFORMER") k = "CIRCUIT_BREAKER";
      k = sldFamSym(k, fam);
      if (sldSymbolStyle === "BOX" && (k === "CIRCUIT_BREAKER" || k === "ACB_DRAWOUT"))
        k = "CIRCUIT_BREAKER_BOX";
      const p = S.ports(k, { x: cx, y: cy, scale: 0.92 * Z() });
      if (p && p[key]) return p[key].y;
    }
    return cy + (key === "A" ? -zy(13) : zy(13));
  }

  /* the same port question for a kind the renderer places directly (CT, and
     from v1.10.0 the starting device), which has no ELEC_MAP entry */
  function sldPortYDirect(kind, cx, cy, key) {
    const S = (typeof window !== "undefined" ? window : globalThis).TamSym;
    if (S && S.ports && S.spec && S.spec(kind)) {
      const p = S.ports(kind, { x: cx, y: cy, scale: 0.92 * Z() });
      if (p && p[key]) return p[key].y;
    }
    return cy + (key === "A" ? -zy(13) : zy(13));
  }

  /* draw a REGISTERED symbol kind directly, bypassing ELEC_MAP.
     v1.3.0. Used by the metering assembly: "CT" is a shape the renderer places
     from `ct_ratio_raw` on a metering node — it is NOT a `symbol_kind` any row
     in v_sld_nodes carries, so putting it in ELEC_MAP would claim the database
     says something it does not (db-graphics §4). The kind is still registered
     in `_symUsed` so the auto-generated legend picks it up (rule G-7).
     Falls back to a plain circle when the packs are absent, per G-8. */
  function sldSymDirect(kind, o) {
    if (_symUsed) _symUsed.add(String(kind || "").toUpperCase());
    const S = (typeof window !== "undefined" ? window : globalThis).TamSym;
    if (S && S.draw && S.spec && S.spec(kind)) return S.draw(kind, o);
    const cx = (o && o.x) || 0, cy = (o && o.y) || 0, col = (o && o.color) || INK;
    return `<circle cx="${cx}" cy="${cy}" r="${zy(7)}" fill="#fff" stroke="${col}" stroke-width="1.6"/>` +
      ((o && o.label) ? `<text x="${cx}" y="${cy + (o.labelPos === "above" ? -12 : 18)}" text-anchor="middle" ` +
        `font-family="${MONO}" font-size="8" font-weight="700" fill="${INK}">${esc(o.label)}</text>` : "") +
      ((o && o.sub) ? `<text x="${cx + 15}" y="${cy + 3}" font-family="${MONO}" font-size="6.8" fill="${SOFT}">${esc(o.sub)}</text>` : "");
  }

  const HALO = ` paint-order="stroke" stroke="#fff" stroke-width="3" stroke-linejoin="round"`;
  function sldGlyphLegacy(kind, cx, cy, col, open) {
    const sw = 1.6, W = `stroke="${col}" stroke-width="${sw}"`;
    const box = (r, dash) => `<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" fill="#fff" ${W}${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
    const disc = (r, ch) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" ${W}/>` +
      (ch ? `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" fill="${col}">${ch}</text>` : "");
    switch (kind) {
      case "GENERAL_SWITCH":
      case "DISCONNECTOR":
        return `<line x1="${cx}" y1="${cy - 12}" x2="${cx + 10}" y2="${cy + 10}" ${W}/>` +
               `<circle cx="${cx}" cy="${cy - 12}" r="2.4" fill="${col}"/>` +
               `<circle cx="${cx}" cy="${cy + 12}" r="2.4" fill="${col}"/>`;
      case "NETWORK_ANALYZER": return disc(10, "A");
      case "TRANSFORMER":
        return `<circle cx="${cx}" cy="${cy - 5}" r="9.5" fill="none" ${W}/>` +
               `<circle cx="${cx}" cy="${cy + 5}" r="9.5" fill="none" ${W}/>`;
      case "SPARE": return box(10, "3 3");
      case "BUS_COUPLER":
        return box(10, open ? "4 3" : "") +
               `<text x="${cx + 15}" y="${cy - 12}" font-family="${MONO}" font-size="6.4" font-weight="700" fill="${col}">N.O.</text>`;
      case "MOTOR": return disc(13, "M");
      case "GENERATOR": return disc(13, "G");
      case "PUMP": return disc(13, "P");
      case "COMPRESSOR": return disc(13, "C");
      case "INVERTER":
        return box(12) + `<line x1="${cx - 8}" y1="${cy + 8}" x2="${cx + 8}" y2="${cy - 8}" ${W}/>` +
               `<text x="${cx - 5}" y="${cy - 2}" text-anchor="middle" font-family="${MONO}" font-size="8" fill="${col}">=</text>` +
               `<text x="${cx + 5}" y="${cy + 9}" text-anchor="middle" font-family="${MONO}" font-size="8" fill="${col}">~</text>`;
      case "HEATER":
        return box(11) + `<path d="M${cx - 6},${cy + 4} l3,-8 l3,8 l3,-8 l3,8" fill="none" ${W}/>`;
      default: return box(10);   // INCOMER · FEEDER · everything else = breaker
    }
  }
  /* ── v1.5.0 · the label pass ────────────────────────────────────────────
     Mario, 2026-07-26: "for breakers to have a clean look, move the label to
     the left or right … below the breaker leave blank, also in feeders remove
     characteristics … below the tag of the load put the power and below the
     current … the power and current of generators in the generator icon".

     Three rules, and they are all the same rule: a number belongs to the
     object that owns it.

       · A POSITION is a cubicle. Its code is its identity, so it sits BESIDE
         the symbol — to the RIGHT, on the centre line, where nothing else is.
         Under it stays EMPTY: the conductor, the cable tag and the load all
         use that column, and the kW/A block printed there was the RATING OF
         THE LOAD wearing the breaker's clothes.
       · A LOAD owns its power and its current. They go under its tag.
       · A GENERATOR owns its rating. It goes on the machine symbol.

     Nothing is invented and nothing is derived: a value absent from
     v_sld_nodes prints nothing at all (rule G-3).                          */
  function sldPosLabel(cx, cy, code, nav, tag) {
    return `<text x="${cx + zy(15)}" y="${cy + zy(3.4)}" text-anchor="start" font-family="${MONO}" ` +
      `font-size="${ts(8.4)}" font-weight="700" fill="${INK}"${HALO}` +
      (nav ? ` style="cursor:pointer" onclick="${nav}('sld/${esc(tag)}')"` : "") +
      `>${esc(clip(code, 14))}</text>`;
  }
  /* the two rating lines under a load's tag: power first, current below it.
     Returns the y of the next free line so a caller can keep stacking. */
  function sldRating(cx, y, node) {
    let s = "", yy = y;
    [sldKw(node), sldAmp(node)].filter(Boolean).forEach(v => {
      s += `<text x="${cx}" y="${yy}" text-anchor="middle" font-weight="600" font-family="${MONO}" ` +
        `font-size="${ts(6.8)}" fill="${SOFT}">${esc(v)}</text>`;
      yy += zy(10);
    });
    return { svg: s, y: yy };
  }

  /* v1.8.0 — the cable label sits BESIDE its conductor, not on it, and carries
     its length underneath. `length_m` has been in `v_sld_edges` all along; the
     renderer simply never read it. Centred on the drop line the tag fought the
     line itself; to the right it reads as an annotation of that run. */
  /* v1.14.2 — `mid` centres the label instead of hanging it to the right of the
     conductor. A way that FORKS has no conductor down the middle to hang off,
     and the right-hand offset put the text across the right-hand drop. */
  function sldCable(cx, y, e, mid) {
    if (!e || !e.cable_tag) return "";
    const x = mid ? cx : cx + zy(4), an = mid ? "middle" : "start";
    let g = `<text x="${x}" y="${y}" text-anchor="${an}" font-weight="600" ` +
      `font-family="${MONO}" font-size="${ts(6.6)}" fill="${SOFT}"${HALO}>${esc(e.cable_tag)}</text>`;
    if (e.length_m != null)
      g += `<text x="${x}" y="${y + zy(9)}" text-anchor="${an}" font-weight="600" ` +
        `font-family="${MONO}" font-size="${ts(6.2)}" fill="${SOFT}"${HALO}>${esc(n1(e.length_m))} m</text>`;
    return g;
  }

  /* small labelled card used for sources and for served loads */
  function sldCard(cx, y, node, sub, dim) {
    const x = cx - gx(SLD_BOXW) / 2;
    const st = SLD_STATUS[node.data_status] || SOFT;
    return `<g><rect x="${x}" y="${y}" width="${gx(SLD_BOXW)}" height="${gx(SLD_BOXH)}" rx="4" fill="#fff" stroke="${dim ? LINE : st}" stroke-width="1.3"/>` +
      `<text x="${cx}" y="${y + zy(14)}" text-anchor="middle" font-family="${MONO}" font-size="8.4" font-weight="700" fill="${INK}">${esc(clip(node.tag, 14))}</text>` +
      `<text x="${cx}" y="${y + zy(26)}" text-anchor="middle" font-family="${MONO}" font-size="7" fill="${SOFT}">${esc(clip(sub || "", 16))}</text></g>`;
  }
  const sldKw = n => n && n.power_kw != null ? n1(n.power_kw) + " kW" : "";
  const sldAmp = n => n && n.current_a != null ? n0(n.current_a) + " A" : "";

  /* ── renderer ─────────────────────────────────────────────────────────── */
  function sld(sldData, boardTag, opts) {
    const o = opts || {}, S = sldData;
    _symUsed = new Set();              // reset per render — drives the legend
    /* v1.4.0 — the pack prints the analyser tag and the CT sub-datum, so its
       type scale has to move with ours or the drawing ends up with two. */
    { const K = (typeof window !== "undefined" ? window : globalThis).TamSym;
      if (K) K.textScale = Z(); }
    if (!S || !S._byTag) return `<div style="font:400 11px ${MONO};color:${SOFT}">tam-flow: call TamFlow.loadSld(sb) first</div>`;
    const board = S._byTag.get(boardTag);
    if (!board) return `<div style="font:400 11px ${MONO};color:${SOFT}">no switchboard "${esc(boardTag)}" in v_sld_nodes</div>`;
    const nav = o.onNavigate;

    const busbars = (S._kids.get(boardTag) || []).filter(isBusbar).sort(byRank);
    if (!busbars.length) return `<div style="font:400 11px ${MONO};color:${SOFT}">${esc(boardTag)} has no busbars in v_sld_nodes</div>`;
    const busSet = new Set(busbars.map(b => b.tag));

    /* ── metering (v1.3.0) ────────────────────────────────────────────────
       A metering position is a cubicle holding an instrument; it carries no
       current of its own and feeds nothing. Drawing it as an outgoing column
       said the opposite — it read as a load hanging off the bar. Migration 166
       puts the measuring point in the view (`measures_tag`, `voltage_ref_tag`,
       `ct_ratio_raw`), so it can now be drawn where it physically is: a CT
       clamped on the measured conductor, tapped across to the analyser.

       Only a metering position whose measured circuit is a node ON THIS BOARD
       moves. One with no `measures_tag`, or one pointing off-sheet, stays in
       the outgoing row and says so — a gap must stay visible (rule G-4). */
    const isMeterPos = p => p.symbol_kind === "NETWORK_ANALYZER";
    const meterOn = new Map();          // measured tag → [metering node, …]
    const meterUnplaced = [];           // metering positions left in the out row
    const boardKids = new Set();
    busbars.forEach(bb => (S._kids.get(bb.tag) || []).forEach(k => boardKids.add(k.tag)));
    busbars.forEach(bb => (S._kids.get(bb.tag) || []).forEach(p => {
      if (!isMeterPos(p)) return;
      if (p.measures_tag && boardKids.has(p.measures_tag)) {
        if (!meterOn.has(p.measures_tag)) meterOn.set(p.measures_tag, []);
        meterOn.get(p.measures_tag).push(p);
      } else meterUnplaced.push(p);
    }));
    const placedMeters = new Set();
    meterOn.forEach(list => list.forEach(m => placedMeters.add(m.tag)));

    /* ── v1.6.0 · a bus-to-bus TIE leaves the END of the bar ───────────────
       Mario, 2026-07-26: *"en la barra A al final deberíamos mostrar el breaker
       de salida hacia B pero por arriba; en B mostramos la llegada desde A a la
       izquierda y hacia C al final."*

       A tie is not a load. Hung in the outgoing row it stood among the motors
       as though the next switchboard were something this bar drives, and the
       far-side bar received nothing but a line of text in the gutter — the same
       physical link was a SYMBOL at one end and a SENTENCE at the other. It is
       now one shape at both ends: a stub off the END of the busbar, above it.
       OUT leaves the RIGHT end, IN arrives at the LEFT end.

       Two shapes of tie exist in the data and both are recognised:
         1. a BUS_COUPLER this bar owns          (A ←.MCG1→ B)
         2. a position cable-tied to a coupler on ANOTHER board
            (.B2 ←E150→ 480-JG-692 .MCG2 → busbar C)
       The far busbar is read from the coupler's own FEEDS edge, so the label
       names the bar the link actually reaches. A tie whose far end cannot be
       resolved is NOT promoted — it stays in the outgoing row, where a gap is
       visible (rule G-4). Nothing was added to the database for any of this. */
    /* ── v1.7.0 · which SIDE a tie leaves from ─────────────────────────────
       Mario: *"al busbar C llega desde B por la izquierda, sale a D por la
       derecha, igual que en B."*

       v1.6.0 decided the side by OWNERSHIP — the bar that owns the coupler
       drew it going out. Busbar C owns both `.MCG2` (to B) and `.MCG3` (to D),
       so C showed two departures and the chain read as if it started there.
       Ownership says whose cubicle it is, not which way the line runs.

       The order is ALREADY IN THE DATABASE and needed no correction:
       `v_sld_nodes.display_rank` on the busbars is 165 · 166 · 167 · 168 for
       A · B · C · D — the paper order of the sections. A tie to an EARLIER bar
       arrives on the LEFT; to a LATER bar it leaves on the RIGHT. The four
       inverter busbars all carry rank 173, so board tag and then node tag
       break the tie deterministically (BBIA < BBIB < BBIC < BBID); that shared
       rank is a data smell worth a CR, not a blocker.                        */
    const busOrd = t => {
      const n = S._byTag.get(t);
      return [n && n.display_rank != null ? +n.display_rank : 0,
              (n && sldBoardOf(S, n)) || "", String(t)];
    };
    const isLater = (a, b) => {           /* is bar `a` after bar `b`? */
      const A = busOrd(a), B = busOrd(b);
      for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] > B[i];
      return false;
    };
    const farBusOf = (cplNode, ownTag) => sldOut(S, cplNode.tag)
      .filter(e => e.edge_kind === "FEEDS" && e.to_tag !== ownTag &&
                   isBusbar(S._byTag.get(e.to_tag)))[0] || null;
    function tieOut(p, bb) {
      if (p.symbol_kind === "BUS_COUPLER") {
        const far = farBusOf(p, bb.tag);
        return far ? { pos: p, via: null, farTag: far.to_tag, open: far.normally_open,
                       cable: far.cable_tag } : null;
      }
      const link = sldOut(S, p.tag).concat(sldIn(S, p.tag))
        .filter(e => e.edge_kind === "CONNECTED_TO")
        .map(e => ({ e: e, n: S._byTag.get(e.from_tag === p.tag ? e.to_tag : e.from_tag) }))
        .filter(x => x.n && x.n.symbol_kind === "BUS_COUPLER")[0];
      if (!link) return null;
      const far = farBusOf(link.n, bb.tag);
      return far ? { pos: p, via: link.n, farTag: far.to_tag, open: far.normally_open,
                     cable: link.e.cable_tag || far.cable_tag } : null;
    }

    /* classify each position on each busbar */
    const rawBands = busbars.map(bb => {
      const kids = (S._kids.get(bb.tag) || []).slice().sort(byRank);
      const inc = [], out = [], cpl = [], tie = [];
      kids.forEach(p => {
        if (placedMeters.has(p.tag)) return;      /* drawn on its measured circuit */
        const t = tieOut(p, bb);
        if (t) { tie.push(t); return; }           /* drawn at the end of the bar */
        if (p.symbol_kind === "BUS_COUPLER") { cpl.push(p); return; }
        /* an incomer is a position that FEEDS a busbar of this board */
        const feedsBus = sldOut(S, p.tag).some(e => e.edge_kind === "FEEDS" && busSet.has(e.to_tag));
        (feedsBus ? inc : out).push(p);
      });
      return { bus: bb, inc, out: out.concat(cpl), cplCount: cpl.length,
               tie: tie.filter(t => isLater(t.farTag, bb.tag)),
               tieL: tie.filter(t => !isLater(t.farTag, bb.tag)) };
    });

    /* The tie LABELS are built here, before anything measures the page, and no
       longer inside the per-band loop where v1.7.0 put them. Two reasons, both
       about width: the label runs rightward out of the last column and the page
       has to know how far (trap T-14 — what leaves the viewBox is clipped in
       silence), and v1.15.0 now needs that number BEFORE it can decide how many
       columns fit. Tie objects are shared by reference with the segments the
       split produces, so building them here reaches the draw loop unchanged. */
    const tw = (txt, fs) => String(txt || "").length * fs * 0.6;
    let tieOver = 0;                    /* how far past the bar end a tie reaches */
    rawBands.forEach(b => {
      b.tie.concat(b.tieL).forEach(t => {
        const fb = sldBoardOf(S, S._byTag.get(t.farTag)) || boardTag;
        const viaBoard = t.via ? (sldBoardOf(S, t.via) || boardTag) : boardTag;
        t.farCode = sldBusCode(t.farTag, fb) + (fb !== boardTag ? " · " + fb : "");
        t.offBoard = fb !== boardTag;
        t.sub = [sldPosCode(t.pos.tag, boardTag),
                 t.via ? "via " + (viaBoard !== boardTag ? viaBoard + " " : "") + sldPosCode(t.via.tag, viaBoard) : "",
                 t.cable || "", t.open ? "N.O." : ""].filter(Boolean).join(" · ");
      });
      /* only the OUT ties stick out to the right; an arriving one is labelled
         in the left gutter, where it costs the page nothing */
      b.tie.forEach((t, i) => {
        const w = Math.max(tw("⇢ BUSBAR " + t.farCode, ts(7.6)),
                           ...String(t.sub).split(" · ").map(x => tw(x, ts(6.6))));
        tieOver = Math.max(tieOver, gx(SLD_TIE_DX) * (i + 1) + gx(26) + gx(5) + w);
      });
    });

    /* ── v1.15.0 · CUT A BAR THAT DOES NOT FIT, AND SAY WHERE IT GOES ───────
       How many columns fit across the page, from the page itself. The layout
       grid is `gx`, so the answer moves with the zoom knob for free: zoom in
       and the same board simply cuts into more rows.

       The floor of 4 is deliberate. A very narrow window would otherwise cut
       every bar into one-column strips — technically obedient, unreadable, and
       the sort of thing that makes an automatic layout untrustworthy. Below
       four columns the drawing scrolls instead, which is the honest failure.  */
    const wrapCols = (function () {
      const root = (typeof window !== "undefined") ? window : null;
      /* v1.15.1 — Mario, on the first cut version: "en la pantalla se genera aun
         un scroll horizontal, disminuir un poco el ancho aprovechable". Two
         things were eating the budget and neither was in the sum.

         `innerWidth` is the WHOLE window: it includes the vertical scrollbar,
         the page's own gutters and whatever chrome the app puts around the
         drawing, none of which the SVG may use. 40 px did not cover it. The
         reserve is now 96, which is the page gutter this viewer actually uses
         plus a scrollbar plus a few px of slack — err on the narrow side, since
         one column too few costs a little white space and one column too many
         costs the scrollbar the whole feature exists to remove.

         And a bar that carries a bus TIE does not end at its last column: the
         tie elbow and its destination label run on past it, and that overhang
         was measured for the page width but never subtracted from the column
         budget — so a board with ties (PC1, PC2) overflowed by exactly the
         label. Now it is reserved before the division. */
      const avail = +sldWrapWidth || +(o.wrapWidth || 0) ||
                    (root && root.innerWidth ? root.innerWidth - 96 : 0);
      if (!avail) return Infinity;                 /* headless: never cut */
      return Math.max(4, Math.floor((avail - gx(SLD_PADX) * 2 - tieOver) / gx(SLD_COL)));
    })();

    /* One busbar becomes N SEGMENTS, each a band in its own right. The split is
       by COLUMN INDEX, not by row, so an incomer and the outgoing way that
       share column 7 stay in the same segment and on the same vertical — the
       column is the unit of meaning on this drawing, and cutting between the
       two halves of one would be a lie about which way feeds what.

       The ties do NOT get copied into every segment: an outgoing tie leaves the
       physical END of the bar, so it belongs to the LAST segment; an arriving
       one reaches the START, so it belongs to the FIRST. Copying them would
       draw the same coupler two or three times and inflate the position count
       in the title block. */
    const bands = [];
    rawBands.forEach(b => {
      const wide = Math.max(b.inc.length, b.out.length);
      /* `step` is wrapCols made FINITE. It exists because of a bug that this
         file should record rather than quietly fix: with no page to measure,
         wrapCols is Infinity, and `0 * Infinity` is NaN in JavaScript — so the
         first segment sliced [NaN, NaN], which Array#slice reads as [0, 0], and
         the whole bar came out EMPTY. The page still rendered: title block,
         busbar, footer, four columns of nothing. Trap T-13 in a new costume —
         it did not throw, it returned LESS. */
      const step = isFinite(wrapCols) ? wrapCols : Math.max(1, wide);
      const parts = Math.max(1, Math.ceil(wide / step));
      for (let k = 0; k < parts; k++) {
        const a = k * step, z = a + step;
        bands.push({ bus: b.bus,
                     inc: b.inc.slice(a, z), out: b.out.slice(a, z),
                     cplCount: b.cplCount,
                     tie:  k === parts - 1 ? b.tie  : [],
                     tieL: k === 0         ? b.tieL : [],
                     part: k + 1, parts: parts });
      }
    });

    /* ── v1.7.0 · the tie sits just past the last column, not a column past it ──
       v1.6.0 gave every tie a full column so its vertical would clear the CT
       ratio of the last incomer's metering assembly. That ratio only reaches
       ~45 px past the column edge, so a full 126 px column bought 80 px of
       white space at the right-hand end of every bar — Mario circled exactly
       that. SLD_TIE_DX is measured against what actually sticks out, not
       rounded up to the grid. The bar still ends AT the tie. */
    bands.forEach(b => {
      b.base = Math.max(b.inc.length, b.out.length);
      b.nWide = b.base;
      b.tie.forEach((t, i) => { t.dx = gx(SLD_TIE_DX) * (i + 1); });
    });
    /* a band needs a longer conductor on the side that carries an assembly */
    bands.forEach(b => {
      b.dyIn  = b.inc.some(p => meterOn.has(p.tag)) ? zy(SLD_MTR_DY) : 0;
      b.dyOut = b.out.some(p => meterOn.has(p.tag)) ? zy(SLD_MTR_DY) : 0;
      /* v1.10.0 — a starting device stands ON the conductor between the way and
         its load, so the load row has to move down to make room for it AND for
         the cable label. Applied per band and only where one exists, so a board
         with no starting device is byte-identical to v1.9.0. */
      /* v1.14.0 — the reserve used to be a flat 40 for every starting device,
         which was right while every one of them was 26 units tall. The soft
         starter with its two interlocked contactors is 88, and a flat reserve
         let it grow UP into the fuse switch above it. Size the reserve to the
         tallest symbol actually on this band; a 26-unit one still reserves
         exactly 40, so boards without a tall starter are unchanged. */
      b.dySt  = Math.max(0, ...b.out.map(p =>
        (p.start_kind && SLD_START.has(p.start_kind)) ? zy(SLD_START_DY + startExtra(p.start_kind)) : 0));
    });

    const cols = Math.max(4, ...bands.map(b => b.nWide));
    /* v1.7.0 — the right margin is SIZED TO THE WIDEST TIE LABEL rather than
       assumed. A tie label runs rightward out of the last column; with the
       page width fixed at 2·PADX + cols·COL it was the tie column that kept it
       inside, and removing that column would have pushed it off the edge. */
    let tieRight = 0;
    bands.forEach(b => b.tie.forEach(t => {
      const w = Math.max(tw("⇢ BUSBAR " + t.farCode, ts(7.6)),
                         ...String(t.sub).split(" · ").map(x => tw(x, ts(6.6))));
      tieRight = Math.max(tieRight, gx(SLD_PADX) + b.base * gx(SLD_COL) + t.dx +
                                    gx(26) + gx(5) + w);
    }));
    const W = Math.max(gx(SLD_PADX) * 2 + cols * gx(SLD_COL), tieRight + gx(16));
    /* v1.2.0 — a served BOARD can itself feed a load (migration 154: the flash
       compressors 690-JG-695/696 → PK-361-MC1A/B). When any position on this
       switchboard has that second level, every band grows by one load row so
       the deeper node has somewhere to be drawn. Boards without it are
       byte-identical to v1.1.0. */
    /* everything this diagram already draws in its own right: busbars and
       feeder positions. A second-level node that is one of these is NOT a
       deeper load — it is the same node seen from the other side (an inverter
       feeding its own outgoing position, `.II2 → 480-INV-002 → .OI2`). Drawing
       it twice would invent a machine that does not exist. */
    const alreadyDrawn = new Set();
    bands.forEach(b => { alreadyDrawn.add(b.bus.tag);
      b.inc.concat(b.out).forEach(p => alreadyDrawn.add(p.tag)); });
    S.nodes.forEach(n => { if (n.symbol_kind === "BUSBAR" || n.symbol_kind === "BUSBAR_INVERTER" ||
      n.symbol_kind === "SWITCHBOARD") alreadyDrawn.add(n.tag); });

    /* A node counts as a LOAD on this diagram only if it is not a busbar and
       not a position belonging to another Power Center — the same predicate the
       drawing loop uses. Without it the detector follows bus-coupler hops
       (`.MCG1 → BUSBAR B → PC2 .MCG2`) and grows every band for nothing. */
    const isLoadHere = t => t && !isBusbar(t) &&
      !(sldBoardOf(S, t) && sldBoardOf(S, t) !== boardTag);
    const secondLevel = t => sldOut(S, t.tag).filter(e =>
      e.edge_kind === "FEEDS" && S._byTag.has(e.to_tag) &&
      !alreadyDrawn.has(e.to_tag) && isLoadHere(S._byTag.get(e.to_tag)));

    const hasL2 = bands.some(b => b.out.concat(b.inc).some(p =>
      sldOut(S, p.tag).some(e => e.edge_kind === "FEEDS" && isLoadHere(S._byTag.get(e.to_tag)) &&
        secondLevel(S._byTag.get(e.to_tag)).length)));
    const BAND = gx(SLD_BAND) + (hasL2 ? gx(SLD_L2_DY) + 26 : 0);
    /* v1.3.0 — band tops are CUMULATIVE, not `74 + bi * BAND`: a band carrying a
       metering assembly is taller than one that does not, and only the bands
       that carry one grow. With no meters every band height is BAND and the
       positions are identical to v1.2.0. */
    const bandY = []; let _acc = 74;
    bands.forEach(b => { bandY.push(_acc); _acc += BAND + b.dyIn + b.dyOut + b.dySt; });
    /* v1.3.0 — the bottom margin now sizes itself to the footer.
       DEFECT FOUND WHILE ADDING THE METERING LINE: the margin was a flat 34,
       the legend already used two rows of it, and the "N edges in v_sld_edges
       not drawable" chip was being emitted at y = H + 7 — OUTSIDE the viewBox,
       so it has never been visible on any board that had one. A footer whose
       honesty line is clipped is worse than no honesty line, because the
       diagram then looks complete (rule G-4). One row per optional line. */
    /* v1.15.2 — the reserve follows the same rule as the footer itself. It used
       to reserve a row for every account line that COULD print; now only the
       two that actually do, so a clean board reclaims the page it was leaving
       empty at the bottom. */
    const _footRows = ((S._skipped.some(e => e.edge_kind !== "CONNECTED_TO") ? 1 : 0) +
                       (meterUnplaced.length ? 1 : 0));
    const H = _acc + gx(34) + zy(24) + _footRows * zy(13);
    const colX = i => gx(SLD_PADX) + i * gx(SLD_COL) + gx(SLD_COL) / 2;

    /* v1.10.0 — the page height is a TOKEN, resolved after the footer is known.
       The legend is generated from the symbols the board actually used, so it
       grows when a symbol is added: the contactor pushed it past the right edge
       and it wrapped into nothing, because H had been fixed before anything was
       drawn. Trap T-14 has now bitten three times; measuring the footer and
       then sizing the page ends the whole class. */
    let s = `<svg viewBox="0 0 ${W} %H%" width="${W}" height="%H%" xmlns="http://www.w3.org/2000/svg" font-family="${SANS}">`;
    s += `<rect x="0" y="0" width="${W}" height="%H%" fill="#fff"/>`;

    /* title block */
    s += `<rect x="0" y="0" width="${W}" height="4" fill="${CRIMSON}"/>` +
      `<text x="${gx(SLD_PADX)}" y="30" font-family="${MONO}" font-size="15" font-weight="700" fill="${CRIMSON}">${esc(board.tag)}</text>` +
      `<text x="${gx(SLD_PADX)}" y="46" font-weight="600" font-family="${MONO}" font-size="${ts(8.6)}" fill="${SOFT}">${esc(board.doc_no || "")}` +
      (board.voltage_v != null ? `  ·  ${esc(n0(board.voltage_v))} V` : "") +
      /* v1.6.0 — a tie is still a CUBICLE on this board; moving it to the end
         of the bar must not quietly drop it from the count. */
      /* v1.15.0 — counted off rawBands, NOT the segments. A bar cut into three
         rows is still ONE busbar, and saying "3 busbars" because the page is
         narrow would make the drawing lie about the switchboard. */
      `  ·  ${rawBands.length} busbar${rawBands.length > 1 ? "s" : ""}  ·  ${rawBands.reduce((n, b) => n + b.inc.length + b.out.length + b.tie.length + b.tieL.length, 0)} positions` +
      (bands.length > rawBands.length ? `  ·  ${bands.length} rows (page cut)` : "") +
      /* v1.3.0 — metering positions are counted separately, not dropped. They
         are still cubicles on this board; they just no longer stand in the
         outgoing row pretending to carry load. */
      (placedMeters.size ? `  ·  ${placedMeters.size} metering` : "") + `</text>`;

    const drawn = { inc: 0, out: 0, load: 0, src: 0, cpl: 0, offsheet: 0, meter: 0 };

    /* ── the metering assembly (v1.3.0) ───────────────────────────────────
       Three connections, drawn as three connections:

           conductor ──╫── CT ────●  Ⓐ  .MG1     current, from the CT tap
                       │              ┊
           ════════════╪══════════════╪═══ BUSBAR    voltage, dashed, direct

       `my` is the centre of the CT on the conductor, 30 px from the busbar on
       whichever side the position sits. The auxiliary supply is deliberately
       NOT drawn: the ELD03 does not draw it either — it says "see aux wiring
       diagram for details" — and inventing a connection is rule G-3.        */
    function meterAssembly(cx, busY, above, list) {
      let g = "";
      list.forEach((m, k) => {
        const my = busY + (above ? -1 : 1) * zy(30 + k * 34);
        drawn.meter++;
        /* The analyser sits at cx+30, inside the half column, so its voltage
           reference always lands on the busbar even in the last column. The CT
           ratio used to print to its right; v1.14.3 took it off the sheet (see
           below) and the assembly now ends at the instrument. */
        g += sldSymDirect("CT", { x: cx, y: my, color: INK, scale: 0.92 * Z() });
        g += `<line x1="${cx + zy(11)}" y1="${my}" x2="${cx + zy(18)}" y2="${my}" stroke="${INK}" stroke-width="1.3"/>`;
        /* the instrument tag goes on the side AWAY from the busbar, so it never
           shares space with the voltage reference that runs towards it */
        g += sldSymDirect("NETWORK_ANALYZER", {
          x: cx + zy(30), y: my, color: INK, scale: 0.92 * Z(), labelPos: above ? "above" : "below",
          label: sldPosCode(m.tag, boardTag), dq: m.data_status,
          title: [m.meter_tag || m.tag, "measures " + m.measures_tag,
                  "U ref " + (m.voltage_ref_tag || "?"), m.ct_ratio_raw].filter(Boolean).join(" · ")
        });
        /* v1.14.3 — the CT ratio no longer PRINTS. Mario asked for it off the
           sheet, and it was the one thing standing between the drawing and a
           tighter column: at cx+43 it only fitted while the half column was 54,
           so it, not the split ways, was capping the pitch at 98.
           The datum is NOT lost — it is in the analyser's own tooltip above
           (`m.ct_ratio_raw` in the title), and it is one field of
           v_sld_nodes.ct_ratio_raw for anything that needs to read it. What
           went away is the printed copy, not the number. */
        /* the voltage reference — dashed, because it carries no load current.
           It leaves the instrument on the side FACING the busbar, which is
           below it for an incomer and above it for an outgoing position. */
        const vy = my + (above ? zy(10) : -zy(10));
        g += `<line x1="${cx + zy(30)}" y1="${vy}" x2="${cx + zy(30)}" y2="${busY}" stroke="${SOFT}" ` +
          `stroke-width="1.1" stroke-dasharray="3 3"/>`;
        g += `<text x="${cx + zy(34)}" y="${(vy + busY) / 2}" font-weight="600" font-family="${MONO}" font-size="${ts(6.2)}" ` +
          `fill="${SOFT}"${HALO}>U</text>`;
      });
      return g;
    }

    /* ── v1.6.0 · the tie stub ─────────────────────────────────────────────
       An elbow off the end of the busbar: up, then outward, with the position's
       OWN symbol on the vertical and the destination above the horizontal.

              ⇢ BUSBAR B
                 ┌────           .MCG1 · N.O.
                 │
              ───┴─ ✕ ──         the symbol, in its N.O. state
                 │
           ══════╧══════════ BUSBAR A

       `dir` = +1 leaves to the RIGHT (a tie this bar drives), −1 arrives from
       the LEFT (a tie another bar drives into this one). The N.O. state is
       printed on every one of them because all six couplers are normally open:
       these are sources a section CAN have, not sources it HAS (rule G-3).   */
    function tieStub(x, busY, topY, dir, i, o) {
      /* The device sits on the INCOMER row, not just above the bar. Its first
         position put it level with the metering assembly, where the last
         incomer's CT ratio prints — and the ratio is the one number on that
         assembly that has to stay readable. On the incomer row it also reads
         correctly: a tie IS a switching device fed from the bar, so it belongs
         in the same rank as the machine incomers, at the end of the line. */
      /* An OUT tie gets its own COLUMN at the end of the bar (see b.nWide), so
         it needs no vertical stagger. An IN tie has no columns to the left of
         the bar to take, so a second one steps upward instead. */
      const sy = topY - (dir > 0 ? 0 : i * gx(30));
      /* the label runs RIGHT from the elbow and a second OUT tie is only one
         column away, so the elbows fan upward: same symbol row, different
         heights, and the two destination names never share a line. */
      const h = busY - sy + gx(20) + (dir > 0 ? ((o.n || 1) - 1 - i) * gx(22) : 0), e = gx(26) * dir;
      const col = SLD_BUSCOL;
      /* The conductor STOPS AT THE DEVICE'S TERMINALS and starts again on the
         other side — it does not run through the symbol. Every other position
         on this drawing already does that (`cy ± 13·Z`); the tie stub was
         drawing one line from the bar to the elbow with the breaker painted on
         top of it, so the dashes crossed the glyph. A line through a device is
         not a shorter way of saying the same thing: it says the device is not
         in the circuit. */
      const dash = o.open ? ` stroke-dasharray="5 4"` : "";
      const gap = zy(13);
      let g = `<line x1="${x}" y1="${busY}" x2="${x}" y2="${sy + gap}" stroke="${col}" ` +
        `stroke-width="1.6"${dash}/>` +
        `<line x1="${x}" y1="${sy - gap}" x2="${x}" y2="${busY - h}" stroke="${col}" ` +
        `stroke-width="1.6"${dash}/>` +
        `<line x1="${x}" y1="${busY - h}" x2="${x + e}" y2="${busY - h}" stroke="${col}" ` +
        `stroke-width="1.6"${dash}/>`;
      g += sldGlyph(o.kind, x, sy, col, !!o.open, o.fam);
      /* The OUT label runs right, into the page margin, where there is room.
         The IN label cannot: anchored at the elbow it ran OFF THE LEFT EDGE of
         the viewBox and SVG clipped it silently — trap T-14, the third time.
         It is left-aligned in the gutter instead, which is where the arrival
         used to be printed anyway, so nothing new can collide with it. The
         sub wraps on " · " rather than being clipped: a cable number cut in
         half is worse than a second line. */
      const tx = dir > 0 ? x + e + gx(5) : 8;
      const cap = dir > 0 ? 40 : 24, lines = [];
      String(o.sub || "").split(" · ").forEach(w => {
        if (lines.length && (lines[lines.length - 1] + " · " + w).length <= cap)
          lines[lines.length - 1] += " · " + w;
        else lines.push(w);
      });
      /* the whole block sits ABOVE the elbow, so a second line grows upward
         into free page rather than down across the horizontal run */
      let ly = busY - h - zy(13) - (lines.length - 1) * zy(10);
      g += `<text x="${tx}" y="${ly}" text-anchor="start" font-family="${MONO}" ` +
        `font-size="${ts(7.6)}" font-weight="700" fill="${SLD_BUSCOL}">` +
        `${dir > 0 ? "⇢" : "⇠"} BUSBAR ${esc(o.farCode)}</text>`;
      lines.forEach(t => { ly += zy(10);
        g += `<text x="${tx}" y="${ly}" text-anchor="start" font-weight="600" ` +
          `font-family="${MONO}" font-size="${ts(6.6)}" fill="${SOFT}">${esc(t)}</text>`; });
      return g;
    }

    bands.forEach((band, bi) => {
      const y0 = bandY[bi];
      const dy2 = band.dyIn + band.dyOut;
      const busY = y0 + gx(SLD_BUS_Y) + band.dyIn;
      const nWide = band.nWide;
      const busX1 = gx(SLD_PADX) - 22;
      /* the bar ends AT the last tie when it carries one, not a column beyond */
      const busX2 = gx(SLD_PADX) + Math.max(2, nWide) * gx(SLD_COL) +
                    (band.tie.length ? band.tie[band.tie.length - 1].dx : 0);

      /* ── busbar ── */
      s += `<line x1="${busX1}" y1="${busY}" x2="${busX2}" y2="${busY}" stroke="${SLD_BUSCOL}" stroke-width="${zy(5)}" stroke-linecap="round"/>`;
      /* v1.7.0 — the name sits ABOVE the bar, not across it. It used to straddle
         the conductor (first line on the centre line, tag below it), which put
         the tag in the outgoing half where the drop lines start. Both lines
         now clear the bar upward. */
      s += `<text x="8" y="${busY - zy(13)}" font-family="${MONO}" font-size="12" font-weight="700" fill="${SLD_BUSCOL}">` +
        `BUSBAR ${esc(sldBusCode(band.bus.tag, boardTag))}</text>`;
      s += `<text x="8" y="${busY - zy(3)}" font-weight="600" font-family="${MONO}" font-size="${ts(6.8)}" fill="${SOFT}">${esc(band.bus.tag)}` +
        `${band.bus.symbol_kind === "BUSBAR_INVERTER" ? " · inverter bus" : ""}</text>`;

      /* ── v1.15.0 · the MATCHLINE marks ────────────────────────────────────
         A cut bar must say, at the cut, that it is cut — otherwise a segment
         reads as a short bar with a couple of ways on it, which is a different
         switchboard. Both ends are marked and both marks name the row on the
         OTHER side of the cut, so either one alone tells you where to look.

         The mark is a solid triangle ON the conductor, in the busbar colour,
         pointing the way the power keeps running. It is drawn as a triangle
         rather than a text arrow because it has to survive at any zoom and in
         a rasteriser that may not have the glyph. */
      if (band.parts > 1) {
        const th = zy(7);                          /* half-height of the mark */
        if (band.part < band.parts) {              /* the bar runs off, rightward */
          const x = busX2 + zy(3);
          s += `<path d="M${x},${busY - th} L${x + zy(12)},${busY} L${x},${busY + th} Z" fill="${SLD_BUSCOL}"/>`;
          s += `<text x="${busX2}" y="${busY - zy(11)}" text-anchor="end" font-family="${MONO}" ` +
            `font-size="${ts(7.4)}" font-weight="700" fill="${SLD_BUSCOL}">` +
            `continues on ${band.part + 1}/${band.parts} ⇢</text>`;
        }
        if (band.part > 1) {                       /* …and arrives here */
          /* ON the bar's own start, not before it: the gutter to the left holds
             the busbar name, and a mark placed out there sat on top of the tag.
             Arriving power entering the conductor is the right reading anyway. */
          const x = busX1;
          s += `<path d="M${x},${busY - th} L${x + zy(12)},${busY} L${x},${busY + th} Z" fill="${SLD_BUSCOL}"/>`;
          s += `<text x="${busX1 + zy(6)}" y="${busY - zy(11)}" text-anchor="start" font-family="${MONO}" ` +
            `font-size="${ts(7.4)}" font-weight="700" fill="${SLD_BUSCOL}">` +
            `⇢ from ${band.part - 1}/${band.parts}</text>`;
        }
      }

      /* ── v1.4.0 · where else this section can be fed from ────────────────
         A bus coupler is drawn as a column on the busbar that OWNS it, and the
         busbar at the far end got nothing — so busbar B looked like it had two
         generators and no other source, when .MCG1 on busbar A can feed it and
         .MCG2 on PC2 busbar C can too.

         This is a DRAWING gap, not a data gap: the database carries all four
         FEEDS edges per coupler, both directions, VERIFIED, each with
         normally_open (migration 150b). Nothing was added to build this label.

         N.O. is printed on every one of them, and that is not decoration: all
         six couplers are normally open, so these are sources the section CAN
         have, not sources it HAS. A label saying "from BUSBAR A" without it
         would claim a feed that does not normally exist (rule G-3). */
      /* v1.6.0 — the OUT end: at the RIGHT end of the bar, above it. */
      band.tie.forEach((t, i) => {
        s += tieStub(gx(SLD_PADX) + band.base * gx(SLD_COL) + t.dx, busY,
                     y0 + gx(SLD_INC_Y), +1, i, {
          kind: t.pos.symbol_kind, open: !!t.open, n: band.tie.length, fam: t.pos.breaker_family,
          farCode: t.farCode, sub: t.sub
        });
        if (t.offBoard) drawn.offsheet++;
        drawn.cpl++;
      });

      /* ── the IN end: at the LEFT end of the bar, above it ──────────────
         Two kinds arrive here. First this bar's OWN cubicle pointing back up
         the chain (busbar C's `.MCG2` → busbar B) — v1.7.0; it knows the
         cubicle code, so it is the better of the two. Then a coupler owned by
         ANOTHER bar that reaches this one (busbar B's arrival from A, whose
         cubicle `.MCG1` belongs to A). A link already drawn from this bar in
         either direction is not drawn a second time. */
      let li = 0;
      const outFar = new Set(band.tie.map(t => t.farTag));
      band.tieL.forEach(t => {
        outFar.add(t.farTag);
        s += tieStub(busX1, busY, y0 + gx(SLD_INC_Y), -1, li++, {
          kind: t.pos.symbol_kind, open: !!t.open, n: band.tieL.length, fam: t.pos.breaker_family,
          farCode: t.farCode, sub: t.sub
        });
        if (t.offBoard) drawn.offsheet++;
        drawn.cpl++;
      });
      const fedFrom = sldIn(S, band.bus.tag)
        .filter(e => e.edge_kind === "FEEDS")
        .map(e => ({ e: e, n: S._byTag.get(e.from_tag) }))
        .filter(x => x.n && x.n.symbol_kind === "BUS_COUPLER" &&
                     x.n.parent_tag && x.n.parent_tag !== band.bus.tag)
        .map(x => ({ e: x.e, cpl: x.n, src: S._byTag.get(x.n.parent_tag) }))
        .filter(x => x.src && !outFar.has(x.src.tag));
      fedFrom.forEach(x => {
        const srcBoard = sldBoardOf(S, x.src) || boardTag;
        const off = srcBoard !== boardTag;
        s += tieStub(busX1, busY, y0 + gx(SLD_INC_Y), -1, li++, {
          kind: "BUS_COUPLER", open: !!x.e.normally_open, fam: x.cpl.breaker_family,
          farCode: sldBusCode(x.src.tag, srcBoard) + (off ? " · " + srcBoard : ""),
          sub: [(off ? srcBoard + " " : "") + sldPosCode(x.cpl.tag, srcBoard),
                x.e.cable_tag || "", x.e.normally_open ? "N.O." : ""].filter(Boolean).join(" · ")
        });
        if (off) drawn.offsheet++;
      });

      /* ── incomers, above the bar ── */
      band.inc.forEach((p, i) => {
        const cx = colX(i), cy = y0 + gx(SLD_INC_Y);
        drawn.inc++;
        /* source above the incomer, if the graph names one */
        const up = sldIn(S, p.tag).filter(e => e.edge_kind === "FEEDS");
        if (up.length) {
          const srcNode = S._byTag.get(up[0].from_tag);
          /* the board a node belongs to: its own tag for a switchboard, else the
             switchboard part of its parent ("480-JG-692-BBD" → "480-JG-692").   */
          const srcBoard = sldBoardOf(S, srcNode);
          const off = !!srcBoard && srcBoard !== boardTag;
          const shown = off ? { tag: srcBoard, data_status: srcNode.data_status } : srcNode;
          const sub = srcNode && srcNode.symbol_kind === "GENERATOR"
            ? (sldKw(srcNode) || "generator")
            : (off ? sldPosCode(srcNode.tag, srcBoard) + (up[0].cable_tag ? " · " + up[0].cable_tag : "")
                   : ([srcNode && srcNode.parent_tag ? "via " + sldPosCode(srcNode.parent_tag, boardTag) : "",
                       up[0].cable_tag || ""].filter(Boolean).join(" · ")));
          /* v1.5.0 — a machine is drawn as a machine. A generator feeding this
             board used to be a card: a rounded box with its tag and one line of
             sub-text. That is the shape this renderer uses for something it can
             only NAME (an off-sheet board, a PC tie). A generator is on the
             sheet, it has a symbol in the pack, and it carries both a rating
             and a current — so it is drawn as the rotary symbol with its tag
             above and its two figures beside it (Mario's third instruction). */
          const isGen = srcNode && srcNode.symbol_kind === "GENERATOR" && !off;
          let srcBottom;
          if (isGen) {
            /* the card carried its tag INSIDE the box; the symbol carries it
               ABOVE, so the machine has to drop by that line's height or the
               label climbs into the band overhead — `check_sld_layout.js`
               caught exactly that ("710 kW" ∩ "GE-004" on PC1). */
            const cyS = y0 + gx(SLD_SRC_Y) + gx(SLD_BOXH) / 2 + zy(9);
            s += sldSymDirect("GENERATOR", {
              x: cx, y: cyS, color: INK, scale: 1.05 * Z(), labelPos: "above",
              label: clip(srcNode.tag, 14), dq: srcNode.data_status,
              /* the kernel's badge FORMATS the value, so it takes the NUMBER.
                 Passing it a pre-formatted "1,822" printed "NaN kW" — invisible
                 at the shipping zoom because the two lines only collided at
                 1.5, which is the only reason the sweep found it. */
              values: [srcNode.power_kw  != null ? { v: +srcNode.power_kw,  u: "kW" } : null,
                       srcNode.current_a != null ? { v: +srcNode.current_a, u: "A" }  : null].filter(Boolean),
              title: [srcNode.tag, sldKw(srcNode), sldAmp(srcNode),
                      srcNode.voltage_v != null ? n0(srcNode.voltage_v) + " V" : ""].filter(Boolean).join(" · ")
            });
            srcBottom = cyS + zy(13);
          } else {
            s += sldCard(cx, y0 + gx(SLD_SRC_Y), shown, sub, false);
            srcBottom = y0 + gx(SLD_SRC_Y) + gx(SLD_BOXH);
          }
          if (off) drawn.offsheet++;
          drawn.src++;
          s += `<line x1="${cx}" y1="${srcBottom}" x2="${cx}" y2="${sldPortY(p.symbol_kind, cx, cy, "A", p.breaker_family)}" stroke="${INK}" stroke-width="1.4"/>`;
          s += sldCable(cx, srcBottom + 13, up[0]);
        }
        s += `<line x1="${cx}" y1="${sldPortY(p.symbol_kind, cx, cy, "B", p.breaker_family)}" x2="${cx}" y2="${busY - 2}" stroke="${INK}" stroke-width="1.4"/>`;
        if (meterOn.has(p.tag)) s += meterAssembly(cx, busY, true, meterOn.get(p.tag));
        s += sldGlyph(p.symbol_kind, cx, cy, INK, false, p.breaker_family);
        s += sldPosLabel(cx, cy, sldPosCode(p.tag, boardTag), nav, p.tag);
      });

      /* ── outgoing positions + couplers, below the bar ── */
      band.out.forEach((p, i) => {
        const cx = colX(i), cy = y0 + gx(SLD_OUT_Y) + dy2;
        const isCpl = p.symbol_kind === "BUS_COUPLER";
        const edges = sldOut(S, p.tag).filter(e => e.edge_kind === "FEEDS");
        const openEdge = edges.some(e => e.normally_open);
        const dash = openEdge ? ` stroke-dasharray="5 4"` : "";
        drawn.out++; if (isCpl) drawn.cpl++;

        /* what this position reaches — resolved BEFORE the labels are painted so
           the drop line never runs across the position code (see HALO too) */
        const targets = edges.map(e => ({ e: e, n: S._byTag.get(e.to_tag) }))
          .filter(t => t.n && t.n.tag !== band.bus.tag);
        const t = targets[0], tn = t && t.n;
        /* ── v1.14.0 · a way that feeds MORE THAN ONE machine ──────────────
           Mario, on .312 and .313: "ambos deberían ser arrancados por
           arrancador suave, luego tener dos contactores auto-enclavados y dos
           motores conectados". Until now the renderer drew targets[0] and
           printed "+N more" in red — honest, but it left the second machine as
           a footnote on a drawing whose whole point is that there are two.
           Migration 184 made v_sld_nodes read the loads from the power graph,
           so N loads per way is now ordinary data and the drawing has to say
           so: the conductor forks into a short branch bar and each machine
           hangs off its own drop.
           Only plain, on-board, end-of-branch machines fan out. A busbar, an
           off-sheet position or a node that passes power on keeps the old
           single-target layout — those carry side labels and second levels
           that a fork would collide with. */
        const fan = (targets.length > 1 && targets.every(x =>
              x.n && !isBusbar(x.n) &&
              !(sldBoardOf(S, x.n) && sldBoardOf(S, x.n) !== boardTag) &&
              secondLevel(x.n).length === 0)) ? targets : null;

        s += `<line x1="${cx}" y1="${busY + 2}" x2="${cx}" y2="${sldPortY(p.symbol_kind, cx, cy, "A", p.breaker_family)}" stroke="${INK}" stroke-width="1.4"${dash}/>`;
        if (meterOn.has(p.tag)) s += meterAssembly(cx, busY, false, meterOn.get(p.tag));
        /* ── v1.10.0 · the STARTING DEVICE, between the breaker and the load ──
           Mario: "all contactors have coils, include a contactor with coil".
           Migration 174 puts `start_kind` in v_sld_nodes — VFD, SOFT_STARTER or
           CONTACTOR, in that priority, and only on OUTGOING ways: an incomer
           starts nothing, and restricting it also keeps out the nine bogus
           CONTACTOR rows on the analysers (CR-00238, still open).
           The conductor is BROKEN at the device's terminals, like every other
           symbol on the sheet — a line through a device says it is not in the
           circuit. A way with no start_kind draws exactly as before. */
        const yTop = sldPortY(p.symbol_kind, cx, cy, "B", p.breaker_family);
        const yBot = (tn && !isBusbar(tn) && !(sldBoardOf(S, tn) && sldBoardOf(S, tn) !== boardTag))
            ? sldPortY(tn.symbol_kind, cx, y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + zy(14), "A")
              - (fan ? zy(13) : 0)
            : y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt - 2;
        const stKind = p.start_kind && SLD_START.has(p.start_kind) ? p.start_kind : null;
        /* v1.14.0 — anchored so the TOP PORT lands where a 26-unit symbol's did.
           Hard-coding the centre at +40 put an 88-unit symbol's top port 27
           units above the fuse switch's bottom: the two overlapped. */
        const stY = cy + zy(40 + (stKind ? startExtra(stKind) / 2 : 0));
        if (t && stKind) {
          s += `<line x1="${cx}" y1="${yTop}" x2="${cx}" y2="${sldPortYDirect(stKind, cx, stY, "A")}" stroke="${INK}" stroke-width="1.4"${dash}/>`;
          s += sldSymDirect(stKind, { x: cx, y: stY, color: INK, scale: 0.92 * Z(),
            title: SLD_START.get(stKind) + (p.start_model ? " · " + p.start_model : "") });
          /* v1.14.0 — a symbol that declares BL/BR hands out TWO conductors, so
             the single trunk below it would be a third one that goes nowhere. */
          if (!(fan && startOuts(stKind, cx, stY)))
            s += `<line x1="${cx}" y1="${sldPortYDirect(stKind, cx, stY, "B")}" x2="${cx}" y2="${yBot}" stroke="${INK}" stroke-width="1.4"${dash}/>`;
        } else if (t) {
          s += `<line x1="${cx}" y1="${yTop}" x2="${cx}" y2="${yBot}" stroke="${INK}" stroke-width="1.4"${dash}/>`;
        }
        s += sldGlyph(p.symbol_kind, cx, cy, isCpl ? SLD_BUSCOL : INK, openEdge, p.breaker_family);
        s += sldPosLabel(cx, cy, sldPosCode(p.tag, boardTag), nav, p.tag);

        if (!t) {
          /* no power edge — but the position may still carry a documented
             cable-identity tie (CONNECTED_TO). Show it rather than "no load". */
          const tie = sldOut(S, p.tag).concat(sldIn(S, p.tag))
            .filter(e => e.edge_kind === "CONNECTED_TO" && e.cable_tag)[0];
          if (tie) {
            const other = S._byTag.get(tie.from_tag === p.tag ? tie.to_tag : tie.from_tag);
            const ob = other ? (sldBoardOf(S, other) || "") : "";
            s += `<line x1="${cx}" y1="${cy + zy(15)}" x2="${cx}" y2="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt - 2}" stroke="${SOFT}" stroke-width="1.2" stroke-dasharray="2 3"/>`;
            s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + 8}" text-anchor="middle" font-family="${MONO}" font-size="${ts(7.4)}" font-weight="700" fill="${SOFT}">⇢ ${esc(ob || "tie")} ${esc(other ? sldPosCode(other.tag, ob) : "")}</text>`;
            s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + 19}" text-anchor="middle" font-weight="600" font-family="${MONO}" font-size="${ts(6.6)}" fill="${SOFT}">cable tie · ${esc(tie.cable_tag)}</text>`;
          } else if (p.symbol_kind === "NETWORK_ANALYZER") {
            /* v1.3.0 — a metering position still in the outgoing row is one this
               diagram could NOT attach to its circuit. Say which of the two
               reasons it is; never let it look like a normal feeder (G-4). */
            s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + 8}" text-anchor="middle" font-family="${MONO}" font-size="${ts(7)}" font-weight="700" fill="${CRIMSON}">` +
              (p.measures_tag ? `⇢ ${esc(clip(p.measures_tag, 14))}` : "⚠ not attached") + `</text>`;
            s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + 19}" text-anchor="middle" font-weight="600" font-family="${MONO}" font-size="${ts(6.6)}" fill="${SOFT}">` +
              (p.measures_tag ? "not on this board" : "no measured circuit") + `</text>`;
          } else if (p.symbol_kind !== "SPARE") {
            s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + 16}" text-anchor="middle" font-weight="600" font-family="${MONO}" font-size="${ts(6.8)}" fill="${SOFT}">— no load linked —</text>`;
          }
          return;
        }
        /* v1.14.0 — the cable label sat at a hard-coded stY+24, which was below
           the 26-unit starting symbols and INSIDE the 76-unit SOFT_STARTER_2C.
           Hang it off the symbol's own B port instead, so it stays clear of any
           symbol the pack grows later. */
        s += sldCable(cx, stKind ? sldPortYDirect(stKind, cx, stY, "B") + zy(9) : cy + zy(50), t.e,
                      !!(fan && stKind && startOuts(stKind, cx, stY)));

        if (isBusbar(tn)) {                       /* coupler → another busbar */
          const here = busSet.has(tn.tag);
          const tBoard = here ? boardTag : (sldBoardOf(S, tn) || String(tn.parent_tag || ""));
          s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + 12}" text-anchor="middle" font-family="${MONO}" font-size="${ts(7.6)}" font-weight="700" fill="${SLD_BUSCOL}">` +
            `⇢ BUSBAR ${esc(sldBusCode(tn.tag, tBoard))}</text>`;
          if (!here) { drawn.offsheet++;
            s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + 23}" text-anchor="middle" font-weight="600" font-family="${MONO}" font-size="${ts(6.6)}" fill="${SOFT}">off-sheet · ${esc(tBoard)}</text>`; }
        } else if (sldBoardOf(S, tn) && sldBoardOf(S, tn) !== boardTag) {
          /* the target is a POSITION on another Power Center (.210 → PC3 .300,
             .211 → PC4 .400) — that is a board-to-board tie, not a load.       */
          drawn.offsheet++;
          const tb = sldBoardOf(S, tn);
          s += sldCard(cx, y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt, { tag: tb, data_status: tn.data_status },
                       sldPosCode(tn.tag, tb) + (t.e.cable_tag ? " · " + t.e.cable_tag : ""), false);
          s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + gx(SLD_BOXH) + 11}" text-anchor="middle" font-weight="600" font-family="${MONO}" font-size="${ts(6.6)}" fill="${SOFT}">off-sheet · PC tie</text>`;
        } else if (fan) {                          /* several machines, in parallel */
          const cyL = y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt;
          const cyM = cyL + zy(14);
          const outs = stKind ? startOuts(stKind, cx, stY) : null;
          /* the machines line up UNDER the symbol's own terminals when it has
             two, so each drop is a straight line. Only a one-output symbol
             needs a spacing guess and a branch bar. */
          const dx  = outs ? Math.abs(outs[1].x - outs[0].x) / 2 : gx(SLD_COL) * 0.28;
          const yBar = sldPortY(tn.symbol_kind, cx, cyM, "A") - zy(13);
          /* with a two-output symbol each machine gets its own conductor from
             its own terminal — a dog-leg, the way a real sheet draws it. With a
             one-output symbol, the old branch bar. */
          if (!outs)
            s += `<line x1="${cx - dx}" y1="${yBar}" x2="${cx + dx}" y2="${yBar}" stroke="${INK}" stroke-width="1.4"/>`;
          fan.forEach((x, k) => {
            const n = x.n, ox = cx + (k === 0 ? -dx : dx);
            drawn.load++;
            if (outs && outs[k])
              s += `<line x1="${outs[k].x}" y1="${outs[k].y}" x2="${ox}" y2="${yBar}" stroke="${INK}" stroke-width="1.4"/>`;
            s += `<line x1="${ox}" y1="${yBar}" x2="${ox}" y2="${sldPortY(n.symbol_kind, ox, cyM, "A")}" stroke="${INK}" stroke-width="1.4"/>`;
            s += sldGlyph(n.symbol_kind, ox, cyM, INK, false);
            /* the tags are clipped harder than in the single-machine case: two
               labels have to live inside one column pitch without touching each
               other or the neighbouring way. check_sld_layout.js is the judge. */
            s += `<text x="${ox}" y="${cyL + zy(42)}" text-anchor="middle" font-family="${MONO}" font-size="${ts(7.4)}" font-weight="700" fill="${INK}"` +
              (nav ? ` style="cursor:pointer" onclick="${nav}('asset/${esc(n.tag)}')"` : "") +
              `>${esc(clip(n.tag, 9))}</text>`;
            s += sldRating(ox, cyL + zy(51), n).svg;
            const stk = SLD_STATUS[n.data_status] || SOFT;
            s += `<circle cx="${ox - zy(16)}" cy="${cyM}" r="3" fill="${stk}"><title>${esc(n.data_status || "")}</title></circle>`;
          });
        } else {                                   /* a served load */
          drawn.load++;
          const cyL = y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt;
          /* ── v1.11.0 · a node that PASSES POWER ON is labelled to the SIDE ──
             Mario: "connect them to the motor". The conductor from a drive down
             to its motor was being drawn — and it was ONE PIXEL LONG. The start
             was hard-coded below the node's own label block (cyL + 56) while
             the motor's top port sits at about cyL + 73, so the line existed,
             passed every check, and joined nothing. It looked exactly like a
             drive with no motor attached.
             The label block was there to keep the conductor off the text; the
             fix is the same one the positions already use — put the text BESIDE
             the symbol and run the conductor straight through where it belongs.
             A node at the END of a branch keeps its labels underneath. */
          const passesOn = secondLevel(tn).length > 0;
          s += sldGlyph(tn.symbol_kind, cx, cyL + zy(14), INK, false);
          if (passesOn) {
            s += `<text x="${cx + zy(17)}" y="${cyL + zy(12)}" text-anchor="start" font-family="${MONO}" font-size="${ts(8)}" font-weight="700" fill="${INK}"${HALO}` +
              (nav ? ` style="cursor:pointer" onclick="${nav}('asset/${esc(tn.tag)}')"` : "") +
              `>${esc(clip(tn.tag, 15))}</text>`;
            let ry = cyL + zy(22);
            [sldKw(tn), sldAmp(tn)].filter(Boolean).forEach(v => {
              s += `<text x="${cx + zy(17)}" y="${ry}" text-anchor="start" font-weight="600" font-family="${MONO}" font-size="${ts(6.8)}" fill="${SOFT}"${HALO}>${esc(v)}</text>`;
              ry += zy(10);
            });
          } else {
            s += `<text x="${cx}" y="${cyL + zy(42)}" text-anchor="middle" font-family="${MONO}" font-size="${ts(8)}" font-weight="700" fill="${INK}"` +
              (nav ? ` style="cursor:pointer" onclick="${nav}('asset/${esc(tn.tag)}')"` : "") +
              `>${esc(clip(tn.tag, 15))}</text>`;
            const rt = sldRating(cx, cyL + zy(52), tn); s += rt.svg;
            if (targets.length > 1)
              s += `<text x="${cx}" y="${rt.y}" text-anchor="middle" font-weight="600" font-family="${MONO}" font-size="${ts(6.4)}" fill="${CRIMSON}">+${targets.length - 1} more</text>`;
          }
          const st = SLD_STATUS[tn.data_status] || SOFT;
          s += `<circle cx="${cx - zy(26)}" cy="${cyL + zy(14)}" r="3" fill="${st}"><title>${esc(tn.data_status || "")}</title></circle>`;

          /* SECOND LEVEL (v1.2.0) — this load is itself a board that feeds
             something. Migration 154 put those nodes in v_sld_nodes; without
             this block their edges would be drawable and still not drawn,
             which is the worse of the two failures: the footer would report
             everything fine while the motor was missing from the picture. */
          const kids = secondLevel(tn);
          if (kids.length) {
            const cyK = cyL + gx(SLD_L2_DY) + (targets.length > 1 ? 8 : 0);
            const kn = S._byTag.get(kids[0].to_tag);
            s += `<line x1="${cx}" y1="${sldPortY(tn.symbol_kind, cx, cyL + zy(14), "B")}" x2="${cx}" y2="${
              sldPortY(kn.symbol_kind, cx, cyK + zy(12), "A")}" stroke="${INK}" stroke-width="1.4"/>`;
            s += sldCable(cx, cyK - zy(28), kids[0]);
            s += sldGlyph(kn.symbol_kind, cx, cyK + zy(12), INK, false);
            s += `<circle cx="${cx - zy(26)}" cy="${cyK + zy(12)}" r="3" fill="${SLD_STATUS[kn.data_status] || SOFT}">` +
              `<title>${esc(kn.data_status || "")}</title></circle>`;
            s += `<text x="${cx}" y="${cyK + zy(38)}" text-anchor="middle" font-family="${MONO}" font-size="${ts(8)}" font-weight="700" fill="${INK}"` +
              (nav ? ` style="cursor:pointer" onclick="${nav}('asset/${esc(kn.tag)}')"` : "") +
              `>${esc(clip(kn.tag, 15))}</text>`;
            const rk = sldRating(cx, cyK + zy(48), kn); s += rk.svg;
            if (kids.length > 1)
              s += `<text x="${cx}" y="${rk.y}" text-anchor="middle" font-weight="600" font-family="${MONO}" font-size="${ts(6.4)}" fill="${CRIMSON}">+${kids.length - 1} more</text>`;
            drawn.load++;
          }
        }
      });
    });

    /* ── v1.15.2 · footer: SILENT UNLESS SOMETHING IS WRONG ────────────────
       v1.15.0 dropped the symbol legend and kept the account. Mario circled the
       account too — and on the boards as they stand it was reporting the
       ALL-CLEAR: "14 network links (expected)" and "0 analysers left in the
       outgoing row". Two lines of page, every board, to say nothing happened.

       So the rule tightens rather than the honesty loosening: the footer speaks
       only when there is a GAP.

         · edges not drawable — only the POWER ones. A CONNECTED_TO edge whose
           endpoint is not an electrical node is expected and always will be;
           and the raw count is on the page anyway, in the EDGES NOT DRAWABLE
           fact card above the drawing, which is where a number belongs.
         · analysers — only the ones left stranded in the outgoing row. How many
           were placed correctly is not news.

       Everything clean, and the sheet ends at its last busbar. Something wrong,
       and the line is there in red with nothing else competing for the eye —
       which is more visible than it ever was buried in an all-clear paragraph.
       Rule G-4 is about a gap staying visible, not about narrating success.   */
    let fy = H - gx(14) - zy(14) - _footRows * zy(13);
    const legendRows = 0;
    let fy2 = fy + zy(13);
    const nPwrSkipped = S._skipped.filter(e => e.edge_kind !== "CONNECTED_TO").length;
    if (nPwrSkipped) {
      s += `<text x="${gx(SLD_PADX)}" y="${fy2}" font-weight="600" font-family="${MONO}" font-size="${ts(7.4)}" fill="${CRIMSON}">` +
        `${nPwrSkipped} POWER edge${nPwrSkipped === 1 ? "" : "s"} in v_sld_edges not drawable — ` +
        `endpoint absent from v_sld_nodes ← this is a gap</text>`;
      fy2 += zy(13); }
    if (meterUnplaced.length)
      s += `<text x="${gx(SLD_PADX)}" y="${fy2}" font-weight="600" font-family="${MONO}" font-size="${ts(7.4)}" fill="${CRIMSON}">` +
        `${meterUnplaced.length} analyser${meterUnplaced.length === 1 ? "" : "s"} could not be attached to a ` +
        `measured circuit and stayed in the outgoing row — ` +
        `${meterUnplaced.map(m => sldPosCode(m.tag, boardTag)).join(", ")}</text>`;
    s += `</svg>`;
    /* the page ends below whatever the footer actually reached */
    const HH = Math.max(H, fy2 + gx(12), fy + legendRows * zy(13) + gx(12));
    s = s.split("%H%").join(String(+HH.toFixed(1)));
    return `<div style="overflow-x:auto">${s}</div>`;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     v1.16.0 · THE SUMMARY VIEW — one screen for the whole installation
     ─────────────────────────────────────────────────────────────────────
     Mario asked for an executive read of the electrical distribution: a card
     per Power Center with the figures that matter, and under them a small
     schematic that answers only ONE question — who feeds whom. Click a card,
     get that board's full single-line.

     The rule that shapes everything here: THE INCOMING SIDE IS DETAIL, THE
     OUTGOING SIDE IS A NUMBER. Where a board's energy comes from is the whole
     point of a distribution overview, so every generator, every inverter and
     every coupler is named. What the board then feeds is 44 motors, and naming
     them is the detailed sheet's job — up here they are "44 loads, 15.4 MW"
     and a single arrow. Mario: *"la carga no se muestra como detalle sino como
     algo genérico"*.

     Nothing is added to the database for any of this: it is v_sld_nodes and
     v_sld_edges counted differently.                                        */

  /* Everything the summary needs about one board, derived from the graph — no
     hard-coded plant knowledge, so a fifth Power Center appears on its own. */
  function sldBoardStats(S, boardTag) {
    const board = S._byTag.get(boardTag);
    const buses = (S._kids.get(boardTag) || []).filter(isBusbar).sort(byRank);
    const busSet = new Set(buses.map(b => b.tag));
    const pos = buses.reduce((a, b) => a.concat(S._kids.get(b.tag) || []), []);

    /* an INCOMER is a position that feeds a busbar of THIS board; everything
       else is an outgoing way. The same predicate the drawing uses. */
    const inc = [], out = [];
    pos.forEach(p => (sldOut(S, p.tag).some(e => e.edge_kind === "FEEDS" && busSet.has(e.to_tag))
                      ? inc : out).push(p));

    /* ── where the energy comes from ──────────────────────────────────────
       Walk BACK from each incomer. Whatever feeds it is either a machine that
       makes power (a generator, an inverter) or a position on another board —
       and those two cases are the two ways a Power Center can be energised. */
    const sources = [], upstream = [];
    inc.forEach(p => sldIn(S, p.tag).filter(e => e.edge_kind === "FEEDS").forEach(e => {
      const src = S._byTag.get(e.from_tag); if (!src) return;
      /* A BUSBAR arriving here is not an upstream feed — it is the far side of
         a coupler, and the database carries that edge in both directions, so
         every coupler position looked like a board being fed from its
         neighbour. PC1 and PC2 each claimed the other as their upstream and
         both dropped off the generation row. Couplers are counted once, below,
         as ties; a real upstream feed is a POSITION on another board. */
      if (isBusbar(src)) return;
      const sb = sldBoardOf(S, src);
      if (sb && sb !== boardTag) upstream.push({ pos: p, from: src, board: sb, cable: e.cable_tag });
      else if (src.tag !== boardTag) sources.push({ pos: p, node: src });
    }));

    /* ── the couplers that leave this board ───────────────────────────────
       A tie to a busbar of another board is a source this section CAN have.
       Its N.O. state is carried because all of them are normally open: drawn
       without it the overview would claim a feed that does not normally
       exist, which is the same rule G-3 the detailed sheet obeys. */
    const ties = [];
    pos.forEach(p => sldOut(S, p.tag).filter(e => e.edge_kind === "FEEDS").forEach(e => {
      const t = S._byTag.get(e.to_tag);
      if (!t || !isBusbar(t) || busSet.has(t.tag)) return;
      const tb = sldBoardOf(S, t) || "";
      if (tb && tb !== boardTag) ties.push({ pos: p, to: t, board: tb, open: !!e.normally_open });
    }));

    const start = { VFD: 0, SOFT_STARTER: 0, SOFT_STARTER_2C: 0, CONTACTOR: 0 };
    let kw = 0, loads = 0;
    out.forEach(p => {
      if (p.start_kind && start[p.start_kind] != null) start[p.start_kind]++;
      /* the power total is the OUTGOING side only. Adding the incomers would
         count the same energy twice — once arriving, once leaving. */
      if (p.power_kw != null) kw += +p.power_kw;
      if (sldOut(S, p.tag).some(e => e.edge_kind === "FEEDS" &&
            S._byTag.has(e.to_tag) && !isBusbar(S._byTag.get(e.to_tag)))) loads++;
    });

    /* GENERATION connected to this board. Apparent power only where the source
       declares a power factor — the two inverters do not, so they are COUNTED
       as unknown rather than given a plausible 0.8. A number the drawing made
       up would be indistinguishable from one the plant measured. */
    let genKw = 0, genKva = 0, genNoPf = 0;
    sources.forEach(x => {
      if (x.node.power_kw != null) genKw += +x.node.power_kw;
      if (x.node.apparent_kva != null) genKva += +x.node.apparent_kva;
      else if (x.node.power_kw != null) genNoPf++;
    });
    const ratingUp = !!S._hasRating;

    return { tag: boardTag, doc_no: board && board.doc_no, voltage_v: board && board.voltage_v,
             genKw, genKva, genNoPf, ratingUp,
             busbars: buses.length, positions: pos.length, inc: inc.length, out: out.length,
             sources, upstream, ties, start, kw, loads };
  }

  const SUM_START = [["VFD", "VFD"], ["SOFT_STARTER", "SOFT STARTER"],
                     ["SOFT_STARTER_2C", "SOFT STARTER · 2 CONT."], ["CONTACTOR", "DOL"]];

  /* v1.17.0 — the two halves are addressable on their own. The page keeps the
     CARDS on screen the whole time and swaps only what is under them: the
     schematic when nothing is picked, the board's sheet when something is.
     Mario: *"switchboard cards remain in the view, when I click in one it is
     highlighted and below the SLD detail appears"*. That is one page with a
     selection, not two pages — you never lose the row you are choosing from. */
  function sldSummary(S, o) {
    return sldSummaryCards(S, o) + sldSummarySchematic(S, o);
  }

  function sldSummaryCards(S, o) {
    o = o || {};
    if (!S || !S._byTag) return "";
    const nav = o.onNavigate, sel = o.selected || null;
    const stats = sldBoards(S).map(b => sldBoardStats(S, b.tag));
    if (!stats.length) return "";
    const byTag = new Map(stats.map(x => [x.tag, x]));

    /* ── the cards ─────────────────────────────────────────────────────── */
    const mw = k => (k >= 1000 ? (k / 1000).toFixed(1) + " MW" : Math.round(k) + " kW");
    const card = st => {
      /* generators of equal rating are one line with a count, not five lines:
         "5 × 1,822 kW" is the sentence an engineer would say out loud. */
      const grp = new Map();
      st.sources.forEach(x => {
        const k = (x.node.symbol_kind || "SRC") + "|" + (x.node.power_kw == null ? "" : x.node.power_kw);
        if (!grp.has(k)) grp.set(k, { kind: x.node.symbol_kind, kw: x.node.power_kw, n: 0 });
        grp.get(k).n++;
      });
      const srcName = { GENERATOR: "generator", INVERTER: "inverter", TRANSFORMER: "transformer" };
      const feed = [];
      grp.forEach(g => {
        const nm = srcName[g.kind] || String(g.kind || "fuente").toLowerCase();
        feed.push(`${g.n} ${nm}${g.n > 1 ? "s" : ""}` +
                  (g.kw != null ? ` · ${n0(g.kw)} kW${g.n > 1 ? " each" : ""}` : ""));
      });
      st.upstream.forEach(u => feed.push(`from ${u.board} ${sldPosCode(u.from.tag, u.board)}` +
                                         (u.cable ? " · " + u.cable : "")));
      const tieTxt = st.ties.map(t => `${sldBusCode(t.to.tag, t.board)} · ${t.board}${t.open ? " · N.O." : ""}`);

      const chips = SUM_START.filter(k => st.start[k[0]] > 0).map(k =>
        `<span style="display:inline-block;border:1px solid ${LINE};border-radius:3px;padding:1px 6px;` +
        `margin:0 4px 4px 0;font:700 10px ${MONO};color:${INK}">${k[1]} <span style="color:${CRIMSON}">${st.start[k[0]]}</span></span>`).join("");

      /* A selected card is not a card with a highlight bolted on: it is the
         open one. Heavier border, tinted background, and its own ✕ — clicking
         the card again also closes it, so the gesture that opened it is the
         gesture that closes it. */
      const on = sel === st.tag;
      const go = on ? "sld" : "sld/'+encodeURIComponent('" + esc(st.tag) + "')+'";
      return `<div${nav ? ` onclick="${nav}('${go}')" style="cursor:pointer;` : ` style="`}` +
        `border:1px solid ${on ? CRIMSON : LINE};border-top:3px solid ${CRIMSON};border-radius:6px;` +
        `padding:10px 12px;background:${on ? "#FFF7F8" : "#fff"};` +
        `box-shadow:${on ? "0 2px 10px rgba(200,16,46,.16)" : "none"};position:relative">` +
        (on ? `<div style="position:absolute;top:6px;right:8px;font:700 13px ${MONO};color:${CRIMSON}" title="close">✕</div>` : "") +
        `<div style="font:700 13px ${MONO};color:${CRIMSON}">${esc(st.tag)}</div>` +
        /* the drawing number is gone from the card. Mario: it is the ELD03
           sheet reference, it is the same four times over, and on a card whose
           job is a figure at a glance it was the widest line of type. It is
           still one click away, on the sheet itself. */
        `<div style="font:600 10px ${MONO};color:${SOFT};margin-bottom:8px">` +
          `${st.voltage_v != null ? n0(st.voltage_v) + " V · " : ""}${st.busbars} busbar${st.busbars === 1 ? "" : "s"}</div>` +
        /* GENERATION and LOAD side by side, because the pair is the reading:
           PC1 carries 6.9 MW of load under 8.6 MW / 10.1 MVA of engines, and a
           card that showed only one of them would answer half the question.
           Generation in MVA is what sizes switchgear; load in MW is what the
           plant actually draws. A board with no generation of its own says so
           rather than printing a zero, which would read as "shut down". */
        /* BOTH figures big, generation first and in ink, connected load a shade
           greyer. Mario: *"en grande el de generación y el de carga conectada,
           tal vez generación en negro y carga un poco más gris"*. The weighting
           is the point: on a distribution overview the generation is the
           headline and the load is what it has to cover. */
        `<div style="display:flex;gap:18px;align-items:flex-end;margin-bottom:3px">` +
          `<div><div style="font:700 25px ${SANS};color:${INK};line-height:1.05">` +
            (st.genKva ? `${(st.genKva / 1000).toFixed(1)} MVA`
                       : (st.genKw ? `${(st.genKw / 1000).toFixed(1)} MW` : `<span style="color:${LINE}">—</span>`)) + `</div>` +
            `<div style="font:600 9px ${MONO};color:${SOFT}">GENERATION` +
              (st.genKva && st.genKw ? ` · ${(st.genKw / 1000).toFixed(1)} MW` : "") + `</div></div>` +
          `<div><div style="font:700 25px ${SANS};color:#79808A;line-height:1.05">${mw(st.kw)}</div>` +
            `<div style="font:600 9px ${MONO};color:${SOFT}">CONNECTED LOAD</div></div>` +
        `</div>` +
        /* three different sentences, never blurred into one:
             the ratings view did not load      -> we cannot say
             a source declares no power factor  -> the plant has not said
             everything present                 -> nothing to add            */
        (!st.ratingUp && st.genKw
           ? `<div style="font:600 9px ${MONO};color:${SOFT};margin-bottom:2px">apparent power unavailable — source ratings did not load</div>`
           : st.genNoPf ? `<div style="font:600 9px ${MONO};color:${CRIMSON};margin-bottom:2px">` +
               `+ ${st.genNoPf} source${st.genNoPf === 1 ? "" : "s"} with no declared power factor — not in the MVA</div>` : "") +
        `<div style="font:600 11px ${MONO};color:${SOFT};margin:2px 0 8px">${st.positions} positions · ${st.loads} loads</div>` +
        `<div style="font:600 10px ${MONO};color:${SLD_BUSCOL};margin-bottom:2px">⚡ ${feed.length ? feed.map(esc).join("<br>⚡ ") : "no source declared"}</div>` +
        (tieTxt.length ? `<div style="font:600 10px ${MONO};color:${SOFT};margin-bottom:6px">⇄ ${tieTxt.map(esc).join("<br>⇄ ")}</div>` : `<div style="margin-bottom:6px"></div>`) +
        (chips || `<span style="font:600 10px ${MONO};color:${SOFT}">no starting method declared</span>`) +
        `</div>`;
    };

    return `<div id="sldcards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px">` +
      stats.map(card).join("") + `</div>`;
  }

  function sldSummarySchematic(S, o) {
    o = o || {};
    if (!S || !S._byTag) return "";
    const nav = o.onNavigate;
    const stats = sldBoards(S).map(b => sldBoardStats(S, b.tag));
    if (!stats.length) return "";
    const mw = k => (k >= 1000 ? (k / 1000).toFixed(1) + " MW" : Math.round(k) + " kW");

    /* ── the mini schematic: WHO FEEDS WHOM, and nothing else ────────────
       Depth is derived, not assumed: a board with no upstream board is a
       generation node and sits on the top row; one fed from another sits
       under it. A fifth board slots itself in without a line of code. */
    const depth = st => st.upstream.length ? 1 : 0;
    const rows = [stats.filter(x => depth(x) === 0), stats.filter(x => depth(x) === 1)];
    const BW = 260, BH = 62, GAPX = 70, GAPY = 104, PAD = 16, TOPY = 62;
    const rowW = r => r.length * BW + Math.max(0, r.length - 1) * GAPX;
    const W = Math.max(PAD * 2 + rowW(rows[0]), PAD * 2 + rowW(rows[1]), 520);
    const H = TOPY + BH + (rows[1].length ? GAPY + BH : 0) + 46;
    const bx = (r, i) => (W - rowW(r)) / 2 + i * (BW + GAPX);
    const by = ri => TOPY + ri * (BH + GAPY);
    /* which boards feed a board below them — needed before the first box is
       drawn, so the load arrow knows to step aside for the outgoing feed */
    const feedsDown = new Set();
    stats.forEach(st => st.upstream.forEach(u => feedsDown.add(u.board)));
    const at = new Map();
    rows.forEach((r, ri) => r.forEach((st, i) => at.set(st.tag, { x: bx(r, i), y: by(ri), w: BW, h: BH })));

    let g = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-family="${SANS}">` +
      `<rect width="${W}" height="${H}" fill="#fff"/>`;

    rows.forEach((r, ri) => r.forEach(st => {
      const b = at.get(st.tag);
      /* the generation above a top-row board: ONE machine symbol per distinct
         rating with its count, because five identical circles say nothing that
         "5 ×" does not, and they cost the width the labels need. */
      if (ri === 0 && st.sources.length) {
        const grp = new Map();
        st.sources.forEach(x => { const k = (x.node.symbol_kind || "SRC") + "|" + (x.node.power_kw == null ? "" : x.node.power_kw);
          if (!grp.has(k)) grp.set(k, { kind: x.node.symbol_kind, kw: x.node.power_kw, n: 0 }); grp.get(k).n++; });
        const list = Array.from(grp.values());
        list.forEach((s2, k) => {
          const cx = b.x + b.w * (k + 1) / (list.length + 1), cy = TOPY - 30;
          const K = (typeof window !== "undefined" ? window : globalThis).TamSym;
          const sym = s2.kind === "GENERATOR" ? "GENERATOR" : (s2.kind === "INVERTER" ? "INVERTER" : "GENERATOR");
          g += (K && K.has && K.has(sym)) ? K.draw(sym, { x: cx, y: cy, scale: 0.8, color: INK })
             : `<circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="${INK}"/>`;
          g += `<line x1="${cx}" y1="${cy + 10}" x2="${cx}" y2="${b.y}" stroke="${INK}" stroke-width="1.3"/>`;
          /* TWO lines, not one. On a single line "4 × 1,822 kW" is 78 px of
             10 px mono and three groups had to share 190 px of box: they
             overlapped into "4 × 1,82  kW1,280kW 710 kW", which is not a number
             at all. Count above, rating below, and the box got wider too. */
          g += `<text x="${cx}" y="${cy - 24}" text-anchor="middle" font-family="${MONO}" font-size="10" font-weight="700" fill="${INK}">${s2.n} ×</text>`;
          if (s2.kw != null)
            g += `<text x="${cx}" y="${cy - 14}" text-anchor="middle" font-family="${MONO}" font-size="9" font-weight="600" fill="${SOFT}">${n0(s2.kw)} kW</text>`;
        });
      }
      g += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4" fill="#fff" stroke="${CRIMSON}" stroke-width="1.6"` +
        (nav ? ` style="cursor:pointer" onclick="${nav}('sld/'+encodeURIComponent('${esc(st.tag)}'))"` : "") + `/>`;
      g += `<text x="${b.x + b.w / 2}" y="${b.y + 24}" text-anchor="middle" font-family="${MONO}" font-size="12" font-weight="700" fill="${CRIMSON}">${esc(st.tag)}</text>`;
      g += `<text x="${b.x + b.w / 2}" y="${b.y + 40}" text-anchor="middle" font-family="${MONO}" font-size="9.5" font-weight="600" fill="${SOFT}">` +
        (st.genKva ? `${(st.genKva / 1000).toFixed(1)} MVA generation` : `${st.busbars} busbar${st.busbars === 1 ? "" : "s"}`) + `</text>`;
      g += `<text x="${b.x + b.w / 2}" y="${b.y + 53}" text-anchor="middle" font-family="${MONO}" font-size="9.5" font-weight="700" fill="${INK}">` +
        `${st.positions} pos · ${mw(st.kw)}</text>`;
      /* THE LOAD, GENERIC — one arrow, one count. This is the whole point of a
         summary: the 44 motors are on the other sheet. */
      /* the generic load and the feed to a downstream board both leave the
         bottom of the box; centred, they left it at the SAME POINT and the eye
         could not tell the load from the cable to the MCC. A board that feeds
         something else puts its load on the left third and its feed on the
         right; a board that feeds nothing keeps the arrow centred. */
      const ay = b.y + b.h, lx = b.x + b.w * (feedsDown.has(st.tag) ? 0.28 : 0.5);
      g += `<line x1="${lx}" y1="${ay}" x2="${lx}" y2="${ay + 14}" stroke="${INK}" stroke-width="1.3"/>` +
        `<path d="M${lx - 6},${ay + 14} L${lx + 6},${ay + 14} L${lx},${ay + 24} Z" fill="${INK}"/>` +
        `<text x="${lx + 10}" y="${ay + 22}" font-family="${MONO}" font-size="9.5" font-weight="600" fill="${SOFT}">${st.loads} loads</text>`;
    }));

    /* the feed from an upstream board: a plain elbow, top row to bottom row */
    let elb = 0;
    stats.forEach(st => st.upstream.forEach(u => {
      const a = at.get(u.board), b = at.get(st.tag); if (!a || !b) return;
      /* each feed gets its OWN horizontal run. Sharing one, two cables out of
         the same board drew a single line with both labels stacked on the same
         spot: the drawing said "one feed", the data said two. */
      const x1 = a.x + a.w * 0.72, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y,
            my = y1 + 30 + (elb++) * 16;
      g += `<path d="M${x1},${y1} L${x1},${my} L${x2},${my} L${x2},${y2}" fill="none" stroke="${SLD_BUSCOL}" stroke-width="1.6"/>` +
        `<path d="M${x2 - 5},${y2 - 9} L${x2 + 5},${y2 - 9} L${x2},${y2} Z" fill="${SLD_BUSCOL}"/>` +
        /* the label goes on the MIDDLE of its own horizontal run, where nothing
           else is. Anchored at the left end it landed on the source board's
           "N cargas" arrow; anchored at the right end, on the drop line. When
           the run is too short to hold it, it steps aside instead. */
        `<text x="${Math.abs(x1 - x2) > 60 ? (x1 + x2) / 2 : Math.max(x1, x2) + 8}" y="${my - 4}" ` +
        `text-anchor="${Math.abs(x1 - x2) > 60 ? "middle" : "start"}" font-family="${MONO}" font-size="9" font-weight="600" fill="${SLD_BUSCOL}">` +
        `${esc(sldPosCode(u.from.tag, u.board))}${u.cable ? " · " + esc(u.cable) : ""}</text>`;
    }));

    /* the coupler between two boards: dashed, because every one of them is
       normally open — a solid line would claim a feed that does not exist */
    const seen = new Set();
    stats.forEach(st => st.ties.forEach(t => {
      const a = at.get(st.tag), b = at.get(t.board); if (!a || !b) return;
      const key = [st.tag, t.board].sort().join("|"); if (seen.has(key)) return; seen.add(key);
      const l = a.x < b.x ? a : b, r = a.x < b.x ? b : a;
      const y = l.y + l.h / 2;
      g += `<line x1="${l.x + l.w}" y1="${y}" x2="${r.x}" y2="${y}" stroke="${SLD_BUSCOL}" stroke-width="1.6"${t.open ? ` stroke-dasharray="5 4"` : ""}/>` +
        `<text x="${(l.x + l.w + r.x) / 2}" y="${y - 6}" text-anchor="middle" font-family="${MONO}" font-size="9" font-weight="700" fill="${SLD_BUSCOL}">` +
        `${t.open ? "N.O." : "coupler"}</text>`;
    }));
    g += `</svg>`;

    return `<div style="margin-top:12px;border:1px solid ${LINE};border-radius:6px;background:#fff;padding:10px;overflow-x:auto;text-align:center">${g}</div>`;
  }

  /* ── export ───────────────────────────────────────────────────────────── */
  const API = { load, fromViewer, plantMap, areaBlock, unitSummary, hmbCards, svcClass, hmbChip, indexData,
                loadSld, sldFromViewer, indexSld, sldBoards, sld,
                sldSummary, sldSummaryCards, sldSummarySchematic, sldBoardStats,
                get sldSymbolStyle() { return sldSymbolStyle; },
                set sldSymbolStyle(v) { sldSymbolStyle = (v === "BOX" ? "BOX" : "IEC"); },
                get sldZoom() { return sldZoom; },
                set sldZoom(v) { sldZoom = (+v > 0 ? +v : 1); },
                /* 0 = let each call decide (it should pass `wrapWidth`,
                   measured off its own container — see index.html; the window is
                   only the last-resort fallback, and it does not know about the
                   page's navigator rail). A number here OVERRIDES every caller,
                   which is what a reproducible export or a print wants: set it
                   and the same board cuts into the same rows on any machine. */
                get sldWrapWidth() { return sldWrapWidth; },
                set sldWrapWidth(v) { sldWrapWidth = (+v > 0 ? +v : 0); },
                version: "1.30.0" };
  const root = (typeof window !== "undefined") ? window : globalThis;
  root.TamFlow = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
