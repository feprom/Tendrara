/* ═══════════════════════════════════════════════════════════════════════════
   tam-sym-elec.js — ELECTRICAL symbol pack for tam-sym.js
   ─────────────────────────────────────────────────────────────────────────
   34 IEC-style single-line symbols. Geometry only: no renderer, no layout,
   no data loading. Requires tam-sym.js to be loaded first.

   CONVENTIONS THE WHOLE PACK OBEYS
     · Symbol origin is (0,0) at the CENTRE of the object.
     · Every in-line device has port A at the top (y = −h/2) and port B at the
       bottom (y = +h/2), so a conductor router never inspects a symbol.
     · A device that can be OPEN draws its moving contact at 30° when open and
       vertical when closed. `stateful:true` marks those.
     · Nothing here reads the database. The mapping from a DB row to a kind
       lives in ELEC_MAP at the bottom — one table, easy to audit.

   IEC 60617 form vs. the square-breaker shorthand
     The IEC form of a circuit breaker is a disconnector blade with a cross on
     the fixed contact — NOT a square. Phase 11's `sldGlyph()` used a square
     for every switching device, which is common utility shorthand but loses
     the breaker / disconnector / switch-disconnector / contactor distinction
     that the protection schedule actually carries. Both are provided:
       CIRCUIT_BREAKER          IEC form (default)
       CIRCUIT_BREAKER_BOX      the square shorthand, for compatibility
     Which one the viewer uses is a display option, not a data change.

   MOTOR-OPERATED MECHANISM
     Any switching device can carry a motor operator by passing
     `{ motorized:true }` — it draws the IEC mechanical-link dashes to a small
     M box. That is why `.212`-class motorised load-break switches do not need
     their own symbol: they are SWITCH_DISCONNECTOR + motorized.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const T = (typeof window !== "undefined" ? window : globalThis).TamSym;
  if (!T) throw new Error("tam-sym-elec.js: load tam-sym.js first");
  const def = T.def;

  /* ── shared geometry ──────────────────────────────────────────────────── */
  const H = 26;                       // standard in-line device height
  const TOP = -H / 2, BOT = H / 2;
  const PORTS_AB = { A: [0, TOP, "N"], B: [0, BOT, "S"] };

  /* the moving contact: vertical when closed, 30° when open.
     `pivot` is the bottom fixed contact; the blade reaches toward the top. */
  function tipOf(c, len) {
    const L = len || 15, y0 = BOT - 3;
    return { x: c.open ? L * 0.5 : 0, y: y0 - L * (c.open ? 0.87 : 1), x0: 0, y0: y0 };
  }
  function blade(c, len) {
    const t = tipOf(c, len);
    return c.ln(t.x0, t.y0, t.x, t.y) + c.dot(t.x0, t.y0, 1.8);
  }
  /* stub conductors from the ports to the contacts */
  const stubs = c => c.ln(0, TOP, 0, TOP + 3) + c.ln(0, BOT, 0, BOT - 3);
  const fixedTop = c => c.dot(0, TOP + 3, 1.8);

  /* motor operator: mechanical link (dashed, IEC) to a small M box */
  function motor(c) {
    if (!c.o || !c.o.motorized) return "";
    return c.ln(2, 0, 11, 0, "2 2") + c.rect(11, -5.5, 11, 11, "#fff") +
      c.txt(16.5, 3.6, "M", 8, 700);
  }
  /* the arc-quench mark that makes a disconnector a LOAD-break switch */
  const arcChute = c => c.path(`M-4,${TOP + 3} A4,4 0 0 0 4,${TOP + 3}`);

  /* ══ 1. STRUCTURE ══════════════════════════════════════════════════════ */

  def("BUSBAR", {
    name: "Busbar", std: "IEC 60617-03", w: 120, h: 8,
    ports: { L: [-60, 0, "W"], R: [60, 0, "E"], C: [0, 0, "S"] },
    body: c => `<line x1="-60" y1="0" x2="60" y2="0" stroke="${c.col}" stroke-width="4" stroke-linecap="round"/>`
  });

  def("BUSBAR_INVERTER", {
    name: "Inverter busbar", w: 120, h: 8,
    ports: { L: [-60, 0, "W"], R: [60, 0, "E"], C: [0, 0, "S"] },
    body: c => `<line x1="-60" y1="0" x2="60" y2="0" stroke="${c.col}" stroke-width="4" ` +
      `stroke-dasharray="10 4" stroke-linecap="round"/>`
  });

  def("SWITCHBOARD", {
    name: "Switchboard", w: 40, h: 26,
    ports: { A: [0, -13, "N"], B: [0, 13, "S"] },
    body: c => c.rect(-20, -13, 40, 26, "#fff", "", 2) + c.rect(-16, -9, 32, 18, "none", "2 2")
  });

  def("MCC_PANEL", {
    name: "MCC / local panel", w: 34, h: 26,
    ports: { A: [0, -13, "N"], B: [0, 13, "S"] },
    body: c => c.rect(-17, -13, 34, 26, "#fff", "", 2) +
      c.ln(-17, -5, 17, -5) + c.ln(-17, 3, 17, 3)
  });

  def("SPARE", {
    name: "Spare position", w: 20, h: H,
    ports: PORTS_AB,
    body: c => c.rect(-10, -10, 20, 20, "#fff", "3 3", 2)
  });

  /* ══ 2. SWITCHING & PROTECTION ═════════════════════════════════════════ */

  def("CIRCUIT_BREAKER", {
    name: "Circuit breaker", std: "IEC 60617-07", w: 24, h: H, stateful: true,
    ports: PORTS_AB,
    body: c => stubs(c) + fixedTop(c) + blade(c) + motor(c) +
      /* the cross on the fixed contact is what makes it a BREAKER */
      c.ln(-3.5, TOP - 0.5, 3.5, TOP + 6.5) + c.ln(3.5, TOP - 0.5, -3.5, TOP + 6.5)
  });

  def("CIRCUIT_BREAKER_BOX", {
    name: "Breaker (square)", w: 20, h: 20, stateful: true,
    ports: { A: [0, -10, "N"], B: [0, 10, "S"] },
    /* MIMIC CONVENTION: the square is FILLED when the breaker is closed and
       HOLLOW when it is open. That is how every switchgear mimic panel and
       SCADA one-line reads, and it is why the square shorthand survives at
       all — it carries state at a glance from across a control room.
       Fill colour is the STATE colour, so a tripped breaker reads solid red.
       With no state bound the symbol draws DESIGN = solid ink: the schedule
       says the position exists, not that it is open. */
    body: c => c.rect(-10, -10, 20, 20, c.open ? "#fff" : c.col, "", 1)
  });

  def("ACB_DRAWOUT", {
    name: "ACB, withdrawable", w: 26, h: H, stateful: true,
    ports: PORTS_AB,
    body: c => stubs(c) + fixedTop(c) + blade(c) + motor(c) +
      c.ln(-3.5, TOP - 0.5, 3.5, TOP + 6.5) + c.ln(3.5, TOP - 0.5, -3.5, TOP + 6.5) +
      /* withdrawable: the two racking chevrons, one per isolating contact */
      c.path(`M-9,${TOP + 1} l4,3.5 l-4,3.5`) + c.path(`M9,${BOT - 1} l-4,-3.5 l4,-3.5`)
  });

  def("DISCONNECTOR", {
    name: "Disconnector", std: "IEC 60617-07", w: 22, h: H, stateful: true,
    ports: PORTS_AB,
    body: c => stubs(c) + fixedTop(c) + blade(c) + motor(c)
  });

  def("SWITCH_DISCONNECTOR", {
    name: "Switch-disconnector", std: "IEC 60617-07", w: 22, h: H, stateful: true,
    ports: PORTS_AB,
    /* load-break capability = the arc-quench chute on the fixed contact */
    body: c => stubs(c) + fixedTop(c) + blade(c) + arcChute(c) + motor(c)
  });

  def("GENERAL_SWITCH", {
    name: "General switch", w: 22, h: H, stateful: true,
    ports: PORTS_AB,
    body: c => stubs(c) + fixedTop(c) + blade(c) + motor(c)
  });

  /* CONTACTOR — full IEC 60617-07 form: N.O. contact + operating coil.
     Mario, two decisions, both his to make:
       1. "show the contactors as N.O. because they are" — so the blade is drawn
          OPEN by default. That is the device at rest: a contactor's main
          contacts are normally open and close when the coil is energised.
       2. "all contactors have coils, include a contactor with coil, or as per
          IEC symbology" — so the coil is drawn by DEFAULT.

     Worth recording why that is a choice and not a copy: the ELD03 power
     single-line does NOT draw the coil. Checked at 300 dpi (PR01 sheet 4,
     K.MC10 / K.IC10 under Q.MC10) — it draws the bare N.O. contact and sends
     the operating circuit elsewhere, "See aux wiring diagram for details". The
     coil is real, it is simply on another drawing. Drawing it here makes this
     single-line say more than the source sheet, deliberately. `{coil:false}`
     gives the ELD03 form back; `{state:"CLOSED"}` draws it energised.

     `w` covers the coil, otherwise the kernel would place labels and the data
     quality dot against a box the symbol has outgrown. */
  def("CONTACTOR", {
    name: "Contactor (N.O. + coil)", std: "IEC 60617-07", w: 52, h: H, stateful: true,
    ports: PORTS_AB,
    body: c => {
      const o = c.o || {};
      const cc = Object.assign({}, c, {
        open: String(o.state || "").toUpperCase() !== "CLOSED" });
      const t = tipOf(cc);
      let g = stubs(c) + c.cir(0, TOP + 3, 2, "#fff") + blade(cc) +
        /* the cup on the moving contact — the mark that says CONTACTOR and not
           switch. It opens toward the fixed contact it is travelling to. */
        c.path(`M${t.x - 4.6},${t.y - 1.4} A4.6,4.6 0 0 0 ${t.x + 4.6},${t.y - 1.4}`);
      if (o.coil !== false)
        /* Mechanical link (dashed, IEC) and the coil: a plain rectangle, the
           IEC 60617-07 relay element. The link is anchored at a FIXED point,
           not at the moving tip: anchored to the tip it collapsed to nothing in
           the open state — the box started exactly where the tip ended — so the
           dashes only appeared when the contact was closed, which is the one
           state the drawing does not normally show. */
        g += c.ln(4, 3, 14, 3, "2 2") + c.rect(14, -2.5, 11, 11, "#fff");
      return g;
    }
  });

  def("FUSE", {
    name: "Fuse", std: "IEC 60617-07", w: 16, h: H,
    ports: PORTS_AB,
    body: c => c.ln(0, TOP, 0, BOT) + c.rect(-5, -8, 10, 16, "#fff")
  });

  def("FUSE_SWITCH", {
    name: "Fuse switch-disconnector", w: 24, h: H, stateful: true,
    ports: PORTS_AB,
    body: c => stubs(c) + fixedTop(c) + blade(c) + arcChute(c) +
      c.rect(c.open ? 3 : -4, -6, 8, 12, "#fff") + motor(c)
  });

  def("BUS_COUPLER", {
    name: "Bus coupler", w: 24, h: H, stateful: true,
    ports: PORTS_AB,
    body: c => stubs(c) + fixedTop(c) + blade(c) + motor(c) +
      c.ln(-3.5, TOP - 0.5, 3.5, TOP + 6.5) + c.ln(3.5, TOP - 0.5, -3.5, TOP + 6.5) +
      (c.open ? c.txt(14, TOP + 6, "N.O.", 6.4, 700, "start") : "")
  });

  def("EARTH", {
    name: "Earth", std: "IEC 60617-02", w: 16, h: 14,
    ports: { A: [0, -7, "N"] },
    body: c => c.ln(0, -7, 0, 1) + c.ln(-7, 1, 7, 1) + c.ln(-4.5, 4, 4.5, 4) + c.ln(-2, 7, 2, 7)
  });

  /* ══ 3. MEASUREMENT — the layer that carries load flow ═════════════════ */

  def("CT", {
    name: "Current transformer", std: "IEC 60617-06", w: 22, h: H,
    ports: PORTS_AB,
    /* the ratio belongs at the END OF THE SECONDARY TAP, not under the core —
       that is where the drawing puts it and where the eye looks for it */
    subPos: "right", subDx: 15,
    /* primary conductor straight through; the core is the circle beside it,
       tapped to the right — that tap is where the meter/relay hangs */
    body: c => c.ln(0, TOP, 0, BOT) + c.cir(0, 0, 6.5) + c.ln(6.5, 0, 12, 0) + c.dot(12, 0, 1.6)
  });

  def("VT", {
    name: "Voltage transformer", std: "IEC 60617-06", w: 22, h: H,
    ports: { A: [0, TOP, "N"] },
    body: c => c.ln(0, TOP, 0, -6) + c.cir(0, -1.5, 5.5) + c.cir(0, 6, 5.5) +
      c.ln(0, 11.5, 0, BOT)
  });

  def("METER", {
    name: "Meter", std: "IEC 60617-08", w: 22, h: 22,
    ports: { A: [0, -11, "N"], B: [0, 11, "S"] },
    /* the quantity goes INSIDE the circle: W, Wh, A, V, var, PF.
       opts.quantity drives it — one symbol, every metered quantity. */
    body: c => c.cir(0, 0, 10, "#fff") +
      c.txt(0, 3.5, (c.o && c.o.quantity) || "Wh", 8, 700)
  });

  def("NETWORK_ANALYZER", {
    name: "Network analyser", w: 24, h: 22,
    ports: { A: [0, -11, "N"] },
    /* a multi-quantity meter: circle with A, and the measured set printed by
       the caller as a values badge (P, Q, U, I, cos φ, E) */
    body: c => c.cir(0, 0, 10, "#fff") + c.txt(0, 3.5, "A", 9, 700) +
      c.ln(-10, 0, -14, 0) + c.dot(-14, 0, 1.6)
  });

  /* ══ 4. CONVERSION ═════════════════════════════════════════════════════ */

  def("TRANSFORMER", {
    name: "Transformer, 2 winding", std: "IEC 60617-06", w: 24, h: 30,
    ports: { A: [0, -15, "N"], B: [0, 15, "S"] },
    body: c => c.ln(0, -15, 0, -11) + c.cir(0, -5, 9) + c.cir(0, 5, 9) + c.ln(0, 11, 0, 15)
  });

  def("TRANSFORMER_3W", {
    name: "Transformer, 3 winding", w: 28, h: 34,
    ports: { A: [0, -17, "N"], B: [0, 17, "S"], C: [14, 0, "E"] },
    body: c => c.ln(0, -17, 0, -13) + c.cir(0, -7, 8) + c.cir(-5, 4, 8) + c.cir(5, 4, 8) +
      c.ln(0, 12, 0, 17)
  });

  def("INVERTER", {
    name: "Inverter (DC→AC)", std: "IEC 60617-06", w: 26, h: 26,
    ports: { A: [0, -13, "N"], B: [0, 13, "S"] },
    body: c => c.rect(-13, -13, 26, 26, "#fff") + c.ln(-11, 11, 11, -11) +
      c.txt(-6, -3, "=", 9, 700) + c.path("M2,7 q3,-5 6,0", null)
  });

  def("RECTIFIER", {
    name: "Rectifier (AC→DC)", w: 26, h: 26,
    ports: { A: [0, -13, "N"], B: [0, 13, "S"] },
    body: c => c.rect(-13, -13, 26, 26, "#fff") + c.ln(-11, 11, 11, -11) +
      c.path("M-10,-6 q3,-5 6,0") + c.txt(6, 9, "=", 9, 700)
  });

  /* IEC 60617-06 static converter: a square split by a diagonal, with the INPUT
     quantity in the upper-left triangle and the OUTPUT in the lower-right. That
     one rule generates the whole family and keeps them tellable apart:
         RECTIFIER   sine in, = out
         INVERTER    = in, sine out
         VFD         sine in, sine out   ← a FREQUENCY converter: AC to AC
     v0.2.3 draws both sides as real sine curves (a full period each) instead of
     a single "q" bump plus a stray step polyline that read as noise at drawing
     scale and made the drive hard to tell from the inverter. */
  def("VFD", {
    name: "Variable frequency drive", std: "IEC 60617-06", w: 28, h: 26,
    ports: { A: [0, -13, "N"], B: [0, 13, "S"] },
    body: c => c.rect(-14, -13, 28, 26, "#fff") + c.ln(-12, 11, 12, -11) +
      /* input, upper-left triangle */
      c.path("M-11,-5 q2.4,-4.2 4.8,0 t4.8,0") +
      /* output, lower-right triangle */
      c.path("M1.4,7 q2.4,-4.2 4.8,0 t4.8,0")
  });

  /* A soft starter is an AC power controller, and IEC 60617 draws that as what
     it physically is: a pair of ANTI-PARALLEL THYRISTORS (60617-05). v0.1.0 had
     a diagonal plus two loose triangles floating in a box — not a circuit, and
     at drawing scale just three marks. This is the real thing: two parallel
     branches between the terminals, a thyristor in each, pointing opposite ways,
     each with its cathode bar and its gate lead. One branch conducts each
     half-cycle; phase-shifting the gates is the soft start. */
  /* the thyristor pair on its own, so SOFT_STARTER and SOFT_STARTER_2C draw the
     same controller instead of two hand-copied versions that drift apart. */
  const thyristorPair = c =>
      /* two parallel branches between the terminals */
      c.ln(0, -13, 0, -9) + c.ln(0, 13, 0, 9) +
      c.ln(-9, -9, 9, -9) + c.ln(-9, 9, 9, 9) +
      c.ln(-9, -9, -9, 9) + c.ln(9, -9, 9, 9) +
      /* left branch: a thyristor conducting DOWNWARD - triangle apex down with
         its cathode bar across the apex */
      c.path("M-12,-3.5 L-6,-3.5 L-9,1.5 Z", c.col) + c.ln(-12, 1.5, -6, 1.5) +
      /* right branch: the ANTI-PARALLEL one, conducting upward. One branch
         conducts each half-cycle; phase-shifting the gates is the soft start. */
      c.path("M6,3.5 L12,3.5 L9,-1.5 Z", c.col) + c.ln(6, -1.5, 12, -1.5) +
      /* the gate lead of each thyristor, off its cathode bar (IEC 60617-05) */
      c.ln(-6, 1.5, -3.5, 4) + c.ln(6, -1.5, 3.5, -4);

  def("SOFT_STARTER", {
    name: "Soft starter", std: "IEC 60617-05", w: 28, h: 26,
    ports: { A: [0, -13, "N"], B: [0, 13, "S"] },
    body: thyristorPair
  });

  /* SOFT_STARTER_2C — one soft starter shared by TWO machines through a pair of
     mechanically interlocked contactors. Migration 183b puts this kind in
     `v_sld_start_device` when a way carries a soft starter, contactors with
     qty>=2, AND feeds two loads in the power graph; without the second load it
     stays SOFT_STARTER, because two contactors on a single machine are usually
     line + bypass, which is a different animal.

     Drawn as what it is: the thyristor pair, then the conductor FORKS into two
     N.O. contacts and merges again at port B. The fork/merge is symbolic — the
     two real destinations hang off the way below — but it is the only mark that
     says "this starter serves two machines". The dashed bar across the two
     blades is the IEC mechanical link: the interlock, which is the whole point.
     Only one contactor can close, so only one machine runs at a time. Draw them
     both open (N.O. at rest), same decision as CONTACTOR. */
  def("SOFT_STARTER_2C", {
    name: "Soft starter, two interlocked contactors", std: "IEC 60617-05/-07",
    w: 62, h: 76,
    ports: { A: [0, -38, "N"], B: [0, 38, "S"] },
    body: c => {
      const X = 17;                                /* half the fork width */
      const branch = x => {
        const tx = x + 7.5, ty = 0;                /* blade open at 30 degrees,
                                                      leaning the same way as
                                                      every other contact here */
        return c.ln(x, -8, x, -2) + c.dot(x, -2, 1.8) +
               c.ln(x, 13, tx, ty) +
               /* the cup that says CONTACTOR and not switch */
               c.path(`M${tx - 4.6},${ty - 1.4} A4.6,4.6 0 0 0 ${tx + 4.6},${ty - 1.4}`) +
               c.ln(x, 13, x, 26);
      };
      return `<g transform="translate(0,-25)">` + thyristorPair(c) + `</g>` +
        c.ln(0, -12, 0, -8) + c.ln(-X, -8, X, -8) +
        branch(-X) + branch(X) +
        /* mechanical interlock between the two contactors (IEC dashed link):
           only one can close, so only one machine runs at a time */
        c.ln(-X + 4, 8, X - 4, 8, "2 2") +
        c.ln(-X, 26, X, 26) + c.ln(0, 26, 0, 38);
    }
  });

  def("UPS", {
    name: "UPS", w: 30, h: 26,
    ports: { A: [0, -13, "N"], B: [0, 13, "S"] },
    body: c => c.rect(-15, -13, 30, 26, "#fff", "", 2) + c.txt(0, 3.5, "UPS", 8, 700)
  });

  def("BATTERY", {
    name: "Battery", std: "IEC 60617-06", w: 22, h: 22,
    ports: { A: [0, -11, "N"], B: [0, 11, "S"] },
    body: c => c.ln(0, -11, 0, -5) + c.ln(-8, -5, 8, -5) + c.ln(-4, -1, 4, -1) +
      c.ln(-8, 3, 8, 3) + c.ln(-4, 7, 4, 7) + c.ln(0, 7, 0, 11)
  });

  /* ══ 5. SOURCES & LOADS ════════════════════════════════════════════════ */

  const rotary = (letter, r) => ({
    w: (r || 12) * 2 + 2, h: (r || 12) * 2 + 2,
    ports: { A: [0, -(r || 12), "N"] },
    body: c => c.cir(0, 0, r || 12, "#fff") + c.txt(0, 4.5, letter, 12, 700)
  });

  /* A SOURCE sits at the top of a single-line and its conductor leaves
     DOWNWARD, so its identity and its rating belong ABOVE it — the mirror of a
     motor or compressor, which sits at the bottom and is labelled below. */
  def("GENERATOR",  Object.assign({ name: "Generator", std: "IEC 60617-06", labelPos: "above" }, rotary("G")));
  def("MOTOR",      Object.assign({ name: "Motor",      std: "IEC 60617-06" }, rotary("M")));
  def("PUMP",       Object.assign({ name: "Pump" }, rotary("P")));
  def("COMPRESSOR", Object.assign({ name: "Compressor" }, rotary("C")));
  def("FAN",        Object.assign({ name: "Fan" }, rotary("F")));

  def("HEATER", {
    name: "Electric heater", std: "IEC 60617-04", w: 24, h: 22,
    ports: { A: [0, -11, "N"] },
    body: c => c.rect(-11, -9, 22, 18, "#fff") +
      c.path("M-7,4 l3.5,-9 l3.5,9 l3.5,-9 l3.5,9")
  });

  def("ELECTRICAL_LOAD", {
    name: "Load", w: 20, h: 20,
    ports: { A: [0, -10, "N"] },
    body: c => c.ln(0, -10, 0, -4) + c.path("M-7,-4 L7,-4 L0,9 Z", "#fff")
  });

  def("LIGHTING", {
    name: "Lighting", std: "IEC 60617-11", w: 22, h: 22,
    ports: { A: [0, -11, "N"] },
    body: c => c.cir(0, 0, 9, "#fff") + c.ln(-6.4, -6.4, 6.4, 6.4) + c.ln(6.4, -6.4, -6.4, 6.4)
  });

  def("CAPACITOR", {
    name: "Capacitor bank", std: "IEC 60617-04", w: 20, h: 20,
    ports: { A: [0, -10, "N"] },
    body: c => c.ln(0, -10, 0, -3.5) + c.ln(-8, -3.5, 8, -3.5) +
               c.ln(-8, 3.5, 8, 3.5) + c.ln(0, 3.5, 0, 10)
  });

  /* ══ 6. DB MAPPING — the only place a column value meets a symbol ══════
     Left  = v_sld_nodes.symbol_kind as it exists in the database today
     Right = the kind registered above
     A value absent from this table falls through to UNKNOWN and draws a
     dashed "?" box, so a new symbol_kind is VISIBLE, never silently dropped. */
  const ELEC_MAP = {
    FEEDER:        "CIRCUIT_BREAKER",
    INCOMER:       "CIRCUIT_BREAKER",
    OUTGOING:      "CIRCUIT_BREAKER",
    COUPLER:       "BUS_COUPLER",
    TIE:           "BUS_COUPLER",
    METERING:      "NETWORK_ANALYZER",
    GENERAL_SWITCH:"SWITCH_DISCONNECTOR",
    BUSBAR:        "BUSBAR",
    BUSBAR_INVERTER:"BUSBAR_INVERTER",
    SWITCHBOARD:   "SWITCHBOARD",
    MCC_PANEL:     "MCC_PANEL",
    BUS_COUPLER:   "BUS_COUPLER",
    NETWORK_ANALYZER:"NETWORK_ANALYZER",
    TRANSFORMER:   "TRANSFORMER",
    INVERTER:      "INVERTER",
    SOFT_STARTER:  "SOFT_STARTER",
    VFD_DRIVE:     "VFD",
    UPS:           "UPS",
    GENERATOR:     "GENERATOR",
    MOTOR:         "MOTOR",
    PUMP:          "PUMP",
    COMPRESSOR:    "COMPRESSOR",
    FAN:           "FAN",
    HEATER:        "HEATER",
    ELECTRIC_HEATER:"HEATER",
    ELECTRICAL_LOAD:"ELECTRICAL_LOAD",
    LIGHTING:      "LIGHTING",
    SPARE:         "SPARE",
    DISCONNECTOR:  "DISCONNECTOR"
  };

  /* resolve a v_sld_nodes row to a drawable kind + the options the row implies.
     This is the whole "self-drawing from the DB" contract in one function. */
  function fromNode(n) {
    if (!n) return { kind: "UNKNOWN", opts: {} };
    const kind = ELEC_MAP[String(n.symbol_kind || "").toUpperCase()] || "UNKNOWN";
    const opts = {
      label: n.tag,
      dq: n.data_status,
      open: n.normally_open === true,
      state: n.normally_open === true ? "OPEN" : (n.state || "DESIGN"),
      motorized: n.motorized === true,
      title: [n.tag, n.description, n.data_status].filter(Boolean).join(" · "),
      values: []
    };
    if (n.power_kw   != null) opts.values.push({ k: "P", v: n.power_kw,   u: "kW" });
    if (n.current_a  != null) opts.values.push({ k: "I", v: n.current_a,  u: "A"  });
    if (n.voltage_v  != null) opts.values.push({ k: "U", v: n.voltage_v,  u: "V"  });
    if (n.cos_phi    != null) opts.values.push({ k: "cosφ", v: n.cos_phi, u: ""   });
    return { kind, opts };
  }

  T.ELEC_MAP = ELEC_MAP;
  T.fromNode = fromNode;
  T.packs = (T.packs || []).concat([{ discipline: "ELECTRICAL", version: "0.3.0", count: T.kinds().length }]);
})();
