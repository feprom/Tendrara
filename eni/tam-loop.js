/* ═══════════════════════════════════════════════════════════════════════════
   tam-loop.js — simple control-loop schematics, drawn from the database
                 v0.1.0
   ─────────────────────────────────────────────────────────────────────────
   WHAT THIS IS FOR
     plant_control_loops holds seven rows for Unit 200 and the Module 101 deck
     prints them as a TABLE. A table tells a trainee that FIC-2001 drives
     FV-2001. It does not tell him the shape of the thing: that the measurement
     goes UP from the pipe into a transmitter, ACROSS into a controller that
     lives in the PCS and not on a wall, and back DOWN onto a valve sitting in
     the same pipe it just measured. That closed shape IS the lesson. Four rows
     of a table are four facts; one loop drawing is one idea.

   THE FIVE PARTS, ALWAYS IN THE SAME PLACES
     Every loop on this sheet is drawn with the same geometry, so a trainee who
     learns to read one has learned to read all seven:

         ( controller )                     ← top: lives in the PCS
          ↑          ↓                        left in, right out
       (transmitter) ↓                      ← middle left
          ↑          ↓
       ══[element]═══[valve]══════          ← bottom: the process line itself

     Measurement always rises on the LEFT. The correction always falls on the
     RIGHT. Nothing crosses anything. The moment a loop is drawn with the
     controller under the pipe the output signal has to cut through the valve
     body to reach the actuator, and that is where these drawings usually go
     wrong — so the geometry here makes it impossible.

   EVERYTHING ON THE PAGE COMES FROM A COLUMN
     No shape and no number is chosen by hand:
       loop_tag                 → the controller bubble
       final_control_element    → the valve, and tam-sym-proc picks its actuator
       operating_range / unit   → the range printed under the controller
       set_point                → the SP chip, or an HONEST GAP if it is NULL
       plant_instruments.system → whether a bubble is a circle or a diamond
       instrument_type          → orifice vs thermowell vs magmeter vs nozzle
     A loop whose transmitter is not in plant_instruments draws the bubble with
     a dashed outline and a "?" — rule G-4, a gap must be visible. It is never
     silently drawn as though the row existed.

   THE SET POINT IS DELIBERATELY UGLY WHEN IT IS MISSING
     All seven Unit 200 loops have set_point NULL today; the numbers the deck
     shows (16.0 MMSCFD, 45.0 barg, 43 °C) live only in the HTML. So the chip
     prints "SP —" in amber. That is not a defect in this file: it is the
     drawing refusing to invent a number, and it will turn black by itself the
     day the column is filled. Same rule as the electrical badge (G-3).

   API
     TamLoop.card(loop, opts)   → {svg, w, h} one loop
     TamLoop.sheet(loops, opts) → a full <svg> document, loops tiled in a grid
     TamLoop.build(row, insts)  → plant_control_loops row + instrument rows
                                  → the loop descriptor card() wants

   Depends on tam-sym.js + tam-sym-inst.js + tam-sym-proc.js.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const root = (typeof window !== "undefined") ? window : globalThis;
  const T = root.TamSym, I = root.TamSymInst, P = root.TamSymProc;
  if (!T) throw new Error("tam-loop: load tam-sym.js first");
  if (!I) throw new Error("tam-loop: load tam-sym-inst.js first");
  if (!P) throw new Error("tam-loop: load tam-sym-proc.js first");

  const MONO = T.MONO, INK = T.INK, SOFT = T.SOFT;
  const AMBER = "#B26A00";
  const esc = T.esc;

  /* ── card geometry — one table, so every loop lines up across the sheet ──
     Change a number here and all seven loops move together. That is the point:
     a sheet where each drawing has its own proportions is a sheet nobody can
     scan. */
  const G = {
    w: 470, h: 246,
    padX: 26,
    titleY: 20, subY: 34,
    ctrlX: 236, ctrlY: 76,          // controller bubble centre
    txX: 122, txY: 132,             // transmitter bubble centre
    pipeY: 196,                     // the process line
    elemX: 122, valveX: 348,        // element and final element, on the pipe
    footY: 232
  };

  /* which primary-element symbol a transmitter implies. The database says the
     TYPE and the type says the shape: an orifice has taps, a magmeter does not,
     a thermowell is a pocket, a DP level transmitter hangs off a nozzle. Guess
     wrong and you teach a trainee to look for hardware that is not installed. */
  function elementKind(elemType, txType, letter) {
    const s = String(elemType || txType || "").toUpperCase();
    if (/ELECTROMAGNETIC|MAGNETIC/.test(s)) return "MAG_FLOWMETER";
    if (/ORIFICE|FLOW SENSOR|FLOW ELEMENT/.test(s)) return "ORIFICE_PLATE";
    if (/THERMO|TEMPERATURE/.test(s)) return "THERMOWELL";
    if (/LEVEL/.test(s)) return "LEVEL_GAUGE";
    if (letter === "F") return "ORIFICE_PLATE";
    if (letter === "T") return "THERMOWELL";
    if (letter === "L") return "LEVEL_GAUGE";
    return null;                    // P and others tap straight off the line
  }

  /* ── build: database rows → the descriptor card() draws ─────────────────
     `insts` is any array of plant_instruments rows; this picks out the ones
     that belong to the loop by number, which is what a loop number is FOR. */
  function build(loop, insts, valves) {
    loop = loop || {}; insts = insts || []; valves = valves || [];
    const tag = loop.loop_tag || "";
    const p = I.parse(tag);
    const num = p.number, letter = (p.letters || "")[0] || "";

    const byTag = t => insts.find(r => String(r.tag || "").toUpperCase() === String(t).toUpperCase());
    /* the transmitter of a loop is <letter>T-<number>; the element <letter>E-. */
    const tx = byTag(letter + "T-" + num);
    const el = byTag(letter + "E-" + num);

    const fce = loop.final_control_element || "";
    const fceRow = valves.find(r => String(r.tag || "").toUpperCase() === fce.toUpperCase());

    return {
      tag,
      title: loop.controlled_variable || "",
      controller: { tag, system: "PCS" },   // a controller lives in the PCS by definition
      transmitter: tx
        ? { tag: tx.tag, system: tx.system, range: tx.range, units: tx.units,
            service: tx.service, type: tx.instrument_type, missing: false }
        : { tag: letter + "T-" + num, missing: true },
      element: el
        ? { tag: el.tag, type: el.instrument_type, line: el.line_number, missing: false }
        : { tag: letter + "E-" + num, missing: true },
      elementKind: elementKind(el && el.instrument_type, tx && tx.instrument_type, letter),
      valve: { tag: fce, type: fceRow && fceRow.instrument_type,
               line: fceRow && fceRow.line_number, missing: !fceRow },
      range: loop.operating_range, unit: loop.unit,
      setPoint: loop.set_point,
      note: loop.comments || "",
      /* the line the loop actually works on — the transmitter's line if it has
         one, otherwise the final element's. Printed on the pipe. */
      line: (tx && tx.line_number) || (el && el.line_number) || (fceRow && fceRow.line_number) || null
    };
  }

  /* a bubble whose database row does not exist: dashed, and it says so */
  function ghostBubble(x, y, tag) {
    const R = I.R;
    return `<g transform="translate(${x},${y})">` +
      `<circle cx="0" cy="0" r="${R}" fill="#fff" stroke="${AMBER}" stroke-width="1.3" stroke-dasharray="3 2"/>` +
      `<text x="0" y="-1.2" text-anchor="middle" font-family="${MONO}" font-size="7.6" font-weight="700" fill="${AMBER}">` +
      esc(I.parse(tag).letters) + `</text>` +
      `<text x="0" y="8.2" text-anchor="middle" font-family="${MONO}" font-size="7.6" fill="${AMBER}">` +
      esc(I.parse(tag).number) + `</text>` +
      `<text x="${R + 3}" y="${-R + 2}" font-family="${MONO}" font-size="9" font-weight="700" fill="${AMBER}">?</text>` +
      `<title>${esc(tag)} — no row in plant_instruments</title></g>`;
  }

  function txt(x, y, s, size, weight, fill, anchor) {
    return `<text x="${x}" y="${y}" text-anchor="${anchor || "start"}" font-family="${MONO}" ` +
      `font-size="${size}"${weight ? ` font-weight="${weight}"` : ""} fill="${fill || INK}">${esc(s)}</text>`;
  }

  /* ── card ─────────────────────────────────────────────────────────────── */
  function card(L, o) {
    o = o || {};
    const x0 = o.x || 0, y0 = o.y || 0;
    let s = `<g transform="translate(${x0},${y0})">`;

    /* frame */
    s += `<rect x="0.5" y="0.5" width="${G.w - 1}" height="${G.h - 1}" rx="6" fill="#fff" stroke="#E3E7EB"/>`;

    /* header — tag, then what it controls, then where it lives */
    s += txt(G.padX, G.titleY, L.tag, 12.5, 700);
    s += txt(G.padX, G.subY, String(L.title || "").toUpperCase(), 7.6, 600, SOFT);
    s += `<rect x="${G.w - 66}" y="${G.titleY - 11}" width="40" height="15" rx="7.5" fill="#EEF3F8" stroke="#C9D6E4"/>`;
    s += txt(G.w - 46, G.titleY, "PCS", 7.6, 700, "#0B5CAD", "middle");

    /* ── the process line ────────────────────────────────────────────────
       Drawn as segments that BREAK at the element and at the valve, because a
       valve is inserted IN a line — it is not laid on top of one. Same rule
       tam-sym-proc.js states and the reason every valve exposes W/E ports. */
    const PIPE = "#C08A2E", PW = 3.2;
    const seg = (a, b) => `<line x1="${a}" y1="${G.pipeY}" x2="${b}" y2="${G.pipeY}" ` +
      `stroke="${PIPE}" stroke-width="${PW}" stroke-linecap="butt"/>`;
    const eHalf = L.elementKind ? 9 : 0;
    s += seg(G.padX, G.elemX - eHalf);
    s += seg(G.elemX + eHalf, G.valveX - 9);
    s += seg(G.valveX + 9, G.w - G.padX - 8);
    s += `<path d="M-6,-4 L4,0 L-6,4 Z" fill="${PIPE}" transform="translate(${G.w - G.padX - 6},${G.pipeY})"/>`;

    /* the line number, on the line, where a P&ID puts it */
    if (L.line)
      s += txt(G.padX + 2, G.pipeY + 16, L.line, 6.8, 600, SOFT);

    /* primary element */
    if (L.elementKind && L.elementKind !== "LEVEL_GAUGE")
      s += T.draw(L.elementKind, { x: G.elemX, y: G.pipeY, strokeWidth: 1.3,
        title: (L.element.tag || "") + " · " + T.spec(L.elementKind).name });
    else if (L.elementKind === "LEVEL_GAUGE")
      /* a level element is on the VESSEL, not in the line: draw the nozzle stub
         so nobody reads it as an in-line device */
      s += `<line x1="${G.elemX}" y1="${G.pipeY - 8}" x2="${G.elemX}" y2="${G.pipeY}" stroke="${SOFT}" stroke-width="1.3"/>` +
        `<circle cx="${G.elemX}" cy="${G.pipeY - 10}" r="2.4" fill="#fff" stroke="${SOFT}" stroke-width="1.3"/>`;
    else
      /* no element at all — a pressure loop taps straight off the line. Draw the
         TAP, because an impulse line that just lands on a pipe with no fitting
         reads as a drawing error rather than as "there is nothing here". */
      s += `<line x1="${G.elemX - 4}" y1="${G.pipeY - 7}" x2="${G.elemX + 4}" y2="${G.pipeY - 7}" stroke="${SOFT}" stroke-width="1.3" stroke-linecap="round"/>`;

    if (L.element && !L.element.missing && L.elementKind)
      s += txt(G.elemX, G.pipeY + 26, L.element.tag, 6.8, 700, SOFT, "middle");

    /* final control element — tam-sym-proc picks the actuator from the tag,
       so an SDV draws a solenoid and an FV draws a diaphragm without this file
       knowing the difference */
    if (L.valve.tag) {
      const v = P.fromTag(L.valve.tag, { label: false, strokeWidth: 1.35 });
      s += T.draw(v.kind, Object.assign({}, v.opts, { x: G.valveX, y: G.pipeY }));
      s += txt(G.valveX, G.pipeY + 26, L.valve.tag, 7.6, 700,
        L.valve.missing ? AMBER : INK, "middle");
      if (L.valve.missing)
        s += txt(G.valveX + 30, G.pipeY + 26, "?", 9, 700, AMBER);
    }

    /* ── the bubbles ──────────────────────────────────────────────────── */
    /* transmitter — field mounted: a circle, no line. It is out in the plant. */
    if (L.transmitter.missing) {
      s += ghostBubble(G.txX, G.txY, L.transmitter.tag);
    } else {
      const b = I.fromRow(L.transmitter, { sub: null });
      s += T.draw(b.kind, Object.assign({}, b.opts, { x: G.txX, y: G.txY }));
      /* the range goes BESIDE the bubble, not under it: under it lands on the
         impulse line and a number crossed by a line is a number nobody reads. */
      if (L.transmitter.range)
        s += txt(G.txX + I.R + 6, G.txY + 4, L.transmitter.range +
          (L.transmitter.units ? " " + L.transmitter.units : ""), 6.6, 600, SOFT, "start");
    }

    /* controller — square: it is a block in the PCS, not a box on a wall */
    const cb = I.fromRow(L.controller, { sub: null });
    s += T.draw(cb.kind, Object.assign({}, cb.opts, { x: G.ctrlX, y: G.ctrlY }));

    /* range and set point, under the controller */
    const rng = L.range ? L.range + (L.unit ? " " + L.unit : "") : "—";
    s += txt(G.ctrlX, G.ctrlY + 26, "range " + rng, 6.8, 600, SOFT, "middle");
    const spOk = L.setPoint != null && L.setPoint !== "";
    s += txt(G.ctrlX, G.ctrlY + 36, "SP " + (spOk ? L.setPoint + (L.unit ? " " + L.unit : "") : "—"),
      7.2, 700, spOk ? INK : AMBER, "middle");

    /* ── the signals ──────────────────────────────────────────────────────
       Three runs, three different media, and the difference is the teaching:
         element → transmitter    process/impulse, a plain solid line
         transmitter → controller ELECTRIC, dashed: this is the 4-20 mA cable
         controller → valve       ELECTRIC, dashed: and it stops at the actuator
       When signal_output says something other than 4-20 mA the medium follows
       the data instead of the default. */
    const R = I.R;
    const sigType = /PNEU|PSI|BAR/i.test(String(L.transmitter.signal_output || "")) ? "pneumatic" : "electric";

    /* element up into the transmitter — impulse/process, no arrowhead: it is a
       physical connection, not a signal going somewhere */
    const elemTop = L.elementKind === "ORIFICE_PLATE" ? G.pipeY - 16
      : L.elementKind === "THERMOWELL" ? G.pipeY - 14
      : L.elementKind === "LEVEL_GAUGE" ? G.pipeY - 13 : G.pipeY - 8;
    s += I.signal(G.elemX, elemTop, G.txX, G.txY + R, { type: "process", arrow: false, color: SOFT });

    /* transmitter up and across into the controller */
    s += I.signal(G.txX, G.txY - R, G.ctrlX - R - 1, G.ctrlY, { type: sigType, route: "vh", color: SOFT });

    /* controller across and down onto the valve actuator */
    s += I.signal(G.ctrlX + R + 1, G.ctrlY, G.valveX, G.pipeY - 20,
      { type: sigType, route: "hv", color: SOFT });

    /* ── footer: the one sentence the database already wrote ───────────── */
    if (L.note)
      s += txt(G.padX, G.footY, clip(L.note, 74), 6.6, 400, SOFT);

    s += `</g>`;
    return { svg: s, w: G.w, h: G.h };
  }

  const clip = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  /* ── sheet: the loops of one area, tiled ────────────────────────────── */
  function sheet(loops, o) {
    o = o || {};
    const cols = o.cols || 2, gap = o.gap || 16, pad = o.pad || 22;
    const head = o.title ? 54 : 0;
    /* the legend needs a band of its own. v0.1.0 laid it inside the bottom pad
       and it sat on top of the last card's footnote — a legend that overlaps
       the drawing is worse than no legend, so it gets its own reserved height. */
    const foot = o.legend === false ? 0 : 52;
    const rows = Math.ceil(loops.length / cols);
    const W = pad * 2 + cols * G.w + (cols - 1) * gap;
    const H = pad * 2 + head + rows * G.h + (rows - 1) * gap + foot;

    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ` +
      `font-family="${MONO}"><rect width="${W}" height="${H}" fill="#FAFBFC"/>`;
    if (o.title) {
      s += txt(pad, pad + 16, o.title, 15, 700);
      if (o.subtitle) s += txt(pad, pad + 32, o.subtitle, 8, 600, SOFT);
      s += `<line x1="${pad}" y1="${pad + 42}" x2="${W - pad}" y2="${pad + 42}" stroke="#E3E7EB"/>`;
    }
    loops.forEach((L, i) => {
      const cx = pad + (i % cols) * (G.w + gap);
      const cy = pad + head + Math.floor(i / cols) * (G.h + gap);
      s += card(L, { x: cx, y: cy }).svg;
    });

    /* legend — generated from the registry, so it can never go stale (G-7) */
    if (o.legend !== false) {
      const ly = H - pad - foot + 14;
      s += `<line x1="${pad}" y1="${ly - 12}" x2="${W - pad}" y2="${ly - 12}" stroke="#E3E7EB"/>`;
      s += T.legend(
        ["INST_FIELD", "INST_SHARED", "INST_LOGIC", "CONTROL_VALVE", "SHUTDOWN_VALVE", "ORIFICE_PLATE"],
        { x: pad, y: ly, cols: 6, cellW: 168, scale: 0.62 });
      s += txt(pad, ly + 40,
        "signal media — solid: process/impulse · dashed: electric 4-20 mA · dashed+circles: PCS internal link · " +
        "amber: the database has no row for it", 6.8, 600, SOFT);
    }
    return s + `</svg>`;
  }

  const API = { card, sheet, build, G, version: "0.1.0" };
  root.TamLoop = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
