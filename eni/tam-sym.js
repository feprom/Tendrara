/* ═══════════════════════════════════════════════════════════════════════════
   tam-sym.js — Tendrara symbol kernel (discipline-agnostic)
   ─────────────────────────────────────────────────────────────────────────
   ONE kernel. Symbol PACKS register into it, one pack per discipline:

     tam-sym-elec.js    ELECTRICAL      single-line, power flow, SCADA mimic
     tam-sym-proc.js    PROCESS         (future — folds the P&ID glyphs in)
     tam-sym-inst.js    INSTRUMENT      (future — the ISA bubbles)
     tam-sym-safety.js  SAFETY          (future — F&G / ESD devices)

   A pack contributes GEOMETRY + PORTS + STATE RULES. It never contains a
   renderer, a layout engine or a data loader — those stay in tam-flow.js.
   Rule, same as the process side: never fork a second renderer, and never
   fork a second symbol kernel. Add a pack, or add a symbol to a pack.

   WHY PARAMETRIC JS AND NOT AN SVG ASSET LIBRARY
     A single-line symbol is not a picture. It has to carry, per instance:
       · connection PORTS the router can attach a conductor to
       · a STATE (open / closed / tripped / de-energized / unknown)
       · a DATA QUALITY mark (the project's VERIFIED / NEEDS_REVIEW / CONFLICT)
       · live or design MEASUREMENTS (P, Q, I, U, cos φ, E) as a badge
     Static .svg files carry none of that, and dropping a <use href> per node
     costs more bytes than drawing the shape. IEC 60617 shapes are circles,
     lines and arcs — 26 of them fit in ~14 KB with all four layers above.

   IEC 60617 NOTE
     The standard's own symbol database is licensed by IEC and is NOT
     redistributed here. Every shape in these packs is drawn from geometric
     primitives against the published shape descriptions, the same way any
     CAD template is built. Nothing is copied from a paywalled asset set.

   API
     TamSym.def(kind, spec)           register a symbol (packs call this)
     TamSym.has(kind)                 boolean
     TamSym.kinds()                   all registered kinds
     TamSym.draw(kind, o)             → SVG string, positioned
     TamSym.ports(kind, o)            → {name: {x, y, dir}} in PARENT coords
     TamSym.badge(values, x, y, o)    → measurement badge SVG
     TamSym.flow(x1,y1,x2,y2, o)      → conductor + direction + load-flow chip
     TamSym.legend(kinds, o)          → legend strip SVG
     TamSym.STATE / TamSym.DQ         colour tokens

   SPEC SHAPE (what a pack registers)
     { name   : "Circuit breaker",          // human, for the legend
       std    : "IEC 60617-07 S00219",      // reference, documentation only
       w, h   : bounding box, symbol units, centred on (0,0)
       ports  : { A:[x,y,"N"], B:[x,y,"S"] },
       stateful: true|false,                 // does OPEN/CLOSED change the shape
       body   : c => "<svg fragment>" }      // c = draw context, see below

   DRAW CONTEXT `c` handed to body()
     c.col    resolved stroke colour (from state)
     c.sw     stroke width in symbol units
     c.open   true when state is OPEN / N.O.
     c.state  raw state string
     c.o      the caller's full options object
     c.ln/c.cir/c.rect/c.arc/c.txt/c.path  primitive helpers

   Zero dependencies. Emits plain SVG strings, so it works in the ENI viewer,
   in a training module, in an offline snapshot and in a print/PDF path.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const MONO = "Consolas,monospace";
  const INK = "#15171A", SOFT = "#4A4F57", LINE = "#C9CED4", CRIMSON = "#C8102E";

  /* ── colour tokens ────────────────────────────────────────────────────────
     STATE is the OPERATIONAL condition of the object.
     DQ is how much we trust the ROW — the project's data_status, already used
     as a dot in the phase-11 single-line. The two are independent and are
     drawn on different layers: state colours the shape, DQ colours the dot. */
  const STATE = {
    CLOSED:       INK,        // in service, conducting
    ENERGIZED:    "#0B5CAD",
    OPEN:         SOFT,       // open / normally open
    DEENERGIZED:  "#8A9099",
    TRIPPED:      CRIMSON,
    FAULT:        CRIMSON,
    ALARM:        "#B26A00",
    UNKNOWN:      "#8A9099",
    DESIGN:       INK         // no live value bound — the default
  };
  const DQ = { VERIFIED: "#1F8A4C", NEEDS_REVIEW: "#B26A00", CONFLICT: CRIMSON, REJECTED: SOFT };

  /* ── helpers ──────────────────────────────────────────────────────────── */
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const num = v => (Math.round(v * 1000) / 1000);
  const clip = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const fmt = v => v == null ? "—" : Math.abs(+v) >= 100 ? Math.round(+v).toLocaleString("en-US")
    : (+v).toLocaleString("en-US", { maximumFractionDigits: 2 });

  const REG = new Map();

  function def(kind, spec) {
    if (!kind || !spec || typeof spec.body !== "function")
      throw new Error("TamSym.def: " + kind + " needs a body() function");
    REG.set(String(kind).toUpperCase(), Object.assign({ w: 24, h: 24, ports: {}, stateful: false }, spec));
    return spec;
  }
  const has = k => REG.has(String(k || "").toUpperCase());
  const kinds = () => Array.from(REG.keys()).sort();
  const spec = k => REG.get(String(k || "").toUpperCase()) || REG.get("UNKNOWN");

  /* primitive helpers handed to every body() — keeps packs terse and uniform */
  function primitives(col, sw) {
    const S = `stroke="${col}" stroke-width="${sw}" stroke-linecap="round"`;
    return {
      ln: (x1, y1, x2, y2, dash) =>
        `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" ${S}${dash ? ` stroke-dasharray="${dash}"` : ""}/>`,
      cir: (cx, cy, r, fill, dash) =>
        `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="${fill || "none"}" ${S}${dash ? ` stroke-dasharray="${dash}"` : ""}/>`,
      rect: (x, y, w, h, fill, dash, rx) =>
        `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${rx ? ` rx="${rx}"` : ""} fill="${fill || "none"}" ${S}${dash ? ` stroke-dasharray="${dash}"` : ""}/>`,
      path: (d, fill, dash) =>
        `<path d="${d}" fill="${fill || "none"}" ${S}${dash ? ` stroke-dasharray="${dash}"` : ""}/>`,
      dot: (cx, cy, r) => `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r || 1.6)}" fill="${col}"/>`,
      txt: (x, y, t, size, weight, anchor, fill) =>
        `<text x="${num(x)}" y="${num(y)}" text-anchor="${anchor || "middle"}" font-family="${MONO}" ` +
        `font-size="${size || 8}"${weight ? ` font-weight="${weight}"` : ""} fill="${fill || col}">${esc(t)}</text>`
    };
  }

  /* ── draw ─────────────────────────────────────────────────────────────────
     o = { x, y, scale, state, dq, open, label, sub, values, title, onClick,
           rot, color, dim }
     Returns one <g>. Everything inside is in SYMBOL units; the group scales,
     so a symbol drawn at scale 2 keeps its line weights proportional. */
  function draw(kind, o) {
    o = o || {};
    const sp = spec(kind);
    if (!sp) return "";
    const st = String(o.state || (o.open ? "OPEN" : "DESIGN")).toUpperCase();
    const col = o.color || (o.dim ? LINE : (STATE[st] || INK));
    const sw = o.strokeWidth || 1.6;
    const c = Object.assign(primitives(col, sw), {
      col, sw, state: st, open: o.open === true || st === "OPEN", o
    });

    const s = o.scale == null ? 1 : o.scale;
    const tr = `translate(${num(o.x || 0)},${num(o.y || 0)})` +
      (s !== 1 ? ` scale(${num(s)})` : "") + (o.rot ? ` rotate(${o.rot})` : "");

    let g = `<g transform="${tr}"` +
      (o.onClick ? ` style="cursor:pointer" onclick="${o.onClick}"` : "") + `>`;
    if (o.title) g += `<title>${esc(o.title)}</title>`;
    g += sp.body(c);

    /* ── label / sub placement ──────────────────────────────────────────────
       labelPos 'below' (default) | 'above'. A SOURCE at the top of a drawing
       reads wrong with its text underneath — it collides with the conductor
       going down. Sources default to 'above' in their spec; loads stay 'below'.
       subPos 'below' (default) | 'right' — 'right' is for a symbol whose datum
       belongs at the END OF ITS TAP, like a CT ratio. */
    const lp = o.labelPos || sp.labelPos || "below";
    const spos = o.subPos || sp.subPos || "below";
    const top = -sp.h / 2, bot = sp.h / 2;
    const subRight = spos === "right";
    const subX = sp.subDx != null ? sp.subDx : sp.w / 2 + 4;

    /* data-quality dot — opposite corner to the label, so they never overlap */
    if (o.dq && DQ[o.dq]) {
      g += `<circle cx="${num(-sp.w / 2 - 4)}" cy="${num(lp === "above" ? bot : top)}" r="2.6" ` +
        `fill="${DQ[o.dq]}"><title>${esc(o.dq)}</title></circle>`;
    }
    if (o.label) {
      const y = lp === "above"
        ? top - (o.sub && !subRight ? 14 : 7)
        : bot + 11;
      g += `<text x="0" y="${num(y)}" text-anchor="middle" font-family="${MONO}" ` +
        `font-size="8" font-weight="700" fill="${o.dim ? SOFT : INK}">${esc(clip(o.label, 16))}</text>`;
    }
    if (o.sub) {
      const sx = subRight ? subX : 0;
      const sy = subRight ? 3
        : lp === "above" ? top - 5
        : bot + (o.label ? 20 : 11);
      g += `<text x="${num(sx)}" y="${num(sy)}" text-anchor="${subRight ? "start" : "middle"}" ` +
        `font-family="${MONO}" font-size="6.8" fill="${SOFT}">${esc(clip(o.sub, 22))}</text>`;
    }
    /* measurement badge — always to the right, beside the symbol, so it never
       fights the tag whichever side the tag is on. When the sub already
       occupies the right (a CT ratio on its tap) the badge drops below it. */
    if (o.values && o.values.length)
      g += badge(o.values, subX + 2, subRight ? bot + 6 : top + 2, { anchor: "start", live: o.live });
    g += `</g>`;
    return g;
  }

  /* ports resolved into the PARENT coordinate system, so a router can use them
     without knowing anything about the symbol's internals */
  function ports(kind, o) {
    o = o || {};
    const sp = spec(kind); if (!sp) return {};
    const s = o.scale == null ? 1 : o.scale, X = o.x || 0, Y = o.y || 0;
    const out = {};
    Object.keys(sp.ports).forEach(k => {
      const p = sp.ports[k];
      out[k] = { x: X + p[0] * s, y: Y + p[1] * s, dir: p[2] || "S" };
    });
    return out;
  }

  /* ── measurement badge ────────────────────────────────────────────────────
     values = [{k:"P", v:1807, u:"kW"}, {k:"I", v:1780, u:"A"}, …]
     `live:true` draws the filled marker that means "bound to a live tag";
     design values print plain. This is the ONE place the design-vs-live
     distinction is rendered, so it stays consistent everywhere. */
  function badge(values, x, y, o) {
    o = o || {};
    const v = (values || []).filter(Boolean);
    if (!v.length) return "";
    const anchor = o.anchor || "start";
    const dy = 9;
    let s = `<g>`;
    if (o.live) s += `<circle cx="${num(x - 4)}" cy="${num(y - 3)}" r="2" fill="#1F8A4C"><title>live</title></circle>`;
    v.forEach((m, i) => {
      const label = (m.k ? m.k + " " : "") + fmt(m.v) + (m.u ? " " + m.u : "");
      s += `<text x="${num(x)}" y="${num(y + i * dy)}" text-anchor="${anchor}" font-family="${MONO}" ` +
        `font-size="6.8" fill="${m.alarm ? CRIMSON : SOFT}">${esc(label)}</text>`;
    });
    return s + `</g>`;
  }

  /* ── conductor with direction and an optional load-flow chip ──────────────
     The chip is what makes a meter useful: it prints WHAT IS MEASURED on the
     line it is measured on, exactly the way the process side prints an HMB
     chip on a stream. */
  function flow(x1, y1, x2, y2, o) {
    o = o || {};
    const col = o.color || "#0B5CAD", sw = o.width || 1.6;
    let s = `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke="${col}" ` +
      `stroke-width="${sw}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ""} stroke-linecap="round"/>`;
    if (o.arrow !== false) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const a = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      s += `<path d="M-4,-3 L4,0 L-4,3 Z" fill="${col}" transform="translate(${num(mx)},${num(my)}) rotate(${num(a)})"/>`;
    }
    if (o.chip) {
      /* chipSide: 'left' | 'right' | 'over' (default). On a vertical conductor
         the chip must sit BESIDE the run, or it collides with the symbols. */
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const vertical = Math.abs(x2 - x1) < Math.abs(y2 - y1);
      const side = o.chipSide || (vertical ? "right" : "over");
      const cx = side === "left" ? mx - 6 : side === "right" ? mx + 6 : mx;
      const cy = side === "over" ? my - 6 : my + 2;
      const an = side === "left" ? "end" : side === "right" ? "start" : "middle";
      s += `<text x="${num(cx)}" y="${num(cy)}" text-anchor="${an}" font-family="${MONO}" font-size="6.8" ` +
        `paint-order="stroke" stroke="#fff" stroke-width="3" fill="${col}">${esc(o.chip)}</text>`;
    }
    return s;
  }

  /* ── legend ───────────────────────────────────────────────────────────────
     Generated from the registry, so a symbol added to a pack shows up in every
     legend automatically and no diagram can carry a stale key. */
  function legend(list, o) {
    o = o || {};
    const ks = (list && list.length ? list : kinds()).filter(has);
    const cols = o.cols || 6, cw = o.cellW || 118, ch = o.cellH || 44;
    let s = "";
    ks.forEach((k, i) => {
      const cx = (o.x || 0) + (i % cols) * cw + 22, cy = (o.y || 0) + Math.floor(i / cols) * ch + 16;
      s += draw(k, { x: cx, y: cy, scale: o.scale || 0.62 });
      s += `<text x="${num(cx + 16)}" y="${num(cy + 3)}" font-family="${MONO}" font-size="7" fill="${SOFT}">` +
        esc(clip(spec(k).name || k, 16)) + `</text>`;
    });
    return s;
  }

  /* fallback so an unmapped symbol_kind draws a visible placeholder rather
     than nothing — a silent gap is the failure mode we refuse */
  def("UNKNOWN", {
    name: "Unmapped", w: 20, h: 20,
    ports: { A: [0, -10, "N"], B: [0, 10, "S"] },
    body: c => c.rect(-10, -10, 20, 20, "#fff", "3 2", 2) + c.txt(0, 4, "?", 11, 700)
  });

  const API = { def, has, kinds, spec, draw, ports, badge, flow, legend,
                STATE, DQ, esc, fmt, MONO, INK, SOFT, LINE, CRIMSON, version: "0.1.0" };
  const root = (typeof window !== "undefined") ? window : globalThis;
  root.TamSym = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
