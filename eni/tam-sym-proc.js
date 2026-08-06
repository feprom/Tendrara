/* ═══════════════════════════════════════════════════════════════════════════
   tam-sym-proc.js — PROCESS symbol pack  ·  v0.5.0
   ─────────────────────────────────────────────────────────────────────────
   Phase 5 of GRAPHICS_LIBRARY_PLAN.md. v0.5.0 rebuilds the pack against the
   CLIENT'S OWN LEGEND — PRO13-ING-PR00 (21044-PR-PID-00000) rev 3, sheets 1
   and 2 — which is the only symbol authority this plant has. The legend is
   already digitised: `plant_pid_legend`, 402 rows, and the graphic categories
   are the contract this file must satisfy:

     valve_symbol 24 · control_valve 15 · misc_symbol 19 · fitting 12
     line_symbol 11 · specialty_valve 6 · connection 4 · pump 3

   WHY v0.5.0 EXISTS — three defects, all of them in the BRIDGE or the CENSUS,
   none of them visible by looking at a symbol
     1 · v0.4.0 registered 10 shapes against a legend that publishes ~80. Every
         strainer, reducer, blind, spectacle blind, manifold, regulator,
         3-way and pump on 51 P&IDs therefore had nowhere to land.
     2 · THE VALVE BODY WAS READ OFF THE TAG PREFIX AND NEVER OFF THE ROW.
         The census of 2026-08-05 says the plant writes 1904 `HV` tags and
         `valve_type` distinguishes them: 179 ball · 159 gate · 132 globe ·
         99 needle · 8 butterfly · 182 check. All of them drew one shape — a
         gate valve with a hand-wheel. The geometry was right and the drawing
         was still false, which is exactly the failure mode of the area-prefix
         defect fixed in v0.4.0. A prefix says WHO OPERATES the valve; only
         `valve_type` says WHAT IT IS. Both are needed, in that order of
         precedence: type first, prefix only as fallback (`kindSource` records
         which one answered).
     3 · The solenoid actuator was drawn as a box with a diagonal. PR00 sheet 2
         draws a plain box carrying a LETTER — S solenoid · M motor · P
         pneumatic relay — over a rotary (circle) body. The letter is the
         distinction, and it is the client's, not ours.

   THE THREE ORTHOGONAL FLAGS (G-5 — a property is a flag, never a symbol)
     hand   : true          hand-wheel bar on any body — MANUAL operation
     ends   : 'FL'|'SW'|'BW'|'SCR'   end connection, PR00 "VALVE CONNECTIONS"
     esd    : true          the safety fill (yellow). Comes from row.system.
   That is what keeps 1904 hand valves at ~8 bodies × 1 flag instead of 30
   near-duplicate symbols.

   DECLARED DEVIATIONS FROM PR00 — for the reviewer, not hidden in a diff
     D-P1 · CHECK valve. PR00 draws the wafer form (two flange bars + a
            diagonal seat), which at the 0.62 legend scale is not tellable
            from its own butterfly symbol. The pack keeps the ISO 14617
            bow-tie + heavy seat bar on the outlet side. Overturn it and the
            geometry moves; the map does not.
     D-P2 · GATE_VALVE keeps its hand-wheel by default. PR00 draws a bare
            bow-tie for "gate valve" and shows the hand-wheel only in the
            manual-regulating rows — but 87% of this plant's valve population
            is hand-operated, and a training diagram that hides that is the
            defect the bow-tie was introduced to fix. `hand:false` gives the
            legend-exact form.
     D-P3 · The legend prints many valves twice, hollow and SOLID BLACK. PR00
            nowhere states what the solid form means (it is not in the 402
            digitised rows either). The pack exposes it as `filled:true` and
            claims nothing about it. Do not use it to mean "closed" until the
            client confirms — G-3.

   THE OTHER HALF OF THE FIX IS NOT IN THIS FILE
     A valve is INSERTED IN the line, never laid ON TOP of it. The line breaks
     at the valve's ports — a router concern, so it lives in tam-flow.js
     `procLine()`. This pack only guarantees the contract that makes it
     possible: EVERY in-line symbol exposes ports W and E ON THE PIPE AXIS
     (y = 0), whatever the actuator does above.

   ISO / licensing note — same rule as the electrical pack
     ISO 10628 / ISO 14617 are licensed standards and are NOT redistributed.
     Every shape here is drawn from primitives (lines, arcs, triangles)
     against the published shape descriptions and against the client's own
     legend sheet, the way any CAD template is built. Nothing is copied from
     a paywalled asset set.

   API
     TamSymProc.fromRow(row, o)   ← PREFER THIS. type → prefix → system colour
     TamSymProc.fromTag(tag, o)   tag-prefix only; a guess, and it says so
     TamSymProc.valveKind(tag)    symbol kind for a plant tag
     TamSymProc.typeKind(t)       symbol kind for a valve_type / instrument_type
     TamSymProc.endsOf(t)         end connection encoded in a type ("Gate-SW")
     TamSymProc.isEsd(tag)        boolean (the yellow family)
     TamSymProc.audit(rows)       coverage census — what the drawing cannot say
     TamSymProc.offPage(x,y,o)    off-page connector (client PR50 convention)
     TamSymProc.MAP / TYPE_MAP / INST_MAP / LEGEND_MAP / LINE_STYLES

   Depends on tam-sym.js only. Zero other dependencies, offline-first.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const T = (typeof window !== "undefined" ? window : globalThis).TamSym;
  if (!T) throw new Error("tam-sym-proc: load tam-sym.js first");

  /* ── house colours ────────────────────────────────────────────────────────
     ESD yellow is NOT invented here — it is the convention tam-flow already
     used for the ESD diamonds and that the module legends print. Keeping it
     means the symbol changes shape without changing what the colour means. */
  const ESD_FILL = "#F7C600", ESD_INK = "#8A6D00";
  const WHITE = "#fff";

  /* body geometry — one set of numbers so every valve in the family lines up */
  const A = 9;      // half-length of the bow-tie (also the port offset)
  const B = 6.5;    // half-height of the bow-tie
  const HB = 26;    // declared bbox height for ACTUATED valves: clears the actuator
  const HP = 15;    // …for plain in-line devices with nothing on top

  const PORTS_INLINE = { W: [-A, 0, "W"], E: [A, 0, "E"] };

  /* ── 1 · shared geometry ──────────────────────────────────────────────────
     Everything below is built from these six helpers, which is the reason a
     pack of ~80 symbols is still readable: the bow-tie is written once. */

  /* the bow-tie: two closed triangles apex-to-apex on the pipe axis.
     Drawn as two separate paths, never one, so the apex stays a clean point. */
  const bowtie = (c, fill) =>
    c.path(`M ${-A},${-B} L ${-A},${B} L 0,0 Z`, fill) +
    c.path(`M ${A},${-B} L ${A},${B} L 0,0 Z`, fill);

  /* fill follows the flags, not the symbol — G-5.
     esd → the safety yellow · filled → PR00's solid form (D-P3) · else white */
  const bodyFill = c => (c.o && c.o.esd) ? ESD_FILL : (c.o && c.o.filled) ? c.col : WHITE;

  /* end connections — PR00 sheet 2 "VALVE CONNECTIONS".
     SCR (screwed) draws nothing: on the legend it is the bare body, and a mark
     that means "no mark" is how drawings acquire noise. */
  function ends(c) {
    const e = String((c.o && c.o.ends) || "").toUpperCase();
    if (!e || e === "SCR" || e === "SCREWED" || e === "NPT") return "";
    if (e === "BW" || e === "BUTT") return c.dot(-A, 0, 2.1) + c.dot(A, 0, 2.1);
    if (e === "SW" || e === "SOCKET")                       // bracket hard on the body
      return c.ln(-A, -B - 1.5, -A, B + 1.5) + c.ln(-A, -B - 1.5, -A - 3, -B - 1.5) + c.ln(-A, B + 1.5, -A - 3, B + 1.5) +
             c.ln(A, -B - 1.5, A, B + 1.5) + c.ln(A, -B - 1.5, A + 3, -B - 1.5) + c.ln(A, B + 1.5, A + 3, B + 1.5);
    /* FL — the flange pair, standing clear of the body */
    return c.ln(-A - 2.5, -B, -A - 2.5, B) + c.ln(A + 2.5, -B, A + 2.5, B);
  }

  /* hand-wheel seen edge-on (the bar) on a rising stem. A FLAG on any body. */
  const hw = c => c.ln(0, 0, 0, -10) + c.ln(-6.5, -10, 6.5, -10);
  const handIf = c => (c.o && c.o.hand) ? hw(c) : "";

  /* actuators, all drawn from the pipe axis upward so any body can carry any
     one of them without moving the ports */
  const dome = c => c.ln(0, 0, 0, -13) + c.path("M -7,-13 A 7,5.5 0 0 1 7,-13 Z", bodyFill(c));
  const boxAct = (c, letter) =>                    // PR00: a plain box + ONE letter
    c.ln(0, 0, 0, -11) + c.rect(-6, -19, 12, 8, bodyFill(c)) +
    (letter ? c.txt(0, -12.7, letter, 7.4, 700) : "");
  const piston = c =>                              // hydraulic / pneumatic piston
    c.ln(0, 0, 0, -11) + c.rect(-7, -21, 14, 10, bodyFill(c)) + c.ln(-7, -16, 7, -16);
  const rotary = c => c.ln(0, 0, 0, -11) + c.cir(0, -16.5, 5.5, bodyFill(c));
  const springTop = c => c.ln(0, 0, 0, -8) + c.path("M -4,-8 L 4,-10 L -4,-12 L 4,-14 L -4,-16", "none");

  /* rotary (ball/plug) core — the circle PR00 draws inside every actuated body */
  const ballCore = c => c.cir(0, 0, 3.4, WHITE);

  /* ── 2 · the manual valve bodies ──────────────────────────────────────────
     One body per PR00 "VALVE & PIPE SPECIALS SYMBOLS" row. The hand-wheel is a
     flag on all of them (D-P2), so `{hand:true}` turns any of these into the
     hand-operated version without a second registration. */

  /* generic — a valve whose type we do NOT know. G-4: a gap must be visible,
     so this is a bare body: no actuator claimed that the data does not have. */
  T.def("VALVE", {
    name: "Valve", std: "ISO 14617-8", w: 2 * A, h: HP, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + ends(c) + handIf(c)
  });

  /* gate — PR00 draws the bare bow-tie. The pack draws the hand-wheel by
     default because 87% of this plant's valves are hand-operated (D-P2). */
  T.def("GATE_VALVE", {
    name: "Gate valve", std: "PR00 / ISO 14617-8", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + ends(c) + ((c.o && c.o.hand === false) ? "" : hw(c))
  });

  /* globe — the SOLID dot on the axis is what says "throttling seat" */
  T.def("GLOBE_VALVE", {
    name: "Globe valve", std: "PR00 / ISO 14617-8", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + c.dot(0, 0, 2.7) + ends(c) + handIf(c)
  });

  /* ball — the HOLLOW circle. Globe vs ball is fill, and only fill: that is
     the client's own distinction on PR00 and it is why both are here. */
  T.def("BALL_VALVE", {
    name: "Ball valve", std: "PR00 / ISO 14617-8", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + ballCore(c) + ends(c) + handIf(c)
  });

  /* butterfly — the wafer form: two flange bars and the disc seen edge-on */
  T.def("BUTTERFLY_VALVE", {
    name: "Butterfly valve", std: "PR00", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => c.ln(-A, -B - 1, -A, B + 1) + c.ln(A, -B - 1, A, B + 1) +
      c.path(`M ${-A},${B} C ${-A + 2},${-B} ${A - 2},${B} ${A},${-B}`, "none") +
      c.dot(0, 0, 1.8) + handIf(c)
  });

  /* needle — the stem carries the needle itself, point down onto the seat */
  T.def("NEEDLE_VALVE", {
    name: "Needle valve", std: "PR00", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + c.path("M -2.6,-11 L 2.6,-11 L 0,-1 Z", bodyFill(c)) +
      c.ln(0, -11, 0, -13) + ends(c) + handIf(c)
  });

  /* check — D-P1: the ISO body, not PR00's wafer form. The heavy bar sits on
     the OUTLET side; no actuator, because a check valve is moved by the fluid
     and not by a signal. */
  T.def("CHECK_VALVE", {
    name: "Check valve", std: "ISO 14617-8 (see D-P1)", w: 2 * A, h: HP, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + ends(c) +
      `<line x1="${A}" y1="${-B - 1}" x2="${A}" y2="${B + 1}" stroke="${c.col}" stroke-width="${c.sw * 1.7}" stroke-linecap="round"/>`
  });

  /* 3-way — the third triangle IS the third port. This is what resolves the
     COV gap declared in v0.4.0: 10 changeover valves standing between PSV
     pairs were drawing a 2-port body, which on a relief manifold is the single
     most misleading thing the drawing can say. */
  T.def("THREE_WAY_VALVE", {
    name: "3-way valve", std: "PR00 / gate", w: 2 * A, h: HB,
    ports: { W: [-A, 0, "W"], E: [A, 0, "E"], S: [0, A, "S"] },
    body: c => bowtie(c, bodyFill(c)) +
      c.path(`M ${-B},${A} L ${B},${A} L 0,0 Z`, bodyFill(c)) + handIf(c)
  });

  T.def("FOUR_WAY_VALVE", {
    name: "4-way valve", std: "PR00 / gate", w: 2 * A, h: 2 * A,
    ports: { W: [-A, 0, "W"], E: [A, 0, "E"], N: [0, -A, "N"], S: [0, A, "S"] },
    body: c => bowtie(c, bodyFill(c)) +
      c.path(`M ${-B},${A} L ${B},${A} L 0,0 Z`, bodyFill(c)) +
      c.path(`M ${-B},${-A} L ${B},${-A} L 0,0 Z`, bodyFill(c))
  });

  /* angle body — inlet from below, outlet to the side. Registered because the
     legend carries "Refr. Globe Angle Valve" and because a PSV is one. */
  T.def("ANGLE_VALVE", {
    name: "Angle valve", std: "PR00 / refr. globe angle", w: 2 * A, h: HB,
    ports: { S: [0, B + 2.5, "S"], E: [A, 0, "E"] },
    body: c => c.path(`M ${-B},${B + 2.5} L ${B},${B + 2.5} L 0,0 Z`, bodyFill(c)) +
      c.path(`M ${A},${-B} L ${A},${B} L 0,0 Z`, bodyFill(c)) + c.dot(0, 0, 2.4) + handIf(c)
  });

  /* manual regulating — the T handle. PR00 gives it its own row precisely
     because a regulating hand valve is NOT a shut-off hand valve: it is set
     and left, and the drawing has to be able to say so. */
  T.def("REGULATING_VALVE", {
    name: "Regulating valve", std: "PR00 / manual regulating", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + ends(c) +
      c.ln(0, 0, 0, -11) + c.ln(-5.5, -11, 5.5, -11) + c.ln(0, -11, 0, -14)
  });

  T.def("REGULATING_ANGLE_VALVE", {
    name: "Regulating angle valve", std: "PR00", w: 2 * A, h: HB,
    ports: { S: [0, B + 2.5, "S"], E: [A, 0, "E"] },
    body: c => c.path(`M ${-B},${B + 2.5} L ${B},${B + 2.5} L 0,0 Z`, bodyFill(c)) +
      c.path(`M ${A},${-B} L ${A},${B} L 0,0 Z`, bodyFill(c)) +
      c.ln(0, 0, 0, -11) + c.ln(-5.5, -11, 5.5, -11) + c.ln(0, -11, 0, -14)
  });

  /* pressure relief — ANGLE body with the spring on top. A PSV is not an
     in-line device and drawing it in-line is how people end up thinking it is
     one, so the ports say S (inlet, from below) and E (outlet). */
  T.def("RELIEF_VALVE", {
    name: "Relief valve (PSV)", std: "PR00 / PSV-TRV", w: 2 * A, h: HB,
    ports: { S: [0, B + 2.5, "S"], E: [A, 0, "E"] },
    body: c => c.path(`M ${-B},${B + 2.5} L ${B},${B + 2.5} L 0,0 Z`, bodyFill(c)) +
      c.path(`M ${A},${-B} L ${A},${B} L 0,0 Z`, bodyFill(c)) + springTop(c)
  });

  /* ── 3 · the actuated family ──────────────────────────────────────────────
     PR00 sheet 2 "CONTROL VALVES": the actuator is a box carrying a LETTER
     over a rotary body. The letter is the client's distinction — S solenoid,
     M motor, P pneumatic relay — and replacing it with a diagonal (which is
     what v0.4.0 drew) throws away the only mark that separates them. */

  /* modulating control valve — diaphragm actuator (the dome) */
  T.def("CONTROL_VALVE", {
    name: "Control valve", std: "PR00 / diaphragm", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + dome(c)
  });

  /* …with a positioner: the small box on the yoke. Worth its own kind because
     a positioner is a maintainable item with its own tag on the loop sheets. */
  T.def("CONTROL_VALVE_POS", {
    name: "Control valve w/ positioner", std: "PR00", w: 2 * A, h: HB + 4, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + dome(c) +
      c.rect(4.5, -12, 7, 6.5, WHITE) + c.ln(11.5, -8.7, 15, -8.7) + c.ln(11.5, -14, 15, -14)
  });

  /* on/off ESD valve — solenoid box 'S' over a rotary body, spring-return.
     YELLOW is reserved for the safety family (Mario, 2026-07-30): an XV that
     the PCS operates in normal service is not a trip and must not claim the
     trip colour. Shape identical to ONOFF_VALVE on purpose — the colour is the
     only difference, and that is the teaching point. */
  T.def("SHUTDOWN_VALVE", {
    name: "Shutdown valve (ESD)", std: "PR00 / solenoid", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + ballCore(c) + boxAct(c, "S")
  });
  T.def("ONOFF_VALVE", {
    name: "On/off valve (operating)", std: "PR00 / solenoid", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + ballCore(c) + boxAct(c, "S")
  });

  /* 3-way pilot solenoid — the pilot that vents an actuator. Its third port is
     the vent, drawn open to atmosphere, which is why it is not a THREE_WAY
     with a box on top. */
  T.def("SOLENOID_3W", {
    name: "3-way pilot solenoid", std: "PR00", w: 2 * A, h: HB,
    ports: { W: [-A, 0, "W"], E: [A, 0, "E"], S: [0, A, "S"] },
    body: c => bowtie(c, bodyFill(c)) + c.path(`M ${-B},${A} L ${B},${A} L 0,0 Z`, WHITE) +
      boxAct(c, "S")
  });

  T.def("MOTOR_VALVE", {
    name: "Motor actuated valve", std: "PR00", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + ballCore(c) + boxAct(c, "M")
  });
  T.def("PNEU_RELAY_VALVE", {
    name: "Pneumatic relay valve", std: "PR00", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + ballCore(c) + boxAct(c, "P")
  });
  T.def("PISTON_VALVE", {
    name: "Piston / spring return", std: "PR00", w: 2 * A, h: HB + 4, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + ballCore(c) + piston(c)
  });
  T.def("ROTARY_MOTOR_VALVE", {
    name: "Rotary motor actuated", std: "PR00", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + ballCore(c) + rotary(c)
  });

  /* ── 4 · self-contained regulators ────────────────────────────────────────
     A regulator is NOT a control valve: nothing on the loop drives it, it
     senses its own line through the pigtail PR00 draws from the dome down to
     the pipe. Which SIDE the pigtail lands on is the whole content of the
     symbol — inlet regulators hold pressure upstream, outlet regulators hold
     it downstream, and swapping them inverts what the trainee reads. */
  const regPipe = (c, side) => side === "in"
    ? c.path("M -6,-18 L -14,-18 L -14,0", "none")           // senses upstream
    : c.path("M 6,-18 L 14,-18 L 14,0", "none");             // senses downstream

  T.def("REG_INLET_SC", {
    name: "Inlet press. regulator", std: "PR00 / self-contained", w: 2 * A + 8, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + dome(c) + regPipe(c, "in")
  });
  T.def("REG_OUTLET_SC", {
    name: "Outlet press. regulator", std: "PR00 / self-contained", w: 2 * A + 8, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + dome(c) + regPipe(c, "out")
  });
  /* differential — the sensing element is split (the divided circle) because it
     compares TWO taps, and both pigtails are drawn for the same reason */
  T.def("REG_DP_SC", {
    name: "Diff. press. regulator", std: "PR00 / self-contained", w: 2 * A + 16, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + c.ln(0, 0, 0, -10) + c.cir(0, -15, 6, bodyFill(c)) +
      c.ln(-6, -15, 6, -15) + regPipe(c, "in") + regPipe(c, "out")
  });

  T.def("AIR_LUBRICATOR", {
    name: "Air lubricator", std: "PR00", w: 2 * A, h: HP + 4, ports: PORTS_INLINE,
    body: c => c.path("M 0,-8 L 8,0 L 0,8 L -8,0 Z", WHITE) + c.ln(0, -5, 0, 2)
  });
  T.def("AIR_REGULATOR", {
    name: "Air regulator", std: "PR00", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => c.rect(-7, -6, 14, 12, WHITE) + c.ln(-7, 0, 7, 0) +
      c.path("M -2,-6 L -2,-14 L 2,-14", "none") + c.path("M 2,-8 L 6,-11 L 2,-13 L 6,-15", "none")
  });

  /* ── 5 · specialty valves and manifolds ───────────────────────────────────
     The block-and-bleed manifolds are the reason instrument hook-ups are safe
     to work on, and PR00 gives all three their own row. Drawn as the DASHED
     ENCLOSURE the legend uses: the box says "this is one purchased assembly",
     not three valves that happen to sit together. */
  const miniValve = (c, x, y, s) => {
    s = s || 3.2;
    return c.path(`M ${x - s},${y - s * 0.72} L ${x - s},${y + s * 0.72} L ${x},${y} Z`, WHITE) +
           c.path(`M ${x + s},${y - s * 0.72} L ${x + s},${y + s * 0.72} L ${x},${y} Z`, WHITE);
  };
  T.def("BLOCK_BLEED_2W", {
    name: "2-way block & bleed", std: "PR00", w: 2 * A, h: 24,
    ports: { W: [-A, 0, "W"], E: [A, 0, "E"] },
    body: c => bowtie(c, WHITE) + c.ln(0, -B, 0, -11) + c.path("M -2.6,-11 L 2.6,-11 L 0,-15 Z", c.col) +
      c.ln(0, B, 0, 11) + c.path("M -2.6,11 L 2.6,11 L 0,15 Z", c.col)
  });
  T.def("BLOCK_BLEED_3W", {
    name: "3-way block & bleed", std: "PR00", w: 26, h: 24,
    ports: { W: [-13, 0, "W"], E: [13, 0, "E"] },
    body: c => c.rect(-13, -12, 26, 24, WHITE) + miniValve(c, -6, 2) + miniValve(c, 6, 2) +
      c.rect(-8.5, -11, 5, 4, WHITE) + c.rect(3.5, -11, 5, 4, WHITE) +
      c.ln(-6, -7, -6, -1) + c.ln(6, -7, 6, -1)
  });
  T.def("BLOCK_BLEED_5W", {
    name: "5-way block & bleed", std: "PR00", w: 34, h: 24,
    ports: { W: [-17, 0, "W"], E: [17, 0, "E"] },
    body: c => c.rect(-17, -12, 34, 24, WHITE) + miniValve(c, -7, 2) + miniValve(c, 7, 2) +
      miniValve(c, -14, -8, 2.4) + miniValve(c, 0, -8, 2.4) + miniValve(c, 14, -8, 2.4) +
      c.ln(-7, -8, -7, -1) + c.ln(7, -8, 7, -1)
  });

  T.def("FLOAT_EXPANSION_VALVE", {
    name: "Float expansion valve", std: "PR00", w: 24, h: 18,
    ports: { W: [-12, 0, "W"], E: [12, 0, "E"] },
    body: c => c.path("M -6,-8 L 6,-8 A 8,8 0 0 1 6,8 L -6,8 Z", WHITE) +
      c.ln(-10, -9, -10, 9) + c.ln(-10, 0, -6, 0) + c.cir(3, 1, 2.4, WHITE) + c.ln(-6, -5, 3, 1)
  });
  T.def("UNIDIR_FLOW_CONTROL", {
    name: "Unidirectional flow control", std: "PR00", w: 24, h: 16,
    ports: { W: [-12, 0, "W"], E: [12, 0, "E"] },
    body: c => c.rect(-11, -7, 22, 14, WHITE) + c.ln(-11, -7, 11, -7) +
      c.path("M -5,-11 L 5,-3", "none") + c.ln(-3, -3, 3, -11) +
      c.path("M -3,5 L 0,2 L 3,5 L 0,8 Z", WHITE) + c.ln(-11, 5, -3, 5) + c.ln(3, 5, 11, 5)
  });
  /* the 4-way hydraulic spool valves — drawn as the two/three-cell spool box
     PR00 shows. The cells are the point: a spool valve has POSITIONS, and a
     single-cell body would claim it does not. */
  const spool = (c, pilot) => {
    let s = c.rect(-16, -8, 32, 16, WHITE) + c.ln(0, -8, 0, 8);
    s += c.path("M -13,-4 L -4,4", "none") + c.path("M -13,4 L -4,-4", "none");
    s += c.path("M 5,5 L 5,-4 M 3,-2 L 5,-5 L 7,-2", "none");
    s += c.path("M 11,-5 L 11,4 M 9,2 L 11,5 L 13,2", "none");
    /* the operators, one per end: zig-zag spring + pilot arrow or 'S' box */
    s += c.path("M -16,-4 L -20,-1 L -16,2 L -20,5", "none") + c.path("M 16,-4 L 20,-1 L 16,2 L 20,5", "none");
    if (pilot === "S") s += c.rect(-26, -6, 6, 12, WHITE) + c.txt(-23, 3, "S", 7, 700) +
                            c.rect(20, -6, 6, 12, WHITE) + c.txt(23, 3, "S", 7, 700);
    return s;
  };
  T.def("FOURWAY_HYD_PILOT", {
    name: "4-way spool, pilot", std: "PR00", w: 44, h: 20,
    ports: { P: [-6, 10, "S"], T: [6, 10, "S"], A: [-6, -10, "N"], Bx: [6, -10, "N"] },
    body: c => spool(c, null)
  });
  T.def("FOURWAY_HYD_DIRECT", {
    name: "4-way spool, direct", std: "PR00", w: 56, h: 20,
    ports: { P: [-6, 10, "S"], T: [6, 10, "S"], A: [-6, -10, "N"], Bx: [6, -10, "N"] },
    body: c => spool(c, "S")
  });

  /* six-port transfer valve — the PSV changeover on a relief manifold. Six
     flanged ports and ONE rotating plug, drawn as the diagonal: which way the
     plug points is which relief is lined up. */
  T.def("SIX_PORT_TRANSFER_VALVE", {
    name: "6-port transfer valve", std: "PR00", w: 34, h: 34,
    ports: { N: [0, -17, "N"], S: [0, 17, "S"], NW: [-17, -6, "W"], SW: [-17, 6, "W"], NE: [17, -6, "E"], SE: [17, 6, "E"] },
    body: c => c.rect(-11, -11, 22, 22, WHITE) +
      c.ln(0, -11, 0, -17) + c.ln(-4, -17, 4, -17) + c.ln(0, 11, 0, 17) + c.ln(-4, 17, 4, 17) +
      c.ln(-11, -6, -17, -6) + c.ln(-17, -9, -17, -3) + c.ln(-11, 6, -17, 6) + c.ln(-17, 3, -17, 9) +
      c.ln(11, -6, 17, -6) + c.ln(17, -9, 17, -3) + c.ln(11, 6, 17, 6) + c.ln(17, 3, 17, 9) +
      c.ln(-6, 9, 6, -5) + c.cir(6, -5, 1.6, WHITE)
  });

  /* ── 6 · in-line devices that are not valves ──────────────────────────── */

  /* rupture disc — PR00 draws the disc as a flat body with the bursting
     element inside, and gives PRESSURE and VACUUM two different marks. Which
     way it protects is the entire information content. */
  T.def("RUPTURE_DISC", {
    name: "Rupture disc (pressure)", std: "PR00", w: 2 * A, h: HP, ports: PORTS_INLINE,
    body: c => c.rect(-8, -3.6, 16, 7.2, WHITE) + c.ln(-8, 3.6, 8, -3.6)
  });
  T.def("RUPTURE_DISC_VACUUM", {
    name: "Rupture disc (vacuum)", std: "PR00", w: 2 * A, h: HP, ports: PORTS_INLINE,
    body: c => c.rect(-8, -3.6, 16, 7.2, WHITE) + c.ln(-8, -3.6, 8, 3.6)
  });

  /* restriction orifice — the plate, drawn as the pair of bars it is */
  T.def("RESTRICTION_ORIFICE", {
    name: "Restriction orifice", std: "PR00", w: 2 * A, h: HP, ports: PORTS_INLINE,
    body: c => c.ln(-2.5, -B - 1, -2.5, B + 1) + c.ln(2.5, -B - 1, 2.5, B + 1)
  });
  /* …and its tag bubble. PR00 prints the HOLE DIAMETER under "RO" inside the
     bubble; pass it as `sub` — never invent it (G-3). */
  T.def("RO_TAG", {
    name: "Restriction orifice tag", std: "PR00", w: 22, h: 22,
    ports: { S: [0, 11, "S"] },
    body: c => c.cir(0, 0, 11, WHITE) + c.txt(0, -1, "RO", 7.4, 700) +
      c.txt(0, 7, (c.o && c.o.hole) ? String(c.o.hole) : "—", 6, 400)
  });

  /* strainers — four bodies, because PR00 publishes four and they are bought
     as four different items. The mesh direction is what each one carries. */
  T.def("Y_STRAINER", {
    name: "Y strainer", std: "PR00", w: 2 * A, h: HP + 6, ports: PORTS_INLINE,
    body: c => c.ln(-A, 0, A, 0) + c.ln(-A, -5, A, -5) + c.ln(-A, -5, -A, 0) + c.ln(A, -5, A, 0) +
      c.ln(0, 0, 7, 8) + c.ln(4, 9.5, 9, 5)
  });
  T.def("T_STRAINER", {
    name: "T strainer", std: "PR00", w: 2 * A, h: HP + 6, ports: PORTS_INLINE,
    body: c => c.ln(-A, -5, A, -5) + c.ln(-A, -5, -A, 0) + c.ln(A, -5, A, 0) + c.ln(-A, 0, A, 0) +
      c.ln(0, 0, 0, 8) + c.ln(-4, 8, 4, 8)
  });
  T.def("ANGLE_STRAINER", {
    name: "Angle strainer", std: "PR00", w: 2 * A, h: HP + 6,
    ports: { W: [-A, -4, "W"], S: [2, 11, "S"] },
    body: c => c.rect(-6, -10, 15, 15, WHITE) + c.ln(-A, -4, -6, -4) + c.ln(-6, 5, 9, -10) +
      c.ln(2, 5, 2, 11) + c.ln(-1, 11, 5, 11)
  });
  T.def("CONICAL_STRAINER", {
    name: "Conical strainer", std: "PR00", w: 2 * A, h: HP + 6, ports: PORTS_INLINE,
    body: c => c.ln(-3, -6, -3, 6) + c.ln(3, -6, 3, 6) + c.ln(0, -6, 0, -13) +
      c.path("M 0,-13 L 7,-13 L 0,-9 Z", WHITE) + c.ln(-A, 0, -3, 0) + c.ln(3, 0, A, 0)
  });
  T.def("BUCKET_STRAINER", {
    name: "Bucket strainer", std: "PR00", w: 2 * A, h: HP + 6, ports: PORTS_INLINE,
    body: c => c.ln(-3, -6, -3, 6) + c.ln(3, -6, 3, 6) + c.ln(3, -6, 3, -13) +
      c.path("M 3,-13 L 10,-13 L 3,-9 Z", WHITE) + c.ln(-A, 0, -3, 0) + c.ln(3, 0, A, 0)
  });
  /* basket strainer — the only one PR00 draws as an EQUIPMENT outline rather
     than an in-line mark, because it is a vessel with a removable cover */
  T.def("BASKET_STRAINER", {
    name: "Basket strainer", std: "PR00", w: 32, h: 20,
    ports: { W: [-16, 0, "W"], E: [16, 0, "E"] },
    body: c => c.path("M -8,-8 L 8,-8 L 12,-6 L 12,6 L 8,8 L -8,8 Z", WHITE) +
      c.ln(12, -9, 12, 9) + c.ln(14, -9, 14, 9) + c.ln(14, 0, 16, 0) + c.ln(-16, 0, -8, 0) +
      c.ln(-2, 8, -2, 11) + c.ln(-5, 11, 1, 11)
  });

  T.def("SIGHT_GLASS", {
    name: "Sight glass", std: "PR00", w: 2 * A, h: HP, ports: PORTS_INLINE,
    body: c => c.rect(-8, -5, 16, 10, WHITE) + c.cir(0, 0, 3.6, WHITE)
  });
  T.def("FLEX_HOSE", {
    name: "Flexible hose", std: "PR00", w: 26, h: HP,
    ports: { W: [-13, 0, "W"], E: [13, 0, "E"] },
    body: c => c.ln(-13, -4, -13, 4) + c.ln(13, -4, 13, 4) +
      c.path("M -13,0 C -8,-8 -4,8 0,0 C 4,-8 8,8 13,0", "none")
  });
  T.def("DIAPHRAGM_SEAL", {
    name: "Diaphragm seal", std: "PR00", w: 12, h: 20,
    ports: { N: [0, -10, "N"], S: [0, 10, "S"] },
    body: c => c.rect(-4, -10, 8, 20, WHITE, null, 1.5) +
      c.path("M -1.5,-8 C 3,-4 -3,0 1.5,4 C 3,6 0,8 -1.5,8", "none")
  });
  T.def("AUTO_DRAIN", {
    name: "Automatic drain", std: "PR00", w: 16, h: 16,
    ports: { N: [0, -8, "N"] },
    body: c => c.cir(0, 0, 7, WHITE) +
      c.path("M -7,0 A 7,7 0 0 0 7,0 A 3.5,3.5 0 0 0 0,0 A 3.5,3.5 0 0 1 -7,0 Z", c.col)
  });
  /* spectacle blind — the two discs on one stem: one bored, one solid. Which
     disc is IN THE LINE is the whole point, so `blindClosed` swaps the fill
     rather than swapping the symbol (G-5). */
  T.def("SPECTACLE_BLIND", {
    name: "Spectacle blind", std: "PR00", w: 14, h: 24,
    ports: { W: [-7, 0, "W"], E: [7, 0, "E"] },
    body: c => {
      const closed = !!(c.o && c.o.blindClosed);
      return c.ln(0, -12, 0, 4) + c.ln(-7, 0, 7, 0) + c.ln(-3, -4, -3, 4) + c.ln(3, -4, 3, 4) +
        c.cir(0, -6.5, 3, closed ? WHITE : c.col) + c.cir(0, -12, 3, closed ? c.col : WHITE);
    }
  });

  /* ── 7 · fittings and pipe specials (PR00 sheet 1, MISCELLANEOUS) ──────── */
  T.def("SPOOL_PIECE", {
    name: "Spool piece (SP)", std: "PR00", w: 26, h: 16,
    ports: { W: [-13, 0, "W"], E: [13, 0, "E"] },
    body: c => c.ln(-9, -5, -9, 5) + c.ln(-6, -5, -6, 5) + c.ln(6, -5, 6, 5) + c.ln(9, -5, 9, 5) +
      c.ln(-13, 0, -9, 0) + c.ln(-6, 0, 6, 0) + c.ln(9, 0, 13, 0) + c.txt(0, -7, "SP", 6.4, 700)
  });
  T.def("BLIND_FLANGE", {
    name: "Blind flange", std: "PR00", w: 16, h: 16, ports: { W: [-8, 0, "W"] },
    body: c => c.ln(-8, 0, 2, 0) + c.ln(2, -6, 2, 6) + c.ln(5, -6, 5, 6)
  });
  T.def("BLIND_FLANGE_PLUG", {
    name: "Blind flange w/ plug", std: "PR00", w: 16, h: 16, ports: { W: [-8, 0, "W"] },
    body: c => c.ln(-8, 0, 2, 0) + c.ln(2, -6, 2, 6) + c.path("M 5,-5 L 5,5 L 9,3 L 9,-3 Z", c.col)
  });
  T.def("PIPE_CAP", {
    name: "Pipe cap", std: "PR00", w: 16, h: 14, ports: { W: [-8, 0, "W"] },
    body: c => c.ln(-8, 0, 1, 0) + c.ln(1, -5, 1, 5) + c.path("M 1,-5 A 5,5 0 0 1 1,5", "none")
  });
  T.def("THREADED_CAP", {
    name: "Threaded cap", std: "PR00", w: 16, h: 14, ports: { W: [-8, 0, "W"] },
    body: c => c.ln(-8, 0, 1, 0) + c.ln(1, -5, 1, 5) + c.path("M 1,-5 L 6,-5 L 6,5 L 1,5", "none")
  });
  T.def("THREADED_PLUG", {
    name: "Threaded plug", std: "PR00", w: 16, h: 14, ports: { W: [-8, 0, "W"] },
    body: c => c.ln(-8, 0, 1, 0) + c.ln(1, -5, 1, 5) + c.path("M 1,-5 L 6,-3 L 6,3 L 1,5 Z", c.col)
  });
  T.def("CONCENTRIC_REDUCER", {
    name: "Concentric reducer", std: "PR00", w: 20, h: 16,
    ports: { W: [-10, 0, "W"], E: [10, 0, "E"] },
    body: c => c.path("M -6,-6 L 6,-3 L 6,3 L -6,6 Z", WHITE) + c.ln(-10, 0, -6, 0) + c.ln(6, 0, 10, 0)
  });
  T.def("ECCENTRIC_REDUCER", {
    name: "Eccentric reducer", std: "PR00", w: 20, h: 16,
    ports: { W: [-10, 0, "W"], E: [10, 3, "E"] },
    body: c => c.path("M -6,-6 L 6,0 L 6,6 L -6,6 Z", WHITE) + c.ln(-10, 0, -6, 0) + c.ln(6, 3, 10, 3)
  });
  T.def("WELDOLET", {
    name: "Weldolet", std: "PR00", w: 18, h: 14,
    ports: { S: [0, 5, "S"], N: [0, -7, "N"] },
    body: c => c.ln(-9, 5, 9, 5) + c.path("M -4,5 A 4,4 0 0 1 4,5 Z", WHITE) + c.ln(0, 1, 0, -7) + c.ln(-3, -7, 3, -7)
  });
  T.def("THREADOLET", {
    name: "Threadolet", std: "PR00", w: 18, h: 14,
    ports: { S: [0, 5, "S"], N: [0, -7, "N"] },
    body: c => c.ln(-9, 5, 9, 5) + c.rect(-4, 1, 8, 4, WHITE) + c.ln(0, 1, 0, -7) + c.ln(-3, -7, 3, -7)
  });
  T.def("SOCKOLET", {
    name: "Sockolet", std: "PR00", w: 18, h: 14,
    ports: { S: [0, 5, "S"], N: [0, -7, "N"] },
    body: c => c.ln(-9, 5, 9, 5) + c.rect(-4, 1, 8, 4, WHITE) + c.ln(-4, -1, 4, -1) + c.ln(0, -1, 0, -7)
  });
  T.def("PIPE_SLOPE", {
    name: "Pipe slope", std: "PR00", w: 22, h: 12,
    ports: { W: [-11, 0, "W"], E: [11, 0, "E"] },
    body: c => c.ln(-11, 0, 11, 0) + c.path("M -3,-3 L 7,-3 L 7,-6 Z", WHITE) + c.ln(-3, -3, -3, 0)
  });

  /* ── 8 · plant items PR00 draws on the process sheets ─────────────────── */
  T.def("PUMP_CENTRIFUGAL", {
    name: "Centrifugal pump", std: "PR00", w: 28, h: 28,
    ports: { W: [-14, -4, "W"], N: [4, -14, "N"] },
    body: c => c.path("M -12,-12 L -2,-12 A 10,10 0 1 1 -12,-2 Z", WHITE) +
      c.cir(-2, -2, 3, WHITE) + c.path("M -10,8 L 6,8 L -2,-1 Z", WHITE) + c.ln(-12, 12, 8, 12) +
      c.ln(-14, -4, -12, -4) + c.ln(4, -14, 4, -11)
  });
  T.def("PUMP_VOLUMETRIC", {
    name: "Volumetric pump", std: "PR00", w: 30, h: 28,
    ports: { W: [-15, -2, "W"], E: [15, -2, "E"] },
    body: c => c.cir(0, -2, 10, WHITE) + c.cir(0, -6, 3.4, WHITE) + c.cir(0, 1, 3.4, WHITE) +
      c.ln(-8, 5, 8, -8) + c.path("M -8,8 L 8,8 L 2,2 L -4,2 Z", WHITE) + c.ln(-10, 12, 10, 12) +
      c.ln(-15, -2, -10, -2) + c.ln(-13, -5, -13, 1) + c.ln(15, -2, 10, -2) + c.ln(13, -5, 13, 1)
  });
  T.def("PUMP_DIAPHRAGM", {
    name: "Diaphragm pump", std: "PR00", w: 30, h: 26,
    ports: { W: [-15, 6, "W"], E: [15, 6, "E"] },
    body: c => c.rect(-9, -2, 18, 12, WHITE) + c.ln(0, -2, 0, -8) +
      `<ellipse cx="0" cy="-10" rx="7" ry="3.6" fill="${WHITE}" stroke="${c.col}" stroke-width="${c.sw}"/>` +
      c.ln(-9, -6, -9, -2) + c.ln(9, -6, 9, -2) +
      c.ln(-15, 6, -9, 6) + c.ln(-13, 3, -13, 9) + c.ln(15, 6, 9, 6) + c.ln(13, 3, 13, 9)
  });
  T.def("EJECTOR", {
    name: "Ejector", std: "PR00", w: 34, h: 20,
    ports: { W: [-17, -3, "W"], S: [-6, 10, "S"], E: [17, -3, "E"] },
    body: c => c.rect(-10, -8, 8, 10, WHITE) + c.path("M -2,-8 L 12,-3 L -2,2 Z", WHITE) +
      c.ln(-17, -3, -10, -3) + c.ln(12, -3, 17, -3) + c.ln(-6, 2, -6, 10)
  });
  T.def("SEAL_DRAIN_POT", {
    name: "Atmospheric seal drain pot", std: "PR00", w: 18, h: 26,
    ports: { N: [0, -13, "N"] },
    body: c => c.path("M -6,13 L -6,-4 L -2,-9 L -2,-12 L 2,-12 L 2,-9 L 6,-4 L 6,13 Z", WHITE) +
      c.rect(-2.4, -13, 4.8, 2.4, c.col)
  });
  T.def("DRIP_FUNNEL", {
    name: "Drip funnel", std: "PR00", w: 14, h: 18,
    ports: { N: [0, -9, "N"] },
    body: c => c.ln(-5, -9, 0, -2) + c.ln(5, -9, 0, -2) + c.ln(0, -2, 0, 9)
  });
  T.def("LEVEL_REFERENCE", {
    name: "Level reference", std: "PR00", w: 12, h: 10, ports: {},
    body: c => c.path("M -5,-3 L 5,-3 L 0,4 Z", WHITE)
  });

  /* ── 9 · drawing-management marks ─────────────────────────────────────────
     These are not process equipment — they are statements about the DRAWING:
     where scope changes hands, where the piping class changes, where the sheet
     ends. On a training diagram they matter as much as the valves, because
     they are what tells the operator whose equipment he is looking at. */
  const scopeArrows = (c, col) =>
    c.path(`M -9,-4 L -1,0 L -9,4 Z`, col || c.col) + c.path(`M 9,-4 L 1,0 L 9,4 Z`, col || c.col);

  T.def("SPEC_CHANGE", {
    name: "Piping class change", std: "PR00", w: 22, h: 26,
    ports: { W: [-11, 0, "W"], E: [11, 0, "E"] },
    body: c => c.ln(0, -13, 0, 13) + scopeArrows(c) + c.ln(-11, 0, -9, 0) + c.ln(9, 0, 11, 0)
  });
  T.def("SCOPE_BREAK", {
    name: "Scope of supply", std: "PR00", w: 22, h: 26,
    ports: { W: [-11, 0, "W"], E: [11, 0, "E"] },
    body: c => c.ln(0, -13, 0, 13) + scopeArrows(c, "#8A9099") + c.ln(-11, 0, -9, 0) + c.ln(9, 0, 11, 0)
  });
  T.def("SCOPE_ELECTRICAL", {
    name: "Scope, electrical", std: "PR00", w: 22, h: 26,
    ports: { S: [0, 13, "S"] },
    body: c => c.path("M 0,-11 L 8,-3 L 0,5 L -8,-3 Z", WHITE) +
      c.path("M 0,-11 L 8,-3 L 0,5 Z", c.col) + c.ln(0, 5, 0, 13)
  });
  T.def("SCOPE_MECHANICAL", {
    name: "Scope, mechanical", std: "PR00", w: 22, h: 26,
    ports: { W: [-11, 0, "W"], E: [11, 0, "E"] },
    /* magenta is PR00's own colour for this mark — the ONE place this pack
       hardcodes a colour, because here the colour IS the symbol */
    body: c => c.ln(0, -13, 0, 13, "3 2") +
      c.path("M -9,-4 L -1,0 L -9,4 Z", "#E5007D") + c.path("M 9,-4 L 1,0 L 9,4 Z", "#E5007D")
  });
  T.def("BATTERY_LIMIT", {
    name: "Battery limit", std: "PR00", w: 24, h: 24,
    ports: { W: [-12, 0, "W"], E: [12, 0, "E"] },
    body: c => c.cir(0, 0, 11, WHITE) + c.txt(0, 3, (c.o && c.o.mark) || "An", 8, 700)
  });
  T.def("SKID_TIE_IN", {
    name: "Skid tie-in", std: "PR00", w: 24, h: 24,
    ports: { W: [-12, 0, "W"], E: [12, 0, "E"] },
    body: c => c.path("M -11,0 L -5.5,-9.5 L 5.5,-9.5 L 11,0 L 5.5,9.5 L -5.5,9.5 Z", WHITE) +
      c.txt(0, 3, (c.o && c.o.mark) || "An", 8, 700)
  });

  /* ── 10 · line styles — the renderer's half of the legend ─────────────────
     PR00 sheet 1 "LINE SYMBOLS" publishes 11 line types. They are NOT symbols
     (nothing to place, no ports), so they are published as a table the
     renderer reads. Kept HERE and not in tam-flow.js so that the legend and
     the drawing cannot drift apart: one source, two consumers. */
  const LINE_STYLES = {
    main_process_line:      { name: "Main process line",      width: 3,   dash: null },
    secondary_process_line: { name: "Secondary process line", width: 1.8, dash: null },
    instrument_line:        { name: "Instrument line",        width: 1,   dash: null },
    pneumatic_signal:       { name: "Pneumatic signal",       width: 1,   dash: null, hatch: "slash" },
    gas_signal:             { name: "Gas signal",             width: 1,   dash: null, mark: "GAS" },
    electric_signal:        { name: "Electric signal",        width: 1,   dash: "5 4" },
    capillary_tube:         { name: "Capillary tube",         width: 1,   dash: null, hatch: "cross" },
    hydraulic_signal:       { name: "Hydraulic signal",       width: 1,   dash: null, hatch: "L" },
    internal_system_link:   { name: "Internal system link",   width: 1,   dash: null, hatch: "circle" },
    tubing_line:            { name: "Tubing line",            width: 1.2, dash: null },
    process_continuation_arrow: { name: "Off-page connector", width: 1.4, dash: null }
  };

  /* ── 11 · the bridges ─────────────────────────────────────────────────────
     THREE tables, in strict precedence, and every result records WHICH ONE
     answered so the audit footer can say how much of the drawing is a guess:

       1 TYPE_MAP   plant_manual_valves.valve_type     ← what the valve IS
       2 INST_MAP   plant_valves.instrument_type       ← what the valve IS
       3 MAP        the tag prefix                     ← who OPERATES it

     Rule G-3 applied to a bridge: a prefix may fill a gap, never overrule a
     stated type. XV alone carries CONTROL VALVE, ON-OFF VALVE and SHUTDOWN
     VALVE rows — the prefix cannot tell them apart and the type can. */

  /* ── 11a · valve_type (manual side) ──────────────────────────────────────
     Values are the live census of 2026-08-05 over plant_manual_valves, lower-
     cased. The compound values ("Gate-SW x Npt") carry the END CONNECTION
     after the dash, which endsOf() strips out and turns into the `ends` flag —
     so "Gate-FL" is a GATE_VALVE drawn with flanges, not a second symbol. */
  const TYPE_MAP = {
    gate: "GATE_VALVE", globe: "GLOBE_VALVE", ball: "BALL_VALVE",
    needle: "NEEDLE_VALVE", butterfly: "BUTTERFLY_VALVE", check: "CHECK_VALVE",
    "angle globe": "ANGLE_VALVE", regulating: "REGULATING_VALVE",
    restriction: "RESTRICTION_ORIFICE", funnel: "DRIP_FUNNEL",
    "3-way changeover": "THREE_WAY_VALVE", changeover: "THREE_WAY_VALVE",
    /* root / manifold / bleed / drain / vent say WHAT THE VALVE IS FOR, not
       what it is. PR00 has no body for "root valve" — it is a globe or a
       needle depending on the hook-up — so they map to the generic body and
       are counted as a gap by audit(). Do NOT guess a globe here: the whole
       point of §11 is that a duty is not a body. */
    root: "VALVE", "instrument root": "VALVE", "gauge root": "VALVE",
    bleed: "VALVE", drain: "VALVE", vent: "VALVE",
    /* the tag-prefix echoes some rows carry in valve_type — no information */
    hv: null, mv: null, hr: null, ck: "CHECK_VALVE"
  };

  /* ── 11b · instrument_type (actuated side) ──────────────────────────────── */
  const INST_MAP = {
    "solenoid valve": "ONOFF_VALVE",              // colour decided by row.system
    "on-off valve": "ONOFF_VALVE",
    "shutdown valve": "SHUTDOWN_VALVE",
    "blowdown valve": "SHUTDOWN_VALVE",
    "control valve": "CONTROL_VALVE",
    "pressure control valve": "CONTROL_VALVE",
    "3-way control valve": "THREE_WAY_VALVE",
    "inlet pressure control valve self-contained": "REG_INLET_SC",
    "outlet pressure control valve self-contained": "REG_OUTLET_SC",
    "pressure safety valve": "RELIEF_VALVE",
    "thermal safety valve": "RELIEF_VALVE",
    "motor operated valve": "MOTOR_VALVE"
  };

  /* ── 11b-bis · valve_class ───────────────────────────────────────────────
     The class is stated data too, and on 1735 rows it is the ONLY stated
     thing: `valve_type` is null and `valve_class` is not. Three of its values
     name a body and therefore outrank the prefix; the rest (MANUAL, MANIFOLD,
     HV, MV, HR) name a DUTY and only set the hand-wheel flag.
       RESTRICTION 32 · CHECK 138 · COV 8  — all of them drew a hand-operated
     gate valve until this table existed, because HR/CK/COV reach the prefix
     map before anything else could contradict it. */
  const CLASS_MAP = { CHECK: "CHECK_VALVE", RESTRICTION: "RESTRICTION_ORIFICE", COV: "THREE_WAY_VALVE" };

  /* ── 11c · the tag prefix — the fallback, and only the fallback ───────────
     ONE flat table, matched longest-prefix-first so SDEV never loses to SD.
     XV/XEV are OPERATING on/off valves (white) since 2026-07-30; yellow is
     reserved for the safety family. A tag that matches nothing draws VALVE —
     the honest answer, "a valve is here and the data does not say which
     kind" — never nothing. */
  const MAP = {
    SDV: "SHUTDOWN_VALVE", SDEV: "SHUTDOWN_VALVE", BDV: "SHUTDOWN_VALVE", BDEV: "SHUTDOWN_VALVE",
    XV: "ONOFF_VALVE", XEV: "ONOFF_VALVE", UV: "SHUTDOWN_VALVE", ESD: "SHUTDOWN_VALVE",
    LEV: "SHUTDOWN_VALVE",
    /* ZEV 76 · PEV 16 — both are SOLENOID VALVE in plant_valves, so the BODY
       is not in doubt; ONOFF_VALVE and SHUTDOWN_VALVE draw the identical
       solenoid body and differ only in fill. Mapping the body therefore
       asserts nothing about safety — the fill comes from fromRow(row.system),
       which is the only place that knows. PEV in particular is ESD on some
       rows and PCS on others. */
    ZEV: "ONOFF_VALVE", PEV: "ONOFF_VALVE",
    /* added 2026-08-05 from the prefix census — 8 tags that drew a bare body:
       SV 2 · CEV 1 · PEVH 1 · PEVL 1 (all SOLENOID VALVE in the row) */
    SV: "ONOFF_VALVE", CEV: "ONOFF_VALVE", PEVH: "ONOFF_VALVE", PEVL: "ONOFF_VALVE",
    FV: "CONTROL_VALVE", PV: "CONTROL_VALVE", LV: "CONTROL_VALVE", TV: "CONTROL_VALVE",
    FCV: "CONTROL_VALVE", PCV: "CONTROL_VALVE", LCV: "CONTROL_VALVE", TCV: "CONTROL_VALVE",
    FEV: "CONTROL_VALVE", HIC: "CONTROL_VALVE", CV: "CONTROL_VALVE",
    PSV: "RELIEF_VALVE", TSV: "RELIEF_VALVE", VSV: "RELIEF_VALVE", RV: "RELIEF_VALVE",
    PSE: "RUPTURE_DISC",                     // PSE = the disc, not the valve
    RD: "RUPTURE_DISC", RO: "RESTRICTION_ORIFICE",
    NRV: "CHECK_VALVE", CKV: "CHECK_VALVE",
    /* CK and HR: the pack knew the generic names NRV/CKV, which this plant
       does not use, and missed the two prefixes it actually writes — 215 CK
       check valves and 144 HR manual valves. skills/pid-extraction/SKILL.md
       defines the manual family as HV hand · MV manifold/root · HR · CK. */
    CK: "CHECK_VALVE",
    /* COV — 10 changeover valves between PSV pairs. v0.4.0 declared this an
       honest gap because the pack had no 3-way body. THREE_WAY_VALVE closes
       it: the third port is now drawn, which is what a relief changeover is. */
    COV: "THREE_WAY_VALVE",
    HV: "GATE_VALVE", MV: "GATE_VALVE", HR: "GATE_VALVE", GV: "GATE_VALVE", BV: "BALL_VALVE"
  };
  const PREFIXES = Object.keys(MAP).sort((a, b) => b.length - a.length);   // longest first

  /* the hand-wheel is a DUTY, not a body — these prefixes are hand-operated
     whatever body the type turns out to be, which is how a `ball` HV comes out
     as a ball body WITH a hand-wheel instead of as a gate valve */
  const HAND_PREFIX = { HV: 1, MV: 1, HR: 1, GV: 1, BV: 1 };

  /* THE AREA PREFIX HAS TO COME OFF FIRST — defect found 2026-08-05.
     Tendrara writes a valve tag BOTH ways and the database holds both:
       521 tags bare          SDV-2001 · PSV-2001A · XV-2203
       2648 tags area-first   100-HV-001 · 220-COV-2251 · 200-HR-001
     Matching the raw string only ever caught the bare form, so 84% of the
     plant's valves — every one of the 1888 HV hand valves included — fell
     through to the generic VALVE body and drew with no hand-wheel at all. */
  const stripArea = t => t.replace(/^[0-9]+-/, "");

  const prefixOf = tag => {
    const t = stripArea(String(tag || "").trim().toUpperCase());
    return PREFIXES.find(p => t.startsWith(p + "-") || t === p) || null;
  };
  const valveKind = tag => { const p = prefixOf(tag); return p ? MAP[p] : "VALVE"; };
  const isEsd = tag => valveKind(tag) === "SHUTDOWN_VALVE";

  /* endsOf — "Gate-SW x Npt" → 'SW'. The end connection is written INTO the
     type string on ~40 rows and nowhere else, so this is the only place it can
     be recovered from. Returns null when the string says nothing: an absent
     connection must not become a drawn flange (G-3). */
  function endsOf(type) {
    const t = String(type || "").toUpperCase();
    if (/\bFL\b|FLANGE/.test(t)) return "FL";
    if (/\bSW\b|SOCKET/.test(t)) return "SW";
    if (/\bBW\b|BUTT/.test(t)) return "BW";
    if (/\bNPT\b|SCREW|THREAD/.test(t)) return "SCR";
    return null;
  }

  /* typeKind — valve_type or instrument_type → symbol kind, or null when the
     string names a duty rather than a body. The dash suffix is stripped first
     so "Globe-SW x Npt" and "globe" reach the same entry. */
  function typeKind(type) {
    const raw = String(type || "").trim().toLowerCase();
    if (!raw) return null;
    if (INST_MAP[raw]) return INST_MAP[raw];
    if (Object.prototype.hasOwnProperty.call(TYPE_MAP, raw)) return TYPE_MAP[raw];
    const base = raw.split("-")[0].trim();                   // "gate-sw x npt" → "gate"
    if (Object.prototype.hasOwnProperty.call(TYPE_MAP, base)) return TYPE_MAP[base];
    return null;
  }

  /* fromRow — THE BRIDGE TO PREFER when you have the database row.
     ─────────────────────────────────────────────────────────────────────────
     WHY fromTag IS NOT ENOUGH, twice over

     1 · THE BODY. The plant writes 1904 `HV` tags and the row says what they
         are: 179 ball · 159 gate · 132 globe · 99 needle · 8 butterfly. Read
         off the prefix they are 1904 gate valves, which is a drawing that
         disagrees with the valve list it was built from.

     2 · THE COLOUR. The solenoid families are NOT cleanly split by prefix:

           XEV  83  system = PCS            operating
           ZEV  76  system = PCS            operating
           SDEV 16  system = ESD            safety
           PEV  16  system = ESD  AND  PCS  ← both, row by row
           LEV   8  system = ESD  AND  PCS  ← both
           FEV   4  system = ESD  AND  PCS  ← both

         A PEV is yellow or white depending on WHICH PEV, and only the row
         knows. Colouring from the prefix paints 28 valves the wrong colour —
         and the wrong colour here means a trainee reads an operating valve as
         a trip, which is the one confusion these shapes exist to prevent.

     `row` is a plant_valves / plant_manual_valves row. Precedence:
       kind   = instrument_type | valve_type  →  tag prefix  →  VALVE
       colour = system                        →  prefix guess
       ends   = the connection written into the type string, else nothing
       hand   = HV/MV/HR/GV/BV, or valve_class = MANUAL
     Every one of those records its provenance in opts, because the audit
     footer has to be able to say how much of the drawing is a guess. */
  function fromRow(row, o) {
    row = row || {};
    const r = fromTag(row.tag, o);

    /* 1 · the body — stated type, then stated class, then the prefix guess */
    const stated = typeKind(row.instrument_type || row.valve_type);
    const cls0 = String(row.valve_class || "").toUpperCase();
    if (stated) { r.kind = stated; r.opts.kindSource = "type"; }
    else if (CLASS_MAP[cls0]) { r.kind = CLASS_MAP[cls0]; r.opts.kindSource = "class"; }
    else r.opts.kindSource = prefixOf(row.tag) ? "prefix" : "none";

    /* 2 · the safety colour — from the row's system column when it has one */
    if (row.system) {
      const esd = String(row.system).trim().toUpperCase() === "ESD";
      r.opts.esd = esd;
      r.opts.color = esd ? ESD_INK : "#333";
      r.opts.esdSource = "system";
    } else {
      r.opts.esd = (r.kind === "SHUTDOWN_VALVE");
      r.opts.color = r.opts.esd ? ESD_INK : "#333";
      r.opts.esdSource = "prefix";              // a guess, and it says so
    }

    /* 3 · the hand-wheel — a duty, so it survives whatever body won above */
    const cls = String(row.valve_class || "").toUpperCase();
    if (HAND_PREFIX[prefixOf(row.tag)] || cls === "MANUAL" || cls === "MANIFOLD") r.opts.hand = true;

    /* 4 · the end connection, only if the data actually stated one */
    const e = endsOf(row.valve_type || row.instrument_type);
    if (e) r.opts.ends = e;

    /* keep the title honest about which layer answered */
    r.opts.title = (o && o.title) || (T.spec(r.kind).name + " " + String(row.tag || "").trim() +
      (r.opts.kindSource === "type" ? "" : " · body from tag prefix"));
    return r;
  }

  /* fromTag — everything the renderer needs in one call, so a caller never has
     to know that ESD means yellow or that a PSV is an angle body.
     Prefer fromRow() when the database row is in hand — see above. */
  function fromTag(tag, o) {
    o = o || {};
    const p = prefixOf(tag);
    const kind = p ? MAP[p] : "VALVE", esd = kind === "SHUTDOWN_VALVE";
    return {
      kind,
      opts: Object.assign({
        label: o.label !== false ? String(tag || "").trim() : null,
        esd,
        hand: !!HAND_PREFIX[p],
        color: esd ? ESD_INK : "#333",
        strokeWidth: 1.4,
        kindSource: p ? "prefix" : "none",
        title: (o.title || "") || (T.spec(kind).name + " " + String(tag || "").trim())
      }, o)
    };
  }

  /* ── 11d · audit ──────────────────────────────────────────────────────────
     The same shape as the network pack's audit(): hand it the rows and it
     answers the only question that matters before a diagram ships — how much
     of what is about to be drawn is actually stated by the data, and how much
     is the prefix guessing. A drawing that cannot answer this has no business
     being printed. G-4: the gap is the deliverable, not the pass rate. */
  function audit(rows) {
    const out = {
      total: 0, byKind: {}, bySource: { type: 0, class: 0, prefix: 0, none: 0 },
      colourFromSystem: 0, colourGuessed: 0, generic: [], unmappedTypes: {}
    };
    (rows || []).forEach(row => {
      out.total++;
      const r = fromRow(row);
      out.byKind[r.kind] = (out.byKind[r.kind] || 0) + 1;
      out.bySource[r.opts.kindSource] = (out.bySource[r.opts.kindSource] || 0) + 1;
      if (r.opts.esdSource === "system") out.colourFromSystem++; else out.colourGuessed++;
      if (r.kind === "VALVE") out.generic.push(row.tag);
      const t = row.instrument_type || row.valve_type;
      if (t && !typeKind(t)) out.unmappedTypes[t] = (out.unmappedTypes[t] || 0) + 1;
    });
    return out;
  }

  /* ── 12 · the PROCESS TAG (off-page connector) ────────────────────────────
     WHAT IT IS, AND WHY IT IS WORTH A SYMBOL
     A plant diagram spends most of its ink on lines that leave the sheet. Draw
     them as lines and two things go wrong: the router has to carry a run
     across the whole drawing to reach a box that exists only to be a
     destination, and the reader has to follow it. Every P&ID solves this the
     same way — an OFF-PAGE CONNECTOR: a pennant carrying WHERE the line goes
     and WHICH DRAWING continues it.

     This is the client's own convention, read off PRO13-ING-PR50 rev 5 and
     published on PR00 sheet 1 as "P&ID PROCESS CONTINUATION ARROW": a
     rectangle with a chevron point in the direction of flow, two lines of text
     (destination, then line number / document), and a hexagon holding the
     one-letter connector tag that pairs the two sheets.

     WHY IT MATTERS BEYOND THIS SHEET
     Once a destination can be a TAG instead of a BOX, the layout algorithm
     stops having to reserve a lane and a box for every secondary stream. The
     ordering gets easier because there is less to order — which is exactly why
     the standard has this symbol.

     API
       TamSymProc.offPage(x, y, o) → SVG string
         o.dir    'out' — the pipe ARRIVES at the flat end (default)
                  'in'  — the pipe LEAVES from the point
                  In BOTH cases the chevron points the way the fluid goes; only
                  the anchor moves. A pennant pointing backwards on an inlet is
                  the commonest off-page mistake there is.
         o.rot    90 hangs the tag downwards, -90 upwards.
         o.title  destination, e.g. "TO U530 · process water"
         o.sub    line number and/or continuation document
         o.tag    the one-letter connector, drawn in a hexagon (optional)
         o.color  the service colour — from plant_service_classes, never here
         o.w      box width (default sized from the text)
     The caller draws the pipe up to `x`; the flat end lands there. */
  function offPage(x, y, o) {
    o = o || {};
    const dir = o.dir === "in" ? "in" : "out";
    const col = o.color || "#333";
    const title = String(o.title || ""), sub = String(o.sub || "");
    const w = o.w || Math.max(78, 7 + 4.75 * Math.max(title.length, sub.length * 0.92));
    const h = sub ? 26 : 18, pt = 9;
    const esc2 = T.esc;
    /* the chevron ALWAYS points downstream; 'in' simply hangs the shape back so
       its point lands on the anchor and the pipe carries on from there */
    const x0 = dir === "out" ? x : x - w - pt;
    const d = `M ${x0},${y - h / 2} L ${x0 + w},${y - h / 2} L ${x0 + w + pt},${y} ` +
              `L ${x0 + w},${y + h / 2} L ${x0},${y + h / 2} Z`;
    const tx = x0 + 6;
    const rot = +o.rot || 0;
    let s = `<g${rot ? ` transform="rotate(${rot},${x},${y})"` : ""}>` +
      `<title>${esc2(title + (sub ? " · " + sub : ""))}</title>` +
      `<path d="${d}" fill="#fff" stroke="${col}" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<text x="${tx}" y="${y + (sub ? -2 : 3)}" font-family="Consolas,monospace" font-size="7.6" font-weight="700" fill="${col}">${esc2(title)}</text>`;
    if (sub) s += `<text x="${tx}" y="${y + 8}" font-family="Consolas,monospace" font-size="6.4" fill="#4A4F57">${esc2(sub)}</text>`;
    if (o.tag) {
      /* the hexagon sits BEYOND the point, the way the client's sheets draw it:
         it belongs to the PAIR of drawings, not to this one */
      const hx = x0 + w + pt + 13, r = 9;
      s += `<path d="M ${hx - r},${y} L ${hx - r / 2},${y - r * 0.87} L ${hx + r / 2},${y - r * 0.87} ` +
        `L ${hx + r},${y} L ${hx + r / 2},${y + r * 0.87} L ${hx - r / 2},${y + r * 0.87} Z" fill="#fff" stroke="${col}" stroke-width="1.2"/>` +
        `<text x="${hx}" y="${y + 3}" text-anchor="middle" font-family="Consolas,monospace" font-size="8" font-weight="700" fill="${col}">${esc2(o.tag)}</text>`;
    }
    return s + `</g>`;
  }
  /* registry entry so the self-generating legend can show it (G-7) */
  T.def("OFFPAGE_TAG", {
    name: "Off-page connector", std: "ISO 10628 / client PR50", w: 30, h: 16,
    ports: { W: [-15, 0, "W"] },
    body: c => c.path("M -15,-8 L 8,-8 L 15,0 L 8,8 L -15,8 Z", "#fff")
  });

  /* ── 13 · LEGEND_MAP — the pack answering to the legend, row by row ───────
     `plant_pid_legend.code` → the kind this pack draws for it, for the eight
     GRAPHIC categories. This is the audit surface for "is the library
     finished?": anything mapped to null is a legend row the pack cannot draw
     yet, and the demo sheet prints the count. Never delete an entry to make
     the number look better — that is the one move this table exists to stop. */
  const LEGEND_MAP = {
    /* valve_symbol (24) */
    gate: "GATE_VALVE", globe: "GLOBE_VALVE", ball: "BALL_VALVE", butterfly: "BUTTERFLY_VALVE",
    needle: "NEEDLE_VALVE", check: "CHECK_VALVE", "3way_gate": "THREE_WAY_VALVE",
    "4way_gate": "FOUR_WAY_VALVE", psv_trv: "RELIEF_VALVE", restriction_orifice: "RESTRICTION_ORIFICE",
    sight_glass: "SIGHT_GLASS", y_strainer: "Y_STRAINER", t_strainer: "T_STRAINER",
    angle_strainer: "ANGLE_STRAINER", flexible_hoses: "FLEX_HOSE", diaphragm_seal: "DIAPHRAGM_SEAL",
    automatic_drain: "AUTO_DRAIN", two_way_block_bleed: "BLOCK_BLEED_2W",
    three_way_block_bleed: "BLOCK_BLEED_3W", five_way_block_bleed_plugs: "BLOCK_BLEED_5W",
    refr_globe_straight: "GLOBE_VALVE", refr_globe_angle: "ANGLE_VALVE",
    man_reg_straight_refr: "REGULATING_VALVE", man_reg_angle_refr: "REGULATING_ANGLE_VALVE",
    /* control_valve (15) */
    diaphragm_cv: "CONTROL_VALVE", diaphragm_cv_positioner: "CONTROL_VALVE_POS",
    "2way_solenoid": "ONOFF_VALVE", "3way_pilot_solenoid": "SOLENOID_3W",
    motor_actuated: "MOTOR_VALVE", rotary_motor_actuated: "ROTARY_MOTOR_VALVE",
    piston_spring_return: "PISTON_VALVE", pneumatic_relay: "PNEU_RELAY_VALVE",
    inlet_pressure_regulator: "REG_INLET_SC", inlet_pressure_regulator_sc: "REG_INLET_SC",
    outlet_pressure_regulator: "REG_OUTLET_SC", outlet_pressure_regulator_sc: "REG_OUTLET_SC",
    diff_pressure_regulator_sc: "REG_DP_SC",
    air_lubricator: "AIR_LUBRICATOR", air_regulator: "AIR_REGULATOR",
    /* specialty_valve (6) */
    four_way_hyd_pilot: "FOURWAY_HYD_PILOT", four_way_hyd_direct: "FOURWAY_HYD_DIRECT",
    float_expansion: "FLOAT_EXPANSION_VALVE", unidirectional_flow_control: "UNIDIR_FLOW_CONTROL",
    /* insulation is a LINE decoration, not a symbol — the renderer's hatch */
    piping_insulation: null, vessel_insulation: null,
    /* misc_symbol (19) */
    ejector: "EJECTOR", basket_strainer: "BASKET_STRAINER", bucket_strainer: "BUCKET_STRAINER",
    conical_strainer: "CONICAL_STRAINER", atmospheric_seal_drain_pot: "SEAL_DRAIN_POT",
    drip_funnel: "DRIP_FUNNEL", level_reference_inside: "LEVEL_REFERENCE",
    rupture_disc_pressure: "RUPTURE_DISC", rupture_disc_vacuum: "RUPTURE_DISC_VACUUM",
    spectacle_blind_open: "SPECTACLE_BLIND", spectacle_blind_closed: "SPECTACLE_BLIND",
    six_ports_transfer_valve: "SIX_PORT_TRANSFER_VALVE", battery_limit: "BATTERY_LIMIT",
    skid_interconnecting_tie_in: "SKID_TIE_IN", piping_material_class_change: "SPEC_CHANGE",
    scope_of_supply: "SCOPE_BREAK", scope_electrical: "SCOPE_ELECTRICAL",
    scope_mechanical: "SCOPE_MECHANICAL",
    /* equipment_elevation is an annotation with a dimension line — renderer */
    equipment_elevation: null,
    /* fitting (12) */
    blind_flange: "BLIND_FLANGE", blind_flange_plug: "BLIND_FLANGE_PLUG", cap: "PIPE_CAP",
    threaded_cap: "THREADED_CAP", threaded_plug: "THREADED_PLUG",
    concentric_reducer: "CONCENTRIC_REDUCER", eccentric_reducer: "ECCENTRIC_REDUCER",
    spool_piece: "SPOOL_PIECE", weldolet: "WELDOLET", threadolet: "THREADOLET",
    socklet: "SOCKOLET", slope: "PIPE_SLOPE",
    /* pump (3) */
    centrifugal: "PUMP_CENTRIFUGAL", volumetric: "PUMP_VOLUMETRIC", diaphragm: "PUMP_DIAPHRAGM",
    /* connection (4) — flags on a body, never symbols (G-5) */
    screwed: "flag:ends=SCR", flanged: "flag:ends=FL",
    socket_weld: "flag:ends=SW", butt_weld: "flag:ends=BW",
    /* line_symbol (11) — LINE_STYLES, consumed by the renderer */
    main_process_line: "line", secondary_process_line: "line", instrument_line: "line",
    pneumatic_signal: "line", gas_signal: "line", electric_signal: "line",
    capillary_tube: "line", hydraulic_signal: "line", internal_system_link: "line",
    tubing_line: "line", process_continuation_arrow: "OFFPAGE_TAG"
  };

  const API = {
    valveKind, isEsd, fromTag, fromRow, typeKind, endsOf, audit, offPage,
    MAP, TYPE_MAP, INST_MAP, CLASS_MAP, LEGEND_MAP, LINE_STYLES, HAND_PREFIX,
    A, B, ESD_FILL, ESD_INK, version: "0.5.0"
  };
  const root = (typeof window !== "undefined") ? window : globalThis;
  root.TamSymProc = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
