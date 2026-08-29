# tam-disc.js — discipline squares · integration handoff

**Status 2026-07-29:** library at v0.4.1 (`eni/tam-disc.js`), demo at `eni/tam-disc-demo.html`,
and **wired into all three call sites** — `renderHome()`, `renderArea()` and `buildBand102()`.
The card band is no longer the default; it is now the documented fallback (see §3a).

---

## 1. What it is

Four squares of the SAME size, one per discipline. Inside each square the asset classes are
tiled by area (squarified treemap, Bruls/Huizing/van Wijk 2000 — ~60 lines, no d3). The
outer frame is constant so the four chapters read as equals; the inner areas are
proportional so, inside a chapter, size means quantity.

**Cross-square areas are not comparable** (Mechanical 362 vs Instrumentation 1868 would turn
Mechanical into a stamp). That is why every square prints its total in the corner — the
figure the reader needs is stated, not estimated from pixels.

## 2. API

```js
TamDisc.band(groups, opts)   // the row of squares  → HTML string
TamDisc.square(group, opts)  // one discipline      → <svg> string
TamDisc.squarify(items,w,h)  // the algorithm alone → [{item,x,y,w,h}] (unit-testable)

group = { title, rule, ink, total, totalLabel, note, items:[{label, value, nav, sub}] }
opts  = { size:210, gap:2, pad:10, minLabel:34, minValue:18, bandGap:8 }
```

`nav` is the same string the cards already use (`"nav('report/equipment')"`). No `nav`, no
cursor and no click. The library **counts nothing**: the caller passes figures already read
from the registry (db-graphics §4).

## 3. The three call sites — DONE

All three built the same `groups` shape already, so each became one call swap plus the
partition fix of §3b.

| Where | File | Function | Notes |
|---|---|---|---|
| Plant home | `eni/index.html` | `renderHome()` | `discBand(` → `discRow(`. `<script src="tam-disc.js?v=0.2.0">` added next to the other packs. |
| Area detail | `eni/index.html` | `renderArea()` | `discBand(` → `discRow(`. Same groups (`mechCards`, `elecCards`, `instCards`, `ctrlCards`). |
| Module 102 | `modules/module-102-unit-330-310.html` | `buildBand102()` | tiles are **data** now (`{icon,n,label,g,f,fam}`), drawn as squares or as cards from the same array. The pack is **inlined** into the deck, not linked — the deck must open from a USB stick. `OBJ330/OBJ310` + `UNITSTATS102` untouched. |

### 3a. Two fallbacks, both in the caller

`discRow()` (index) and `buildBand102()` (deck) apply the same two rules. Neither lives in
the library, because both are judgements about *this* data:

1. **Fewer than 3 classes → the card row.** Two tiles and a lot of air reads as "this unit is
   empty" when it means "this unit has two kinds of thing". `MIN_TILES` / `MIN_TILES102`.
2. **No `TamDisc` → the card band, unchanged.** One `<script>` failing must not blank the
   page.

Today that means: home = 4 squares; area 330 = 4 squares; area 310 = mechanical +
instrumentation squares, electrical + control cards; module 102 = 3 squares with electrical
as cards in both units (§3b).

### 3b. The partition problem — the real work of this integration

**A card row is a list of facts. A square is a claim that the parts make up the whole.**
Swapping the renderer silently upgrades every group to that stronger claim, and two of the
four groups could not carry it:

- **Home ELECTRICAL** counted `MOTORS` and `GENERATORS` out of `v_electrical_ui`, then
  `LOADS` as *all* of `v_electrical_ui` — three sources in one box, with the motors inside
  the loads. **Superseded 2026-07-29 — see §3c.** The box is now tiled off `plant_assets`
  by asset class and closes exactly on its own corner figure.
- **Area ELECTRICAL** had the same overlap by a different route: `motorRows` is built *from*
  `eloads` (every load carrying a motor datasheet) plus the remote-MCC rows. Now
  **OTHER LOADS** = the area's feeders that are not the driven equipment of a motor already
  counted. Area 330 reads 37 motors and the remainder of its 26 loads instead of 37 + 26.
- **Module 102 ELECTRICAL** — the first reading was that `MOTORS 30` beside the
  starters-by-type row double-counts the motors. **That reading was wrong (§3c):** a motor
  and its feeder are two assets. It stays as cards for a different reason — the switchboard
  objects are not area-coded to a process unit, so the corner figure cannot cover the
  feeders the cards show. Cards claim no partition, which is right here.
- **MECHANICAL** and **INSTRUMENTATION** were already disjoint (asset classes; ISA first
  letter + a separate valve table) and needed no change.
- **CONTROL** is not a partition either — IO channels, alarms and stations are three
  different kinds of thing rather than parts of one whole — but nothing is double-counted.
  Squared deliberately (Mario, 2026-07-29): IO channels dominate every control square, which
  is true, and the corner total carries the meaning.

### 3c. ELECTRICAL is the single line — Mario, 2026-07-29

The partition fix above was solving the wrong problem for electrical. **A motor is one asset
and the feeder that supplies it is another asset.** The registry already models it that way,
because it is the same registry the single line is drawn from:

| class | n | what it is on the drawing |
|---|---:|---|
| `MOTOR` | 308 | the consumer — `MP-411A` |
| `POWER_FEEDER` | 107 | the position on the board — `480-JG-694-F422` |
| `ELECTRICAL_LOAD` | 14 | non-motor consumers — `GE-006-AUX`, ignition panels |
| `NETWORK_ANALYZER` | 11 | the metering at `.401` — `480-JG-694-401` |
| `BUSBAR` | 10 | `480-JG-694-BBM` |
| `GENERATOR` | 9 | the sources |
| `SWITCHGEAR` | 7 | |
| `BUS_COUPLER` | 6 | `480-JG-691-FICG1` |
| `E_HOUSE` | 6 | |
| `MCC_PANEL` | 4 | the four power centres `480-JG-691…694` |
| `INVERTER` · `TRANSFORMER` · `VFD_DRIVE` | 2 · 2 · 2 | `690-JG-695/696` are drive **panels** |
| **total** | **488** | **= the corner figure, exactly** |

ELECTRICAL is now the only box whose tiles add up to its own total. Checks run before the
change, worth re-running after any electrical migration:

- **No `normalized_tag` is registered twice** anywhere in `plant_assets`. Nothing is
  duplicated.
- **Every `v_sld_nodes` row resolves to exactly one ELECTRICAL asset by tag**, except 21
  driven consumers — 16 heaters, 4 pumps, 1 compressor — which are correctly MECHANICAL
  assets sitting at the end of a feeder. **Do not promote those into the electrical
  discipline.** They are one asset with two faces; promoting them would be the real
  duplication.

Open gaps found while checking, for the change-request register:

1. `VFD_DRIVE` holds 2 assets (the panels `690-JG-695/696`) while 26 loads carry
   `starting_method = VFD`. The ABB drives on `.214/.215` are not individually registered.
2. `SOFT_STARTER` class exists with **0** assets, though 4 loads start on `SOFT START` and
   the SLD carries `SOFT_STARTER_2C` on 2 nodes and `SOFT_STARTER` on 1.
3. `CIRCUIT_BREAKER`, `ELECTRIC_HEATER`, `LIGHTING`, `UPS` classes exist with **0** assets.
4. `starting_method` is not normalized: `DIRECT (CB)` 18 and `CB` 9 are the same method, and
   24 rows are null.
5. `supply_system` is null on 361 of 365, `load_factor` null on 269 of 365 — see §5.6.
6. `TRANSFORMER`: 4 nodes on the single line, 2 assets in the registry.
7. `POWER_FEEDER` 107 assets against 94 feeder-ish SLD nodes (FEEDER 78 + INCOMER 11 +
   SPARE 3 + GENERAL_SWITCH 2) — 13 feeders registered but not drawn, or on sheets not yet
   digitized.

**Rule for whoever adds the next card:** before adding a tile to one of these groups, ask
whether it overlaps a tile already there. If it does, the square is lying and the group
belongs in cards.

Card shape → group shape:

```js
// cards:  [icon, value, label, navString]
// square: {label, value, nav}
items: cards.map(c => ({label:c[2], value:c[1], nav:c[3]}))
```

## 4. Decisions already taken (do not re-litigate without a reason)

- **Rank ramp, not value ramp.** Shade steps by position, not by magnitude: with 30 fans
  against 2 heaters a value ramp collapses every small tile into the same wash.
- **Labels degrade, never clip.** Too small for the word → keep the number; too small for
  the number → keep the colour and the tooltip. Nothing is ever cut mid-word.
- **The discipline hue is the rule colour** already used by the card band, so switching
  renderers does not change what a colour means anywhere in the product.
- **The four hues are pure, and there is no exception.** `#E52521` red · `#FBD000` yellow ·
  `#43B047` green · `#049CD8` blue, at full saturation. They now live in the library
  (`TamDisc.MARIO`) and are resolved from the discipline title, so a caller passes no colour
  at all and a fifth red cannot appear on one page. An explicit `rule` still overrides.
- The ramp **starts** at the pure hue — the biggest tile of every square is the discipline
  colour itself; only the smaller tiles wash toward white. Previously the darkest tile was
  already 10 % diluted, so the pure colour never actually appeared on screen.
- v0.1.0's electrical exception (`#E0A800`, justified as "black text at ~2:1 on pure yellow")
  is **removed — the premise was wrong.** Black on `#FBD000` measures **12.08:1**. The colour
  was muted to fix a problem that did not exist.
- Where a pure hue genuinely cannot be used is *text on the white card*: `#FBD000` at 8.5 px
  on `#FBFCFD` is 1.4:1. So the title ink is no longer a second hand-picked colour but is
  **derived** from the pure hue by `autoInk()` — same hue, value walked down only until it
  clears 4.5:1. Red barely moves (`#E02420`), yellow travels (`#887000`).

## 5. Open points for whoever wires it

1. ~~**Small-count areas look empty.**~~ **Settled 2026-07-29:** fall back to the card row
   under 3 classes, decision in the caller. Implemented as `MIN_TILES` / `MIN_TILES102`.
2. **Manual valves are not assets yet** (they live in `plant_manual_valves`, Stage-2). They
   are the biggest mechanical tile in both views while NOT being inside the corner total.
   Either promote them to `plant_assets` (then the total moves and the note goes away) or
   keep the current tooltip. Do not silently drop them from the tile — the count is real.
3. **Print / PDF export — still open.** The deck exports through `Print / Export PDF`; check
   the squares at A4 landscape before shipping. SVG scales, but `minLabel` was tuned on
   screen, and the label-degrade rule means a narrower box silently drops words rather than
   shrinking them.
4. A `TamDisc.squarify` unit test belongs next to the geometry checks: sum of tile areas
   must equal `w*h` and no rectangle may overlap. Both hold — re-verified at 190×158 on the
   five real class lists (home ×2, area 330 ×2, unit 310), exact area, zero overlap.
5. **The electrical tail is thin.** 13 classes in one 210 px square puts the last six
   (2 · 2 · 2 · 4 · 6 · 6) below `minValue`, so they render as colour and tooltip only. That
   is the documented degrade, not a bug, but if it reads as noise the switchboard classes
   (busbar · coupler · board · e-house · metering) could be grouped into one SWITCHBOARD
   tile — at the cost of losing the drawing's own words.
6. **Industry axes are missing from the DB.** A load schedule is classified by *duty*
   (continuous / intermittent / standby, which sets the demand factor) and by *criticality*
   (normal / essential / critical-UPS) — NORSOK E-001 and IEC 61892-2 both build the
   consumer split that way. Neither exists in `plant_electrical_assets`. Mario's call
   (2026-07-29): **write the change request against ITALFLUID, do not migrate** — the values
   have to come from their load-list document, not from us.
7. **One tile is under 4.5:1**: mechanical rank-2 red, `rgb(231,55,51)`, black 11 px bold at
   **4.27:1**. It is the worst pair in the whole ramp and only appears when Mechanical has
   many classes. 11 px bold sits just under the WCAG "large text" cut, so it passes 3:1 and
   misses 4.5:1. Fixing it means either muting red — which is exactly what we just undid — or
   skipping the mid-luminance step in the ramp. Left as-is deliberately; raise it only if
   somebody reads the squares as a compliance artefact.

## 6. Symbols

Squares carry no icons; the card fallback still does, so the glyph vocabulary is still live
in both files and cannot be deleted.

The squares carry no icons on purpose — at tile scale a 13 px glyph competes with the
number. The glyph vocabulary stays in the card band and in the tables (`PV_ICONS` in
`eni/index.html`, mirrored in the module deck: PUMP · HX · FILTER · FAN · HEATER · MVLV ·
COMP · INSTP/T/L/F/Z/A/G).

---

## 7. Changelog

**v0.2.0 — 2026-07-29 · pure palette**

- Four pure Mario hues, no muted variants; `TamDisc.MARIO` exported and resolved from the
  discipline title, so call sites pass no `rule`/`ink` at all.
- `TamDisc.autoInk(hex)` exported: derives the readable title ink from a pure hue.
- Ramp starts at the pure colour (biggest tile undiluted) instead of 10 % washed.
- Tile text now picks black/white by **WCAG relative luminance** rather than a
  `0.299/0.587/0.114` brightness guess, which was choosing white on several light greens.
- **Bug fix, not cosmetic:** `worst()` — the row aspect-ratio test at the heart of the
  squarified treemap — returned a malformed expression in v0.1.0
  (`Math.max(mx/mn, mn/mx ? … : Infinity, …)`), so rows were being closed on a meaningless
  number and the layout was not actually squarified. It is now
  `Math.max(len/mn, mx/len)` per Bruls et al. Tiles are visibly closer to square; **the
  layout of every square changes**, which is worth a look before this replaces the card band.
- Demo updated and re-rendered; `?v=` bumped to `0.2.0` at all call sites.

**v0.3.0 — 2026-07-29 · deeper ramp**

- The ramp now walks from the pure hue DOWN into deeper shades of it, instead of
  washing toward white. Mario sent a reference treemap and asked for that depth: the
  tail of a long square used to be a row of near-white rectangles, weak on a
  projector. `DEEP = 0.58` sets how far the smallest tile goes (pure → 42 %).
- Consequence, and it is the point: roughly two tiles in three now carry **white**
  text instead of black. The exceptions are the pure top tiles of yellow, green and
  blue — white on `#FBD000` is 1.7:1 — so those keep black. That is contrast, not
  preference.
- **Hue mapping unchanged.** The reference maps mechanical to blue, electrical to
  red, control to gold. Ours stays mechanical red · electrical yellow ·
  instrumentation green · control blue, because that mapping is the discipline code
  used by the rules, the cards, the legends and the single line. Mario's call.
- **Direction differs from the reference** on purpose: it puts the darkest tile on
  the biggest class, we keep the pure hue there, because "the ramp starts at the pure
  hue" was set earlier the same day and the 3.4 px rule bar is too thin to carry the
  discipline colour alone. One line to flip — see the comment on `ramp()`.
- Worst tile-text contrast across the whole ramp is now 4.30:1 (mechanical mid-rank,
  black on `rgb(148,25,22)`-ish), same figure as v0.2.0.

**v0.3.1 — 2026-07-29 · the reference palette, sampled**

Mario: *"why blue is different from picture, use these palettes"*. The four hues were
read pixel-for-pixel out of his reference images instead of matched by eye:

| discipline | was | now | note |
|---|---|---|---|
| MECHANICAL | `#E52521` | `#E52521` | already identical to the reference |
| ELECTRICAL | `#FBD000` | `#F4C320` | a shade warmer, less acid |
| INSTRUMENTATION | `#43B047` | `#3FA540` | slightly deeper |
| CONTROL | `#049CD8` | `#2B6BD1` | **the one he spotted** — cyan → royal blue |

- **Mapping unchanged.** The reference calls mechanical blue and electrical red; ours
  stays red / gold / green / royal because that mapping is the product's discipline
  code, used by the rules, the cards, the legends and the single line.
- Worth having: `#2B6BD1` is dark enough that white text wins on the pure hue
  (5.09:1), so the control square reads white throughout like the reference, and
  `autoInk` returns the pure blue itself for the title.
- The deck's own theme variables (`--ok:#1F8A4C`, `--blue:#0B5CAD`) were NOT touched —
  they colour the process diagrams and status chips, not the squares.
- Library `?v=` bumped to `0.3.1`; the inlined copy in module 102 re-pasted.

**v0.4.0 — 2026-07-29 · all tile labels white**

Mario: *"all labels white … label inside squares"*. Every number and word inside a
square is white. `inkOn()` returns `#FFFFFF` unconditionally — the per-tile
black/white choice is gone, because that is what produced the mixed squares.

That is a statement about type, so it became a constraint on the FILL. A tile may only
be as light as white text can survive on it, so the ramp no longer always starts at
the pure hue: it starts at the deepest point where white clears `WHITE_MIN` and walks
down from there.

| discipline | start | top tile | white contrast |
|---|---:|---|---:|
| MECHANICAL `#E52521` | 1.00 — unchanged | `rgb(229,37,33)` | 4.55 |
| CONTROL `#2B6BD1` | 1.00 — unchanged | `rgb(43,107,209)` | 5.09 |
| INSTRUMENTATION `#3FA540` | 1.00 — unchanged | `rgb(63,165,64)` | 3.15 |
| ELECTRICAL `#F4C320` | **0.74** | `rgb(181,144,24)` | 3.01 |

**Only gold moves.** White on pure `#F4C320` is 1.66:1 and cannot be read, so the
electrical tiles sit a shade below the pure value. The pure gold is still on the card
— it is the rule bar and the discipline title.

**`WHITE_MIN = 3.0` is a deliberate near-miss, not a pass.** It is the WCAG large-text
bound; the tile numbers are 11 px bold, just under the size that bound is written for.
It keeps red, green and blue at full purity and gold still reading as gold. Set it to
**4.5** for the strict rating — one number, nothing else changes — and gold drops to
`rgb(144,115,19)`, an olive that stops reading as the electrical colour. The source
treemap runs white on its gold at about 1.7:1, so either setting beats the reference.

Worst white-on-tile contrast across every hue and every square length: **3.01:1**.

**v0.4.1 — 2026-07-29 · the palette exactly as supplied**

Mario: *"keep colors I sent you, don't put that gold, make them exactly as I told
you"*. `WHITE_MIN` and the start-factor logic of v0.4.0 are **removed**. The four
hues are used verbatim and the biggest tile of every square carries its pure hue:

    MECHANICAL #E52521 · ELECTRICAL #F4C320 · INSTRUMENTATION #3FA540 · CONTROL #2B6BD1

Labels stay white at every rank. The ramp only walks DOWN into deeper shades of the
same colour — nothing is ever lightened or muted.

v0.4.0 had darkened the gold so white text would clear a contrast bound. That was the
same mistake v0.1.0 made with `#E0A800`: changing a colour the owner had chosen, to
satisfy a rule he had not asked for. Reverted.

**Known and accepted:** white on pure `#F4C320` is 1.66:1, below every WCAG bound, so
the number on the largest electrical tile is the weakest text in the set. The source
treemap does the same at the same ratio. **Do not "fix" this by changing the palette.**
If a print or an audit ever forces it, add a text shadow or halo to the tile numbers —
that keeps the colour and buys the legibility.

**Integration — 2026-07-29 · all three call sites wired**

- `eni/index.html`: `discBoxCard()` extracted from `discBand()` so both renderers share one
  card box; new `discRow()` picks square-or-card per discipline; `renderHome()` and
  `renderArea()` call it. ELECTRICAL made a true partition in both (§3b).
- `modules/module-102-unit-330-310.html`: pack inlined (deck stays one offline file);
  `buildBand102()` builds tile **data** and renders squares or cards from it; squares route
  clicks through the new `window.DISC102[unit](group, filter, family)` so a tile opens the
  identical modal a card opened. Verified: square tile → "Pumps · Unit 330 (10)", family tile
  → "Instruments · Pressure (P) · Unit 330 (30)", card → the motors table.
- Not verified: the live plant/area pages against real Supabase data — only the renderer was
  exercised, with the registry figures of 2026-07-29 as stubs. Load the viewer once before
  publishing.
