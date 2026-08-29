/* ═══════════════════════════════════════════════════════════════════════════
   tam-sym-inst.js — INSTRUMENT symbol pack  ·  v0.1.3
   ─────────────────────────────────────────────────────────────────────────
   The pack GRAPHICS_LIBRARY_PLAN.md §4 reserved for "the ISA bubbles", written
   now because the control-loop schematics need it and nothing else can draw a
   controller: tam-sym-proc.js knows valves, tam-sym-elec.js knows switchgear,
   and neither knows what a bubble means.

   WHAT A BUBBLE ACTUALLY SAYS — and why the shape is not decoration
     A P&ID bubble carries TWO independent facts and a trainee has to read both:

       WHAT it is        → the letters inside      FIC = flow indicating ctrl
       WHERE it lives    → the OUTLINE and the line through it

     The outline is the part people skip, and it is the part that decides
     whether an operator can touch the thing during a shift:

       circle, no line          field mounted — you walk to it, in the plant
       circle, solid line       panel front, control room — operator accessible
       circle, dashed line      behind the panel — auxiliary, not normally seen
       circle in a SQUARE       shared display / shared control — it lives in
                                the PCS; there is no physical box to point at
       circle in a DIAMOND      safety logic (ESD) — a different system, on
                                purpose, and the diamond is what says so
       hexagon                  computer / advanced function

     On the Tendrara plant this maps straight onto the database: an instrument
     with system='PCS' is a square (shared control), system='ESD' is a diamond
     (safety logic), and a gauge or sight glass with no system at all is a bare
     field circle. So the outline is DATA, not a drawing preference — see
     TamSymInst.fromRow().

     v0.1.3 — TWO consequences of "the outline is data" that the pack now
     enforces instead of assuming:
       · MOUNTING IS NOT IN THE DATABASE. plant_instruments has no mounting
         column, so field / panel-front / behind-panel cannot be told apart from
         a row. INST_PANEL and INST_AUX are therefore DEFINED BUT UNREACHABLE
         from fromRow() — drawing them would be inventing (G-3). They wait for a
         migration, not for a drafter's judgement.
       · A `system` OUTSIDE PCS/ESD DRAWS A GAP. The plant carries 'PCS/ESD' (6),
         'MCC' (4) and 'BOILER PANEL' (1). Rounding those to the nearest outline
         claims something the row does not say, so bubbleKind() returns UNKNOWN
         and the dashed `?` shows up where a reviewer will see it (G-4).
     Norm: skills/db-graphics/NORMA_COLOR_SIMBOLO.md §4.

   SIGNAL LINES ARE NOT ALL THE SAME LINE
     ISA 5.1 gives every signal medium its own line, and mixing them is how a
     drawing stops teaching. This pack draws five:

       process / impulse   plain solid       the tap to the sensor
       electric            dashed            4-20 mA, the plant's normal case
       pneumatic           solid + hash      instrument air to a positioner
       software / link     dashed + bubbles  inside the PCS, no cable exists
       capillary           solid + arcs      filled system to a diaphragm seal

     The software link matters more than it looks: between a transmitter and its
     controller in a DCS there IS no wire — the wire stops at the I/O card. Draw
     it as a wire and you teach a trainee to look for a cable that is not there.

   ISO / ISA NOTE — same rule as the other two packs
     ISA 5.1 and ISO 14617-6 are licensed standards and are NOT redistributed.
     Every shape here is drawn from primitives against the published shape
     descriptions, the way any CAD template is built. Nothing is copied.

   API
     TamSymInst.fromRow(row)        plant_instruments row → {kind, opts}
     TamSymInst.bubbleKind(system, tag, opts) → symbol kind, or UNKNOWN (a gap)
     TamSymInst.signal(x1,y1,x2,y2,{type})    → SVG for a signal run.
       ALWAYS pass `type`: it defaults to 'electric', and defaulting the medium
       of a signal is inventing a fact. See the norm §4.1 for which is which.
     TamSymInst.parse(tag)          "FIC-2001" → {letters:"FIC", number:"2001"}

   Depends on tam-sym.js only. Zero other dependencies, offline-first.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const T = (typeof window !== "undefined" ? window : globalThis).TamSym;
  if (!T) throw new Error("tam-sym-inst: load tam-sym.js first");

  const WHITE = "#fff";
  const R = 11;            // bubble radius — one number, so every bubble matches
  const SQ = 2 * R;        // the square that circumscribes it
  const ESD_INK = "#8A6D00";

  /* Ports on all four sides: a bubble is a junction, and a loop schematic
     approaches it from whichever side the layout needs. */
  const PORTS = { N: [0, -R, "N"], S: [0, R, "S"], W: [-R, 0, "W"], E: [R, 0, "E"] };
  const PORTS_SQ = { N: [0, -R, "N"], S: [0, R, "S"], W: [-R, 0, "W"], E: [R, 0, "E"] };

  /* ── the tag, printed INSIDE the bubble ───────────────────────────────────
     ISA splits it: function letters on top, loop number below, on two lines.
     That split is why a bubble is round — the two lines want a circle. Passing
     the tag as opts.tag (not opts.label) is what puts it inside instead of
     underneath; opts.label still works and prints below, for a caption. */
  function parse(tag) {
    const t = String(tag || "").trim().toUpperCase();
    const m = t.match(/^([A-Z]+)[\s-]*([0-9][0-9A-Z/-]*)$/);
    return m ? { letters: m[1], number: m[2] } : { letters: t, number: "" };
  }
  const inner = c => {
    const p = parse(c.o.tag || "");
    if (!p.letters) return "";
    const two = !!p.number;
    /* v0.1.1 — the two lines were centred on the circle's centre, which pushes
       the number's baseline onto the outline: at r=11 a 7.6 px digit row sits
       1 px inside the arc and reads as touching it. The pair is now centred as
       a BLOCK (cap height + leading), so both lines clear the arc at any size. */
    /* v0.1.2 — the number line is set by HOW MANY DIGITS it has. A circle is
       narrowest where the second line sits, so a 4-digit loop number at the
       same size as a 3-letter function code overruns the arc: "2001" measured
       8.8 half-widths against 8.66 of available circle. Rather than move the
       text off centre — which breaks the ISA reading — the digits step down
       one size when there are four or more of them. */
    const nsz = p.number.length >= 4 ? 6.6 : 7.4;
    return c.txt(0, two ? -2.2 : 3, p.letters, two ? 7.4 : 8.4, 700, "middle") +
      (two ? c.txt(0, 6.4, p.number, nsz, 400, "middle") : "");
  };

  /* ── 1 · the bubble family ────────────────────────────────────────────── */

  /* FIELD — a circle and nothing else. The absence of a line is the statement:
     no operator interface, you go and look at it. */
  T.def("INST_FIELD", {
    name: "Field instrument", std: "ISA 5.1", w: SQ, h: SQ, ports: PORTS,
    body: c => c.cir(0, 0, R, WHITE) + inner(c)
  });

  /* PANEL FRONT — solid line = normally accessible to the operator. */
  T.def("INST_PANEL", {
    name: "Panel front", std: "ISA 5.1", w: SQ, h: SQ, ports: PORTS,
    body: c => c.cir(0, 0, R, WHITE) + c.ln(-R, 0, R, 0) + inner(c)
  });

  /* AUXILIARY — dashed line = behind the panel; it exists, you do not see it. */
  T.def("INST_AUX", {
    name: "Auxiliary location", std: "ISA 5.1", w: SQ, h: SQ, ports: PORTS,
    body: c => c.cir(0, 0, R, WHITE) + c.ln(-R, 0, R, 0, "2.5 2") + inner(c)
  });

  /* SHARED DISPLAY / SHARED CONTROL — the PCS. Square around the circle.
     This is the one that stops a trainee hunting for a physical controller:
     FIC-2001 is a block of code and an operator faceplate, not a box on a wall. */
  T.def("INST_SHARED", {
    name: "Shared ctrl PCS", std: "ISA 5.1", w: SQ, h: SQ, ports: PORTS_SQ,
    body: c => c.rect(-R, -R, SQ, SQ, WHITE) + c.cir(0, 0, R - 0.4, "none") +
      c.ln(-R, 0, R, 0) + inner(c)
  });

  /* SHARED, FIELD-MOUNTED — square + circle, no line: a smart field device or
     a local panel that the PCS reads but the operator does not stand in front of. */
  T.def("INST_SHARED_FIELD", {
    name: "Shared, field", std: "ISA 5.1", w: SQ, h: SQ, ports: PORTS_SQ,
    body: c => c.rect(-R, -R, SQ, SQ, WHITE) + c.cir(0, 0, R - 0.4, "none") + inner(c)
  });

  /* SAFETY LOGIC — the diamond. A DIFFERENT SYSTEM, and the whole point of the
     shape is that you can see at a glance which trips are ESD and which are
     control. On this plant that is system='ESD' in plant_instruments. */
  T.def("INST_LOGIC", {
    name: "Safety logic ESD", std: "ISA 5.1", w: SQ + 6, h: SQ + 6, ports: PORTS_SQ,
    body: c => c.path(`M 0,${-R - 3} L ${R + 3},0 L 0,${R + 3} L ${-R - 3},0 Z`, WHITE) +
      c.cir(0, 0, R - 0.6, "none") + inner(c)
  });

  /* COMPUTER FUNCTION — hexagon. Kept because the legend needs the full set;
     nothing on Unit 200 uses it yet, and drawing it wrong later is worse. */
  T.def("INST_COMPUTER", {
    name: "Computer function", std: "ISA 5.1", w: SQ + 4, h: SQ, ports: PORTS_SQ,
    body: c => c.path(`M ${-R - 2},0 L ${-R / 2},${-R} L ${R / 2},${-R} L ${R + 2},0 ` +
      `L ${R / 2},${R} L ${-R / 2},${R} Z`, WHITE) + inner(c)
  });

  /* ── 2 · primary elements — what actually touches the fluid ─────────────
     A loop schematic that starts at the transmitter skips the half that can
     fail mechanically. These are drawn IN the pipe, ports on the pipe axis. */

  const PA = 9, PB = 6.5;                       // same pipe geometry as tam-sym-proc
  const PORTS_INLINE = { W: [-PA, 0, "W"], E: [PA, 0, "E"] };

  /* ORIFICE PLATE — the plate plus its two pressure taps. The taps are the
     symbol: an orifice measures a DIFFERENCE, and the two lines say so. */
  T.def("ORIFICE_PLATE", {
    name: "Orifice plate", std: "ISO 14617-8", w: 2 * PA, h: 22, ports: PORTS_INLINE,
    body: c => `<line x1="0" y1="${-PB - 3}" x2="0" y2="${PB + 3}" stroke="${c.col}" ` +
      `stroke-width="${c.sw * 1.6}" stroke-linecap="round"/>` +
      c.ln(-4, -PB - 3, -4, -PB - 9) + c.ln(4, -PB - 3, 4, -PB - 9) +
      c.ln(-4, -PB - 9, 4, -PB - 9)
  });

  /* THERMOWELL — the pocket. A TT reads the well, not the fluid, which is the
     whole reason a thermowell has a response-time argument attached to it. */
  T.def("THERMOWELL", {
    name: "Thermowell", std: "ISO 14617-8", w: 2 * PA, h: 20, ports: PORTS_INLINE,
    body: c => c.rect(-2.6, -PB - 7, 5.2, 7, WHITE) + c.ln(0, -PB, 0, PB - 1)
  });

  /* MAGNETIC FLOWMETER — the ISO in-line meter body with its coil marks.
     FT-2021 on the V-202 water outlet is one; drawing it as an orifice would
     teach a trainee to look for taps that do not exist. */
  T.def("MAG_FLOWMETER", {
    name: "Magnetic flowmeter", std: "ISO 14617-8", w: 2 * PA, h: 20, ports: PORTS_INLINE,
    body: c => c.rect(-PA, -PB, 2 * PA, 2 * PB, WHITE) +
      c.cir(0, 0, 3.2, "none") + c.ln(-PA + 2, -PB, -PA + 2, PB) + c.ln(PA - 2, -PB, PA - 2, PB)
  });

  /* LEVEL GAUGE — the sight glass on a vessel nozzle. Vertical by nature. */
  T.def("LEVEL_GAUGE", {
    name: "Level gauge", std: "ISO 14617-8", w: 14, h: 22,
    ports: { N: [0, -11, "N"], S: [0, 11, "S"] },
    body: c => c.rect(-4, -11, 8, 22, WHITE, null, 2) + c.ln(-4, 0, 4, 0)
  });

  /* ── 3 · signal lines ─────────────────────────────────────────────────────
     Not a symbol: a run between two points. Orthogonal by default, because a
     diagonal signal line on a P&ID reads as a mistake.
       type: 'process' | 'electric' | 'pneumatic' | 'software' | 'capillary'
       route: 'direct' | 'hv' (horizontal then vertical) | 'vh'
     Returns SVG. Arrowhead at the far end unless arrow:false. */
  const SIG = {
    process:   { dash: null,    hatch: null },
    impulse:   { dash: null,    hatch: null },
    electric:  { dash: "5 3",   hatch: null },
    pneumatic: { dash: null,    hatch: "hash" },
    software:  { dash: "4 3",   hatch: "bubble" },
    capillary: { dash: null,    hatch: "arc" }
  };

  function signal(x1, y1, x2, y2, o) {
    o = o || {};
    const t = SIG[String(o.type || "electric").toLowerCase()] || SIG.electric;
    const col = o.color || "#4A4F57", sw = o.width || 1.15;
    const route = o.route || "direct";

    /* build the polyline points first — one path, so the dash pattern runs
       continuously round the corner instead of restarting at each segment */
    let pts;
    if (route === "hv")      pts = [[x1, y1], [x2, y1], [x2, y2]];
    else if (route === "vh") pts = [[x1, y1], [x1, y2], [x2, y2]];
    else                     pts = [[x1, y1], [x2, y2]];

    const d = pts.map((p, i) => (i ? "L " : "M ") + p[0] + "," + p[1]).join(" ");
    let s = `<path d="${d}" fill="none" stroke="${col}" stroke-width="${sw}"` +
      (t.dash ? ` stroke-dasharray="${t.dash}"` : "") + ` stroke-linecap="round" stroke-linejoin="round"/>`;

    /* the medium marks, placed on the LONGEST segment so they always land on
       a straight run and never on a corner */
    let best = 0, bl = -1;
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (L > bl) { bl = L; best = i; }
    }
    const ax = pts[best - 1][0], ay = pts[best - 1][1], bx = pts[best][0], by = pts[best][1];
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;

    if (t.hatch === "hash") {
      /* pneumatic: the double slash, twice, straddling the midpoint */
      s += `<g transform="translate(${mx},${my}) rotate(${ang})" stroke="${col}" stroke-width="${sw}" stroke-linecap="round">` +
        `<line x1="-5" y1="-4" x2="-1" y2="4"/><line x1="-1" y1="-4" x2="3" y2="4"/></g>`;
    } else if (t.hatch === "bubble") {
      /* software link: the small open circles ISA uses for an internal link */
      s += `<g transform="translate(${mx},${my}) rotate(${ang})">` +
        `<circle cx="-4" cy="0" r="1.9" fill="#fff" stroke="${col}" stroke-width="${sw}"/>` +
        `<circle cx="4" cy="0" r="1.9" fill="#fff" stroke="${col}" stroke-width="${sw}"/></g>`;
    } else if (t.hatch === "arc") {
      s += `<g transform="translate(${mx},${my}) rotate(${ang})" fill="none" stroke="${col}" stroke-width="${sw}">` +
        `<path d="M -5,0 A 2.5,2.5 0 0 1 0,0 A 2.5,2.5 0 0 0 5,0"/></g>`;
    }

    /* v0.1.1 — the arrowhead must follow the LAST segment, not the longest one.
       On an L-shaped run with two equal legs the longest-segment tie picked the
       first leg, so the head at the valve pointed sideways instead of down into
       the actuator: an arrow that lies about where the signal goes. */
    if (o.arrow !== false) {
      const n = pts.length;
      const ex = pts[n - 1][0], ey = pts[n - 1][1];
      const px = pts[n - 2][0], py = pts[n - 2][1];
      const a2 = Math.atan2(ey - py, ex - px) * 180 / Math.PI;
      s += `<path d="M-4.5,-3 L1,0 L-4.5,3 Z" fill="${col}" transform="translate(${ex},${ey}) rotate(${a2})"/>`;
    }
    return s;
  }

  /* ── 4 · the bridge: a plant_instruments row → a bubble ───────────────────
     ONE rule, and it reads the database rather than the drafter's habit:

       system 'ESD'                    → INST_LOGIC     (diamond, safety)
       system 'PCS' + controller tag   → INST_SHARED    (square, in the PCS)
       system 'PCS' + field device     → INST_FIELD     (circle, out in the plant)
       no system                       → INST_FIELD

     A CONTROLLER is what the PCS holds: the third letter of the tag is C or the
     tag ends in IC/IC-. A transmitter sits in the field even though the PCS
     reads it — that is exactly the distinction the outline is for. */
  const CTRL = /^[A-Z]{1,2}(IC|C|RC|ICA)$/;
  function bubbleKind(system, tag, opts) {
    opts = opts || {};
    if (opts.kind) return opts.kind;
    const sys = String(system || "").toUpperCase();
    const p = parse(tag);
    const isController = CTRL.test(p.letters) || /C$/.test(p.letters);
    if (sys === "ESD" || sys === "SIS") return "INST_LOGIC";
    if (sys === "PCS" || sys === "") return isController ? "INST_SHARED" : "INST_FIELD";
    /* v0.1.3 — un `system` fuera del dominio PCS/ESD no se redondea a ninguno de
       los dos. La planta trae hoy 'PCS/ESD' (6), 'MCC' (4) y 'BOILER PANEL' (1):
       redondearlos pinta un contorno que el dato no respalda, y el contorno es
       precisamente lo que dice si un operador puede tocar la cosa en turno.
       Dibuja el hueco visible — G-4, y NORMA_COLOR_SIMBOLO.md §4. */
    return "UNKNOWN";
  }

  function fromRow(row, o) {
    row = row || {}; o = o || {};
    const tag = row.tag || row.loop_tag || "";
    const kind = bubbleKind(row.system, tag, o);
    const esd = kind === "INST_LOGIC";
    return {
      kind,
      opts: Object.assign({
        tag,
        sub: o.sub != null ? o.sub :
          (row.range ? row.range + (row.units ? " " + row.units : "") : null),
        color: esd ? ESD_INK : "#15171A",
        strokeWidth: 1.3,
        title: [tag, row.service, row.system, row.signal_output].filter(Boolean).join(" · ")
      }, o)
    };
  }

  const API = {
    fromRow, bubbleKind, signal, parse, SIG, R,
    BUBBLES: ["INST_FIELD", "INST_PANEL", "INST_AUX", "INST_SHARED",
              "INST_SHARED_FIELD", "INST_LOGIC", "INST_COMPUTER"],
    ELEMENTS: ["ORIFICE_PLATE", "THERMOWELL", "MAG_FLOWMETER", "LEVEL_GAUGE"],
    version: "0.1.3"
  };
  const root = (typeof window !== "undefined") ? window : globalThis;
  root.TamSymInst = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
