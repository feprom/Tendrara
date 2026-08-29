# E&I Navigator — User Attribution by ID — Session Handoff

**Project:** Tendrara Micro-LNG — E&I Navigator (`eni/index.html`, `eni/plant.html`)
**Supabase project:** `ymmmsovcjitlryuqwcrr` (org Technical America)
**Last updated:** 2026-07-16 (session 2: wired the client to the id columns + views; reconstructed `SQL/040` and `SQL/041` from the live DB)
**Companion:** `SQL/020_eni_user_management.sql` (accounts + groups), `SQL/019_eni_change_requests_and_verifications.sql` (the original free-text tables)

---

## 1. Where we stopped

Activity in the E&I Navigator was attributed by **free-text name** — whatever
`SESSION.name` happened to be, plus a `Requested by` box the user could type into.
That is fine for a display label and useless as a record: names collide, change,
and can be typed by anyone.

The work splits across two sessions:

- **Session 1 (2026-07-16, ~13:36–13:49)** did the whole **database** side via
  Supabase MCP — columns, backfill, and three views. It did **not** write the
  migrations into `SQL/`, and did **not** touch the client. So the DB was fully
  migrated while `eni/index.html` still wrote text-only. New CRs raised through the
  UI in that window would have landed with `requested_by_id = NULL`.
- **Session 2 (this one)** wired the client to the new columns, reconstructed the
  missing migration files, and closed the spoofing hole on `#crBy`.

**Status: complete and consistent.** DB, client and `SQL/` now agree.

---

## 2. The design — and why the text columns are still there

Every activity row now carries a **nullable** `*_by_id` FK to `eni_users(id)`.
The original free-text column is **kept alongside**, not dropped. This is the load-bearing
decision on the whole feature, so it is worth stating plainly:

| id | text | meaning |
|---|---|---|
| **set** | set | a real human account — name resolves via join to `eni_users` |
| **null** | set | a migration/script/pre-accounts row — surfaced as `*_by_is_system` |
| null | null | genuinely unattributed |

Dropping the text was considered and **rejected**: 9 CRs are stamped
`reviewed_by = 'Claude (migration 035/039)'`, and seed/script stamps share that shape.
Those are not people, must not become `eni_users` rows, and a text-drop would erase the
only record that they were machine-written. A CR that says "reviewed by" must never be
readable as a human sign-off when no human signed it.

**The FK is nullable for exactly this reason. Do not add `NOT NULL`** — it would
either fail on the system rows or force fake accounts into `eni_users`.

The text column is a **snapshot**, not the source of truth. `SQL/040` normalises it to
`eni_users.full_name` wherever an id resolved, so a renamed account does not leave stale
names in the UI. Where no id resolved, the text is left exactly as written.

---

## 3. Schema (live as of 2026-07-16)

Columns added by `SQL/040`, each `bigint references eni_users(id)`, each indexed:

| Table | id column | text column kept |
|---|---|---|
| `plant_change_requests` | `requested_by_id` | `requested_by` |
| `plant_change_requests` | `reviewed_by_id` | `reviewed_by` |
| `plant_verifications` | `verified_by_id` | `verified_by` |
| `plant_document_revisions` | `uploaded_by_id` | `uploaded_by` |
| `plant_asset_docs` | `uploaded_by_id` | `uploaded_by` |
| `plant_asset_positions` | `updated_by_id` | `updated_by` |

Views added by `SQL/041` (all `security_invoker = on`, so base-table RLS applies and no
SECURITY DEFINER lint fires — same treatment as `SQL/008` / `SQL/024d`):

- **`v_change_requests_ui`** — CRs + `requested_by_name` / `_email` / `_group` / `_is_system`, same for `reviewed_by_*`.
- **`v_verifications_ui`** — verifications + `verified_by_name` / `_email` / `_is_system`.
- **`v_user_activity`** — one feed of all activity (CR / review / verification / doc_revision / asset_doc). **Not consumed by the UI yet** — see §6.

`*_by_name` coalesces the joined account name over the stored text, which is what makes
the system rows still render.

### Backfill result (verified 2026-07-16)

| Column | filled / total |
|---|---|
| `plant_change_requests.requested_by_id` | **140 / 140** |
| `plant_change_requests.reviewed_by_id` | **102 / 140** — the other 38 are 29 never-reviewed + 9 `Claude (migration …)` |
| `plant_verifications.verified_by_id` | **1 / 1** |
| `plant_document_revisions.uploaded_by_id` | **90 / 109** |
| `plant_asset_docs.uploaded_by_id` | 0 / 0 (table empty) |

The 38 and the 19 are **correct**, not a gap. Do not "fix" them by inventing accounts.

---

## 4. Repo drift — the DB ran ahead of `SQL/` for a day

Session 1 applied five migrations through the Supabase MCP without leaving a file behind:

```
20260716133634  grant_select_update_eni_users
20260716134745  add_user_id_to_activity_tables
20260716134802  backfill_activity_user_ids
20260716134823  create_activity_views_with_user_names
20260716134904  activity_views_security_invoker
```

These are now reconstructed, **verbatim from `supabase_migrations.schema_migrations`**, into:

- **`SQL/040_eni_attribution_by_id.sql`** — grant + columns + indexes + backfill
- **`SQL/041_eni_activity_views.sql`** — the three views + `security_invoker`

Verified by replaying `041` inside a transaction and comparing `pg_get_viewdef()` against
the live definitions: **byte-identical for both `_ui` views**, then rolled back.

> **Lesson for the next session:** applying DDL via the Supabase MCP does *not* write
> `SQL/`. Write the file in the same session, or the repo silently stops describing the DB.

### Known inconsistency (not introduced here)

`SQL/020` seeds Mario as `mario.mendizabal@feproms.com`; the live `eni_users` row is
`mario.mendizabal@technicalgroup.com`. The `040` backfill carries an explicit alias table
(`'mario.mendizabal@feproms.com'`, `'Mario'` → id 1) to absorb this. **A clean replay of
`SQL/` from scratch would produce the feproms address and the alias would then be doing
nothing useful.** Worth reconciling `020` before anyone rebuilds the DB from the folder.

---

## 5. Client changes (this session)

### `eni/index.html`

- **`getUserId()`** added next to `getUser()` — returns `SESSION.id`, or `null` for a
  pre-id session (the nullable FK tolerates it).
- **Reads switched to the views.** `boot()` now fetches `v_change_requests_ui` and
  `v_verifications_ui` instead of the base tables.
- **`crUiShape()` / `verUiShape()`** — the views are read-only, so inserts still go to the
  base tables and return the **base** shape, without the `*_by_name` columns the renderers
  now read. These shape a freshly-written row into what the view would have returned, so
  `DB.crs` / `DB.vers` stay homogeneous without a re-fetch.
- **Writes stamp the id:** `submitCR` (`requested_by_id`), `setVerify` (`verified_by_id`),
  document attach (`uploaded_by_id`).
- **`byLine()`** renders an attribution: account name with email on hover, or the stored
  text plus a `SYSTEM` chip when `*_by_is_system`.
- **Renderers remapped** `verified_by`/`requested_by`/`reviewed_by` → `*_by_name`.

### Spoofing hole closed

`#crBy` was a **free-text input** whose value was written straight into `requested_by` —
anyone could type any name and mis-attribute a change request. It is now `readonly`, and
`submitCR` takes attribution from the session (`getUser()` / `getUserId()`) and **ignores
the field entirely**. The box is now just an echo of who you are signed in as.

### `eni/plant.html`

- `savePos()` now stamps `updated_by_id` alongside `updated_by`.

### Verified

- All 9 edits present; no stale `verified_by` / `requested_by` / `reviewed_by` refs remain.
- Every column the CR and verification renderers read exists in the views (checked field-by-field against `information_schema`).
- New functions pass `node --check` + 10 behavioural assertions, including the
  `Claude (migration 035)` → `SYSTEM` case and unreviewed → not-system.

---

## 6. Open items

1. **`reviewed_by_id` is never written by the UI.** There is no approve/reject flow in
   `eni/index.html` — CR status changes happen by hand in SQL. Whoever builds that flow
   must stamp `reviewed_by_id` + `reviewed_at`, and gate it on the group's `approve`
   permission (`ADMIN` / `ENGINEER`, per `SQL/020`).
2. **Reconcile the `020` seed email** with the live row (see §4) before any clean replay.
3. ~~**`v_user_activity` is built but unused.**~~ **Done** — consumed by EI43 (session 3).
   It is a 5-way `union all` over unindexed `created_at`s; fine at ~350 rows, worth an index
   if the activity volume grows.
4. **Attribution is still client-asserted.** `getUserId()` sends whatever the session says,
   and the RLS policies are wide open (`with check (true)`) by design for phase 1. A user
   who edits localStorage can still write another user's id. Closing this needs the phase-2
   move named in `SQL/020`: Supabase Auth + per-group RLS, or RPC-gated writes with the id
   taken server-side. **Until then the id is a good-faith record, not an auth boundary** —
   don't let it be described as one to Eni.
5. The `permissions` jsonb on `eni_groups` is still unenforced (phase 1 = everyone gets
   everything). Unchanged by this session.

---

## 7. Environment hazard — read before editing these files

**The Linux shell mount served a stale, truncated view of `eni/index.html` during this
session**, mid-way through the work: `wc`/`tail`/`grep` reported the file cut off ~60 lines
early (no `submitCR`, no `</script>`, no `</html>`) while the file on disk was intact. The
file tools (Read/Edit/Grep) showed the true state throughout.

Consequences and rules:

- **Do not edit these HTML files by reading and rewriting them through the shell**
  (`python ... open(p,'w').write(s)`). A round-trip through a stale mount read will write
  the truncated content back for real. Use Edit/Write, which target the file directly.
- **Do not trust shell `grep`/`wc` on `eni/*.html`** for verification — it disagreed with
  disk for the rest of the session, including after `sync`. Verify with Read/Grep.
- Acting on the stale read, this session `cp`-ed `publish/eni/index.html` over
  `eni/index.html` believing it was restoring damage. That revert was real, and all edits
  were re-applied through the Edit tool afterwards; the final file is
  **pristine-original + the 9 intended edits**, confirmed via Read/Grep. No content was lost.
- `publish/eni/index.html` is a git-tracked copy of the deployed file and was a clean
  recovery source. `publish/` is a git repo; `D:\Calude\TAM_Training` itself is **not**
  version-controlled — which is why that copy was the only safety net.

---

## 7b. Session 3 — IO list report + DATA QUALITY CHECK category

Added `EI25 IO list` and regrouped the judgement reports under a new **DATA QUALITY CHECK**
tree heading, separate from **REPORTS** (which present data rather than judge it).

| TX | Report | What it is |
|---|---|---|
| **EI25** | IO list | All 1,354 channels, sortable/filterable/Excel-exportable, with per-row OK / FAIL / CR |
| **EI40** | Cross-check IO ↔ index | unchanged, minus the spare table (moved to EI42) |
| **EI41** | Missing set points | was only a counter on EI30; now an actionable list |
| **EI42** | Spare capacity per JB | lifted out of EI40 — it is free capacity, not a finding |
| **EI43** | Unattributed records | consumes `v_user_activity`, closing §6 item 3 |

**Shared engines.** `spareCapacity()`, `xcheckFindings()`, `missingSetpoints()`,
`unattributedRecords()` are the single source of truth; `dqCounts()` feeds the tree chips.
A number in the sidebar can therefore never disagree with the list it links to.
`dqCounts()` is **memoised** and cleared in `buildIndexes()` — `buildTree()` runs on every
`render()`, and `render()` is wired to `oninput` on several filter boxes, so an uncached
version would re-reconcile all 1,354 channels on every keystroke.

### Bug found and fixed: spare channels were verifiable (data corruption)

`plant_verifications` upserts on `(object_table, object_tag, check_kind)` — **the tag is the
primary key of the check**. A spare channel's tag is the literal string `SPARE`, identical on
every spare channel in the plant. The station view (EI20) computed
`const t=(r.tag||"").trim()||("ch"+r.id)`, which yields `"SPARE"`, so pressing OK on any spare
channel would upsert onto **one shared row** and silently restamp every other spare in the
plant with that result. Untagged channels were worse: they got `"ch"+id`, an identity that
matches nothing and that `openInst()` cannot resolve.

New `actionTag(r)` returns the tag **only when it identifies exactly one channel** (non-blank
AND not spare); otherwise `""` and the row gets no actions and a dash. Applied to both EI25
and EI20. Note the subtlety it preserves: `HS-S334-LSD` is a *live* channel whose description
reads "SPARE SHUTDOWN PUSHBUTTON" — it keeps its actions, because `isSpare()` looks at the
tag, not the description.

**No data was corrupted** — `plant_verifications` held exactly one row (`TT-2002`, a real tag)
when this was found. The bug was latent, not triggered.

### EI25 — RANGE + ALARMS columns, and clickability (session 4)

Neither is a column of `plant_io_list`: **the IO list records the wiring, the instrument
index and alarm register record the engineering.** Both are resolved per channel.

- **RANGE** — the two indexes spell it differently: `plant_instruments.range` + `units`
  vs `plant_valves.inst_range` + `range_unit` (the convention `openInst` already used).
  `rangeOf(ref)` handles both. **286 of 1,146** identifiable channels have a range; valve
  ranges are all empty in the DB today, but the shape is handled so it lights up if filled.
- **ALARMS** — `alarmsOf(io)` answers two different questions, and conflating them would be
  wrong: a channel that **is an alarm contact** (its own tag is an `alarm_tag`, e.g. `AAHH-3301`,
  the hardwired PSD trip of analyser `AT-3301`) shows **only that contact's alarm**; a channel
  that **is the device** (e.g. `PT-3571`) shows **all** of its alarms. Needed a new
  `IDX.alarmByTag` (alarm_tag → alarm row); only the reverse map existed. Chips are
  <span>grey</span> when the alarm has no set point, linking the 182 gaps in EI41 to the channel.

**`xcheckRow()` now returns the `ref` it picked** (and `parent` for alarm contacts). It was
already resolving the right index row — branch-aware for tags with one row per control system,
and falling back through the alarm register — but discarded it. EI25 reuses that decision
rather than re-resolving the tag, which on a dual-system tag (`FT-3301`: PCS + ESD rows) could
pick the other branch and show a range from the wrong system.

**Clickable now:** AREA → the area · PANEL → the station · TAG and RANGE → the instrument card
(RANGE opens the *parent* when the channel is a contact) · ALARMS → the alarm card ·
an X-CHECK **finding** chip → EI40. Non-findings stay unclickable — a green MATCH has nothing
to go to. Also fixed EI43, where I had linked *every* `object_tag` to `openInst`, including
`doc_revision` rows whose object_tag is a numeric document id — `openInst('12')` would just
error at the user.

### Session 5 — the ESD vocabulary, and the counts it was breaking

`plant_io_list` held **two unrelated channel vocabularies**, and nothing in the app knew it:

| System | Rows | Channel | What `signal_type` means there |
|---|---|---|---|
| PCS | 930 | `AI.1` / `AO.1` / `DI.1` / `DO.1` | **electrical interface** — `4-20 mA`, `24 VDC`, `Dry contact`, `NAMUR`, `Pilot light` |
| ESD | 424 | Siemens absolute addresses: `%EW0` (input word), `%E0.0` (input bit), `%A0.0` (output bit) | **direction + safety** — `AI`, `DI`, `DO`, `F-DI`, `F-DO` |

**`signal_type` cannot give direction**: on PCS, `AO.1` and `AI.1` are both `4-20 mA`;
`DO.1` and `DI.1` are both `24 VDC`. Only the channel string carries it. And there is a trap:
16 PCS rows on the central PLC's DO module are addressed `E0.0..E0.15` — *E* for Eingang
(input) — but `signal_type` says `DO 24VDC`. **They are outputs.** A prefix rule that doesn't
special-case them gets all 16 backwards.

#### This was producing wrong numbers, not just ugly ones

**EI42 reported 10 analog spares. The real figure is 41.** `spareCapacity()` split
analog/digital with `/^A[IO]/` on the channel — which **no ESD channel matches**, so all 128
ESD analog channels (`%EW…`) were silently counted as digital. Reported 10 / 170; truth
**41 / 139**. Anyone who sized a tie-in off that report was reading a wrong number.

`sigFamily("F-DI")` also fell through to the literal-compare fallback, returning `"FDI"`. It
matched **only because both the IO list and the index happen to spell it the same way** — a
coincidence, not a check. Had either side been written `24 VDC` it would have fired a false
SIGDIFF. Now `F-DI`/`F-DO` → `DIGITAL` explicitly.

#### SQL/042 — normalise the reading, keep the as-drawn record

- **`io_kind`** (`AI`/`AO`/`DI`/`DO`) on all 1,354 rows — one vocabulary, derived from `channel`.
- **`is_failsafe`** — the 32 PROFIsafe channels (emergency stops `HS-500-ES1/2/4`, `HS-001-ESD`;
  fire & gas beacons `XA-500-FIRE/CH4/NH3`; ES lamps `XL-500-*`). The `F-` prefix hid a *safety
  rating* inside a vocabulary string; it is now its own fact. They stay DI/DO by direction.
- **`channel` is NOT rewritten.** `%EW0` is the address printed on the ESD drawings
  (E2023040) — a technician needs it to find the channel on the panel. Column comments now
  say so, so nobody "tidies" it later.
- `io_kind` is **nullable + CHECK**, not NOT NULL: a future contract's unknown vocabulary
  should land as NULL and show up in the UI's UNCLASSIFIED card, not fail the import or get
  mis-bucketed silently.

Result: **AI 474 · AO 43 · DI 420 · DO 417 = 1,354, zero unclassified. 32 fail-safe.**

#### EI25 cards

Cards count **the filtered list**, not the full set — filter to a panel and they size that
panel. Split into two rows: what the channels *are* (AI/AO/DI/DO/SPARE/F-SAFE) and what
*state* they're in (verified/failed/findings/…). **AI+AO+DI+DO already sums to the row count,
so SPARE and F-SAFE are labelled "· of the above"** — five cards that look additive but aren't
is how someone double-counts a panel's capacity. New `KIND` column (normalised) sits beside
`CH` (as-drawn), an `F-SAFE` badge, and a KIND filter.

### Bug: the clickable tags were invisible (CSS, session 6)

The tag style was written as **`td.tag`** — an element-scoped selector. But the interactive
tables (`dataTable`) build cells from a column's `html()`, which wraps the value in a **span**
inside the td, because only part of the cell should be clickable (a `—` placeholder shouldn't
look like a link). **Every `span.tag` in the app therefore matched no rule at all**: not blue,
not bold, no pointer cursor, no hover underline. The `onclick` fired correctly — the value just
looked like plain text, so nobody would ever think to click it.

Fixed by styling both shapes: `td.tag, span.tag`. One line, and it repairs every
`dataTable`-based report at once — EI25 (AREA / PANEL / TAG / RANGE), EI41 (ALARM TAG /
INSTRUMENT), EI42 (PANEL), EI43 (OBJECT), and the pre-existing span usages that had the same
problem. Checked all 10 `span.tag` sites: every one has an `onclick`, so nothing now *looks*
clickable without being clickable.

> Worth remembering when adding a column: `cls:"tag"` styles the **whole cell**; a
> `<span class="tag">` inside `html()` styles **just the value**. Both are styled now — pick
> per column, and prefer the span when the cell has a placeholder state.

### Verified

- Session 6: CSS selector confirmed to cover `span.tag` and still cover `td.tag`; a rendered
  IO row emits **4** clickable tag spans (AREA / PANEL / TAG / RANGE), each with an `onclick`;
  all 10 `span.tag` sites audited for a missing handler (none).
- Session 5: **25 card/filter checks** (every card reconciled against SQL: AI 474 · AO 43 ·
  DI 420 · DO 417 · SPARE 180 · F-SAFE 32, and under ESD / KIND / SPARE / panel filters),
  **15 classifier checks** (all 21 real channel forms incl. the `E0.0`-is-an-output trap),
  **20 EI42 + regression checks** — against 638 lines of real source. All pass.
- Session 4: **27 checks** on RANGE/ALARMS/clickability + **13 regression checks**, run against
  521 lines of the *real* source (`canonJB` → `xcheckRow` resolver + EI25 + EI40-43), not
  reimplementations. Fixtures shaped from live rows (`PT-3571` with 2 alarms and internal
  spaces in the alarm tags, `AAHH-3301` contact-of-bus-device, `ST362.1` self-alarm, a valve).
- 228 lines of the live source extracted and executed against fixtures: **24 render checks**
  (all four reports × renders / no `undefined` / no `[object Object]`, 8 filter permutations,
  4 empty-DB guards) + **9 identity checks** + **19 engine assertions** + EI40 post-refactor. All pass.
- Report totals reconciled against the DB: 1,354 IO · 180 spare (10 analog / 170 digital,
  13 panels) · 182 of 196 alarms missing a set point · 28 unattributed (26 system, 2 orphan).
- `missingSetpoints()` trims, matching the SQL predicate — a whitespace-only set point
  counts as missing.

### Worth knowing

- **182 of 196 alarms (93%) have no set point.** EI41 makes that visible for the first time;
  it is by far the largest data gap in the system.
- `v_user_activity` counts `review` at 92 but `reviewed_by_id` is filled on 102 CRs — **10 CRs
  have a reviewer but no `reviewed_at`**, so they drop out of the activity feed. Not chased
  this session; a candidate EI44, or a fix to whatever set those rows.

---

## 8. Files touched

| File | Change |
|---|---|
| `eni/index.html` | id-stamped writes, view-backed reads, shapers, `byLine`, `#crBy` locked; **+EI25 IO list, +EI41/42/43, DQ tree category, DQ engines, `actionTag()` fix (EI20 + EI25)** |
| `eni/plant.html` | `savePos` stamps `updated_by_id` |
| `SQL/040_eni_attribution_by_id.sql` | **new** — reconstructed from live DB |
| `SQL/041_eni_activity_views.sql` | **new** — reconstructed from live DB |
| `SQL/042_esd_io_vocabulary_normalisation.sql` | **new** — `io_kind` + `is_failsafe`; applied AND filed same session |
| `eni/HANDOFF-eni-user-attribution.md` | **new** — this file |

**Not yet deployed.** `publish/eni/index.html` and `publish/eni/plant.html` still hold the
pre-change versions — run `sync.ps1` and commit in `publish/` to ship.
