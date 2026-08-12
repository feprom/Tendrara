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
    DESIGN:       INK,        // no live value bound — the default
    /* v0.2.5 — the three states a MACHINE has once a measurement is bound to
       it. They are not the same question as CLOSED/OPEN (that is switchgear):
       a generator can be stopped with its breaker closed. RUNNING is drawn in
       the entity's own series colour when the caller has one (the palette is
       per-machine, so the kernel cannot own it) and falls back to this green.
       NO_MEASURE is deliberately NOT a shade of "off": absence of measurement
       is its own state, the pixel equivalent of powermanager's white "no
       information about messages" band, and it must never read as zero. */
    RUNNING:      "#1F8A4C",
    STOPPED:      "#8A9099",
    /* lighter than STOPPED but darker than LINE: it has to read as a drawn
       mark at 1×, not as a rule the eye skips */
    NO_MEASURE:   "#A7ADB5"
  };
  const DQ = { VERIFIED: "#1F8A4C", NEEDS_REVIEW: "#B26A00", CONFLICT: CRIMSON, REJECTED: SOFT };

  /* ── helpers ──────────────────────────────────────────────────────────── */
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const num = v => (Math.round(v * 1000) / 1000);
  const clip = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  /* greedy word wrap into at most `max` lines; the last line still clips, so a
     runaway string cannot silently grow the drawing */
  const wrap = (s, n, max) => {
    const words = String(s == null ? "" : s).split(/\s+/).filter(Boolean), out = [];
    let cur = "";
    words.forEach(w => {
      if (!cur) cur = w;
      else if (cur.length + 1 + w.length <= n) cur += " " + w;
      else { out.push(cur); cur = w; }
    });
    if (cur) out.push(cur);
    return out.length > max ? out.slice(0, max - 1).concat(clip(out.slice(max - 1).join(" "), n)) : out;
  };

  /* ── v0.2.5 · one number format per drawing ───────────────────────────────
     A sheet that lives inside a Spanish page was printing `1,822` next to the
     page's own `1.822` (ELEC_FUNCTIONAL §2d l3): two formatters, one number.
     The rule now has ONE knob, and the page sets the kernel to whatever it
     uses itself, so the two can be pinned by a test instead of by eye:
        TamSym.locale = "es-MA"; TamSym.grouping = "always";
     Defaults are the old behaviour exactly ("en-US" / "auto"), so every
     existing caller stays byte-identical. `grouping:"always"` is what makes
     Spanish print 1.823 rather than 1823 — Spanish suppresses the separator
     on four digits and an engineering sheet should not change punctuation at
     the 10.000 kW mark. */
  let numLocale = "en-US", numGrouping = "auto";
  const fmt = v => v == null ? "—"
    : Math.abs(+v) >= 100
      ? Math.round(+v).toLocaleString(numLocale, { useGrouping: numGrouping })
      : (+v).toLocaleString(numLocale, { maximumFractionDigits: 2, useGrouping: numGrouping });

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
  /* ── v0.2.0 · textScale ────────────────────────────────────────────────
     The kernel prints a symbol's tag and its sub-datum (a CT ratio, a rating).
     Those sizes were fixed at 8 and 6.8 px, so a renderer that scaled its own
     labels up left the pack's labels behind and the drawing lost one type
     scale. One knob, default 1 — every existing caller is byte-identical.
       TamSym.textScale = 1.3
     Belongs in the KERNEL, not in a pack or a renderer: it is type, and type
     is a property of the drawing system (db-graphics §1).                   */
  let textScale = 1;
  const tz = n => Math.max(8, +(n * textScale).toFixed(1));

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
        ? top - (o.sub && !subRight ? tz(8) + 6 : tz(8) - 1)
        : bot + tz(8) + 3;
      g += `<text x="0" y="${num(y)}" text-anchor="middle" font-family="${MONO}" ` +
        `font-size="${tz(8)}" font-weight="700" fill="${o.dim ? SOFT : INK}">${esc(clip(o.label, 16))}</text>`;
    }
    if (o.sub) {
      const sx = subRight ? subX : 0;
      const sy = subRight ? 3
        : lp === "above" ? top - 5
        : bot + (o.label ? 20 : 11);
      /* v0.2.5 — `subWrap` sets a line budget in characters and the sub folds
         onto up to three lines instead of being cut. An approval sheet that
         prints "400 V system (not sup…" is a sheet whose reader cannot tell
         whether the missing words matter (ELEC_FUNCTIONAL §2d i6): a label
         that ends in an ellipsis has stopped being a label. Default 0 keeps
         the old single clipped line for every existing caller. */
      const lines = o.subWrap > 0 ? wrap(o.sub, o.subWrap, 3) : [clip(o.sub, 22)];
      lines.forEach((t, i) => {
        g += `<text x="${num(sx)}" y="${num(sy + i * (tz(6.8) + 1.6))}" text-anchor="${subRight ? "start" : "middle"}" ` +
          `font-family="${MONO}" font-size="${tz(6.8)}" font-weight="600" fill="${SOFT}">${esc(t)}</text>`;
      });
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
    /* v0.2.1 — the line pitch has to follow the type, not sit at a constant.
       v0.2.0 gave the badge a SCALED font (tz) and left dy at 9, so above
       textScale ≈ 1.3 the two lines of a generator's rating printed on top of
       each other. Found by the layout sweep at 1.5, not by eye at 1.3. */
    const dy = Math.max(9, tz(6.8) + 2.4);
    let s = `<g>`;
    if (o.live) s += `<circle cx="${num(x - 4)}" cy="${num(y - 3)}" r="2" fill="#1F8A4C"><title>live</title></circle>`;
    /* ── v0.2.5 · the badge has a TYPE SCALE ────────────────────────────────
       Five numbers around a 24 px symbol, all at 6.8 px and all the same
       grey, is a badge with no answer in it (ELEC_FUNCTIONAL §2d l1). Three
       optional per-value knobs give the caller a hierarchy without a second
       badge implementation, and every default is the old value, so a caller
       that passes none renders byte-identical:
         m.size    font size in symbol units (default 6.8)
         m.weight  font weight (default 600)
         m.color   fill (default SOFT; m.alarm still wins with CRIMSON)
         m.rule    hairline separator drawn ABOVE this line — the filete that
                   splits "what it is doing now" from "what it has produced"
         m.gap     extra leading before this line
         m.t       ready-made text, used INSTEAD of k/v/u (for a value the
                   caller has already composed, e.g. "24,0 h · 0 arr.")
         m.parts   [{t, slot, size, weight, color, sep}] — one line, several
                   addressable pieces. Two quantities that are read together
                   (PF and f) belong on one line; two data-slots still have to
                   come out of it, so they are tspans, not two <text>. */
    let cy = y, prevSize = null;
    v.forEach(m => {
      const size = tz(m.size == null ? 6.8 : m.size);
      const weight = m.weight == null ? 600 : m.weight;
      const fill = m.alarm ? CRIMSON : (m.color || SOFT);
      if (prevSize != null) cy += Math.max(9, prevSize + 2.4) + (m.gap || 0);
      if (m.rule) {
        cy += 4;
        s += `<line x1="${num(x)}" y1="${num(cy - size - 1)}" x2="${num(x + (o.ruleW || 84))}" ` +
          `y2="${num(cy - size - 1)}" stroke="${LINE}" stroke-width="0.8"/>`;
      }
      /* v0.2.4 — every value names its slot in the DOM (`data-slot`), so a
         page can address "the P of GE-002" with one querySelector instead of
         parsing text. The slot is the quantity symbol unless the caller
         passes m.slot. This is the smart-SVG contract of ELEC_FUNCTIONAL §2b. */
      const slot = m.slot || m.k;
      let inner;
      if (m.parts && m.parts.length) {
        inner = m.parts.map((p, j) =>
          /* p.dx, not spaces: SVG collapses whitespace between tspans, which
             is how "P 752 kW" and "41 %" ended up glued together */
          `<tspan${p.slot ? ` data-slot="${esc(p.slot)}"` : ""}` +
          (p.dx ? ` dx="${num(p.dx)}"` : "") +
          (p.size ? ` font-size="${tz(p.size)}"` : "") +
          (p.weight ? ` font-weight="${p.weight}"` : "") +
          (p.color ? ` fill="${p.color}"` : "") +
          `>${esc((j ? (p.sep == null ? " · " : p.sep) : (p.sep || "")) + p.t)}</tspan>`).join("");
      } else {
        inner = esc(m.t != null ? m.t
          : (m.k ? m.k + " " : "") + fmt(m.v) + (m.u ? " " + m.u : ""));
      }
      s += `<text x="${num(x)}" y="${num(cy)}" text-anchor="${anchor}" font-family="${MONO}" ` +
        `font-size="${size}" font-weight="${weight}" fill="${fill}"` +
        (slot ? ` data-slot="${esc(slot)}"` : "") + `>${inner}</text>`;
      prevSize = size;
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
      s += `<text x="${num(cx)}" y="${num(cy)}" text-anchor="${an}" font-family="${MONO}" font-size="${tz(6.8)}" font-weight="600" ` +
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
    const sc = o.scale || 0.62;
    ks.forEach((k, i) => {
      const cx = (o.x || 0) + (i % cols) * cw + 22, cy = (o.y || 0) + Math.floor(i / cols) * ch + 16;
      s += draw(k, { x: cx, y: cy, scale: sc });
      /* v0.2.5 — the label clears the symbol it names. A fixed +16 put the
         word "Busbar" underneath the busbar, because a 100-unit-wide symbol
         is 55 px at legend scale and the key became unreadable exactly for
         the widest shapes. The offset is now the symbol's own half-width. */
      const dx = Math.max(16, (spec(k).w || 24) * sc / 2 + 5);
      s += `<text x="${num(cx + dx)}" y="${num(cy + 3)}" font-family="${MONO}" font-size="7" fill="${SOFT}">` +
        esc(clip(spec(k).name || k, o.nameMax || 16)) + `</text>`;
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
                get textScale() { return textScale; },
                set textScale(v) { textScale = (+v > 0 ? +v : 1); },
                /* number format — see fmt() above. A renderer that needs a
                   locale sets it around its own draw and restores it, so one
                   sheet's typography never leaks into the next one. */
                get locale() { return numLocale; },
                set locale(v) { numLocale = v || "en-US"; },
                get grouping() { return numGrouping; },
                set grouping(v) { numGrouping = v || "auto"; },
                STATE, DQ, esc, fmt, wrap, MONO, INK, SOFT, LINE, CRIMSON, version: "0.2.5" };
  const root = (typeof window !== "undefined") ? window : globalThis;
  root.TamSym = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
