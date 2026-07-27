/* ═══════════════════════════════════════════════════════════════════════════
   tam-sym-proc.js — PROCESS symbol pack  ·  v0.1.0
   ─────────────────────────────────────────────────────────────────────────
   Phase 5 of GRAPHICS_LIBRARY_PLAN.md, brought forward because the process
   diagrams were drawing every valve as a ROTATED SQUARE (tam-flow `diamond()`).

   WHY THIS EXISTS — the defect it fixes
     A rotated square is not a process valve. In ISO 10628-2 (flow diagrams for
     process plants) and ISO 14617-8 (valves and dampers) the valve BODY is the
     bow-tie: two triangles meeting apex-to-apex ON the pipe axis. What the
     valve DOES is carried by the actuator drawn above it:

       diaphragm dome   → modulating control valve   FV · PV · LV · TV
       solenoid box     → on/off ESD valve           SDV · BDV · XV · UV
       hand-wheel bar   → manual valve               HV · MV
       spring zig-zag   → pressure relief            PSV · TSV

     A diamond says "a valve of some sort is here". A bow-tie plus its actuator
     says WHICH valve and HOW IT MOVES — and on a training slide that is the
     whole point: the trainee has to tell an ESD valve from a control valve at a
     glance, because one of them closes on him and the other one modulates.

   THE OTHER HALF OF THE FIX IS NOT IN THIS FILE
     A valve is INSERTED IN the line, it is not laid ON TOP of it. The line has
     to break at the valve's ports. That is a router concern, so it lives in
     tam-flow.js `procLine()` — this pack only guarantees the contract that
     makes it possible: EVERY valve exposes ports W and E ON THE PIPE AXIS
     (y = 0), whatever the actuator does above.

   ISO NOTE — same rule as the electrical pack
     ISO 10628 / ISO 14617 are licensed standards and are NOT redistributed.
     Every shape here is drawn from primitives (lines, arcs, triangles) against
     the published shape descriptions, the way any CAD template is built.
     Nothing is copied from a paywalled asset set.

   API
     TamSymProc.valveKind(tag)  → symbol kind for a plant tag ("SDV-2024" → SHUTDOWN_VALVE)
     TamSymProc.fromTag(tag)    → {kind, opts} ready for TamSym.draw()
     TamSymProc.isEsd(tag)      → boolean (the yellow family)
     TamSymProc.MAP             → the prefix table, one flat object, editable

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

  /* the bow-tie: two closed triangles apex-to-apex on the pipe axis.
     Drawn as two separate paths, never one, so the apex stays a clean point. */
  const bowtie = (c, fill) =>
    c.path(`M ${-A},${-B} L ${-A},${B} L 0,0 Z`, fill) +
    c.path(`M ${A},${-B} L ${A},${B} L 0,0 Z`, fill);

  /* fill follows the ESD flag, not the symbol — G-5: orthogonal property = flag */
  const bodyFill = c => (c.o && c.o.esd) ? ESD_FILL : WHITE;
  const PORTS_INLINE = { W: [-A, 0, "W"], E: [A, 0, "E"] };

  /* ── 1 · the valve family ─────────────────────────────────────────────── */

  /* generic — a valve whose type we do NOT know. G-4: a gap must be visible,
     so this is a bare body: no actuator claimed that the data does not have. */
  T.def("VALVE", {
    name: "Valve", std: "ISO 14617-8", w: 2 * A, h: HP, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c))
  });

  /* modulating control valve — diaphragm actuator (the dome).
     The dome is a half-ellipse CLOSED on its base line, which is what makes it
     read as a diaphragm chamber rather than an arc. */
  T.def("CONTROL_VALVE", {
    name: "Control valve", std: "ISO 14617-8 / diaphragm", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) +
      c.ln(0, 0, 0, -13) +
      c.path("M -7,-13 A 7,5.5 0 0 1 7,-13 Z", bodyFill(c))
  });

  /* on/off ESD valve — solenoid box with its diagonal, spring-return stroke.
     The diagonal is the solenoid mark; the short bar under the box is the
     spring that returns the valve to its fail position when power is lost. */
  T.def("SHUTDOWN_VALVE", {
    name: "Shutdown valve (ESD)", std: "ISO 14617-8 / solenoid", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) +
      c.ln(0, 0, 0, -11) +
      c.rect(-6, -18.5, 12, 7.5, bodyFill(c)) +
      c.ln(-6, -11, 6, -18.5)
  });

  /* manual valve — hand-wheel seen edge-on (the bar) on a rising stem */
  T.def("GATE_VALVE", {
    name: "Manual valve", std: "ISO 14617-8 / hand", w: 2 * A, h: HB, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + c.ln(0, 0, 0, -10) + c.ln(-6.5, -10, 6.5, -10)
  });

  T.def("BALL_VALVE", {
    name: "Ball valve", std: "ISO 14617-8", w: 2 * A, h: HP, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) + c.cir(0, 0, 3.4, WHITE)
  });

  /* check valve — the seat bar on the OUTLET side is what says "one way".
     No actuator: a check valve is moved by the fluid, not by a signal. */
  T.def("CHECK_VALVE", {
    name: "Check valve", std: "ISO 14617-8", w: 2 * A, h: HP, ports: PORTS_INLINE,
    body: c => bowtie(c, bodyFill(c)) +
      `<line x1="${A}" y1="${-B - 1}" x2="${A}" y2="${B + 1}" stroke="${c.col}" stroke-width="${c.sw * 1.7}" stroke-linecap="round"/>`
  });

  /* pressure relief — ANGLE body: inlet from below, outlet to the side, spring
     on top. The angle is not decoration: a PSV is not an in-line device and
     drawing it in-line is how people end up thinking it is one. */
  T.def("RELIEF_VALVE", {
    name: "Relief valve (PSV)", std: "ISO 14617-8 / spring", w: 2 * A, h: HB,
    ports: { S: [0, B + 2.5, "S"], E: [A, 0, "E"] },
    body: c => c.path(`M ${-B},${B + 2.5} L ${B},${B + 2.5} L 0,0 Z`, bodyFill(c)) +
      c.path(`M ${A},${-B} L ${A},${B} L 0,0 Z`, bodyFill(c)) +
      c.ln(0, 0, 0, -8) +
      c.path("M -4,-8 L 4,-10 L -4,-12 L 4,-14 L -4,-16", "none")
  });

  /* ── 2 · in-line devices that are not valves ──────────────────────────── */

  /* rupture disc — the dome faces the pressure it protects against */
  T.def("RUPTURE_DISC", {
    name: "Rupture disc", std: "ISO 14617-8", w: 2 * A, h: HP, ports: PORTS_INLINE,
    body: c => c.ln(0, -B - 1, 0, B + 1) + c.path(`M 0,${-B - 1} A 8,8 0 0 1 0,${B + 1}`, "none")
  });

  /* restriction orifice — the plate, drawn as the pair of bars it is */
  T.def("RESTRICTION_ORIFICE", {
    name: "Restriction orifice", std: "ISO 14617-8", w: 2 * A, h: HP, ports: PORTS_INLINE,
    body: c => c.ln(-2.5, -B - 1, -2.5, B + 1) + c.ln(2.5, -B - 1, 2.5, B + 1)
  });

  /* ── 3 · the bridge: plant tag → symbol ───────────────────────────────────
     ONE flat table, ordered longest-prefix-first at match time so SDEV never
     loses to SD. A tag that matches nothing draws VALVE — the honest answer,
     "a valve is here and the data does not say which kind" — never nothing. */
  const MAP = {
    SDV: "SHUTDOWN_VALVE", SDEV: "SHUTDOWN_VALVE", BDV: "SHUTDOWN_VALVE", BDEV: "SHUTDOWN_VALVE",
    XV: "SHUTDOWN_VALVE", XEV: "SHUTDOWN_VALVE", UV: "SHUTDOWN_VALVE", ESD: "SHUTDOWN_VALVE",
    FV: "CONTROL_VALVE", PV: "CONTROL_VALVE", LV: "CONTROL_VALVE", TV: "CONTROL_VALVE",
    FCV: "CONTROL_VALVE", PCV: "CONTROL_VALVE", LCV: "CONTROL_VALVE", TCV: "CONTROL_VALVE",
    FEV: "CONTROL_VALVE", HIC: "CONTROL_VALVE",
    PSV: "RELIEF_VALVE", TSV: "RELIEF_VALVE", VSV: "RELIEF_VALVE", RV: "RELIEF_VALVE",
    RD: "RUPTURE_DISC", RO: "RESTRICTION_ORIFICE",
    NRV: "CHECK_VALVE", CKV: "CHECK_VALVE",
    HV: "GATE_VALVE", MV: "GATE_VALVE", GV: "GATE_VALVE", BV: "BALL_VALVE"
  };
  const PREFIXES = Object.keys(MAP).sort((a, b) => b.length - a.length);   // longest first

  const prefixOf = tag => {
    const t = String(tag || "").trim().toUpperCase();
    return PREFIXES.find(p => t.startsWith(p + "-") || t === p) || null;
  };
  const valveKind = tag => { const p = prefixOf(tag); return p ? MAP[p] : "VALVE"; };
  const isEsd = tag => valveKind(tag) === "SHUTDOWN_VALVE";

  /* fromTag — everything the renderer needs in one call, so a caller never has
     to know that ESD means yellow or that a PSV is an angle body. */
  function fromTag(tag, o) {
    o = o || {};
    const kind = valveKind(tag), esd = kind === "SHUTDOWN_VALVE";
    return {
      kind,
      opts: Object.assign({
        label: o.label !== false ? String(tag || "").trim() : null,
        esd,
        color: esd ? ESD_INK : "#333",
        strokeWidth: 1.4,
        title: (o.title || "") || (T.spec(kind).name + " " + String(tag || "").trim())
      }, o)
    };
  }

  const API = { valveKind, isEsd, fromTag, MAP, A, B, ESD_FILL, ESD_INK, version: "0.1.0" };
  const root = (typeof window !== "undefined") ? window : globalThis;
  root.TamSymProc = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
