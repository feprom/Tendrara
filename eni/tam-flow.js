/* ═══════════════════════════════════════════════════════════════════════════
   tam-flow.js — Tendrara process-flow diagram library
   ─────────────────────────────────────────────────────────────────────────
   ONE renderer for every process-flow representation, generated DIRECTLY from
   the database topology layer (migrations 048/049):

     plant_service_classes  → line colours / dash / category  (was SVC_STYLE)
     plant_process_links    → area↔area crossings (v_plant_block)
     v_area_flows           → per-area IN/OUT with HMB values per case
     v_area_energy          → duty / electric power per area
     plant_area_trains      → main equipment chain per unit (unit-summary)

   Same graphic language as Module 101 (plant map · area block · unit summary).
   No dependencies. Works in the ENI viewer, in training modules, standalone.

   API (all renderers return an SVG string; cards return HTML):
     TamFlow.load(sb)                    → data bundle from a supabase client
     TamFlow.fromViewer(DB)             → data bundle from the ENI viewer DB
     TamFlow.plantMap(data, opts)       → plant block diagram (opts.highlight)
     TamFlow.areaBlock(data, code, o)   → area process block (IN | skids | OUT)
     TamFlow.unitSummary(data, code, o) → Manual §3.1 unit-flow diagram
     TamFlow.hmbCards(data, code, o)    → IN / DUTY / OUT HMB cards (html)
     TamFlow.svcClass(data, code)       → service class {color,dash,width,…}
   opts.case: 'C1S' | 'C1W' | 'C2S' | 'C2W'  (default 'C1W')
   opts.onNavigate / opts.onEquip: names of global fns for inline onclick.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const MONO = "Consolas,monospace", SANS = "Segoe UI,Arial";
  const INK = "#15171A", SOFT = "#4A4F57", LINE = "#C9CED4", CRIMSON = "#C8102E";
  const FALLBACK_CLASS = { color: "#4A4F57", dash: "", stroke_width: 1.5, category: "OTHER", name: "LINE" };

  /* ── tiny helpers ─────────────────────────────────────────────────────── */
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const clip = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const n1 = v => v == null ? "—" : (+v).toLocaleString("en-US", { maximumFractionDigits: 1 });
  const n0 = v => v == null ? "—" : Math.round(+v).toLocaleString("en-US");

  function svcClass(data, code) {
    return (data._svcIdx && data._svcIdx.get(code)) || FALLBACK_CLASS;
  }
  function areaName(data, code) {
    const a = (data._areaIdx && data._areaIdx.get(String(code)));
    return a ? (a.description || "") : "";
  }
  function indexData(data) {
    data._svcIdx = new Map((data.classes || []).map(c => [c.service_code, c]));
    data._areaIdx = new Map((data.areas || []).map(a => [String(a.area_code), a]));
    return data;
  }

  /* value chip from a v_area_flows row's hmb jsonb: "16.6 MMSCFD · 46.0 barg · 4.6 °C" */
  function hmbChip(row, kase) {
    const h = row && row.hmb && (row.hmb[kase] || row.hmb.ALL);
    if (!h) return "";
    const parts = [];
    if (h.std_gas_flow_mmscfd != null && h.std_gas_flow_mmscfd >= 0.05)
      parts.push(n1(h.std_gas_flow_mmscfd) + " MMSCFD");
    else if (h.mass_flow_kg_h != null && h.mass_flow_kg_h > 0)
      parts.push(n0(h.mass_flow_kg_h) + " kg/h");
    if (h.pressure_barg != null) parts.push(n1(h.pressure_barg) + " barg");
    if (h.temperature_c != null) parts.push(n1(h.temperature_c) + " °C");
    return parts.join(" · ");
  }
  /* pick the "main" flow of an area for a direction: plant main path first, then
     by category priority (so loop/hub units like 340/360/370/410 still render) */
  function pickMain(rows, dir) {
    const pri = ["PRODUCT", "ENERGY", "REFRIGERANT", "CHEMICAL", "WATER"];
    return rows.find(f => f.direction === dir && f.is_main) ||
      pri.map(c => rows.find(f => f.direction === dir && f.category === c && f.hmb) ||
                   rows.find(f => f.direction === dir && f.category === c)).find(Boolean);
  }
  function arrowMarker(id, color) {
    return `<marker id="${id}" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="${color}"/></marker>`;
  }
  function markerDefs(colors) {
    return `<defs>${[...new Set(colors)].map(c => arrowMarker("tf-" + c.replace("#", ""), c)).join("")}</defs>`;
  }
  const mref = c => `url(#tf-${c.replace("#", "")})`;

  /* ── data loading ─────────────────────────────────────────────────────── */
  async function load(sb) {
    const all = async (t, order) => {
      let q = sb.from(t).select("*"); if (order) q = q.order(order);
      const { data, error } = await q;
      if (error) { console.warn("tam-flow: " + t + ": " + error.message); return []; }
      return data || [];
    };
    const [areas, classes, links, flows, energy, trains, equipment, skids, instruments, valves] = await Promise.all([
      all("plant_areas", "area_code"), all("plant_service_classes", "sort_order"),
      all("v_plant_block"), all("v_area_flows"), all("v_area_energy"),
      all("plant_area_trains", "seq"), all("plant_equipment", "tag"), all("plant_skids", "tag"),
      all("plant_instruments", "tag"), all("plant_valves", "tag")
    ]);
    return indexData({ areas, classes, links, flows, energy, trains, equipment, skids, instruments, valves });
  }
  function fromViewer(DB) {
    return indexData({
      areas: DB.areas || [], classes: DB.svcClasses || [], links: DB.plinks || [],
      flows: DB.aflows || [], energy: DB.aenergy || [], trains: DB.trains || [],
      equipment: DB.equip || [], skids: DB.skids || [],
      instruments: DB.inst || [], valves: DB.valves || []
    });
  }

  /* ── ESD / safety symbology ─────────────────────────────────────────────
     ESD-actuated valves (SDV/BDV/XV/UV…) draw as SMALL YELLOW diamonds;
     process control valves (FV/PV/LV/TV/PCV…) stay white. */
  const ESD_YELLOW = "#F7C600";
  const isEsd = s => /^(SDV|BDV|XV|XEV|UV|SDEV|BDEV|ESD)/.test(String(s || "").trim());
  function diamond(x, y, label, labelPos) {   // labelPos: 'above' | 'below'
    const esd = isEsd(label);
    const r = esd ? 6 : 8;                     // ESD diamonds smaller
    const ly = labelPos === "below" ? y + r + 22 : y - r - 12;   // breathing room from the arrow
    return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" transform="rotate(45 ${x} ${y})"
      fill="${esd ? ESD_YELLOW : "#fff"}" stroke="${esd ? "#8A6D00" : "#333"}" stroke-width="1.4"/>
      <text x="${x}" y="${ly}" text-anchor="middle" font-family="${MONO}" font-size="7.4"
        font-weight="${esd ? 700 : 400}" fill="${esd ? "#8A6D00" : "#333"}" data-live-kind="valve" data-tag="${esc(String(label).split(" ")[0])}">${esc(label)}</text>`;
  }
  /* group PSV-2001A + PSV-2001B → PSV-2001A/B */
  function groupAB(tags) {
    const by = new Map();
    (tags || []).forEach(t => {
      const m = /^(.*?)([A-D])$/.exec(t);
      const k = m ? m[1] : t;
      if (!by.has(k)) by.set(k, []);
      if (m) by.get(k).push(m[2]);
    });
    return [...by.entries()].map(([k, sfx]) => sfx.length ? k + sfx.sort().join("/") : k);
  }
  /* key instruments / safety valves of an equipment group (index `equipment` field + service text) */
  const _matches = (r, tags) =>
    (r.equipment && tags.includes(String(r.equipment).trim())) ||
    (r.service && tags.some(t => String(r.service).toUpperCase().includes(t.toUpperCase())));
  function equipKeyInstruments(data, tags, max) {
    const KEY = /^(PT|PDT|TT|LT|LIT|FT|AT)-/;
    const m = (data.instruments || []).filter(i => !i.removed && KEY.test(i.tag || "") && _matches(i, tags));
    return [...new Set(m.map(i => i.tag))].sort().slice(0, max || 6);
  }
  function equipSafetyValves(data, tags) {
    const m = (data.valves || []).filter(v => !v.removed && /^(PSV|TSV|VSV)-/.test(v.tag || "") && _matches(v, tags));
    return groupAB([...new Set(m.map(v => v.tag))].sort()).slice(0, 3);
  }
  /* flow-origin rule (mirrors v_instrument_flow_origin): which equipment does a
     flow instrument measure the outlet of? Parsed from the index service text;
     transmitters inherit their flow element's service via `equipment`. */
  function flowOrigin(data, tag) {
    const by = t => (data.instruments || []).find(i => (i.tag || "").trim() === t && !i.removed);
    const i = by(tag);
    if (!i) return null;
    let svc = String(i.service || "").toUpperCase();
    const fe = i.equipment ? by(String(i.equipment).trim()) : null;
    if (fe && fe.service) svc = String(fe.service).toUpperCase() || svc;
    const m = /FROM ([A-Z]{1,3}-[0-9]+[A-Z]?)/.exec(svc) || /^([A-Z]{1,3}-[0-9]+[A-Z]?) OUTLET/.exec(svc);
    return m ? m[1] : null;
  }

  /* ═════════════════════════════════════════════════════════════════════
     1 · PLANT MAP — all process areas, main path on the centre line
     ═════════════════════════════════════════════════════════════════════ */
  function plantMap(data, opts) {
    opts = opts || {};
    const kase = opts.case || "C1W";
    const hi = opts.highlight != null ? String(opts.highlight) : null;
    const nav = opts.onNavigate;
    const links = data.links || [];
    const hideCat = new Set(opts.showAll ? [] : ["UTILITY", "DRAIN", "RELIEF", "OTHER"]);

    /* main chain from is_main links */
    const mains = links.filter(l => l.is_main).sort((a, b) => (a.display_rank || 0) - (b.display_rank || 0));
    const chain = [];           // [{kind:'ext'|'area', label, name}]
    mains.forEach(l => {
      const f = l.from_area ? { kind: "area", label: l.from_area } : { kind: "ext", label: l.from_ext };
      const t = l.to_area ? { kind: "area", label: l.to_area } : { kind: "ext", label: l.to_ext };
      if (!chain.length) chain.push(f);
      else if (chain[chain.length - 1].label !== f.label) chain.push(f);
      chain.push(t);
    });
    const chainAreas = new Set(chain.filter(c => c.kind === "area").map(c => c.label));

    /* side areas grouped top/bottom by dominant category of their visible links */
    const sideLinks = links.filter(l =>
      !l.is_main && !hideCat.has(l.category) &&
      l.from_area && l.to_area &&
      (chainAreas.has(l.from_area) !== chainAreas.has(l.to_area)));
    const sideAreas = new Map();  // area → {cats:Set, partners:[chain areas]}
    sideLinks.forEach(l => {
      const side = chainAreas.has(l.from_area) ? l.to_area : l.from_area;
      if (chainAreas.has(side)) return;
      if (!sideAreas.has(side)) sideAreas.set(side, { cats: new Set(), partners: [] });
      const s = sideAreas.get(side);
      s.cats.add(l.category);
      s.partners.push(chainAreas.has(l.from_area) ? l.from_area : l.to_area);
    });

    /* geometry */
    const W = 1000, H = 380, BW = 118, BH = 58, mainY = 196;
    const nodePos = new Map();
    const nMain = chain.length;
    const slot = (W - 60) / nMain;
    chain.forEach((c, i) => {
      const x = 30 + slot * i + (slot - BW) / 2;
      if (!nodePos.has(c.label)) nodePos.set(c.label, { x, y: mainY, kind: c.kind });
    });
    /* side rows: REFRIGERANT/PRODUCT → top, everything else → bottom */
    const tops = [], bots = [];
    [...sideAreas.entries()].forEach(([a, s]) => {
      (s.cats.has("REFRIGERANT") || s.cats.has("PRODUCT") ? tops : bots).push([a, s]);
    });
    const place = (arr, y) => {
      arr.map(([a, s]) => {
        const xs = s.partners.map(p => (nodePos.get(p) || { x: W / 2 }).x);
        return [a, xs.reduce((u, v) => u + v, 0) / (xs.length || 1)];
      }).sort((p, q) => p[1] - q[1]).forEach(([a, x], i, all) => {
        let px = Math.max(20, Math.min(W - BW - 20, x));
        if (i > 0) { const prev = nodePos.get(all[i - 1][0]); if (prev && px < prev.x + BW + 24) px = prev.x + BW + 24; }
        nodePos.set(a, { x: px, y, kind: "area" });
      });
    };
    place(tops, 60); place(bots, 306);

    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">`;
    const colors = new Set(["#4A4F57"]);
    sideLinks.forEach(l => colors.add(svcClass(data, l.service_code).color));
    mains.forEach(l => colors.add(svcClass(data, l.service_code).color));
    s += markerDefs([...colors]);

    /* flows by link id (for value chips) */
    const flowById = new Map();
    (data.flows || []).forEach(f => { if (!flowById.has(f.id)) flowById.set(f.id, f); });

    /* main-path arrows (chips drawn later, above the node layer) */
    const chips = [];
    mains.forEach(l => {
      const f = nodePos.get(l.from_area || l.from_ext), t = nodePos.get(l.to_area || l.to_ext);
      if (!f || !t) return;
      const st = svcClass(data, l.service_code);
      const y = mainY + BH / 2, x1 = f.x + BW + 2, x2 = t.x - 3;
      s += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${st.color}" stroke-width="3" marker-end="${mref(st.color)}"/>`;
      const chip = hmbChip(flowById.get(l.id), kase).split(" · ")[0];   // short: flow only
      if (chip) chips.push([(x1 + x2) / 2, mainY + BH + 13, (l.stream_code ? l.stream_code + " · " : "") + chip]);
    });

    /* side arrows (orthogonal) */
    sideLinks.forEach((l, i) => {
      const f = nodePos.get(l.from_area), t = nodePos.get(l.to_area);
      if (!f || !t) return;
      const st = svcClass(data, l.service_code);
      const up = (chainAreas.has(l.from_area) ? t : f).y < mainY;
      const cx = a => a.x + BW / 2;
      const off = ((i % 5) - 2) * 11;
      const x1 = cx(f) + off, x2 = cx(t) + off;
      const y1 = f.y + (f.y < t.y ? BH : 0), y2 = t.y + (t.y < f.y ? BH : 0) + (t.y < f.y ? 2 : -2);
      const ym = up ? Math.min(f.y, t.y) + BH + 22 + (i % 3) * 8 : Math.max(f.y, t.y) - 22 - (i % 3) * 8;
      s += `<g><title>${esc((l.service_name || "") + " " + (l.description || ""))}</title>
        <polyline points="${x1},${y1} ${x1},${ym} ${x2},${ym} ${x2},${y2}" fill="none" stroke="${st.color}"
          stroke-width="${st.stroke_width || 1.6}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ""} marker-end="${mref(st.color)}"/>
        <text x="${(x1 + x2) / 2}" y="${ym - 3}" text-anchor="middle" font-family="${MONO}" font-size="7" fill="${st.color}">${esc(l.service_code)}</text></g>`;
    });

    /* nodes */
    nodePos.forEach((p, label) => {
      if (p.kind === "ext") {
        s += `<text x="${p.x + BW / 2}" y="${p.y + BH / 2 - 12}" text-anchor="middle" font-family="${MONO}" font-size="8.6" fill="${SOFT}">${esc(clip(label.split("(")[0].trim(), 18))}</text>
              <text x="${p.x + BW / 2}" y="${p.y + BH / 2 - 2}" text-anchor="middle" font-family="${MONO}" font-size="7" fill="${SOFT}">battery limit</text>`;
        return;
      }
      const isHi = hi === label;
      s += `<g ${nav ? `style="cursor:pointer" onclick="${nav}('area/${esc(label)}')"` : ""}>
        <rect x="${p.x}" y="${p.y}" width="${BW}" height="${BH}" rx="5" fill="${isHi ? CRIMSON : "#fff"}" stroke="${isHi ? CRIMSON : LINE}" stroke-width="1.5"/>
        <text x="${p.x + BW / 2}" y="${p.y + 25}" text-anchor="middle" font-family="${SANS}" font-size="15" font-weight="700" fill="${isHi ? "#fff" : INK}">UNIT ${esc(label)}</text>
        <text x="${p.x + BW / 2}" y="${p.y + 41}" text-anchor="middle" font-family="${SANS}" font-size="8" fill="${isHi ? "#ffd9df" : SOFT}">${esc(clip(areaName(data, label), 22))}</text>`;
      if (isHi) s += `<text x="${p.x + BW / 2}" y="${p.y - 8}" text-anchor="middle" font-family="${MONO}" font-size="10" font-weight="700" fill="${CRIMSON}">▼ YOU ARE HERE</text>`;
      s += `</g>`;
    });
    /* main-path value chips on top, with a soft halo so they stay readable */
    chips.forEach(([x, y, txt]) => {
      s += `<text x="${x}" y="${y}" text-anchor="middle" font-family="${MONO}" font-size="7.4" fill="${SOFT}" stroke="#fff" stroke-width="2.6" paint-order="stroke">${esc(txt)}</text>`;
    });

    s += `<text x="20" y="${H - 8}" font-family="${MONO}" font-size="7.5" fill="${SOFT}">GENERATED FROM plant_process_links · HMB CASE ${esc(kase)} · utilities/relief/drains hidden</text></svg>`;
    return s;
  }

  /* ═════════════════════════════════════════════════════════════════════
     2 · AREA BLOCK — IN column | skids/equipment | OUT column, with HMB
     ═════════════════════════════════════════════════════════════════════ */
  function areaBlock(data, code, opts) {
    opts = opts || {};
    const kase = opts.case || "C1W";
    const nav = opts.onNavigate, onEq = opts.onEquip;
    code = String(code);

    /* group flows by direction + other endpoint */
    const rows = (data.flows || []).filter(f => String(f.area_code) === code);
    const groups = new Map();
    rows.forEach(f => {
      const k = f.direction + "|" + (f.other_label || "?");
      if (!groups.has(k)) groups.set(k, {
        dir: f.direction, label: f.other_label || "?", area: f.other_area,
        name: f.other_area_name || "", links: [], svcs: new Map()
      });
      const g = groups.get(k);
      g.links.push(f);
      g.svcs.set(f.service_code, (g.svcs.get(f.service_code) || 0) + 1);
    });
    const pick = g => {   // representative link: main first, then curated HMB, then lowest class sort
      return g.links.find(l => l.is_main) || g.links.find(l => l.hmb) ||
        g.links.slice().sort((a, b) => (svcClass(data, a.service_code).sort_order || 99) - (svcClass(data, b.service_code).sort_order || 99))[0];
    };
    const gs = [...groups.values()].map(g => {
      g.rep = pick(g);
      g.chip = hmbChip(g.rep, kase);
      g.meters = [...new Set(g.links.flatMap(l => l.meter_tags || []))];
      g.ctrls = [...new Set(g.links.flatMap(l => l.control_tags || []))];
      g.h = 34 + (g.chip ? 11 : 0) + (g.meters.length + g.ctrls.length ? 11 : 0);
      return g;
    }).sort((a, b) => (b.rep.is_main - a.rep.is_main) || (b.links.length - a.links.length));
    const ins = gs.filter(g => g.dir === "IN"), outs = gs.filter(g => g.dir === "OUT");

    /* centre: skids + equipment */
    const eq = (data.equipment || []).filter(r => String(r.area_code) === code);
    const by = new Map();
    eq.forEach(r => { const k = (r.skid_tag || "").trim(); if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
    const skidDesc = t => { const s = (data.skids || []).find(x => (x.tag || "").trim() === t); return s ? (s.description || "") : ""; };
    const skids = [...by.entries()]
      .sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0])))
      .map(([t, r]) => ({ tag: t || null, desc: t ? skidDesc(t) : "LOOSE / FIELD EQUIPMENT", rows: r.sort((x, y) => String(x.tag).localeCompare(String(y.tag))) }));

    const W = 1000, GX = [8, 250], CX = 300, CW = 400, OX = 752, GGAP = 10;
    const MAXTAGS = 9;
    const skidH = s => { const shown = Math.min(s.rows.length, MAXTAGS), rws = Math.ceil(shown / 3) + (s.rows.length > MAXTAGS ? 1 : 0); return 26 + rws * 12 + 6; };
    const cInner = skids.reduce((n, x) => n + skidH(x) + 8, 0);
    const cH = Math.max(88, 40 + cInner + 6);
    const colH = arr => arr.reduce((n, g) => n + g.h + GGAP, 0);
    const H = Math.max(cH, colH(ins), colH(outs)) + 56;
    const cTop = 28 + Math.max(0, (H - 56 - cH) / 2);

    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">`;
    s += markerDefs(gs.map(g => svcClass(data, g.rep.service_code).color));

    /* centre box */
    s += `<g><rect x="${CX}" y="${cTop}" width="${CW}" height="${cH}" rx="8" fill="#fff" stroke="${LINE}" stroke-width="1.6"/>
      <rect x="${CX}" y="${cTop}" width="4" height="${cH}" rx="2" fill="${CRIMSON}" opacity=".85"/>
      <text x="${CX + 14}" y="${cTop + 20}" font-family="${MONO}" font-size="15" font-weight="700" fill="${CRIMSON}">${esc(code)}</text>
      <text x="${CX + 14}" y="${cTop + 32}" font-family="${SANS}" font-size="8" font-weight="700" fill="${INK}">${esc(clip(areaName(data, code), 52))}</text>`;
    let sy = cTop + 40;
    skids.forEach(sk => {
      const h = skidH(sk), shown = sk.rows.slice(0, MAXTAGS);
      s += `<g><rect x="${CX + 12}" y="${sy}" width="${CW - 24}" height="${h}" rx="5" fill="#F7F8FA" stroke="#E2E5E9"/>
        <text x="${CX + 20}" y="${sy + 13}" font-family="${MONO}" font-size="9.5" font-weight="700" fill="${sk.tag ? "#0B5CAD" : SOFT}">${esc(sk.tag || "LOOSE")}</text>
        <text x="${CX + 20}" y="${sy + 22}" font-family="${SANS}" font-size="6.8" fill="${SOFT}">${esc(clip(sk.desc || "", 64))}</text>`;
      shown.forEach((r, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        s += `<text x="${CX + 20 + col * ((CW - 44) / 3)}" y="${sy + 35 + row * 12}" font-family="${MONO}" font-size="8.4" fill="#0B5CAD" ${onEq ? `style="cursor:pointer" onclick="${onEq}('${esc((r.tag || "").trim())}')"` : ""}><title>${esc(r.service || "")}</title>${esc(clip(r.tag || "", 16))}</text>`;
      });
      if (sk.rows.length > MAXTAGS)
        s += `<text x="${CX + 20}" y="${sy + 35 + Math.ceil(MAXTAGS / 3) * 12}" font-family="${MONO}" font-size="7.6" fill="${SOFT}">+${sk.rows.length - MAXTAGS} more…</text>`;
      s += "</g>"; sy += h + 8;
    });
    s += "</g>";

    /* flow groups */
    const drawGroup = (g, y0, side, ye) => {
      const st = svcClass(data, g.rep.service_code);
      const bx = side === "in" ? GX[0] : OX, tx = bx + 8;
      const yg = y0 + g.h / 2;
      const isExt = !g.area;
      const svcTxt = [...g.svcs.entries()].slice(0, 3).map(([k, v]) => k + "×" + v).join(" · ") || "—";
      const tip = (g.rep.description || "") + (g.rep.stream_code ? " · HMB " + g.rep.stream_code : "");
      let o = `<g ${(!isExt && nav) ? `style="cursor:pointer" onclick="${nav}('area/${esc(g.area)}')"` : ""}>
        <title>${esc(tip || g.label)}</title>
        <rect x="${bx}" y="${y0}" width="240" height="${g.h}" rx="5" fill="#fff" stroke="${LINE}"${g.rep.is_main ? ` stroke-width="1.6"` : ""}/>
        <rect x="${bx}" y="${y0}" width="3" height="${g.h}" rx="1.5" fill="${st.color}"/>
        <text x="${tx}" y="${y0 + 13}" font-family="${MONO}" font-size="9.5" font-weight="700" fill="${CRIMSON}">${isExt ? "◈" : esc(g.label)}</text>
        <text x="${tx + (isExt ? 14 : 30)}" y="${y0 + 13}" font-family="${SANS}" font-size="7" font-weight="700" fill="${INK}">${esc(clip(isExt ? g.label : areaName(data, g.area), isExt ? 34 : 30))}</text>
        <text x="${tx}" y="${y0 + 24}" font-family="${MONO}" font-size="7.2" fill="${SOFT}">${g.links.length} line${g.links.length > 1 ? "s" : ""} · ${esc(svcTxt)}</text>`;
      let ly = y0 + 24;
      if (g.chip) { ly += 11; o += `<text x="${tx}" y="${ly}" font-family="${MONO}" font-size="7.4" font-weight="700" fill="${st.color}">${esc((g.rep.stream_code ? g.rep.stream_code + " · " : "") + g.chip)}</text>`; }
      if (g.meters.length || g.ctrls.length) {
        ly += 11;
        o += `<text x="${tx}" y="${ly}" font-family="${MONO}" font-size="7.2" fill="#0B5CAD">${esc([g.meters.length ? "◉ " + g.meters.join(",") : "", g.ctrls.length ? "⧫ " + g.ctrls.join(",") : ""].filter(Boolean).join("  "))}</text>`;
      }
      o += `</g>`;
      const mid = side === "in" ? (GX[1] + CX) / 2 : (OX - 4 + CX + CW) / 2;
      const x1 = side === "in" ? GX[1] - 2 : CX + CW, x2 = side === "in" ? CX - 2 : OX - 4;
      o += `<polyline points="${x1},${side === "in" ? yg : ye} ${mid},${side === "in" ? yg : ye} ${mid},${side === "in" ? ye : yg} ${x2},${side === "in" ? ye : yg}" fill="none"
        stroke="${st.color}" stroke-width="${st.stroke_width || 1.5}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ""} marker-end="${mref(st.color)}"/>`;
      return o;
    };
    let y = 28; ins.forEach((g, i) => { s += drawGroup(g, y, "in", cTop + ((i + 0.5) * cH / Math.max(1, ins.length))); y += g.h + GGAP; });
    y = 28; outs.forEach((g, i) => { s += drawGroup(g, y, "out", cTop + ((i + 0.5) * cH / Math.max(1, outs.length))); y += g.h + GGAP; });
    if (!ins.length) s += `<text x="${GX[0]}" y="${cTop + cH / 2}" font-family="${MONO}" font-size="8" fill="${SOFT}">NO INBOUND LINKS DIGITIZED</text>`;
    if (!outs.length) s += `<text x="${OX}" y="${cTop + cH / 2}" font-family="${MONO}" font-size="8" fill="${SOFT}">NO OUTBOUND LINKS DIGITIZED</text>`;
    s += `<text x="${GX[0]}" y="16" font-family="${MONO}" font-size="8.5" letter-spacing=".12em" fill="${SOFT}">IN — FROM</text>
          <text x="${OX}" y="16" font-family="${MONO}" font-size="8.5" letter-spacing=".12em" fill="${SOFT}">OUT — TO</text>
          <text x="${W - 8}" y="${H - 6}" text-anchor="end" font-family="${MONO}" font-size="7" fill="${SOFT}">plant_process_links · HMB ${esc(kase)} · ◉ meter · ⧫ control</text></svg>`;
    return s;
  }

  /* ═════════════════════════════════════════════════════════════════════
     3 · UNIT SUMMARY — Manual §3.1: inputs → equipment train → outputs
     ═════════════════════════════════════════════════════════════════════ */
  function unitSummary(data, code, opts) {
    opts = opts || {};
    const kase = opts.case || "C1W";
    code = String(code);
    const train = (data.trains || []).filter(t => String(t.area_code) === code).sort((a, b) => a.seq - b.seq);
    if (!train.length)
      return `<svg viewBox="0 0 1000 60" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto"><text x="500" y="34" text-anchor="middle" font-family="${MONO}" font-size="10" fill="${SOFT}">UNIT ${esc(code)} — EQUIPMENT TRAIN NOT CURATED YET (plant_area_trains)</text></svg>`;

    const rows = (data.flows || []).filter(f => String(f.area_code) === code);
    const mainIn = pickMain(rows, "IN"), mainOut = pickMain(rows, "OUT");
    /* the train line is drawn in the MAIN PRODUCT's class colour (single source of
       truth: plant_service_classes — no hardcoded "gas" fluid) */
    const mainRef = mainOut || mainIn;
    const mc = mainRef ? svcClass(data, mainRef.service_code).color : "#333";
    const waters = rows.filter(f => f.direction === "OUT" && f !== mainOut &&
      (f.category === "WATER" || ["WC", "DC"].includes(f.service_code)));
    const inChip = hmbChip(mainIn, kase), outChip = hmbChip(mainOut, kase);
    /* every meter/control already allocated to a link of this area (drawn on lines, not in boxes) */
    const linkMeterSet = new Set(rows.flatMap(f => [...(f.meter_tags || []), ...(f.control_tags || [])]));

    const W = 1000, H = 360;
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">`;
    const cols = ["#333", "#0B5CAD", "#1F8A4C", "#B26A00", mc];
    rows.forEach(r => cols.push(svcClass(data, r.service_code).color));
    s += markerDefs(cols);

    /* unit boundary */
    s += `<rect x="96" y="98" width="812" height="182" rx="8" fill="#FAFBFC" stroke="${CRIMSON}" stroke-width="1.5" stroke-dasharray="5 4"/>
          <text x="106" y="115" font-family="${MONO}" font-size="10" font-weight="700" fill="${CRIMSON}">UNIT ${esc(code)} · ${esc(areaName(data, code))}</text>`;

    /* feed in */
    const inLabel = mainIn ? (mainIn.other_label || "") : "";
    s += `<text x="6" y="176" font-family="${MONO}" font-size="9" fill="#333">${esc(clip(inLabel.split("(")[0] || "FEED", 12))}</text>`;
    if (inChip) s += `<text x="6" y="188" font-family="${MONO}" font-size="7.4" fill="#666"
                        data-live-kind="hmb" data-stream="${esc(mainIn.stream_code || "")}" data-case="${esc(kase)}">${esc(clip(inChip, 20))}</text>
                      <text x="6" y="198" font-family="${MONO}" font-size="7.4" fill="#666">${esc(mainIn && mainIn.stream_code ? "HMB " + mainIn.stream_code + " · " + kase : "")}</text>`;

    /* train geometry */
    const n = train.length, bw = 120, y0 = 173, bh = 64, x0 = 120;
    const gap = n > 1 ? (778 - x0 - n * bw) / (n - 1) : 0;
    const bx = i => x0 + i * (bw + gap);
    const my = y0 + 32;

    /* inlet arrow + optional inline element of step 1 */
    s += `<line x1="66" y1="${my}" x2="${bx(0) - 2}" y2="${my}" stroke="${mc}" stroke-width="3" marker-end="${mref(mc)}"/>`;
    train.forEach((t, i) => {
      if (t.inline_element) {
        const dx = i === 0 ? (66 + bx(0)) / 2 : bx(i - 1) + bw + gap / 2;
        s += diamond(dx, my, t.inline_element, i === 0 ? "below" : "above");
      }
      const x = bx(i);
      if (i > 0) s += `<line x1="${x - gap}" y1="${my}" x2="${x - 2}" y2="${my}" stroke="${mc}" stroke-width="3" marker-end="${mref(mc)}"/>`;
      s += `<rect x="${x}" y="${y0}" width="${bw}" height="${bh}" rx="5" fill="#fff" stroke="${CRIMSON}" stroke-width="1.6"/>
            <text x="${x + bw / 2}" y="${y0 + 22}" text-anchor="middle" font-family="${SANS}" font-size="14" font-weight="700" fill="${INK}">${esc(t.display_tag)}</text>`;
      const svc = (data.equipment || []).find(e => (t.equipment_tags || []).includes((e.tag || "").trim()));
      s += `<text x="${x + bw / 2}" y="${y0 + 35}" text-anchor="middle" font-family="${SANS}" font-size="7.4" fill="${SOFT}">${esc(clip(svc ? svc.service : "", 27))}</text>`;
      /* key instruments of this equipment group — future live-value hooks (data-live-tags).
         Flow meters allocated to a LINK are drawn on their line, never inside the box. */
      const keyInst = equipKeyInstruments(data, t.equipment_tags || [], 6)
        .filter(tg => !linkMeterSet.has(tg));
      if (keyInst.length) {
        const rows2 = [keyInst.slice(0, 3), keyInst.slice(3, 6)].filter(a => a.length);
        rows2.forEach((rw, ri) => {
          s += `<text x="${x + bw / 2}" y="${y0 + 47 + ri * 9}" text-anchor="middle" font-family="${MONO}" font-size="6.4" fill="#0B5CAD"
            data-live-kind="inst" data-live-tags="${esc(rw.join(","))}">${esc(rw.join(" · "))}</text>`;
        });
      }
      /* safety valves above the box, right corner (yellow — relief/ESD family) */
      const psvs = equipSafetyValves(data, t.equipment_tags || []);
      if (psvs.length)
        s += `<text x="${x + 2}" y="${y0 - 5}" font-family="${MONO}" font-size="6.8" font-weight="700" fill="#8A6D00"
          data-live-kind="psv" data-live-tags="${esc(psvs.join(","))}">⌃ ${esc(psvs.join(" · "))}</text>`;
      if (t.caption) s += `<text x="${x + bw / 2}" y="${y0 + bh + 19}" text-anchor="middle" font-family="${MONO}" font-size="7.6" fill="${CRIMSON}">${esc(t.caption)}</text>`;
      if (t.aux_note) {
        const up = !/blowdown|flare|drain/i.test(t.aux_note);
        const ay = up ? y0 - 33 : y0 - 33;   /* aux always drawn above; colour hints purpose */
        const col = /hot oil|kW/i.test(t.aux_note) ? "#B26A00" : /inhibitor|chem/i.test(t.aux_note) ? "#7A3FB3" : "#B26A00";
        s += `<line x1="${x + bw / 2}" y1="${ay + 8}" x2="${x + bw / 2}" y2="${y0 - 2}" stroke="${col}" stroke-width="1.5" marker-end="${mref(up ? col : col)}"/>
              <text x="${x + bw / 2}" y="${ay + 2}" text-anchor="middle" font-family="${MONO}" font-size="7.6" fill="${col}">${esc(t.aux_note)}</text>`;
      }
    });

    /* outlet: control diamond + destination box */
    const xEnd = bx(n - 1) + bw;
    const outSt = mainOut ? svcClass(data, mainOut.service_code) : null;
    const oc = outSt ? outSt.color : mc;
    s += `<line x1="${xEnd}" y1="${my}" x2="${W - 92}" y2="${my}" stroke="${oc}" stroke-width="3" marker-end="${mref(oc)}"/>`;
    const ctrl = mainOut && (mainOut.control_tags || [])[0];
    if (ctrl) s += diamond((xEnd + W - 92) / 2, my, ctrl, "above");
    if (mainOut) {
      s += `<rect x="${W - 90}" y="${my - 21}" width="82" height="42" rx="5" fill="#FBE9EC" stroke="${CRIMSON}" stroke-width="1.5"/>
            <text x="${W - 49}" y="${my - 2}" text-anchor="middle" font-family="${SANS}" font-size="12" font-weight="700" fill="${CRIMSON}">${esc(mainOut.other_area ? "U" + mainOut.other_area : clip(mainOut.other_label, 9))}</text>
            <text x="${W - 49}" y="${my + 11}" text-anchor="middle" font-family="${SANS}" font-size="7" fill="${SOFT}">${esc(clip(mainOut.other_area_name || "", 14))}</text>`;
      if (outChip) s += `<text x="${W - 8}" y="${my + 32}" text-anchor="end" font-family="${MONO}" font-size="7.6" fill="#333"
        data-live-kind="hmb" data-stream="${esc(mainOut.stream_code || "")}" data-case="${esc(kase)}">${esc((mainOut.stream_code ? mainOut.stream_code + " · " : "") + outChip)}</text>`;
    }

    /* boundary flow meters on the MAIN line itself */
    const inM = mainIn && (mainIn.meter_tags || [])[0];
    if (inM) s += `<text x="70" y="${my + 16}" font-family="${MONO}" font-size="7.2" fill="#0B5CAD" data-live-kind="meter" data-tag="${esc(inM)}">◉ ${esc(inM)}</text>`;
    const outM = mainOut && (mainOut.meter_tags || [])[0];
    if (outM) s += `<text x="${xEnd + 6}" y="${my + 16}" font-family="${MONO}" font-size="7.2" fill="#0B5CAD" data-live-kind="meter" data-tag="${esc(outM)}">◉ ${esc(outM)}</text>`;

    /* bottom outputs — one drop PER METER, hanging from its ORIGIN equipment box
       (rule of v_instrument_flow_origin: "WATER OUTLET FROM V-201" → the line
       leaves V-201's box and carries FT-2011; V-202's water carries FT-2021) */
    const drops = [];
    waters.forEach(f => {
      const meters = (f.meter_tags && f.meter_tags.length) ? f.meter_tags : [null];
      meters.forEach(m => {
        const org = m ? flowOrigin(data, m) : null;
        const ti = org ? train.findIndex(t => (t.equipment_tags || []).includes(org)) : -1;
        drops.push({ f, m, ti, org });
      });
    });
    const perBox = new Map(); let fallbackSlot = 0;
    drops.slice(0, 4).forEach(d => {
      const st = svcClass(data, d.f.service_code);
      const kIdx = perBox.get(d.ti) || 0; perBox.set(d.ti, kIdx + 1);
      const x = d.ti >= 0 ? bx(d.ti) + bw / 2 + (kIdx ? (kIdx % 2 ? -18 : 18) * Math.ceil(kIdx / 2) : 0)
                          : (150 + (fallbackSlot++) * 620);
      const left = kIdx % 2 === 1;              // alternate label side for same-box drops
      const anchor = left ? `text-anchor="end"` : "";
      const tx = left ? x - 8 : x + 8;
      const chip = hmbChip(d.f, kase);
      const dest = d.f.other_area ? "U" + d.f.other_area : (d.f.other_label || "");
      s += `<line x1="${x}" y1="${y0 + bh}" x2="${x}" y2="316" stroke="${st.color}" stroke-width="1.6" marker-end="${mref(st.color)}"/>`;
      if (d.m) s += `<text x="${tx}" y="288" ${anchor} font-family="${MONO}" font-size="7.2" fill="#0B5CAD" data-live-kind="meter" data-tag="${esc(d.m)}">◉ ${esc(d.m)}</text>`;
      s += `<text x="${tx}" y="299" ${anchor} font-family="${MONO}" font-size="8" fill="${st.color}">${esc(clip((d.org ? d.org + " " : "") + (st.name || "").toLowerCase() + " → " + dest, 34))}</text>`;
      if (chip) s += `<text x="${tx}" y="309" ${anchor} font-family="${MONO}" font-size="7.2" fill="${st.color}"
        data-live-kind="hmb" data-stream="${esc(d.f.stream_code || "")}" data-case="${esc(kase)}">${esc((d.f.stream_code ? d.f.stream_code + " · " : "") + chip)}</text>`;
    });

    /* legend — ONLY fluids from plant_service_classes (no hardcoded entries) */
    const cats = [...new Map(rows.map(r => {
      const st = svcClass(data, r.service_code);
      return [st.name.toLowerCase(), st.color];
    })).entries()].slice(0, 6);
    let lx = 120;
    cats.forEach(([nm, col]) => {
      s += `<line x1="${lx}" y1="344" x2="${lx + 20}" y2="344" stroke="${col}" stroke-width="3"/>
            <text x="${lx + 25}" y="347" font-family="${MONO}" font-size="8" fill="#666">${esc(clip(nm, 18))}</text>`;
      lx += 32 + nm.length * 5.4;
    });
    s += `<text x="${W - 8}" y="347" text-anchor="end" font-family="${MONO}" font-size="7" fill="${SOFT}">plant_area_trains + plant_process_links · HMB ${esc(kase)}</text></svg>`;
    return s;
  }

  /* ═════════════════════════════════════════════════════════════════════
     4 · HMB CARDS — IN · DUTY · OUT  (html, module-101 style)
     ═════════════════════════════════════════════════════════════════════ */
  function hmbCards(data, code, opts) {
    opts = opts || {};
    const kase = opts.case || "C1W";
    code = String(code);
    const rows = (data.flows || []).filter(f => String(f.area_code) === code);
    const mainIn = pickMain(rows, "IN"), mainOut = pickMain(rows, "OUT");
    const en = (data.energy || []).filter(e => String(e.area_code) === code);
    const eNow = en.find(e => e.case_code === kase);
    const duties = en.filter(e => e.thermal_duty_kw != null).map(e => e.thermal_duty_kw);

    const card = (cls, title, sub, kv) => `
      <div style="flex:1;min-width:220px;border:1px solid #C9CED4;border-radius:8px;overflow:hidden;background:#fff">
        <div style="display:flex;justify-content:space-between;padding:6px 10px;font:700 10px ${MONO};letter-spacing:.06em;color:#fff;background:${cls}">
          <span>${title}</span><span>${sub}</span></div>
        <div style="padding:6px 10px">${kv.map(([k, v]) => `
          <div style="display:flex;justify-content:space-between;border-bottom:1px dotted #E2E5E9;padding:3px 0">
            <span style="font:400 10px ${SANS};color:#4A4F57">${k}</span>
            <span style="font:700 10.5px ${MONO};color:#15171A">${v}</span></div>`).join("")}
        </div></div>`;

    const flowKv = f => {
      const h = f && f.hmb && (f.hmb[kase] || f.hmb.ALL);
      if (!h) return [["No HMB stream curated", "—"]];
      // each value carries live-binding hooks: swap textContent when SCADA/live data arrives
      const live = (field, txt) => `<span data-live-kind="hmb" data-stream="${esc(f.stream_code || "")}" data-field="${field}" data-case="${esc(kase)}">${txt}</span>`;
      const kv = [];
      kv.push(["Flow", live("flow", (h.std_gas_flow_mmscfd >= 0.05 ? n1(h.std_gas_flow_mmscfd) + " MMSCFD · " : "") + n0(h.mass_flow_kg_h) + " kg/h")]);
      kv.push(["Pressure", live("pressure_barg", n1(h.pressure_barg) + " barg")]);
      kv.push(["Temperature", live("temperature_c", n1(h.temperature_c) + " °C")]);
      return kv;
    };
    const cards = [];
    if (mainIn) cards.push(card("#1F6FB8", "▶ IN · " + esc(clip((mainIn.other_label || "").split("(")[0].trim(), 18)) + (mainIn.stream_code ? " (" + mainIn.stream_code + ")" : ""),
      (mainIn.meter_tags || []).map(esc).join(" "), flowKv(mainIn)));
    if (en.length) {
      const kv = [];
      if (eNow && eNow.thermal_duty_kw != null) kv.push(["Duty (" + kase + ")", n1(eNow.thermal_duty_kw) + " kW"]);
      if (duties.length > 1) kv.push(["Duty (all cases)", n1(Math.min(...duties)) + " – " + n1(Math.max(...duties)) + " kW"]);
      if (eNow && eNow.electric_power_kw != null) kv.push(["Electric", n1(eNow.electric_power_kw) + " kW"]);
      if (eNow && eNow.by_equipment) kv.push(["Equipment", esc(Object.keys(eNow.by_equipment).join(" · "))]);
      cards.push(card("#B26A00", "◈ ENERGY · U" + esc(code), "thermal / electric", kv));
    }
    if (mainOut) cards.push(card("#1F8A4C", "▶ OUT · " + esc(clip((mainOut.other_label || "").split("(")[0].trim(), 18)) + (mainOut.stream_code ? " (" + mainOut.stream_code + ")" : ""),
      (mainOut.control_tags || []).map(esc).join(" "), flowKv(mainOut)));
    /* utility & energy feeds card: what the area CONSUMES (lines + duty, no HMB values on utilities) */
    const feeds = rows.filter(f => f.direction === "IN" && (f.category === "UTILITY" || f.category === "ENERGY" || f.category === "CHEMICAL"));
    if (feeds.length) {
      const bySvc = new Map();
      feeds.forEach(f => {
        const k = f.service_code;
        if (!bySvc.has(k)) bySvc.set(k, { name: f.service_name, n: 0, from: new Set(), meters: new Set() });
        const s = bySvc.get(k); s.n++; if (f.other_label) s.from.add(f.other_label);
        (f.meter_tags || []).forEach(m => s.meters.add(m));
      });
      const kv = [...bySvc.entries()].map(([k, s]) =>
        [esc(s.name), esc(k + "×" + s.n + " · from " + [...s.from].map(x => String(x).split(" ")[0]).join(",") + ([...s.meters].length ? " · ◉" + [...s.meters].join(",") : ""))]);
      cards.push(card("#4A4F57", "◈ UTILITIES & FEEDS · U" + esc(code), "consumption", kv));
    }
    if (!cards.length) return "";
    return `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">${cards.join("")}</div>`;
  }

  /* ── export ───────────────────────────────────────────────────────────── */
  const API = { load, fromViewer, plantMap, areaBlock, unitSummary, hmbCards, svcClass, hmbChip, indexData, version: "1.0.0" };
  const root = (typeof window !== "undefined") ? window : globalThis;
  root.TamFlow = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
