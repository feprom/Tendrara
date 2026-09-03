/* ═══════════════════════════════════════════════════════════════════════════
   tam-sym-elec.js — ELECTRICAL symbol pack for tam-sym.js
   ─────────────────────────────────────────────────────────────────────────
   48 IEC-style single-line symbols. Geometry only: no renderer, no layout,
   no data loading. Requires tam-sym.js to be loaded first.

   v0.4.0 (2026-09-02) — THE COMOS/IEC LAYER, § 5b and 5c
     Nine symbols and three conductor annotations, every one of them read off a
     real issued sheet in `elec/ejemplos/` (three Reinhausen COMOS ET 10.1
     sets, norm IEC). The doctrine those sheets impose — sheet anatomy, IEC
     81346 tagging, the cross-sheet reference `/sheet.column`, and the four
     things no house one-line may ship without — is written up in SOUL.md §E.
     Added: CABLE_TERMINATION, EARTHING_SWITCH, REACTOR, PROTECTION_FUNCTION,
     PROTECTION_RELAY, CUBICLE, RACKING_TRUCK, TERMINAL, WARNING_NOTE, plus
     TamSym.ELEC_ANNOT.{conductors, xref, busData}.
     Nothing existing changed: every caller of v0.3.4 renders byte-identical.

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
  /* ── the CONTACTOR cup (v0.3.4) ────────────────────────────────────────
     IEC 60617-07: what makes a make-contact a CONTACTOR is a semicircle on the
     free end of the moving contact, its opening facing the fixed contact it is
     travelling to. The plane of that semicircle is perpendicular TO THE MOVING
     CONTACT — it turns with the blade.

     Until v0.3.3 the cup was drawn axis-aligned: a "∪" opening straight up, no
     matter that the blade sat at 30°. Closed (blade vertical) that is correct
     by accident; OPEN — which is the state this drawing shows, because a
     contactor is N.O. at rest — the blade ran diagonally into a horizontal cup
     and the three ends fanned out. Mario: *"revisar icono de contactor con IEC,
     si tiene esa especie de trinche"*. He was right: it read as a trident, and
     a trident is not a symbol in 60617.

     There were TWO faults, and the second is the one that made the trident.
     The cup was centred ON the tip, so the moving contact ran to the middle of
     the cup's MOUTH: two arc ends plus the blade sticking out between them —
     three prongs, at any angle. In 60617 the blade STOPS AT THE BACK of the
     cup and the cup opens forward from there. So the centre sits one radius
     BEYOND the tip, along the blade, and the arc passes exactly through the
     tip: the line meets the arc at a single point of tangency and there is
     nothing left to read as a prong.

     Given the pivot and the tip, the cup is built on that axis, so it is right
     at every angle and there is no angle left to get wrong.                  */
  function cup(c, x0, y0, x, y, r) {
    const dx = x - x0, dy = y - y0, L = Math.hypot(dx, dy) || 1;
    const nx = dx / L, ny = dy / L;        /* pivot → tip = toward the fixed contact */
    const px = -ny, py = nx;               /* the chord runs across that            */
    const R = r || 4.6;
    const cx = x + nx * R, cy = y + ny * R;          /* one radius PAST the tip */
    const f = n => +n.toFixed(2);
    return c.path(`M${f(cx + px * R)},${f(cy + py * R)} A${R},${R} 0 0 1 ` +
                  `${f(cx - px * R)},${f(cy - py * R)}`);
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
           switch. It opens toward the fixed contact it is travelling to, and
           since v0.3.4 it TURNS WITH THE BLADE (see `cup` above). */
        cup(c, t.x0, t.y0, t.x, t.y, 4.6);
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
      /* v0.4.0 — not when the symbol is ROTATED. A coupler laid onto a
         horizontal busbar is drawn rot:90, and the group transform turns this
         text with it: "N.O." came out reading down the page, half of it under
         the bar. Text inside a body cannot survive an arbitrary rotation, so a
         rotated instance leaves the state to the caller, who knows which way
         up the drawing is. */
      (c.open && !(c.o && c.o.rot) ? c.txt(14, TOP + 6, "N.O.", 6.4, 700, "start") : "")
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
     same controller instead of two hand-copied versions that drift apart.

     v0.3.4 — SIZED TO THE VFD. Mario, seeing .310/.311 (drives) next to
     .312/.313 (soft starters) on the same bar: "el arrancador, del mismo tamaño
     que los VFD". They were not: the drive is a solid 28 × 26 box, while the
     starter's rails were only 18 apart with the thyristors poking out past
     them, so on the sheet one converter read small-and-spiky and the other
     large-and-solid — a difference in DRAWING that looked like a difference in
     KIND. The rails now stand at ±11 so the thyristors reach exactly ±14, and
     the whole mark occupies the same 28 × 26 as the drive. Two converters, two
     symbols, one visual weight. */
  const thyristorPair = c =>
      /* two parallel branches between the terminals, the outer edge of the
         thyristors landing on the VFD's own box line */
      c.ln(-11, -13, 11, -13) + c.ln(-11, 13, 11, 13) +
      c.ln(-11, -13, -11, 13) + c.ln(11, -13, 11, 13) +
      /* left branch: a thyristor conducting DOWNWARD - triangle apex down with
         its cathode bar across the apex */
      c.path("M-14,-3.5 L-8,-3.5 L-11,1.5 Z", c.col) + c.ln(-14, 1.5, -8, 1.5) +
      /* right branch: the ANTI-PARALLEL one, conducting upward. One branch
         conducts each half-cycle; phase-shifting the gates is the soft start. */
      c.path("M8,3.5 L14,3.5 L11,-1.5 Z", c.col) + c.ln(8, -1.5, 14, -1.5) +
      /* the gate lead of each thyristor, off its cathode bar (IEC 60617-05) */
      c.ln(-8, 1.5, -5.5, 4) + c.ln(8, -1.5, 5.5, -4);

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

     Drawn as what it is: the thyristor pair, then the conductor reaches a
     JUNCTION and forks into two N.O. contacts, one per machine, each dropping
     straight to its own terminal. Only one contactor can close, so only one
     machine runs at a time; the mechanical coupling between the two operating
     elements is what says so. Draw them both open (N.O. at rest), same
     decision as CONTACTOR.

     v0.3.3 — the two contactors were inside a white box, which read as one
     piece of switchgear and hid the fork. Mario sent the plant's own drawing of
     this arrangement: a solid junction dot, a bare horizontal spread, a
     contactor hanging off each end, and the interlock marked by a triangle
     between them — no enclosure anywhere. That is the form here now. The box
     was never carrying information the fork does not: what mattered was the one
     way in and the two ways out, and an open fork says that more directly. */
  def("SOFT_STARTER_2C", {
    name: "Soft starter, two interlocked contactors", std: "IEC 60617-05/-07/-02",
    /* the fork is as WIDE as the two machines are apart, so each drop runs
       STRAIGHT from its terminal to its motor. Mario: "haz la caja lo
       suficientemente ancha como para que la bajada a los motores sea directa,
       sin esas líneas horizontales". The renderer reads the machine spacing off
       BL/BR rather than off a constant, so the two stay locked together. */
    w: 64, h: 88,
    ports: { A: [0, -44, "N"], B: [0, 44, "S"], BL: [-26, 44, "S"], BR: [26, 44, "S"] },
    body: c => {
      const X = 26, yFork = -13, yPiv = 15;
      const contact = x => {
        const tx = x + 6, ty = 4;                  /* blade open at 30 degrees */
        return c.ln(x, yFork, x, -3) + c.dot(x, -3, 1.8) +
               c.ln(x, yPiv, tx, ty) +
               /* the cup: this is a CONTACTOR, not a switch — same helper as
                  CONTACTOR, so the two can no longer drift apart (v0.3.4) */
               cup(c, x, yPiv, tx, ty, 4.2) +
               /* and straight on down to its own machine — no merge, no box */
               c.ln(x, yPiv, x, 44);
      };
      return `<g transform="translate(0,-30)">` + thyristorPair(c) + `</g>` +
        /* soft starter down into the junction */
        c.ln(0, -17, 0, yFork) + c.dot(0, yFork, 2.4) +
        /* ONE way in, TWO ways out: the spread the junction dot presides over */
        c.ln(-X, yFork, X, yFork) +
        contact(-X) + contact(X) +
        /* MECHANICAL INTERLOCK, IEC 60617-02 form: the dashed mechanical
           coupling between the two operating elements, with the triangle that
           marks the coupling as an INTERLOCK — closing either contactor holds
           the other open, so only one machine runs.

           v0.3.4 — Mario: *"la línea horizontal debe pasar por el medio del
           triángulo, pero no cortarlo"*. It used to run along the triangle's
           BASE, which reads as a triangle hanging off a line — two marks that
           happen to touch. Now the triangle straddles the line: base at 5.7,
           apex at 12.3, so y = 9 is its half-height. The dashes stop at the
           triangle's actual width AT THAT HEIGHT (±2.5, since it has tapered to
           half by then), so the coupling runs INTO the mark from both sides and
           the mark stays whole. */
        c.ln(-X, 9, -2.5, 9, "2 2") + c.ln(2.5, 9, X, 9, "2 2") +
        c.path("M-5,5.7 L5,5.7 L0,12.3 Z");
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

  /* A load fed from a busbar section, drawn as the BLOCK the distribution
     sheets use when the thing behind the feeder is a group and not one machine:
     a plain square with its figure inside. ELECTRICAL_LOAD (the triangle) is one
     load on one conductor; this is "everything section D feeds, 7,190 kW". The
     figure goes INSIDE the block and the prose function goes underneath, which
     is rule 4 of SOUL.md SS E.7. Added v0.4.1 for module 109 slide 10.
       lines:   the figures printed inside, top to bottom (["7,190", "kW"])
       caption: the prose function, printed under the block */
  def("LOAD_BLOCK", {
    name: "Load block", w: 46, h: 46,
    ports: { A: [0, -23, "N"] },
    body: c => {
      const o = c.o || {}, w = o.w || 46, h = o.h || 46;
      const x = -w / 2, y = -h / 2;
      const lines = [].concat(o.lines || []);
      const step = ts(11);
      let g = c.rect(x, y, w, h, "#fff", "", 2);
      lines.forEach((t, i) => {
        g += c.txt(0, (i - (lines.length - 1) / 2) * step + ts(3), t,
                   ts(i ? 7.8 : 8.6), i ? 600 : 700);
      });
      [].concat(o.caption || []).forEach((t, i) => {
        g += c.txt(0, y + h + ts(9) + i * ts(8), t, ts(7.6), 600);
      });
      return g;
    }
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

  /* v0.4.0 — body text follows the kernel's type scale.
     `c.txt` takes a RAW size, so a symbol that prints inside its own body (a
     cubicle header, the bands of a protection block) stayed at its literal size
     while every kernel-placed label grew with TamSym.textScale. On slide 10 that
     printed a 7.6 px cubicle header beside an 11 px tag, and audit.py flagged it
     as unreadable. One helper, applied to the bodies below. */
  const ts = v => +(v * (T.textScale || 1)).toFixed(2);

  /* ══ 5b. THE COMOS/IEC LAYER — v0.4.0 ══════════════════════════════════
     Every symbol below was read off a real sheet in `elec/ejemplos/`: three
     Reinhausen COMOS ET 10.1 sets, issued to IEC. The sheet reference is on
     each one. Nothing here is invented; what could not be decided from the
     sheets is listed as an open point in SOUL.md §E.8.

     Shorthand used in the citations:
       A h1  = 20325865_010_20171220.pdf, sheet 1 (single line, 3.3 kV)
       C h2  = 4084-DI-E-007=2, sheet 2   (esquema unifilar, 69 kV)
       C h3  = 4084-DI-E-007=2, sheet 3   (diagrama del circuito, 125 V DC) */

  /* Hollow triangle set INTO the conductor, at the point where it crosses a
     cubicle boundary. C h2 puts it between the 69 kV busbar and the bay; A h1
     puts one at the exit of each of the two cubicles. Read as a cable
     termination / boundary crossing — see SOUL.md §E.8, still `[POR MEDIR]`.
     `up:true` points it back toward the source, which is the C h2 form. */
  def("CABLE_TERMINATION", {
    name: "Cable termination", w: 18, h: H,
    ports: PORTS_AB,
    body: c => {
      const up = !!(c.o && c.o.up);
      return c.ln(0, TOP, 0, -5) + c.ln(0, 5, 0, BOT) +
        (up ? c.path("M0,-5 L5.5,5 L-5.5,5 Z", "#fff")
            : c.path("M0,5 L-5.5,-5 L5.5,-5 Z", "#fff"));
    }
  });

  /* A h1 `-Q8`: a blade that closes onto earth instead of onto a conductor.
     Not the same object as EARTH, which is a bonding point with no mechanism.
     Drawn OPEN unless CLOSED is asked for: an earthing switch at rest is open,
     and a closed one on a live drawing is a safety statement. */
  def("EARTHING_SWITCH", {
    name: "Earthing switch", std: "IEC 60617-07", w: 24, h: 30, stateful: true,
    ports: { A: [0, -15, "N"] },
    body: c => {
      const closed = String((c.o && c.o.state) || "").toUpperCase() === "CLOSED" && !c.open;
      /* the blade travels between TWO fixed contacts: the live one above and
         the earthed one below. Open, it must not touch the lower contact —
         drawing a return leg from the blade tip to earth showed an earthing
         switch that is closed, which is a safety lie. */
      return c.ln(0, -15, 0, -9) + c.dot(0, -9, 1.8) +
        (closed ? c.ln(0, -9, 0, 2) : c.ln(0, -9, 9, 0)) +
        c.dot(0, 2, 1.8) + c.ln(0, 2, 0, 5) +
        c.ln(-7, 5, 7, 5) + c.ln(-4.5, 8, 4.5, 8) + c.ln(-2, 11, 2, 11) + motor(c);
    }
  });

  /* C h2 `-L1;L2;L3` 38.01 mH, A h1 `-L1` 3 x 2.61 mH: a SOLID black bar in
     the conductor. Solid is the whole message — an unfilled rectangle in this
     position is a fuse or an instrument, and the sheets keep them apart by
     fill alone. The value goes in `sub`, never inside the body. */
  def("REACTOR", {
    name: "Reactor", std: "IEC 60617-06", w: 18, h: H,
    ports: PORTS_AB,
    body: c => c.ln(0, TOP, 0, -8) + c.rect(-4.5, -8, 9, 16, c.col) + c.ln(0, 8, 0, BOT)
  });

  /* A h1 `-F100`, beside the 7SJ80: a box split into horizontal bands, one
     protection function per band, top to bottom in the order the sheet prints
     them. `functions:["I>>","I>","Δt"]` — that set is the sheet's own and the
     default here. */
  def("PROTECTION_FUNCTION", {
    name: "Protection function", std: "IEC 60617-07", w: 34, h: 36,
    ports: { A: [-17, 0, "W"] },
    body: c => {
      const fs = (c.o && c.o.functions) || ["I>>", "I>", "Δt"];
      const n = Math.max(1, fs.length), bh = 36 / n;
      let g = c.rect(-17, -18, 34, 36, "#fff");
      fs.forEach((f, i) => {
        const y = -18 + i * bh;
        if (i) g += c.ln(-17, y, 17, y);
        g += c.txt(0, y + bh / 2 + 2.8, f, ts(7.6), 600);
      });
      return g;
    }
  });

  /* C h2: a plain rectangle carrying the device's own words ("Relé de
     protección y BCU"), with `+lugar / -tag / modelo` printed OUTSIDE, to its
     right. The kernel's label/sub own the outside; the body owns the inside.
     So: `text` for what goes in the box, `label`/`sub` for what goes beside
     it. Up to three wrapped lines, then it stops. */
  def("PROTECTION_RELAY", {
    name: "Protection relay / IED", w: 46, h: 34,
    ports: { A: [0, -17, "N"], B: [0, 17, "S"], W: [-23, 0, "W"], E: [23, 0, "E"] },
    body: c => {
      const words = String((c.o && c.o.text) || "IED").split(/\s+/).filter(Boolean);
      const lines = [];
      let cur = "";
      words.forEach(w => {
        if (!cur) cur = w;
        else if (cur.length + 1 + w.length <= 11) cur += " " + w;
        else { lines.push(cur); cur = w; }
      });
      if (cur) lines.push(cur);
      const use = lines.slice(0, 3);
      let g = c.rect(-23, -17, 46, 34, "#fff");
      const y0 = -(use.length - 1) * 4.5;
      use.forEach((l, i) => { g += c.txt(0, y0 + i * 9 + 2.6, l, ts(7.2), 600); });
      return g;
    }
  });

  /* A h1 / C h2: the cubicle boundary is DASH-DOT, and `=aspect` / `+location`
     sit stacked above its top-left corner, OUTSIDE the box. Sized by the
     caller — a cubicle is furniture, not a fixed-size device — so the nominal
     w/h here only feed the kernel's label placement, which this symbol does
     not use: the header and the prose caption are drawn in the body. */
  def("CUBICLE", {
    name: "Cubicle / enclosure", w: 120, h: 90,
    ports: { N: [0, -45, "N"], S: [0, 45, "S"] },
    body: c => {
      const o = c.o || {}, w = o.w || 120, h = o.h || 90;
      const x = -w / 2, y = -h / 2;
      let g = c.rect(x, y, w, h, "none", "9 3 2 3");
      /* the two header lines are spaced BY THE TYPE SCALE: at textScale 1.45 a
         fixed 9 u gap put an 11 px "=480" on top of its own "+480-JG-691". */
      if (o.aspect)   g += c.txt(x, y - (o.location ? ts(12.5) : ts(3.5)), o.aspect, ts(7.6), 700, "start");
      if (o.location) g += c.txt(x, y - ts(3.5), o.location, ts(7.6), 700, "start");
      /* the plain-prose function caption the sheets put UNDER each block:
         "Incoming feeder", "Compensation step 1 / 1000 kvar / 189 Hz" */
      [].concat(o.caption || []).forEach((t, i) => {
        g += c.txt(0, y + h + 14 + i * 10, t, ts(8), 600);
      });
      return g;
    }
  });

  /* A h1 `-Q1`: the racking symbol, a crossed square set into the mechanical
     link of a withdrawable device. Kept apart from ACB_DRAWOUT's chevrons
     because on that sheet it is its own object, between the motor operator and
     the breaker, not a decoration on the breaker. */
  def("RACKING_TRUCK", {
    name: "Withdrawable unit", w: 14, h: 14,
    ports: { W: [-7, 0, "W"], E: [7, 0, "E"] },
    body: c => c.rect(-6, -6, 12, 12, "#fff") + c.ln(-6, 0, 6, 0) + c.ln(0, -6, 0, 6)
  });

  /* C h3: a terminal in a circuit diagram is a HOLLOW circle on the conductor.
     The strip tag (-X81) goes left as the kernel `label`; the terminal number
     (813) goes right, ROTATED 90°, which the kernel cannot do — so the number
     is drawn here from `terminal`. */
  def("TERMINAL", {
    name: "Terminal", std: "IEC 60617-03", w: 20, h: 16,
    ports: { A: [0, -8, "N"], B: [0, 8, "S"] },
    body: c => {
      const n = c.o && c.o.terminal;
      return c.ln(0, -8, 0, -3.2) + c.cir(0, 0, 3.2, "#fff") + c.ln(0, 3.2, 0, 8) +
        (n == null ? "" :
          `<text transform="translate(12,7) rotate(-90)" text-anchor="start" ` +
          `font-family="Consolas,monospace" font-size="${ts(6.4)}" font-weight="600" ` +
          `fill="${c.col}">${String(n).replace(/[&<>"]/g, "")}</text>`);
    }
  });

  /* C h3, column 2: a dashed box with a warning triangle at each end and the
     hazard in prose — on that sheet, "Energizado, aúnque interruptor principal
     esta apagado". It is part of the drawing standard, not decoration, so it
     lives in the pack. */
  def("WARNING_NOTE", {
    name: "Warning note", std: "IEC 60617-02", w: 150, h: 42,
    ports: {},
    body: c => {
      const o = c.o || {}, w = o.w || 150, h = o.h || 42;
      const x = -w / 2, y = -h / 2;
      const tri = tx => c.path(`M${tx},${y + 7} l6,11 l-12,0 Z`) +
        c.txt(tx, y + 16.4, "!", ts(7), 700);
      let g = c.rect(x, y, w, h, "none", "4 3") + tri(x + 14) + tri(x + w - 14) +
        c.txt(0, y + 15, (o.title || "¡Atención!"), ts(7.6), 700);
      [].concat(o.text || []).slice(0, 3).forEach((t, i) => {
        g += c.txt(0, y + 27 + i * 8.6, t, ts(6.8), 600);
      });
      return g;
    }
  });

  /* ══ 5c. ANNOTATION — the marks that live ON a conductor ═══════════════
     These are not symbols: no ports, nothing routes to them. They are the
     three marks that separate a sheet which LOOKS like a one-line from one
     that IS a one-line, and a module drawing takes them from here instead of
     hand-rolling <line> elements (SOUL.md §E.7 rule 1). */
  const INK_A = "#15171A", SOFT_A = "#4A4F57", MONO_A = "Consolas,monospace";
  const escA = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const ANNOT = {
    /* the `///` phase ticks. A h1 and C h2 draw three for a three-phase run.
       (x,y) is the point on the conductor; `dir` "V" for a vertical conductor
       (the default) or "H". `count:true` also prints the number, which is what
       C h2 does beside each CT tap. */
    conductors(x, y, n, o) {
      o = o || {};
      const col = o.color || INK_A, sw = o.strokeWidth || 1.4;
      const L = o.len || 9, gap = o.gap || 3.4, N = Math.max(1, n || 3);
      const vert = String(o.dir || "V").toUpperCase() !== "H";
      let s = "";
      for (let i = 0; i < N; i++) {
        const d = (i - (N - 1) / 2) * gap;
        const cx = vert ? x : x + d, cy = vert ? y + d : y;
        /* the tick leans 45° across the conductor, always the same way */
        s += `<line x1="${cx - L / 2}" y1="${cy + L / 2}" x2="${cx + L / 2}" y2="${cy - L / 2}" ` +
             `stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`;
      }
      if (o.count) s += `<text x="${x + (vert ? 8 : 0)}" y="${y - (vert ? 6 : 9)}" ` +
        `text-anchor="${vert ? "start" : "middle"}" font-family="${MONO_A}" font-size="7.2" ` +
        `font-weight="600" fill="${col}">${N}</text>`;
      return s;
    },

    /* the cross-sheet reference, SOUL.md §E.5. Always `/sheet.column`, always
       with the leading slash — added here when the caller forgets it, because
       a bare "7.8" on a sheet means nothing. `anchor` "start" | "end"; a rail's
       left end takes "end" so the tag sits outside the drawing, as the sheets
       do it. */
    xref(x, y, ref, o) {
      o = o || {};
      const r = escA(ref);
      return `<text x="${x}" y="${y}" text-anchor="${o.anchor || "start"}" ` +
        `font-family="${MONO_A}" font-size="${o.size || 7}" font-weight="600" ` +
        `fill="${o.color || SOFT_A}">${r.charAt(0) === "/" ? r : "/" + r}</text>`;
    },

    /* the system data printed ABOVE a busbar: `69 kV / 50 Hz / 3~` at the left
       end, `25 kA / 1 sec.` at the right, both clear of the bar. C h2, A h1.
       SOUL.md §E.7 rule 4: no house one-line ships without this. */
    busData(x1, x2, y, left, right, o) {
      o = o || {};
      const col = o.color || INK_A, dy = o.dy || 9, size = o.size || 8.4;
      let s = "";
      if (left)  s += `<text x="${x1 + 4}" y="${y - dy}" text-anchor="start" ` +
        `font-family="${MONO_A}" font-size="${size}" font-weight="600" fill="${col}">` +
        escA(left) + `</text>`;
      if (right) s += `<text x="${x2 - 4}" y="${y - dy}" text-anchor="end" ` +
        `font-family="${MONO_A}" font-size="${size}" font-weight="600" fill="${col}">` +
        escA(right) + `</text>`;
      return s;
    }
  };

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
    LOAD_BLOCK:    "LOAD_BLOCK",
    LIGHTING:      "LIGHTING",
    SPARE:         "SPARE",
    DISCONNECTOR:  "DISCONNECTOR",
    /* v0.4.0 — the COMOS/IEC layer, SOUL.md §E.3 */
    EARTHING_SWITCH:    "EARTHING_SWITCH",
    EARTH_SWITCH:       "EARTHING_SWITCH",
    REACTOR:            "REACTOR",
    CHOKE:              "REACTOR",
    CABLE_TERMINATION:  "CABLE_TERMINATION",
    PROTECTION_RELAY:   "PROTECTION_RELAY",
    IED:                "PROTECTION_RELAY",
    PROTECTION_FUNCTION:"PROTECTION_FUNCTION",
    RACKING_TRUCK:      "RACKING_TRUCK",
    TERMINAL:           "TERMINAL",
    TERMINAL_BLOCK:     "TERMINAL",
    CUBICLE:            "CUBICLE"
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
  T.ELEC_ANNOT = ANNOT;
  T.fromNode = fromNode;
  T.packs = (T.packs || []).concat([{ discipline: "ELECTRICAL", version: "0.4.1", count: T.kinds().length }]);
})();
