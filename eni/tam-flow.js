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

   ELECTRICAL SINGLE-LINE (phase 11, v1.1.0 — v_sld_nodes / v_sld_edges):
     v1.2.0 — symbol geometry now comes from tam-sym.js + tam-sym-elec.js.
     Load those two BEFORE this file. Without them the legacy inline glyphs
     still draw, so the page degrades instead of breaking.
     TamFlow.sldSymbolStyle = 'IEC' (default) | 'BOX'
     TamFlow.loadSld(sb)                → {nodes, edges} bundle, indexed
     TamFlow.sldFromViewer(DB)          → same bundle from the ENI viewer DB
     TamFlow.sldBoards(sld)             → [{tag,doc_no,busbars,positions,loads}]
     TamFlow.sld(sld, boardTag, opts)   → one Power Center single-line (html)

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
    const [areas, classes, links, flows, energy, trains, equipment, skids, instruments, valves, media] = await Promise.all([
      all("plant_areas", "area_code"), all("plant_service_classes", "sort_order"),
      all("v_plant_block"), all("v_area_flows"), all("v_area_energy"),
      all("plant_area_trains", "seq"), all("plant_equipment", "tag"), all("plant_skids", "tag"),
      all("plant_instruments", "tag"), all("plant_valves", "tag"), all("v_exchanger_media")
    ]);
    return indexData({ areas, classes, links, flows, energy, trains, equipment, skids, instruments, valves, media });
  }
  function fromViewer(DB) {
    return indexData({
      areas: DB.areas || [], classes: DB.svcClasses || [], links: DB.plinks || [],
      flows: DB.aflows || [], energy: DB.aenergy || [], trains: DB.trains || [],
      equipment: DB.equip || [], skids: DB.skids || [],
      instruments: DB.inst || [], valves: DB.valves || [], media: DB.xmedia || []
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
  /* instrument TAP: dot on the pipe + leader + tag — unambiguous line association */
  function tap(x, y, tag, below, color) {
    const c = color || "#0B5CAD";
    const ly = below ? y + 18 : y - 12;
    return `<circle cx="${x}" cy="${y}" r="2.4" fill="${c}" stroke="#fff" stroke-width="0.6"/>` +
      `<line x1="${x}" y1="${y + (below ? 3 : -3)}" x2="${x}" y2="${ly + (below ? -7 : 3)}" stroke="${c}" stroke-width="0.7"/>` +
      `<text x="${x}" y="${ly}" text-anchor="middle" font-family="${MONO}" font-size="6.6" fill="${c}" data-live-kind="inst" data-tag="${esc(tag)}">${esc(tag)}</text>`;
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
  const MEDIUM_RX = /HOT OIL|AMMONIA|NH3|STEAM|LUBE OIL/;   // heating/cooling media
  function equipKeyInstruments(data, tags, max, unit) {
    const KEY = /^(PT|PDT|TT|LT|LIT|FT|AT)-/;
    const m = (data.instruments || []).filter(i => !i.removed && KEY.test(i.tag || "") && _matches(i, tags)
      && (unit == null || i.unit == null || String(i.unit) === String(unit))   // same unit only
      && !MEDIUM_RX.test(String(i.service || "").toUpperCase()));        // media go to the utility line
    return [...new Set(m.map(i => i.tag))].sort().slice(0, max || 6);
  }
  /* instruments measuring the MEDIUM that feeds this equipment ("HOT OIL TO E-201…") —
     drawn beside the utility (aux) arrow of the destination box. */
  function mediumInstruments(data, tags) {
    const m = (data.instruments || []).filter(i => {
      if (i.removed || !/^(TT|TE|TG|TI|TIC|PT|PG|PI|PIC|PDT|FT|FE)-/.test(i.tag || "")) return false;
      const svc = String(i.service || "").toUpperCase();
      return MEDIUM_RX.test(svc) && tags.some(t => svc.includes(t.toUpperCase()));
    });
    return [...new Set(m.map(i => i.tag))].sort().slice(0, 4);
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
  /* port association (053): T/P instruments whose service names the equipment AND the
     port — "E-201 OUTLET TEMPERATURE", "V-202 GAS OUTLET TEMPERATURE" → drawn on the
     equipment's inlet/outlet line segment, not inside the box. */
  function portInstruments(data, tags) {
    const res = { INLET: [], OUTLET: [] };
    (data.instruments || []).forEach(i => {
      if (i.removed || !/^(TT|TE|TG|TI|TIC|PT|PG|PI|PIC|PDT)-/.test(i.tag || "")) return;
      const svc = String(i.service || "").toUpperCase();
      if (MEDIUM_RX.test(svc)) return;         // medium instruments live on the utility line
      const org = (/FROM ([A-Z]{1,3}-[0-9]+[A-Z]?)/.exec(svc) || /^([A-Z]{1,3}-[0-9]+[A-Z]?) /.exec(svc) || [])[1];
      if (!org || !tags.includes(org)) return;
      const port = /INLET/.test(svc) ? "INLET" : /OUTLET/.test(svc) ? "OUTLET" : null;
      if (port) res[port].push(i.tag);
    });
    res.INLET = [...new Set(res.INLET)].slice(0, 3);
    res.OUTLET = [...new Set(res.OUTLET)].slice(0, 3);
    return res;
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
    /* segment chips: outlet instruments of box i + inlet instruments of box i+1 share
       the same line segment (V-202 outlet ≡ E-201 inlet). Collected per segment k. */
    const ports = train.map(t => portInstruments(data, t.equipment_tags || []));
    const placedPortTags = new Set(ports.flatMap(p => [...p.INLET, ...p.OUTLET]));
    const segChips = [];                       // k = 0..n  (before box k / after box k-1)
    for (let k = 0; k <= n; k++) {
      const chips = [...(k > 0 ? ports[k - 1].OUTLET : []), ...(k < n ? ports[k].INLET : [])];
      if (chips.length) segChips.push([k, chips]);
    }
    segChips.forEach(([k, chips]) => {
      if (k === n) return;                     // last-segment chips join the outlet line
      const x1 = k === 0 ? 72 : bx(k - 1) + bw + 6, x2 = k === 0 ? bx(0) - 8 : bx(k) - 8;
      const hasDia = k === 0 ? !!(train[0] && train[0].inline_element) : !!(train[k] && train[k].inline_element);
      const cxSeg = (x1 + x2) / 2;
      chips.forEach((tag, ci) => {
        let fx = x1 + (x2 - x1) * (ci + 1) / (chips.length + 1);
        if (hasDia && Math.abs(fx - cxSeg) < 15) fx += (fx <= cxSeg ? -17 : 17);   // clear the valve diamond
        s += tap(fx, my, tag, true);           // dot ON the line, tag below with leader
      });
    });
    const lastSegChips = (segChips.find(([k]) => k === n) || [null, []])[1];
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
      const keyInst = equipKeyInstruments(data, t.equipment_tags || [], 6, code)
        .filter(tg => !linkMeterSet.has(tg) && !placedPortTags.has(tg));
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
      /* ── exchanger media: medium IN (conditions) + medium OUT (conditions) ──
         One pattern for EVERY exchanger (plant_equipment_media / v_exchanger_media):
         supply arrow down, return arrow up, design conditions on each, duty chip.
         Live SCADA replaces the design values through the data-live hooks and the
         efficiency = duty / m·Δh comes from the same pair of lines. */
      const med = (data.media || []).filter(mm => (t.equipment_tags || []).includes(mm.equipment_tag)
        && (!mm.case_code || mm.case_code === kase));
      if (med.length) {
        const mr = med[0], mst = svcClass(data, mr.service_code);
        const cxm = x + bw / 2;
        s += `<line x1="${cxm - 16}" y1="${y0 - 28}" x2="${cxm - 16}" y2="${y0 - 2}" stroke="${mst.color}" stroke-width="1.8" marker-end="${mref(mst.color)}"/>
              <line x1="${cxm + 16}" y1="${y0 - 2}"  x2="${cxm + 16}" y2="${y0 - 28}" stroke="${mst.color}" stroke-width="1.8" marker-end="${mref(mst.color)}"/>
              <text x="${cxm}" y="${y0 - 38}" text-anchor="middle" font-family="${MONO}" font-size="7.4" font-weight="700" fill="${mst.color}"
                data-live-kind="duty" data-tag="${esc(mr.equipment_tag)}">${esc(mst.name)} · Q ${esc(n1(mr.duty_kw))} kW (${esc(kase)}) · ${esc(n1(mr.design_delta_kw))} design</text>
              <text x="${cxm - 20}" y="${y0 - 22}" text-anchor="end" font-family="${MONO}" font-size="6.6" fill="${mst.color}"
                data-live-kind="hmb" data-stream="${esc(mr.supply_stream || "")}" data-field="temperature_c">${esc((mr.supply_stream ? mr.supply_stream + " · " : "") + n1(mr.supply_temp_c) + " °C")}</text>
              ${(mr.supply_tags || []).length ? `<circle cx="${cxm - 16}" cy="${y0 - 15}" r="2.2" fill="#0B5CAD" stroke="#fff" stroke-width="0.5"/>
                <line x1="${cxm - 18}" y1="${y0 - 15}" x2="${cxm - 21}" y2="${y0 - 15}" stroke="#0B5CAD" stroke-width="0.7"/>` : ""}
              <text x="${cxm - 22}" y="${y0 - 12}" text-anchor="end" font-family="${MONO}" font-size="6.2" fill="#0B5CAD"
                data-live-kind="inst" data-live-tags="${esc((mr.supply_tags || []).join(","))}">${esc(groupAB(mr.supply_tags || []).join(" · "))}</text>
              <text x="${cxm + 20}" y="${y0 - 22}" font-family="${MONO}" font-size="6.6" fill="${mst.color}"
                data-live-kind="hmb" data-stream="${esc(mr.return_stream || "")}" data-field="temperature_c">${esc((mr.return_stream ? mr.return_stream + " · " : "") + n1(mr.return_temp_c) + " °C")}</text>
              ${(mr.return_tags || []).length ? `<circle cx="${cxm + 16}" cy="${y0 - 15}" r="2.2" fill="#0B5CAD" stroke="#fff" stroke-width="0.5"/>
                <line x1="${cxm + 18}" y1="${y0 - 15}" x2="${cxm + 21}" y2="${y0 - 15}" stroke="#0B5CAD" stroke-width="0.7"/>` : ""}
              <text x="${cxm + 22}" y="${y0 - 12}" font-family="${MONO}" font-size="6.2" fill="#0B5CAD"
                data-live-kind="inst" data-live-tags="${esc((mr.return_tags || []).join(","))}">${esc(groupAB(mr.return_tags || []).join(" · "))}</text>`;
      }
      /* medium instruments fallback (no curated media row yet) + non-medium aux notes */
      const medInst = med.length ? [] : mediumInstruments(data, t.equipment_tags || []);
      const auxIsMedium = t.aux_note && /hot oil|nh3|ammonia|kW/i.test(t.aux_note);
      if (t.aux_note && !(med.length && auxIsMedium)) {
        const up = !/blowdown|flare|drain/i.test(t.aux_note);
        const ay = y0 - 33;
        const col = /hot oil|kW/i.test(t.aux_note) ? "#B26A00" : /inhibitor|chem/i.test(t.aux_note) ? "#7A3FB3" : "#B26A00";
        s += `<line x1="${x + bw / 2}" y1="${ay + 8}" x2="${x + bw / 2}" y2="${y0 - 2}" stroke="${col}" stroke-width="1.5" marker-end="${mref(up ? col : col)}"/>
              <text x="${x + bw / 2}" y="${ay + 2}" text-anchor="middle" font-family="${MONO}" font-size="7.6" fill="${col}">${esc(t.aux_note)}</text>`;
      }
      if (medInst.length)
        s += `<text x="${x + bw / 2 + 6}" y="${y0 - 14}" font-family="${MONO}" font-size="6.4" fill="#B26A00"
          data-live-kind="inst" data-live-tags="${esc(medInst.join(","))}">${esc(medInst.join(" · "))}</text>`;
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

    /* boundary flow meters + last-segment instruments as taps ON the main line */
    const inM = mainIn && (mainIn.meter_tags || [])[0];
    if (inM) s += tap(84, my, inM, true);
    const outM = mainOut && (mainOut.meter_tags || [])[0];
    [...(outM ? [outM] : []), ...lastSegChips].forEach((tag, i) => {
      s += tap(xEnd + 16 + i * 40, my, tag, true);
    });

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
      if (d.m) s += `<circle cx="${x}" cy="285" r="2.2" fill="#0B5CAD" stroke="#fff" stroke-width="0.5"/>
        <line x1="${x + (left ? -3 : 3)}" y1="285" x2="${tx + (left ? 2 : -2)}" y2="285" stroke="#0B5CAD" stroke-width="0.7"/>
        <text x="${tx}" y="288" ${anchor} font-family="${MONO}" font-size="7.2" fill="#0B5CAD" data-live-kind="meter" data-tag="${esc(d.m)}">${esc(d.m)}</text>`;
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

  /* ══ SINGLE-LINE DIAGRAM · ELD03 electrical (phase 11) ═══════════════════
     Data: v_sld_nodes / v_sld_edges (migration 152 series).

     ONE diagram per switchboard. Each busbar of the board gets a band:

         sources          GE-00n, or a feeder on another Power Center
            │
         incomers         positions that FEED the busbar
         ═══════          BUSBAR
            │
         positions        outgoing feeders, in display_rank order
            │
         loads            the served asset

     display_rank is 1000 + sheet_no*100 + column_index for feeder positions,
     so ordering by it reproduces the paper drawing's column order exactly.
     Bus couplers are NORMALLY OPEN and are drawn dashed (rule from Round 4).

     Two data cautions, both handled here rather than assumed away:
      · v_sld_edges also carries fibre/Modbus network links whose endpoints are
        not electrical nodes. Only edges with BOTH endpoints in v_sld_nodes are
        drawable; the rest are counted and reported, never silently dropped.
      · Nothing is invented. A position with no busbar edge and no load edge is
        drawn as it stands; an off-sheet target is labelled as off-sheet.      */

  /* v1.7.0 — PADX is the LEFT GUTTER, and it only has to hold the busbar name
     ("BUSBAR IA" at 12 px ≈ 66 px) and its tag underneath (≈ 74 px), both
     printed from x = 8. At 148 it held ~70 px of nothing and the drawing
     started well right of the page edge; Mario bracketed exactly that. */
  /* v1.14.3 — 92, a 15% tightening of the old 108. It only became reachable
     once the printed CT ratio came off the metering assembly (that label, not
     the split ways, was what collided at 96 and below). Verified by sweeping
     `check_sld_layout.js` over 92..108: 0 collisions on all four boards at the
     shipping zoom. Do not tighten further without re-running that sweep. */
  const SLD_COL = 92, SLD_PADX = 112, SLD_BAND = 312;
  /* how far past the last column a bus-to-bus tie stands. Measured against the
     CT ratio of a metering assembly, which is the thing that reaches furthest
     out of a column (~45 px) — see v1.7.0 note in the band pre-pass. */
  const SLD_TIE_DX = 46;
  const SLD_L2_DY = 62;                 // drop from a served board to what IT feeds   // PADX = left gutter for the busbar label
  const SLD_SRC_Y = 14, SLD_INC_Y = 78, SLD_BUS_Y = 146, SLD_OUT_Y = 182, SLD_LOAD_Y = 250;
  /* v1.3.0 — extra conductor length between a position and the busbar when a
     metering assembly (CT + analyser) has to be drawn on that segment. Applied
     per band and only on the side that actually carries one, so a board with no
     meters is byte-identical to v1.2.0. */
  const SLD_MTR_DY = 40;
  /* extra conductor between an outgoing way and its load when a starting
     device (contactor / soft starter / drive) has to be drawn on it */
  const SLD_START_DY = 40;
  /* how tall a starting symbol is, in symbol units, and how much room beyond the
     26-unit baseline it needs. Read from the pack so the geometry lives in one
     place: add a taller symbol and the layout follows it. */
  function startH(kind) {
    const K = (typeof window !== "undefined" ? window : globalThis).TamSym;
    const sp = K && K.spec && K.spec(kind);
    return (sp && sp.h) ? sp.h : 26;
  }
  const startExtra = kind => Math.max(0, startH(kind) - 26) * 0.92;
  /* the two ways OUT of a starting symbol that has them (BL / BR), in page
     coordinates, or null. A symbol with a single B port returns null and the
     renderer falls back to one trunk plus a branch bar. */
  function startOuts(kind, cx, cy) {
    const K = (typeof window !== "undefined" ? window : globalThis).TamSym;
    if (!K || !K.ports || !K.spec || !K.spec(kind)) return null;
    const p = K.ports(kind, { x: cx, y: cy, scale: 0.92 * Z() });
    return (p && p.BL && p.BR) ? [p.BL, p.BR] : null;
  }

  /* ── v1.4.0 · ONE ZOOM KNOB ──────────────────────────────────────────────
     Mario: "all the icons, it is too small" and "make the small text bold and
     at least 20% bigger". Both are the same complaint — the information-bearing
     marks are small relative to the page — so both hang off one number.

       TamFlow.sldZoom = 1.0   the v1.3.0 drawing, exactly
       TamFlow.sldZoom = 1.3   symbols and small text +30%

     SYMBOLS and TEXT scale by Z. LAYOUT scales by only 55 % of that, which is
     the whole point: scaling everything equally is just a zoom and changes
     nothing. Growing the marks faster than the grid is what makes them legible.
     The value was chosen by rendering the sweep, not by taste — see the
     verification. */
  let sldZoom = 1.3;
  const Z  = () => sldZoom;                       // symbols + text
  const G  = () => 1 + (sldZoom - 1) * 0.55;      // layout grid
  const gx = n => +(n * G()).toFixed(1);          // a layout distance
  const zy = n => +(n * Z()).toFixed(1);          // a symbol-relative distance
  /* a small font size: scaled, and never below 8 px — below that a bold face
     stops helping and the label is decoration rather than information */
  const ts = n => Math.max(8, +(n * Z()).toFixed(1));
  const SLD_BOXW = 86, SLD_BOXH = 34;
  const SLD_STATUS = { VERIFIED: "#1F8A4C", NEEDS_REVIEW: "#B26A00", CONFLICT: CRIMSON };
  const SLD_BUSCOL = "#0B5CAD";          // busbar / power path
  const SLD_ROTARY = new Set(["MOTOR", "PUMP", "COMPRESSOR", "GENERATOR", "FAN", "BLOWER"]);
  /* v1.10.0 — the starting methods v_sld_nodes can name, and how to say them.
     A value outside this map draws nothing rather than guessing a symbol. */
  const SLD_START = new Map([["CONTACTOR", "Contactor"], ["SOFT_STARTER", "Soft starter"],
                             ["SOFT_STARTER_2C", "Soft starter, two interlocked contactors"],
                             ["VFD", "Variable-frequency drive"]]);

  /* ── data ─────────────────────────────────────────────────────────────── */
  async function loadSld(sb) {
    const all = async (t, order) => {
      let q = sb.from(t).select("*"); if (order) q = q.order(order);
      const { data, error } = await q;
      if (error) { console.warn("tam-flow/sld: " + t + ": " + error.message); return []; }
      return data || [];
    };
    const [nodes, edges] = await Promise.all([all("v_sld_nodes", "display_rank"), all("v_sld_edges")]);
    return indexSld({ nodes, edges });
  }
  function sldFromViewer(DB) {
    return indexSld({ nodes: DB.sldNodes || [], edges: DB.sldEdges || [] });
  }
  function indexSld(sld) {
    sld.nodes = sld.nodes || []; sld.edges = sld.edges || [];
    sld._byTag = new Map(sld.nodes.map(n => [n.tag, n]));
    sld._kids = new Map();
    sld.nodes.forEach(n => {
      if (!n.parent_tag || n.parent_tag === n.tag) return;
      if (!sld._kids.has(n.parent_tag)) sld._kids.set(n.parent_tag, []);
      sld._kids.get(n.parent_tag).push(n);
    });
    const drawable = e => sld._byTag.has(e.from_tag) && sld._byTag.has(e.to_tag);
    sld._edges = sld.edges.filter(drawable);
    sld._skipped = sld.edges.filter(e => !drawable(e));
    sld._out = new Map(); sld._in = new Map();
    sld._edges.forEach(e => {
      if (!sld._out.has(e.from_tag)) sld._out.set(e.from_tag, []);
      if (!sld._in.has(e.to_tag)) sld._in.set(e.to_tag, []);
      sld._out.get(e.from_tag).push(e); sld._in.get(e.to_tag).push(e);
    });
    return sld;
  }
  /* the switchboard a node sits on, or "" if it is not under one */
  function sldBoardOf(sld, n) {
    if (!n) return "";
    if (n.symbol_kind === "SWITCHBOARD") return n.tag;
    let cur = n, hops = 0;
    while (cur && cur.parent_tag && cur.parent_tag !== cur.tag && hops++ < 6) {
      const up = sld._byTag.get(cur.parent_tag);
      if (!up) return String(cur.parent_tag).replace(/-(BB|F).*$/, "");
      if (up.symbol_kind === "SWITCHBOARD") return up.tag;
      cur = up;
    }
    return "";
  }
  const sldOut = (sld, tag) => sld._out.get(tag) || [];
  const sldIn = (sld, tag) => sld._in.get(tag) || [];
  const isBusbar = n => n && (n.symbol_kind === "BUSBAR" || n.symbol_kind === "BUSBAR_INVERTER");
  const byRank = (a, b) => (a.display_rank || 0) - (b.display_rank || 0) ||
    String(a.tag).localeCompare(String(b.tag));

  /* "480-JG-691-FMC1" on board "480-JG-691" → ".MC1"   (the paper column code) */
  function sldPosCode(tag, board) {
    let t = String(tag || "");
    if (board && t.indexOf(board + "-") === 0) t = t.slice(board.length + 1);
    return /^F./.test(t) ? "." + t.slice(1) : t;
  }
  /* "480-JG-691-BBIA" → "IA" */
  function sldBusCode(tag, board) {
    let t = String(tag || "");
    if (board && t.indexOf(board + "-") === 0) t = t.slice(board.length + 1);
    return t.replace(/^BB/, "") || t;
  }

  /* boards present in the data, for a picker */
  function sldBoards(sld) {
    return sld.nodes.filter(n => n.symbol_kind === "SWITCHBOARD").sort(byRank)
      .map(b => {
        const bus = (sld._kids.get(b.tag) || []).filter(isBusbar);
        const pos = bus.reduce((a, bb) => a.concat(sld._kids.get(bb.tag) || []), []);
        return {
          tag: b.tag, doc_no: b.doc_no, voltage_v: b.voltage_v,
          busbars: bus.length, positions: pos.length,
          loads: pos.reduce((n, p) => n + (sld._kids.get(p.tag) || []).length, 0)
        };
      });
  }

  /* ── symbols ──────────────────────────────────────────────────────────────
     v1.2.0: the symbol geometry moved OUT of this renderer into the symbol
     packs (`tam-sym.js` + `tam-sym-elec.js`). This function is now a delegate.

     Why: an inline switch cannot carry ports, state, data quality or measured
     values, and it cannot be shared with the process side. The packs can.
     See GRAPHICS_LIBRARY_PLAN.md.

     The legacy switch is KEPT as the fallback, deliberately: if the packs fail
     to load, EI06 degrades to exactly what it drew before rather than to a
     blank page. Delete it only after the packs have shipped and been verified.

     TamFlow.sldSymbolStyle selects the switching-device form:
       'IEC'  breaker as the IEC cross-on-contact; disconnector, switch-
              disconnector and contactor drawn distinctly          ← default
       'BOX'  the square shorthand every switching device used to get, now
              FILLED when closed and hollow when open
     Set TamFlow.sldSymbolStyle = 'BOX' before rendering to go back.           */
  let sldSymbolStyle = "IEC";
  let _symUsed = null;                 // symbol kinds drawn in the current sld() call

  /* v1.12.0 — `fam` is v_sld_nodes.breaker_family (migration 177): 'ACB' for a
     3WA/3WL air circuit breaker, 'MCCB' for a 3VA moulded-case one. Fourteen
     positions carry an ACB — the gas and diesel incomers, the three couplers
     and the two transformer feeders .212 / .213 — and every one of them was
     drawing as a moulded-case breaker, because ELEC_MAP keys on symbol_kind and
     symbol_kind only knows that the row is a FEEDER.
     The view names the FAMILY, a fact off the type code; which symbol that
     deserves is decided here, in the one place a column value meets a symbol. */
  function sldGlyph(kind, cx, cy, col, open, fam) {
    if (_symUsed) _symUsed.add(String(kind || "").toUpperCase());
    const S = (typeof window !== "undefined" ? window : globalThis).TamSym;
    if (S && S.ELEC_MAP && S.draw) {
      let k = S.ELEC_MAP[String(kind || "").toUpperCase()] || "UNKNOWN";
      /* A POSITION IS ITS DEVICE, NOT ITS LOAD. `.212` and `.213` carry
         feeder_kind='TRANSFORMER' — which says what the way SERVES — so they
         were drawn as transformers, with the transformer 480-TR-001 drawn
         again underneath as the load. The same object twice, and the 3WA1120
         air circuit breaker that is actually in the cubicle appeared nowhere.
         A cubicle that holds a MAIN_BREAKER is drawn as that breaker. */
      if (fam && k === "TRANSFORMER") k = "CIRCUIT_BREAKER";
      k = sldFamSym(k, fam);
      if (sldSymbolStyle === "BOX" && (k === "CIRCUIT_BREAKER" || k === "ACB_DRAWOUT"))
        k = "CIRCUIT_BREAKER_BOX";
      if (_symUsed) _symUsed.add(k);
      return S.draw(k, { x: cx, y: cy, color: col, open: !!open,
                         state: open ? "OPEN" : "DESIGN", scale: 0.92 * Z() });
    }
    return sldGlyphLegacy(kind, cx, cy, col, open);
  }

  /* ── v1.13.0 · familia de aparato -> simbolo, SIN tabla que mantener ──────
     Mario: "esto no deberia ser en programacion solo DB". De acuerdo. Antes
     habia un `if` por familia, asi que cada familia nueva pedia una linea de
     codigo. Ahora, si el pack tiene un simbolo REGISTRADO con el nombre de la
     familia, se usa ese y ya esta: 'FUSE_SWITCH' dibuja FUSE_SWITCH sin tocar
     nada. Solo quedan los dos alias donde el nombre de la familia y el del
     simbolo difieren de verdad. */
  const SLD_FAM_ALIAS = { ACB: "ACB_DRAWOUT", MCCB: "CIRCUIT_BREAKER" };
  function sldFamSym(k, fam) {
    if (!fam || k !== "CIRCUIT_BREAKER") return k;
    const S = (typeof window !== "undefined" ? window : globalThis).TamSym;
    const alias = SLD_FAM_ALIAS[fam];
    if (alias) return alias;
    return (S && S.spec && S.spec(fam)) ? fam : k;
  }

  /* v1.9.0 — where a conductor must STOP so it touches the symbol.
     Mario: "los motores tampoco llegan a conectarse con el cable". The drop
     line ended at a hard-coded offset while the glyph was drawn at 0.92·Z with
     its own radius, so a motor (r = 12) left a ~6 px gap and the load looked
     unconnected. The pack already publishes every symbol's ports; ask it,
     rather than guessing an offset that is right for one symbol and wrong for
     the rest. Falls back to the old constant if the packs are absent (G-8). */
  function sldPortY(kind, cx, cy, key, fam) {
    const S = (typeof window !== "undefined" ? window : globalThis).TamSym;
    if (S && S.ELEC_MAP && S.ports) {
      let k = S.ELEC_MAP[String(kind || "").toUpperCase()] || "UNKNOWN";
      if (fam && k === "TRANSFORMER") k = "CIRCUIT_BREAKER";
      k = sldFamSym(k, fam);
      if (sldSymbolStyle === "BOX" && (k === "CIRCUIT_BREAKER" || k === "ACB_DRAWOUT"))
        k = "CIRCUIT_BREAKER_BOX";
      const p = S.ports(k, { x: cx, y: cy, scale: 0.92 * Z() });
      if (p && p[key]) return p[key].y;
    }
    return cy + (key === "A" ? -zy(13) : zy(13));
  }

  /* the same port question for a kind the renderer places directly (CT, and
     from v1.10.0 the starting device), which has no ELEC_MAP entry */
  function sldPortYDirect(kind, cx, cy, key) {
    const S = (typeof window !== "undefined" ? window : globalThis).TamSym;
    if (S && S.ports && S.spec && S.spec(kind)) {
      const p = S.ports(kind, { x: cx, y: cy, scale: 0.92 * Z() });
      if (p && p[key]) return p[key].y;
    }
    return cy + (key === "A" ? -zy(13) : zy(13));
  }

  /* draw a REGISTERED symbol kind directly, bypassing ELEC_MAP.
     v1.3.0. Used by the metering assembly: "CT" is a shape the renderer places
     from `ct_ratio_raw` on a metering node — it is NOT a `symbol_kind` any row
     in v_sld_nodes carries, so putting it in ELEC_MAP would claim the database
     says something it does not (db-graphics §4). The kind is still registered
     in `_symUsed` so the auto-generated legend picks it up (rule G-7).
     Falls back to a plain circle when the packs are absent, per G-8. */
  function sldSymDirect(kind, o) {
    if (_symUsed) _symUsed.add(String(kind || "").toUpperCase());
    const S = (typeof window !== "undefined" ? window : globalThis).TamSym;
    if (S && S.draw && S.spec && S.spec(kind)) return S.draw(kind, o);
    const cx = (o && o.x) || 0, cy = (o && o.y) || 0, col = (o && o.color) || INK;
    return `<circle cx="${cx}" cy="${cy}" r="${zy(7)}" fill="#fff" stroke="${col}" stroke-width="1.6"/>` +
      ((o && o.label) ? `<text x="${cx}" y="${cy + (o.labelPos === "above" ? -12 : 18)}" text-anchor="middle" ` +
        `font-family="${MONO}" font-size="8" font-weight="700" fill="${INK}">${esc(o.label)}</text>` : "") +
      ((o && o.sub) ? `<text x="${cx + 15}" y="${cy + 3}" font-family="${MONO}" font-size="6.8" fill="${SOFT}">${esc(o.sub)}</text>` : "");
  }

  const HALO = ` paint-order="stroke" stroke="#fff" stroke-width="3" stroke-linejoin="round"`;
  function sldGlyphLegacy(kind, cx, cy, col, open) {
    const sw = 1.6, W = `stroke="${col}" stroke-width="${sw}"`;
    const box = (r, dash) => `<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" fill="#fff" ${W}${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
    const disc = (r, ch) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" ${W}/>` +
      (ch ? `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" fill="${col}">${ch}</text>` : "");
    switch (kind) {
      case "GENERAL_SWITCH":
      case "DISCONNECTOR":
        return `<line x1="${cx}" y1="${cy - 12}" x2="${cx + 10}" y2="${cy + 10}" ${W}/>` +
               `<circle cx="${cx}" cy="${cy - 12}" r="2.4" fill="${col}"/>` +
               `<circle cx="${cx}" cy="${cy + 12}" r="2.4" fill="${col}"/>`;
      case "NETWORK_ANALYZER": return disc(10, "A");
      case "TRANSFORMER":
        return `<circle cx="${cx}" cy="${cy - 5}" r="9.5" fill="none" ${W}/>` +
               `<circle cx="${cx}" cy="${cy + 5}" r="9.5" fill="none" ${W}/>`;
      case "SPARE": return box(10, "3 3");
      case "BUS_COUPLER":
        return box(10, open ? "4 3" : "") +
               `<text x="${cx + 15}" y="${cy - 12}" font-family="${MONO}" font-size="6.4" font-weight="700" fill="${col}">N.O.</text>`;
      case "MOTOR": return disc(13, "M");
      case "GENERATOR": return disc(13, "G");
      case "PUMP": return disc(13, "P");
      case "COMPRESSOR": return disc(13, "C");
      case "INVERTER":
        return box(12) + `<line x1="${cx - 8}" y1="${cy + 8}" x2="${cx + 8}" y2="${cy - 8}" ${W}/>` +
               `<text x="${cx - 5}" y="${cy - 2}" text-anchor="middle" font-family="${MONO}" font-size="8" fill="${col}">=</text>` +
               `<text x="${cx + 5}" y="${cy + 9}" text-anchor="middle" font-family="${MONO}" font-size="8" fill="${col}">~</text>`;
      case "HEATER":
        return box(11) + `<path d="M${cx - 6},${cy + 4} l3,-8 l3,8 l3,-8 l3,8" fill="none" ${W}/>`;
      default: return box(10);   // INCOMER · FEEDER · everything else = breaker
    }
  }
  /* ── v1.5.0 · the label pass ────────────────────────────────────────────
     Mario, 2026-07-26: "for breakers to have a clean look, move the label to
     the left or right … below the breaker leave blank, also in feeders remove
     characteristics … below the tag of the load put the power and below the
     current … the power and current of generators in the generator icon".

     Three rules, and they are all the same rule: a number belongs to the
     object that owns it.

       · A POSITION is a cubicle. Its code is its identity, so it sits BESIDE
         the symbol — to the RIGHT, on the centre line, where nothing else is.
         Under it stays EMPTY: the conductor, the cable tag and the load all
         use that column, and the kW/A block printed there was the RATING OF
         THE LOAD wearing the breaker's clothes.
       · A LOAD owns its power and its current. They go under its tag.
       · A GENERATOR owns its rating. It goes on the machine symbol.

     Nothing is invented and nothing is derived: a value absent from
     v_sld_nodes prints nothing at all (rule G-3).                          */
  function sldPosLabel(cx, cy, code, nav, tag) {
    return `<text x="${cx + zy(15)}" y="${cy + zy(3.4)}" text-anchor="start" font-family="${MONO}" ` +
      `font-size="${ts(8.4)}" font-weight="700" fill="${INK}"${HALO}` +
      (nav ? ` style="cursor:pointer" onclick="${nav}('sld/${esc(tag)}')"` : "") +
      `>${esc(clip(code, 14))}</text>`;
  }
  /* the two rating lines under a load's tag: power first, current below it.
     Returns the y of the next free line so a caller can keep stacking. */
  function sldRating(cx, y, node) {
    let s = "", yy = y;
    [sldKw(node), sldAmp(node)].filter(Boolean).forEach(v => {
      s += `<text x="${cx}" y="${yy}" text-anchor="middle" font-weight="600" font-family="${MONO}" ` +
        `font-size="${ts(6.8)}" fill="${SOFT}">${esc(v)}</text>`;
      yy += zy(10);
    });
    return { svg: s, y: yy };
  }

  /* v1.8.0 — the cable label sits BESIDE its conductor, not on it, and carries
     its length underneath. `length_m` has been in `v_sld_edges` all along; the
     renderer simply never read it. Centred on the drop line the tag fought the
     line itself; to the right it reads as an annotation of that run. */
  /* v1.14.2 — `mid` centres the label instead of hanging it to the right of the
     conductor. A way that FORKS has no conductor down the middle to hang off,
     and the right-hand offset put the text across the right-hand drop. */
  function sldCable(cx, y, e, mid) {
    if (!e || !e.cable_tag) return "";
    const x = mid ? cx : cx + zy(4), an = mid ? "middle" : "start";
    let g = `<text x="${x}" y="${y}" text-anchor="${an}" font-weight="600" ` +
      `font-family="${MONO}" font-size="${ts(6.6)}" fill="${SOFT}"${HALO}>${esc(e.cable_tag)}</text>`;
    if (e.length_m != null)
      g += `<text x="${x}" y="${y + zy(9)}" text-anchor="${an}" font-weight="600" ` +
        `font-family="${MONO}" font-size="${ts(6.2)}" fill="${SOFT}"${HALO}>${esc(n1(e.length_m))} m</text>`;
    return g;
  }

  /* small labelled card used for sources and for served loads */
  function sldCard(cx, y, node, sub, dim) {
    const x = cx - gx(SLD_BOXW) / 2;
    const st = SLD_STATUS[node.data_status] || SOFT;
    return `<g><rect x="${x}" y="${y}" width="${gx(SLD_BOXW)}" height="${gx(SLD_BOXH)}" rx="4" fill="#fff" stroke="${dim ? LINE : st}" stroke-width="1.3"/>` +
      `<text x="${cx}" y="${y + zy(14)}" text-anchor="middle" font-family="${MONO}" font-size="8.4" font-weight="700" fill="${INK}">${esc(clip(node.tag, 14))}</text>` +
      `<text x="${cx}" y="${y + zy(26)}" text-anchor="middle" font-family="${MONO}" font-size="7" fill="${SOFT}">${esc(clip(sub || "", 16))}</text></g>`;
  }
  const sldKw = n => n && n.power_kw != null ? n1(n.power_kw) + " kW" : "";
  const sldAmp = n => n && n.current_a != null ? n0(n.current_a) + " A" : "";

  /* ── renderer ─────────────────────────────────────────────────────────── */
  function sld(sldData, boardTag, opts) {
    const o = opts || {}, S = sldData;
    _symUsed = new Set();              // reset per render — drives the legend
    /* v1.4.0 — the pack prints the analyser tag and the CT sub-datum, so its
       type scale has to move with ours or the drawing ends up with two. */
    { const K = (typeof window !== "undefined" ? window : globalThis).TamSym;
      if (K) K.textScale = Z(); }
    if (!S || !S._byTag) return `<div style="font:400 11px ${MONO};color:${SOFT}">tam-flow: call TamFlow.loadSld(sb) first</div>`;
    const board = S._byTag.get(boardTag);
    if (!board) return `<div style="font:400 11px ${MONO};color:${SOFT}">no switchboard "${esc(boardTag)}" in v_sld_nodes</div>`;
    const nav = o.onNavigate;

    const busbars = (S._kids.get(boardTag) || []).filter(isBusbar).sort(byRank);
    if (!busbars.length) return `<div style="font:400 11px ${MONO};color:${SOFT}">${esc(boardTag)} has no busbars in v_sld_nodes</div>`;
    const busSet = new Set(busbars.map(b => b.tag));

    /* ── metering (v1.3.0) ────────────────────────────────────────────────
       A metering position is a cubicle holding an instrument; it carries no
       current of its own and feeds nothing. Drawing it as an outgoing column
       said the opposite — it read as a load hanging off the bar. Migration 166
       puts the measuring point in the view (`measures_tag`, `voltage_ref_tag`,
       `ct_ratio_raw`), so it can now be drawn where it physically is: a CT
       clamped on the measured conductor, tapped across to the analyser.

       Only a metering position whose measured circuit is a node ON THIS BOARD
       moves. One with no `measures_tag`, or one pointing off-sheet, stays in
       the outgoing row and says so — a gap must stay visible (rule G-4). */
    const isMeterPos = p => p.symbol_kind === "NETWORK_ANALYZER";
    const meterOn = new Map();          // measured tag → [metering node, …]
    const meterUnplaced = [];           // metering positions left in the out row
    const boardKids = new Set();
    busbars.forEach(bb => (S._kids.get(bb.tag) || []).forEach(k => boardKids.add(k.tag)));
    busbars.forEach(bb => (S._kids.get(bb.tag) || []).forEach(p => {
      if (!isMeterPos(p)) return;
      if (p.measures_tag && boardKids.has(p.measures_tag)) {
        if (!meterOn.has(p.measures_tag)) meterOn.set(p.measures_tag, []);
        meterOn.get(p.measures_tag).push(p);
      } else meterUnplaced.push(p);
    }));
    const placedMeters = new Set();
    meterOn.forEach(list => list.forEach(m => placedMeters.add(m.tag)));

    /* ── v1.6.0 · a bus-to-bus TIE leaves the END of the bar ───────────────
       Mario, 2026-07-26: *"en la barra A al final deberíamos mostrar el breaker
       de salida hacia B pero por arriba; en B mostramos la llegada desde A a la
       izquierda y hacia C al final."*

       A tie is not a load. Hung in the outgoing row it stood among the motors
       as though the next switchboard were something this bar drives, and the
       far-side bar received nothing but a line of text in the gutter — the same
       physical link was a SYMBOL at one end and a SENTENCE at the other. It is
       now one shape at both ends: a stub off the END of the busbar, above it.
       OUT leaves the RIGHT end, IN arrives at the LEFT end.

       Two shapes of tie exist in the data and both are recognised:
         1. a BUS_COUPLER this bar owns          (A ←.MCG1→ B)
         2. a position cable-tied to a coupler on ANOTHER board
            (.B2 ←E150→ 480-JG-692 .MCG2 → busbar C)
       The far busbar is read from the coupler's own FEEDS edge, so the label
       names the bar the link actually reaches. A tie whose far end cannot be
       resolved is NOT promoted — it stays in the outgoing row, where a gap is
       visible (rule G-4). Nothing was added to the database for any of this. */
    /* ── v1.7.0 · which SIDE a tie leaves from ─────────────────────────────
       Mario: *"al busbar C llega desde B por la izquierda, sale a D por la
       derecha, igual que en B."*

       v1.6.0 decided the side by OWNERSHIP — the bar that owns the coupler
       drew it going out. Busbar C owns both `.MCG2` (to B) and `.MCG3` (to D),
       so C showed two departures and the chain read as if it started there.
       Ownership says whose cubicle it is, not which way the line runs.

       The order is ALREADY IN THE DATABASE and needed no correction:
       `v_sld_nodes.display_rank` on the busbars is 165 · 166 · 167 · 168 for
       A · B · C · D — the paper order of the sections. A tie to an EARLIER bar
       arrives on the LEFT; to a LATER bar it leaves on the RIGHT. The four
       inverter busbars all carry rank 173, so board tag and then node tag
       break the tie deterministically (BBIA < BBIB < BBIC < BBID); that shared
       rank is a data smell worth a CR, not a blocker.                        */
    const busOrd = t => {
      const n = S._byTag.get(t);
      return [n && n.display_rank != null ? +n.display_rank : 0,
              (n && sldBoardOf(S, n)) || "", String(t)];
    };
    const isLater = (a, b) => {           /* is bar `a` after bar `b`? */
      const A = busOrd(a), B = busOrd(b);
      for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] > B[i];
      return false;
    };
    const farBusOf = (cplNode, ownTag) => sldOut(S, cplNode.tag)
      .filter(e => e.edge_kind === "FEEDS" && e.to_tag !== ownTag &&
                   isBusbar(S._byTag.get(e.to_tag)))[0] || null;
    function tieOut(p, bb) {
      if (p.symbol_kind === "BUS_COUPLER") {
        const far = farBusOf(p, bb.tag);
        return far ? { pos: p, via: null, farTag: far.to_tag, open: far.normally_open,
                       cable: far.cable_tag } : null;
      }
      const link = sldOut(S, p.tag).concat(sldIn(S, p.tag))
        .filter(e => e.edge_kind === "CONNECTED_TO")
        .map(e => ({ e: e, n: S._byTag.get(e.from_tag === p.tag ? e.to_tag : e.from_tag) }))
        .filter(x => x.n && x.n.symbol_kind === "BUS_COUPLER")[0];
      if (!link) return null;
      const far = farBusOf(link.n, bb.tag);
      return far ? { pos: p, via: link.n, farTag: far.to_tag, open: far.normally_open,
                     cable: link.e.cable_tag || far.cable_tag } : null;
    }

    /* classify each position on each busbar */
    const bands = busbars.map(bb => {
      const kids = (S._kids.get(bb.tag) || []).slice().sort(byRank);
      const inc = [], out = [], cpl = [], tie = [];
      kids.forEach(p => {
        if (placedMeters.has(p.tag)) return;      /* drawn on its measured circuit */
        const t = tieOut(p, bb);
        if (t) { tie.push(t); return; }           /* drawn at the end of the bar */
        if (p.symbol_kind === "BUS_COUPLER") { cpl.push(p); return; }
        /* an incomer is a position that FEEDS a busbar of this board */
        const feedsBus = sldOut(S, p.tag).some(e => e.edge_kind === "FEEDS" && busSet.has(e.to_tag));
        (feedsBus ? inc : out).push(p);
      });
      return { bus: bb, inc, out: out.concat(cpl), cplCount: cpl.length,
               tie: tie.filter(t => isLater(t.farTag, bb.tag)),
               tieL: tie.filter(t => !isLater(t.farTag, bb.tag)) };
    });
    /* ── v1.7.0 · the tie sits just past the last column, not a column past it ──
       v1.6.0 gave every tie a full column so its vertical would clear the CT
       ratio of the last incomer's metering assembly. That ratio only reaches
       ~45 px past the column edge, so a full 126 px column bought 80 px of
       white space at the right-hand end of every bar — Mario circled exactly
       that. SLD_TIE_DX is measured against what actually sticks out, not
       rounded up to the grid. The bar still ends AT the tie. */
    bands.forEach(b => {
      b.base = Math.max(b.inc.length, b.out.length);
      b.nWide = b.base;
      /* the labels are built here, not in the draw loop, because the page
         width has to know how far the widest one reaches (trap T-14: what
         leaves the viewBox is silently clipped) */
      b.tie.concat(b.tieL).forEach((t, i) => {
        const fb = sldBoardOf(S, S._byTag.get(t.farTag)) || boardTag;
        const viaBoard = t.via ? (sldBoardOf(S, t.via) || boardTag) : boardTag;
        t.farCode = sldBusCode(t.farTag, fb) + (fb !== boardTag ? " · " + fb : "");
        t.offBoard = fb !== boardTag;
        t.sub = [sldPosCode(t.pos.tag, boardTag),
                 t.via ? "via " + (viaBoard !== boardTag ? viaBoard + " " : "") + sldPosCode(t.via.tag, viaBoard) : "",
                 t.cable || "", t.open ? "N.O." : ""].filter(Boolean).join(" · ");
      });
      b.tie.forEach((t, i) => { t.dx = gx(SLD_TIE_DX) * (i + 1); });
    });
    /* a band needs a longer conductor on the side that carries an assembly */
    bands.forEach(b => {
      b.dyIn  = b.inc.some(p => meterOn.has(p.tag)) ? zy(SLD_MTR_DY) : 0;
      b.dyOut = b.out.some(p => meterOn.has(p.tag)) ? zy(SLD_MTR_DY) : 0;
      /* v1.10.0 — a starting device stands ON the conductor between the way and
         its load, so the load row has to move down to make room for it AND for
         the cable label. Applied per band and only where one exists, so a board
         with no starting device is byte-identical to v1.9.0. */
      /* v1.14.0 — the reserve used to be a flat 40 for every starting device,
         which was right while every one of them was 26 units tall. The soft
         starter with its two interlocked contactors is 88, and a flat reserve
         let it grow UP into the fuse switch above it. Size the reserve to the
         tallest symbol actually on this band; a 26-unit one still reserves
         exactly 40, so boards without a tall starter are unchanged. */
      b.dySt  = Math.max(0, ...b.out.map(p =>
        (p.start_kind && SLD_START.has(p.start_kind)) ? zy(SLD_START_DY + startExtra(p.start_kind)) : 0));
    });

    const cols = Math.max(4, ...bands.map(b => b.nWide));
    /* v1.7.0 — the right margin is SIZED TO THE WIDEST TIE LABEL rather than
       assumed. A tie label runs rightward out of the last column; with the
       page width fixed at 2·PADX + cols·COL it was the tie column that kept it
       inside, and removing that column would have pushed it off the edge. */
    const tw = (txt, fs) => String(txt || "").length * fs * 0.6;
    let tieRight = 0;
    bands.forEach(b => b.tie.forEach(t => {
      const w = Math.max(tw("⇢ BUSBAR " + t.farCode, ts(7.6)),
                         ...String(t.sub).split(" · ").map(x => tw(x, ts(6.6))));
      tieRight = Math.max(tieRight, gx(SLD_PADX) + b.base * gx(SLD_COL) + t.dx +
                                    gx(26) + gx(5) + w);
    }));
    const W = Math.max(gx(SLD_PADX) * 2 + cols * gx(SLD_COL), tieRight + gx(16));
    /* v1.2.0 — a served BOARD can itself feed a load (migration 154: the flash
       compressors 690-JG-695/696 → PK-361-MC1A/B). When any position on this
       switchboard has that second level, every band grows by one load row so
       the deeper node has somewhere to be drawn. Boards without it are
       byte-identical to v1.1.0. */
    /* everything this diagram already draws in its own right: busbars and
       feeder positions. A second-level node that is one of these is NOT a
       deeper load — it is the same node seen from the other side (an inverter
       feeding its own outgoing position, `.II2 → 480-INV-002 → .OI2`). Drawing
       it twice would invent a machine that does not exist. */
    const alreadyDrawn = new Set();
    bands.forEach(b => { alreadyDrawn.add(b.bus.tag);
      b.inc.concat(b.out).forEach(p => alreadyDrawn.add(p.tag)); });
    S.nodes.forEach(n => { if (n.symbol_kind === "BUSBAR" || n.symbol_kind === "BUSBAR_INVERTER" ||
      n.symbol_kind === "SWITCHBOARD") alreadyDrawn.add(n.tag); });

    /* A node counts as a LOAD on this diagram only if it is not a busbar and
       not a position belonging to another Power Center — the same predicate the
       drawing loop uses. Without it the detector follows bus-coupler hops
       (`.MCG1 → BUSBAR B → PC2 .MCG2`) and grows every band for nothing. */
    const isLoadHere = t => t && !isBusbar(t) &&
      !(sldBoardOf(S, t) && sldBoardOf(S, t) !== boardTag);
    const secondLevel = t => sldOut(S, t.tag).filter(e =>
      e.edge_kind === "FEEDS" && S._byTag.has(e.to_tag) &&
      !alreadyDrawn.has(e.to_tag) && isLoadHere(S._byTag.get(e.to_tag)));

    const hasL2 = bands.some(b => b.out.concat(b.inc).some(p =>
      sldOut(S, p.tag).some(e => e.edge_kind === "FEEDS" && isLoadHere(S._byTag.get(e.to_tag)) &&
        secondLevel(S._byTag.get(e.to_tag)).length)));
    const BAND = gx(SLD_BAND) + (hasL2 ? gx(SLD_L2_DY) + 26 : 0);
    /* v1.3.0 — band tops are CUMULATIVE, not `74 + bi * BAND`: a band carrying a
       metering assembly is taller than one that does not, and only the bands
       that carry one grow. With no meters every band height is BAND and the
       positions are identical to v1.2.0. */
    const bandY = []; let _acc = 74;
    bands.forEach(b => { bandY.push(_acc); _acc += BAND + b.dyIn + b.dyOut + b.dySt; });
    /* v1.3.0 — the bottom margin now sizes itself to the footer.
       DEFECT FOUND WHILE ADDING THE METERING LINE: the margin was a flat 34,
       the legend already used two rows of it, and the "N edges in v_sld_edges
       not drawable" chip was being emitted at y = H + 7 — OUTSIDE the viewBox,
       so it has never been visible on any board that had one. A footer whose
       honesty line is clipped is worse than no honesty line, because the
       diagram then looks complete (rule G-4). One row per optional line. */
    const _footRows = ((S._skipped.length ? 1 : 0) +
                       ((placedMeters.size || meterUnplaced.length) ? 1 : 0));
    const H = _acc + gx(34) + zy(24) + _footRows * zy(13);
    const colX = i => gx(SLD_PADX) + i * gx(SLD_COL) + gx(SLD_COL) / 2;

    /* v1.10.0 — the page height is a TOKEN, resolved after the footer is known.
       The legend is generated from the symbols the board actually used, so it
       grows when a symbol is added: the contactor pushed it past the right edge
       and it wrapped into nothing, because H had been fixed before anything was
       drawn. Trap T-14 has now bitten three times; measuring the footer and
       then sizing the page ends the whole class. */
    let s = `<svg viewBox="0 0 ${W} %H%" width="${W}" height="%H%" xmlns="http://www.w3.org/2000/svg" font-family="${SANS}">`;
    s += `<rect x="0" y="0" width="${W}" height="%H%" fill="#fff"/>`;

    /* title block */
    s += `<rect x="0" y="0" width="${W}" height="4" fill="${CRIMSON}"/>` +
      `<text x="${gx(SLD_PADX)}" y="30" font-family="${MONO}" font-size="15" font-weight="700" fill="${CRIMSON}">${esc(board.tag)}</text>` +
      `<text x="${gx(SLD_PADX)}" y="46" font-weight="600" font-family="${MONO}" font-size="${ts(8.6)}" fill="${SOFT}">${esc(board.doc_no || "")}` +
      (board.voltage_v != null ? `  ·  ${esc(n0(board.voltage_v))} V` : "") +
      /* v1.6.0 — a tie is still a CUBICLE on this board; moving it to the end
         of the bar must not quietly drop it from the count. */
      `  ·  ${bands.length} busbar${bands.length > 1 ? "s" : ""}  ·  ${bands.reduce((n, b) => n + b.inc.length + b.out.length + b.tie.length + b.tieL.length, 0)} positions` +
      /* v1.3.0 — metering positions are counted separately, not dropped. They
         are still cubicles on this board; they just no longer stand in the
         outgoing row pretending to carry load. */
      (placedMeters.size ? `  ·  ${placedMeters.size} metering` : "") + `</text>`;

    const drawn = { inc: 0, out: 0, load: 0, src: 0, cpl: 0, offsheet: 0, meter: 0 };

    /* ── the metering assembly (v1.3.0) ───────────────────────────────────
       Three connections, drawn as three connections:

           conductor ──╫── CT ────●  Ⓐ  .MG1     current, from the CT tap
                       │              ┊
           ════════════╪══════════════╪═══ BUSBAR    voltage, dashed, direct

       `my` is the centre of the CT on the conductor, 30 px from the busbar on
       whichever side the position sits. The auxiliary supply is deliberately
       NOT drawn: the ELD03 does not draw it either — it says "see aux wiring
       diagram for details" — and inventing a connection is rule G-3.        */
    function meterAssembly(cx, busY, above, list) {
      let g = "";
      list.forEach((m, k) => {
        const my = busY + (above ? -1 : 1) * zy(30 + k * 34);
        drawn.meter++;
        /* The analyser sits at cx+30, inside the half column, so its voltage
           reference always lands on the busbar even in the last column. The CT
           ratio used to print to its right; v1.14.3 took it off the sheet (see
           below) and the assembly now ends at the instrument. */
        g += sldSymDirect("CT", { x: cx, y: my, color: INK, scale: 0.92 * Z() });
        g += `<line x1="${cx + zy(11)}" y1="${my}" x2="${cx + zy(18)}" y2="${my}" stroke="${INK}" stroke-width="1.3"/>`;
        /* the instrument tag goes on the side AWAY from the busbar, so it never
           shares space with the voltage reference that runs towards it */
        g += sldSymDirect("NETWORK_ANALYZER", {
          x: cx + zy(30), y: my, color: INK, scale: 0.92 * Z(), labelPos: above ? "above" : "below",
          label: sldPosCode(m.tag, boardTag), dq: m.data_status,
          title: [m.meter_tag || m.tag, "measures " + m.measures_tag,
                  "U ref " + (m.voltage_ref_tag || "?"), m.ct_ratio_raw].filter(Boolean).join(" · ")
        });
        /* v1.14.3 — the CT ratio no longer PRINTS. Mario asked for it off the
           sheet, and it was the one thing standing between the drawing and a
           tighter column: at cx+43 it only fitted while the half column was 54,
           so it, not the split ways, was capping the pitch at 98.
           The datum is NOT lost — it is in the analyser's own tooltip above
           (`m.ct_ratio_raw` in the title), and it is one field of
           v_sld_nodes.ct_ratio_raw for anything that needs to read it. What
           went away is the printed copy, not the number. */
        /* the voltage reference — dashed, because it carries no load current.
           It leaves the instrument on the side FACING the busbar, which is
           below it for an incomer and above it for an outgoing position. */
        const vy = my + (above ? zy(10) : -zy(10));
        g += `<line x1="${cx + zy(30)}" y1="${vy}" x2="${cx + zy(30)}" y2="${busY}" stroke="${SOFT}" ` +
          `stroke-width="1.1" stroke-dasharray="3 3"/>`;
        g += `<text x="${cx + zy(34)}" y="${(vy + busY) / 2}" font-weight="600" font-family="${MONO}" font-size="${ts(6.2)}" ` +
          `fill="${SOFT}"${HALO}>U</text>`;
      });
      return g;
    }

    /* ── v1.6.0 · the tie stub ─────────────────────────────────────────────
       An elbow off the end of the busbar: up, then outward, with the position's
       OWN symbol on the vertical and the destination above the horizontal.

              ⇢ BUSBAR B
                 ┌────           .MCG1 · N.O.
                 │
              ───┴─ ✕ ──         the symbol, in its N.O. state
                 │
           ══════╧══════════ BUSBAR A

       `dir` = +1 leaves to the RIGHT (a tie this bar drives), −1 arrives from
       the LEFT (a tie another bar drives into this one). The N.O. state is
       printed on every one of them because all six couplers are normally open:
       these are sources a section CAN have, not sources it HAS (rule G-3).   */
    function tieStub(x, busY, topY, dir, i, o) {
      /* The device sits on the INCOMER row, not just above the bar. Its first
         position put it level with the metering assembly, where the last
         incomer's CT ratio prints — and the ratio is the one number on that
         assembly that has to stay readable. On the incomer row it also reads
         correctly: a tie IS a switching device fed from the bar, so it belongs
         in the same rank as the machine incomers, at the end of the line. */
      /* An OUT tie gets its own COLUMN at the end of the bar (see b.nWide), so
         it needs no vertical stagger. An IN tie has no columns to the left of
         the bar to take, so a second one steps upward instead. */
      const sy = topY - (dir > 0 ? 0 : i * gx(30));
      /* the label runs RIGHT from the elbow and a second OUT tie is only one
         column away, so the elbows fan upward: same symbol row, different
         heights, and the two destination names never share a line. */
      const h = busY - sy + gx(20) + (dir > 0 ? ((o.n || 1) - 1 - i) * gx(22) : 0), e = gx(26) * dir;
      const col = SLD_BUSCOL;
      /* The conductor STOPS AT THE DEVICE'S TERMINALS and starts again on the
         other side — it does not run through the symbol. Every other position
         on this drawing already does that (`cy ± 13·Z`); the tie stub was
         drawing one line from the bar to the elbow with the breaker painted on
         top of it, so the dashes crossed the glyph. A line through a device is
         not a shorter way of saying the same thing: it says the device is not
         in the circuit. */
      const dash = o.open ? ` stroke-dasharray="5 4"` : "";
      const gap = zy(13);
      let g = `<line x1="${x}" y1="${busY}" x2="${x}" y2="${sy + gap}" stroke="${col}" ` +
        `stroke-width="1.6"${dash}/>` +
        `<line x1="${x}" y1="${sy - gap}" x2="${x}" y2="${busY - h}" stroke="${col}" ` +
        `stroke-width="1.6"${dash}/>` +
        `<line x1="${x}" y1="${busY - h}" x2="${x + e}" y2="${busY - h}" stroke="${col}" ` +
        `stroke-width="1.6"${dash}/>`;
      g += sldGlyph(o.kind, x, sy, col, !!o.open, o.fam);
      /* The OUT label runs right, into the page margin, where there is room.
         The IN label cannot: anchored at the elbow it ran OFF THE LEFT EDGE of
         the viewBox and SVG clipped it silently — trap T-14, the third time.
         It is left-aligned in the gutter instead, which is where the arrival
         used to be printed anyway, so nothing new can collide with it. The
         sub wraps on " · " rather than being clipped: a cable number cut in
         half is worse than a second line. */
      const tx = dir > 0 ? x + e + gx(5) : 8;
      const cap = dir > 0 ? 40 : 24, lines = [];
      String(o.sub || "").split(" · ").forEach(w => {
        if (lines.length && (lines[lines.length - 1] + " · " + w).length <= cap)
          lines[lines.length - 1] += " · " + w;
        else lines.push(w);
      });
      /* the whole block sits ABOVE the elbow, so a second line grows upward
         into free page rather than down across the horizontal run */
      let ly = busY - h - zy(13) - (lines.length - 1) * zy(10);
      g += `<text x="${tx}" y="${ly}" text-anchor="start" font-family="${MONO}" ` +
        `font-size="${ts(7.6)}" font-weight="700" fill="${SLD_BUSCOL}">` +
        `${dir > 0 ? "⇢" : "⇠"} BUSBAR ${esc(o.farCode)}</text>`;
      lines.forEach(t => { ly += zy(10);
        g += `<text x="${tx}" y="${ly}" text-anchor="start" font-weight="600" ` +
          `font-family="${MONO}" font-size="${ts(6.6)}" fill="${SOFT}">${esc(t)}</text>`; });
      return g;
    }

    bands.forEach((band, bi) => {
      const y0 = bandY[bi];
      const dy2 = band.dyIn + band.dyOut;
      const busY = y0 + gx(SLD_BUS_Y) + band.dyIn;
      const nWide = band.nWide;
      const busX1 = gx(SLD_PADX) - 22;
      /* the bar ends AT the last tie when it carries one, not a column beyond */
      const busX2 = gx(SLD_PADX) + Math.max(2, nWide) * gx(SLD_COL) +
                    (band.tie.length ? band.tie[band.tie.length - 1].dx : 0);

      /* ── busbar ── */
      s += `<line x1="${busX1}" y1="${busY}" x2="${busX2}" y2="${busY}" stroke="${SLD_BUSCOL}" stroke-width="${zy(5)}" stroke-linecap="round"/>`;
      /* v1.7.0 — the name sits ABOVE the bar, not across it. It used to straddle
         the conductor (first line on the centre line, tag below it), which put
         the tag in the outgoing half where the drop lines start. Both lines
         now clear the bar upward. */
      s += `<text x="8" y="${busY - zy(13)}" font-family="${MONO}" font-size="12" font-weight="700" fill="${SLD_BUSCOL}">` +
        `BUSBAR ${esc(sldBusCode(band.bus.tag, boardTag))}</text>`;
      s += `<text x="8" y="${busY - zy(3)}" font-weight="600" font-family="${MONO}" font-size="${ts(6.8)}" fill="${SOFT}">${esc(band.bus.tag)}` +
        `${band.bus.symbol_kind === "BUSBAR_INVERTER" ? " · inverter bus" : ""}</text>`;

      /* ── v1.4.0 · where else this section can be fed from ────────────────
         A bus coupler is drawn as a column on the busbar that OWNS it, and the
         busbar at the far end got nothing — so busbar B looked like it had two
         generators and no other source, when .MCG1 on busbar A can feed it and
         .MCG2 on PC2 busbar C can too.

         This is a DRAWING gap, not a data gap: the database carries all four
         FEEDS edges per coupler, both directions, VERIFIED, each with
         normally_open (migration 150b). Nothing was added to build this label.

         N.O. is printed on every one of them, and that is not decoration: all
         six couplers are normally open, so these are sources the section CAN
         have, not sources it HAS. A label saying "from BUSBAR A" without it
         would claim a feed that does not normally exist (rule G-3). */
      /* v1.6.0 — the OUT end: at the RIGHT end of the bar, above it. */
      band.tie.forEach((t, i) => {
        s += tieStub(gx(SLD_PADX) + band.base * gx(SLD_COL) + t.dx, busY,
                     y0 + gx(SLD_INC_Y), +1, i, {
          kind: t.pos.symbol_kind, open: !!t.open, n: band.tie.length, fam: t.pos.breaker_family,
          farCode: t.farCode, sub: t.sub
        });
        if (t.offBoard) drawn.offsheet++;
        drawn.cpl++;
      });

      /* ── the IN end: at the LEFT end of the bar, above it ──────────────
         Two kinds arrive here. First this bar's OWN cubicle pointing back up
         the chain (busbar C's `.MCG2` → busbar B) — v1.7.0; it knows the
         cubicle code, so it is the better of the two. Then a coupler owned by
         ANOTHER bar that reaches this one (busbar B's arrival from A, whose
         cubicle `.MCG1` belongs to A). A link already drawn from this bar in
         either direction is not drawn a second time. */
      let li = 0;
      const outFar = new Set(band.tie.map(t => t.farTag));
      band.tieL.forEach(t => {
        outFar.add(t.farTag);
        s += tieStub(busX1, busY, y0 + gx(SLD_INC_Y), -1, li++, {
          kind: t.pos.symbol_kind, open: !!t.open, n: band.tieL.length, fam: t.pos.breaker_family,
          farCode: t.farCode, sub: t.sub
        });
        if (t.offBoard) drawn.offsheet++;
        drawn.cpl++;
      });
      const fedFrom = sldIn(S, band.bus.tag)
        .filter(e => e.edge_kind === "FEEDS")
        .map(e => ({ e: e, n: S._byTag.get(e.from_tag) }))
        .filter(x => x.n && x.n.symbol_kind === "BUS_COUPLER" &&
                     x.n.parent_tag && x.n.parent_tag !== band.bus.tag)
        .map(x => ({ e: x.e, cpl: x.n, src: S._byTag.get(x.n.parent_tag) }))
        .filter(x => x.src && !outFar.has(x.src.tag));
      fedFrom.forEach(x => {
        const srcBoard = sldBoardOf(S, x.src) || boardTag;
        const off = srcBoard !== boardTag;
        s += tieStub(busX1, busY, y0 + gx(SLD_INC_Y), -1, li++, {
          kind: "BUS_COUPLER", open: !!x.e.normally_open, fam: x.cpl.breaker_family,
          farCode: sldBusCode(x.src.tag, srcBoard) + (off ? " · " + srcBoard : ""),
          sub: [(off ? srcBoard + " " : "") + sldPosCode(x.cpl.tag, srcBoard),
                x.e.cable_tag || "", x.e.normally_open ? "N.O." : ""].filter(Boolean).join(" · ")
        });
        if (off) drawn.offsheet++;
      });

      /* ── incomers, above the bar ── */
      band.inc.forEach((p, i) => {
        const cx = colX(i), cy = y0 + gx(SLD_INC_Y);
        drawn.inc++;
        /* source above the incomer, if the graph names one */
        const up = sldIn(S, p.tag).filter(e => e.edge_kind === "FEEDS");
        if (up.length) {
          const srcNode = S._byTag.get(up[0].from_tag);
          /* the board a node belongs to: its own tag for a switchboard, else the
             switchboard part of its parent ("480-JG-692-BBD" → "480-JG-692").   */
          const srcBoard = sldBoardOf(S, srcNode);
          const off = !!srcBoard && srcBoard !== boardTag;
          const shown = off ? { tag: srcBoard, data_status: srcNode.data_status } : srcNode;
          const sub = srcNode && srcNode.symbol_kind === "GENERATOR"
            ? (sldKw(srcNode) || "generator")
            : (off ? sldPosCode(srcNode.tag, srcBoard) + (up[0].cable_tag ? " · " + up[0].cable_tag : "")
                   : ([srcNode && srcNode.parent_tag ? "via " + sldPosCode(srcNode.parent_tag, boardTag) : "",
                       up[0].cable_tag || ""].filter(Boolean).join(" · ")));
          /* v1.5.0 — a machine is drawn as a machine. A generator feeding this
             board used to be a card: a rounded box with its tag and one line of
             sub-text. That is the shape this renderer uses for something it can
             only NAME (an off-sheet board, a PC tie). A generator is on the
             sheet, it has a symbol in the pack, and it carries both a rating
             and a current — so it is drawn as the rotary symbol with its tag
             above and its two figures beside it (Mario's third instruction). */
          const isGen = srcNode && srcNode.symbol_kind === "GENERATOR" && !off;
          let srcBottom;
          if (isGen) {
            /* the card carried its tag INSIDE the box; the symbol carries it
               ABOVE, so the machine has to drop by that line's height or the
               label climbs into the band overhead — `check_sld_layout.js`
               caught exactly that ("710 kW" ∩ "GE-004" on PC1). */
            const cyS = y0 + gx(SLD_SRC_Y) + gx(SLD_BOXH) / 2 + zy(9);
            s += sldSymDirect("GENERATOR", {
              x: cx, y: cyS, color: INK, scale: 1.05 * Z(), labelPos: "above",
              label: clip(srcNode.tag, 14), dq: srcNode.data_status,
              /* the kernel's badge FORMATS the value, so it takes the NUMBER.
                 Passing it a pre-formatted "1,822" printed "NaN kW" — invisible
                 at the shipping zoom because the two lines only collided at
                 1.5, which is the only reason the sweep found it. */
              values: [srcNode.power_kw  != null ? { v: +srcNode.power_kw,  u: "kW" } : null,
                       srcNode.current_a != null ? { v: +srcNode.current_a, u: "A" }  : null].filter(Boolean),
              title: [srcNode.tag, sldKw(srcNode), sldAmp(srcNode),
                      srcNode.voltage_v != null ? n0(srcNode.voltage_v) + " V" : ""].filter(Boolean).join(" · ")
            });
            srcBottom = cyS + zy(13);
          } else {
            s += sldCard(cx, y0 + gx(SLD_SRC_Y), shown, sub, false);
            srcBottom = y0 + gx(SLD_SRC_Y) + gx(SLD_BOXH);
          }
          if (off) drawn.offsheet++;
          drawn.src++;
          s += `<line x1="${cx}" y1="${srcBottom}" x2="${cx}" y2="${sldPortY(p.symbol_kind, cx, cy, "A", p.breaker_family)}" stroke="${INK}" stroke-width="1.4"/>`;
          s += sldCable(cx, srcBottom + 13, up[0]);
        }
        s += `<line x1="${cx}" y1="${sldPortY(p.symbol_kind, cx, cy, "B", p.breaker_family)}" x2="${cx}" y2="${busY - 2}" stroke="${INK}" stroke-width="1.4"/>`;
        if (meterOn.has(p.tag)) s += meterAssembly(cx, busY, true, meterOn.get(p.tag));
        s += sldGlyph(p.symbol_kind, cx, cy, INK, false, p.breaker_family);
        s += sldPosLabel(cx, cy, sldPosCode(p.tag, boardTag), nav, p.tag);
      });

      /* ── outgoing positions + couplers, below the bar ── */
      band.out.forEach((p, i) => {
        const cx = colX(i), cy = y0 + gx(SLD_OUT_Y) + dy2;
        const isCpl = p.symbol_kind === "BUS_COUPLER";
        const edges = sldOut(S, p.tag).filter(e => e.edge_kind === "FEEDS");
        const openEdge = edges.some(e => e.normally_open);
        const dash = openEdge ? ` stroke-dasharray="5 4"` : "";
        drawn.out++; if (isCpl) drawn.cpl++;

        /* what this position reaches — resolved BEFORE the labels are painted so
           the drop line never runs across the position code (see HALO too) */
        const targets = edges.map(e => ({ e: e, n: S._byTag.get(e.to_tag) }))
          .filter(t => t.n && t.n.tag !== band.bus.tag);
        const t = targets[0], tn = t && t.n;
        /* ── v1.14.0 · a way that feeds MORE THAN ONE machine ──────────────
           Mario, on .312 and .313: "ambos deberían ser arrancados por
           arrancador suave, luego tener dos contactores auto-enclavados y dos
           motores conectados". Until now the renderer drew targets[0] and
           printed "+N more" in red — honest, but it left the second machine as
           a footnote on a drawing whose whole point is that there are two.
           Migration 184 made v_sld_nodes read the loads from the power graph,
           so N loads per way is now ordinary data and the drawing has to say
           so: the conductor forks into a short branch bar and each machine
           hangs off its own drop.
           Only plain, on-board, end-of-branch machines fan out. A busbar, an
           off-sheet position or a node that passes power on keeps the old
           single-target layout — those carry side labels and second levels
           that a fork would collide with. */
        const fan = (targets.length > 1 && targets.every(x =>
              x.n && !isBusbar(x.n) &&
              !(sldBoardOf(S, x.n) && sldBoardOf(S, x.n) !== boardTag) &&
              secondLevel(x.n).length === 0)) ? targets : null;

        s += `<line x1="${cx}" y1="${busY + 2}" x2="${cx}" y2="${sldPortY(p.symbol_kind, cx, cy, "A", p.breaker_family)}" stroke="${INK}" stroke-width="1.4"${dash}/>`;
        if (meterOn.has(p.tag)) s += meterAssembly(cx, busY, false, meterOn.get(p.tag));
        /* ── v1.10.0 · the STARTING DEVICE, between the breaker and the load ──
           Mario: "all contactors have coils, include a contactor with coil".
           Migration 174 puts `start_kind` in v_sld_nodes — VFD, SOFT_STARTER or
           CONTACTOR, in that priority, and only on OUTGOING ways: an incomer
           starts nothing, and restricting it also keeps out the nine bogus
           CONTACTOR rows on the analysers (CR-00238, still open).
           The conductor is BROKEN at the device's terminals, like every other
           symbol on the sheet — a line through a device says it is not in the
           circuit. A way with no start_kind draws exactly as before. */
        const yTop = sldPortY(p.symbol_kind, cx, cy, "B", p.breaker_family);
        const yBot = (tn && !isBusbar(tn) && !(sldBoardOf(S, tn) && sldBoardOf(S, tn) !== boardTag))
            ? sldPortY(tn.symbol_kind, cx, y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + zy(14), "A")
              - (fan ? zy(13) : 0)
            : y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt - 2;
        const stKind = p.start_kind && SLD_START.has(p.start_kind) ? p.start_kind : null;
        /* v1.14.0 — anchored so the TOP PORT lands where a 26-unit symbol's did.
           Hard-coding the centre at +40 put an 88-unit symbol's top port 27
           units above the fuse switch's bottom: the two overlapped. */
        const stY = cy + zy(40 + (stKind ? startExtra(stKind) / 2 : 0));
        if (t && stKind) {
          s += `<line x1="${cx}" y1="${yTop}" x2="${cx}" y2="${sldPortYDirect(stKind, cx, stY, "A")}" stroke="${INK}" stroke-width="1.4"${dash}/>`;
          s += sldSymDirect(stKind, { x: cx, y: stY, color: INK, scale: 0.92 * Z(),
            title: SLD_START.get(stKind) + (p.start_model ? " · " + p.start_model : "") });
          /* v1.14.0 — a symbol that declares BL/BR hands out TWO conductors, so
             the single trunk below it would be a third one that goes nowhere. */
          if (!(fan && startOuts(stKind, cx, stY)))
            s += `<line x1="${cx}" y1="${sldPortYDirect(stKind, cx, stY, "B")}" x2="${cx}" y2="${yBot}" stroke="${INK}" stroke-width="1.4"${dash}/>`;
        } else if (t) {
          s += `<line x1="${cx}" y1="${yTop}" x2="${cx}" y2="${yBot}" stroke="${INK}" stroke-width="1.4"${dash}/>`;
        }
        s += sldGlyph(p.symbol_kind, cx, cy, isCpl ? SLD_BUSCOL : INK, openEdge, p.breaker_family);
        s += sldPosLabel(cx, cy, sldPosCode(p.tag, boardTag), nav, p.tag);

        if (!t) {
          /* no power edge — but the position may still carry a documented
             cable-identity tie (CONNECTED_TO). Show it rather than "no load". */
          const tie = sldOut(S, p.tag).concat(sldIn(S, p.tag))
            .filter(e => e.edge_kind === "CONNECTED_TO" && e.cable_tag)[0];
          if (tie) {
            const other = S._byTag.get(tie.from_tag === p.tag ? tie.to_tag : tie.from_tag);
            const ob = other ? (sldBoardOf(S, other) || "") : "";
            s += `<line x1="${cx}" y1="${cy + zy(15)}" x2="${cx}" y2="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt - 2}" stroke="${SOFT}" stroke-width="1.2" stroke-dasharray="2 3"/>`;
            s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + 8}" text-anchor="middle" font-family="${MONO}" font-size="${ts(7.4)}" font-weight="700" fill="${SOFT}">⇢ ${esc(ob || "tie")} ${esc(other ? sldPosCode(other.tag, ob) : "")}</text>`;
            s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + 19}" text-anchor="middle" font-weight="600" font-family="${MONO}" font-size="${ts(6.6)}" fill="${SOFT}">cable tie · ${esc(tie.cable_tag)}</text>`;
          } else if (p.symbol_kind === "NETWORK_ANALYZER") {
            /* v1.3.0 — a metering position still in the outgoing row is one this
               diagram could NOT attach to its circuit. Say which of the two
               reasons it is; never let it look like a normal feeder (G-4). */
            s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + 8}" text-anchor="middle" font-family="${MONO}" font-size="${ts(7)}" font-weight="700" fill="${CRIMSON}">` +
              (p.measures_tag ? `⇢ ${esc(clip(p.measures_tag, 14))}` : "⚠ not attached") + `</text>`;
            s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + 19}" text-anchor="middle" font-weight="600" font-family="${MONO}" font-size="${ts(6.6)}" fill="${SOFT}">` +
              (p.measures_tag ? "not on this board" : "no measured circuit") + `</text>`;
          } else if (p.symbol_kind !== "SPARE") {
            s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + 16}" text-anchor="middle" font-weight="600" font-family="${MONO}" font-size="${ts(6.8)}" fill="${SOFT}">— no load linked —</text>`;
          }
          return;
        }
        /* v1.14.0 — the cable label sat at a hard-coded stY+24, which was below
           the 26-unit starting symbols and INSIDE the 76-unit SOFT_STARTER_2C.
           Hang it off the symbol's own B port instead, so it stays clear of any
           symbol the pack grows later. */
        s += sldCable(cx, stKind ? sldPortYDirect(stKind, cx, stY, "B") + zy(9) : cy + zy(50), t.e,
                      !!(fan && stKind && startOuts(stKind, cx, stY)));

        if (isBusbar(tn)) {                       /* coupler → another busbar */
          const here = busSet.has(tn.tag);
          const tBoard = here ? boardTag : (sldBoardOf(S, tn) || String(tn.parent_tag || ""));
          s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + 12}" text-anchor="middle" font-family="${MONO}" font-size="${ts(7.6)}" font-weight="700" fill="${SLD_BUSCOL}">` +
            `⇢ BUSBAR ${esc(sldBusCode(tn.tag, tBoard))}</text>`;
          if (!here) { drawn.offsheet++;
            s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + 23}" text-anchor="middle" font-weight="600" font-family="${MONO}" font-size="${ts(6.6)}" fill="${SOFT}">off-sheet · ${esc(tBoard)}</text>`; }
        } else if (sldBoardOf(S, tn) && sldBoardOf(S, tn) !== boardTag) {
          /* the target is a POSITION on another Power Center (.210 → PC3 .300,
             .211 → PC4 .400) — that is a board-to-board tie, not a load.       */
          drawn.offsheet++;
          const tb = sldBoardOf(S, tn);
          s += sldCard(cx, y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt, { tag: tb, data_status: tn.data_status },
                       sldPosCode(tn.tag, tb) + (t.e.cable_tag ? " · " + t.e.cable_tag : ""), false);
          s += `<text x="${cx}" y="${y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt + gx(SLD_BOXH) + 11}" text-anchor="middle" font-weight="600" font-family="${MONO}" font-size="${ts(6.6)}" fill="${SOFT}">off-sheet · PC tie</text>`;
        } else if (fan) {                          /* several machines, in parallel */
          const cyL = y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt;
          const cyM = cyL + zy(14);
          const outs = stKind ? startOuts(stKind, cx, stY) : null;
          /* the machines line up UNDER the symbol's own terminals when it has
             two, so each drop is a straight line. Only a one-output symbol
             needs a spacing guess and a branch bar. */
          const dx  = outs ? Math.abs(outs[1].x - outs[0].x) / 2 : gx(SLD_COL) * 0.28;
          const yBar = sldPortY(tn.symbol_kind, cx, cyM, "A") - zy(13);
          /* with a two-output symbol each machine gets its own conductor from
             its own terminal — a dog-leg, the way a real sheet draws it. With a
             one-output symbol, the old branch bar. */
          if (!outs)
            s += `<line x1="${cx - dx}" y1="${yBar}" x2="${cx + dx}" y2="${yBar}" stroke="${INK}" stroke-width="1.4"/>`;
          fan.forEach((x, k) => {
            const n = x.n, ox = cx + (k === 0 ? -dx : dx);
            drawn.load++;
            if (outs && outs[k])
              s += `<line x1="${outs[k].x}" y1="${outs[k].y}" x2="${ox}" y2="${yBar}" stroke="${INK}" stroke-width="1.4"/>`;
            s += `<line x1="${ox}" y1="${yBar}" x2="${ox}" y2="${sldPortY(n.symbol_kind, ox, cyM, "A")}" stroke="${INK}" stroke-width="1.4"/>`;
            s += sldGlyph(n.symbol_kind, ox, cyM, INK, false);
            /* the tags are clipped harder than in the single-machine case: two
               labels have to live inside one column pitch without touching each
               other or the neighbouring way. check_sld_layout.js is the judge. */
            s += `<text x="${ox}" y="${cyL + zy(42)}" text-anchor="middle" font-family="${MONO}" font-size="${ts(7.4)}" font-weight="700" fill="${INK}"` +
              (nav ? ` style="cursor:pointer" onclick="${nav}('asset/${esc(n.tag)}')"` : "") +
              `>${esc(clip(n.tag, 9))}</text>`;
            s += sldRating(ox, cyL + zy(51), n).svg;
            const stk = SLD_STATUS[n.data_status] || SOFT;
            s += `<circle cx="${ox - zy(16)}" cy="${cyM}" r="3" fill="${stk}"><title>${esc(n.data_status || "")}</title></circle>`;
          });
        } else {                                   /* a served load */
          drawn.load++;
          const cyL = y0 + gx(SLD_LOAD_Y) + dy2 + band.dySt;
          /* ── v1.11.0 · a node that PASSES POWER ON is labelled to the SIDE ──
             Mario: "connect them to the motor". The conductor from a drive down
             to its motor was being drawn — and it was ONE PIXEL LONG. The start
             was hard-coded below the node's own label block (cyL + 56) while
             the motor's top port sits at about cyL + 73, so the line existed,
             passed every check, and joined nothing. It looked exactly like a
             drive with no motor attached.
             The label block was there to keep the conductor off the text; the
             fix is the same one the positions already use — put the text BESIDE
             the symbol and run the conductor straight through where it belongs.
             A node at the END of a branch keeps its labels underneath. */
          const passesOn = secondLevel(tn).length > 0;
          s += sldGlyph(tn.symbol_kind, cx, cyL + zy(14), INK, false);
          if (passesOn) {
            s += `<text x="${cx + zy(17)}" y="${cyL + zy(12)}" text-anchor="start" font-family="${MONO}" font-size="${ts(8)}" font-weight="700" fill="${INK}"${HALO}` +
              (nav ? ` style="cursor:pointer" onclick="${nav}('asset/${esc(tn.tag)}')"` : "") +
              `>${esc(clip(tn.tag, 15))}</text>`;
            let ry = cyL + zy(22);
            [sldKw(tn), sldAmp(tn)].filter(Boolean).forEach(v => {
              s += `<text x="${cx + zy(17)}" y="${ry}" text-anchor="start" font-weight="600" font-family="${MONO}" font-size="${ts(6.8)}" fill="${SOFT}"${HALO}>${esc(v)}</text>`;
              ry += zy(10);
            });
          } else {
            s += `<text x="${cx}" y="${cyL + zy(42)}" text-anchor="middle" font-family="${MONO}" font-size="${ts(8)}" font-weight="700" fill="${INK}"` +
              (nav ? ` style="cursor:pointer" onclick="${nav}('asset/${esc(tn.tag)}')"` : "") +
              `>${esc(clip(tn.tag, 15))}</text>`;
            const rt = sldRating(cx, cyL + zy(52), tn); s += rt.svg;
            if (targets.length > 1)
              s += `<text x="${cx}" y="${rt.y}" text-anchor="middle" font-weight="600" font-family="${MONO}" font-size="${ts(6.4)}" fill="${CRIMSON}">+${targets.length - 1} more</text>`;
          }
          const st = SLD_STATUS[tn.data_status] || SOFT;
          s += `<circle cx="${cx - zy(26)}" cy="${cyL + zy(14)}" r="3" fill="${st}"><title>${esc(tn.data_status || "")}</title></circle>`;

          /* SECOND LEVEL (v1.2.0) — this load is itself a board that feeds
             something. Migration 154 put those nodes in v_sld_nodes; without
             this block their edges would be drawable and still not drawn,
             which is the worse of the two failures: the footer would report
             everything fine while the motor was missing from the picture. */
          const kids = secondLevel(tn);
          if (kids.length) {
            const cyK = cyL + gx(SLD_L2_DY) + (targets.length > 1 ? 8 : 0);
            const kn = S._byTag.get(kids[0].to_tag);
            s += `<line x1="${cx}" y1="${sldPortY(tn.symbol_kind, cx, cyL + zy(14), "B")}" x2="${cx}" y2="${
              sldPortY(kn.symbol_kind, cx, cyK + zy(12), "A")}" stroke="${INK}" stroke-width="1.4"/>`;
            s += sldCable(cx, cyK - zy(28), kids[0]);
            s += sldGlyph(kn.symbol_kind, cx, cyK + zy(12), INK, false);
            s += `<circle cx="${cx - zy(26)}" cy="${cyK + zy(12)}" r="3" fill="${SLD_STATUS[kn.data_status] || SOFT}">` +
              `<title>${esc(kn.data_status || "")}</title></circle>`;
            s += `<text x="${cx}" y="${cyK + zy(38)}" text-anchor="middle" font-family="${MONO}" font-size="${ts(8)}" font-weight="700" fill="${INK}"` +
              (nav ? ` style="cursor:pointer" onclick="${nav}('asset/${esc(kn.tag)}')"` : "") +
              `>${esc(clip(kn.tag, 15))}</text>`;
            const rk = sldRating(cx, cyK + zy(48), kn); s += rk.svg;
            if (kids.length > 1)
              s += `<text x="${cx}" y="${rk.y}" text-anchor="middle" font-weight="600" font-family="${MONO}" font-size="${ts(6.4)}" fill="${CRIMSON}">+${kids.length - 1} more</text>`;
            drawn.load++;
          }
        }
      });
    });

    /* footer: legend + an honest account of what was not drawn.
       The legend is GENERATED from the symbols this board actually used, so a
       symbol added to the pack can never leave a stale key behind (rule G-7).  */
    let fy = H - gx(14) - zy(14) - _footRows * zy(13);
    let legendRows = 0;
    const skipped = S._skipped.length;
    const Sym = (typeof window !== "undefined" ? window : globalThis).TamSym;
    const used = _symUsed || new Set();
    if (Sym && Sym.ELEC_MAP && used.size) {
      const seen = [], names = [];
      used.forEach(k => {
        /* v1.3.0 — a kind the renderer placed directly (CT) is already a
           registered symbol and must legend under its own name rather than
           fall through to UNKNOWN. ELEC_MAP still wins for anything the
           DATABASE names, so the audit surface is unchanged. */
        let m = Sym.ELEC_MAP[String(k).toUpperCase()] ||
                (Sym.spec && Sym.spec(String(k).toUpperCase()) ? String(k).toUpperCase() : "UNKNOWN");
        if (sldSymbolStyle === "BOX" && (m === "CIRCUIT_BREAKER" || m === "ACB_DRAWOUT"))
          m = "CIRCUIT_BREAKER_BOX";
        if (seen.indexOf(m) < 0 && m !== "BUSBAR" && m !== "BUSBAR_INVERTER" &&
            m !== "SWITCHBOARD") { seen.push(m); names.push((Sym.spec(m) || {}).name || m); }
      });
      /* v1.14.0 — the legend row was a flat 13 units tall, which was fine while
         every symbol was 26 units. An 88-unit symbol at legend scale is 55 page
         px and ran straight through the two rows above it. Lay the rows out
         FIRST, measuring each one by its tallest symbol, then draw. */
      const item = seen.map((m, i) => {
        const sp = Sym.spec(m) || {};
        return { m: m, name: names[i],
                 sw: (sp.w || 24) * 0.62 * Z(),
                 sh: (sp.h || 24) * 0.62 * Z() };
      });
      item.forEach(it => { it.wItem = it.sw + gx(8) + it.name.length * ts(4.6) + gx(10); });
      const rows = [[]];
      let lx = gx(SLD_PADX);
      item.forEach(it => {
        if (lx > gx(SLD_PADX) && lx + it.wItem > W - gx(8)) { rows.push([]); lx = gx(SLD_PADX); }
        it.x = lx; rows[rows.length - 1].push(it); lx += it.wItem;
      });
      let ly = fy;
      rows.forEach((row, ri) => {
        const rowH = Math.max(zy(13), ...row.map(it => it.sh + zy(4)));
        if (ri > 0) legendRows += Math.ceil(rowH / zy(13));
        else        legendRows += Math.max(0, Math.ceil(rowH / zy(13)) - 1);
        const cyR = ly + rowH / 2 - zy(6);       /* symbols centred in the row */
        row.forEach(it => {
          s += Sym.draw(it.m, { x: it.x + it.sw / 2, y: cyR, scale: 0.62 * Z() });
          s += `<text x="${it.x + it.sw + gx(4)}" y="${cyR + zy(3)}" font-weight="600" font-family="${MONO}" font-size="${ts(6.8)}" fill="${SOFT}">${esc(it.name)}</text>`;
        });
        ly += rowH;
      });
      fy = ly - zy(6);
      s += `<text x="${gx(SLD_PADX)}" y="${fy + zy(14)}" font-weight="600" font-family="${MONO}" font-size="${ts(7.4)}" fill="${SOFT}">` +
        `dashed = NORMALLY OPEN (bus coupler)  ·  dotted from an analyser = voltage reference, not a load  ·  ` +
        `dot = data status  ·  order = display_rank (paper column order)  ·  symbols: IEC style, tam-sym-elec v0.3.2</text>`;
    } else {
      s += `<text x="${gx(SLD_PADX)}" y="${fy}" font-weight="600" font-family="${MONO}" font-size="${ts(7.4)}" fill="${SOFT}">` +
        `□ breaker  ⊘ disconnector  Ⓐ analyser  ◎◎ transformer  Ⓜ motor  Ⓖ generator  ` +
        `dashed = NORMALLY OPEN (bus coupler)  ·  dot = data status  ·  order = display_rank (paper column order)</text>`;
    }
    let fy2 = fy + (Sym && Sym.ELEC_MAP && used.size ? zy(27) : zy(13));
    if (skipped) {
      /* v1.3.0 — the breakdown is COUNTED, not narrated. The old sentence named
         the flash-compressor motors as the example; migration 154 put them in
         the view and the sentence kept claiming them anyway. A footer that
         explains the data has to be derived from the data. */
      const nNet = S._skipped.filter(e => e.edge_kind === "CONNECTED_TO").length;
      const nPwr = skipped - nNet;
      s += `<text x="${gx(SLD_PADX)}" y="${fy2}" font-weight="600" font-family="${MONO}" font-size="${ts(7.4)}" fill="${nPwr ? CRIMSON : SOFT}">` +
        `${skipped} edge${skipped > 1 ? "s" : ""} in v_sld_edges not drawable — endpoint absent from v_sld_nodes: ` +
        `${nNet} network link${nNet === 1 ? "" : "s"} (expected — their endpoints are not electrical nodes)` +
        `${nPwr ? `, ${nPwr} POWER edge${nPwr === 1 ? "" : "s"} ← this is a gap` : ""}</text>`;
      fy2 += zy(13); }
    /* v1.3.0 — the metering account. Both numbers are stated even when the
       second is zero: "11 drawn" alone would not say whether any were left. */
    if (drawn.meter || meterUnplaced.length)
      s += `<text x="${gx(SLD_PADX)}" y="${fy2}" font-weight="600" font-family="${MONO}" font-size="${ts(7.4)}" fill="${meterUnplaced.length ? CRIMSON : SOFT}">` +
        `${drawn.meter} metering assembl${drawn.meter === 1 ? "y" : "ies"} drawn on the measured circuit  ·  ` +
        `${meterUnplaced.length} analyser${meterUnplaced.length === 1 ? "" : "s"} left in the outgoing row` +
        `${meterUnplaced.length ? " — " + meterUnplaced.map(m => sldPosCode(m.tag, boardTag)).join(", ") : ""}</text>`;
    s += `</svg>`;
    /* the page ends below whatever the footer actually reached */
    const HH = Math.max(H, fy2 + gx(12), fy + legendRows * zy(13) + gx(12));
    s = s.split("%H%").join(String(+HH.toFixed(1)));
    return `<div style="overflow-x:auto">${s}</div>`;
  }

  /* ── export ───────────────────────────────────────────────────────────── */
  const API = { load, fromViewer, plantMap, areaBlock, unitSummary, hmbCards, svcClass, hmbChip, indexData,
                loadSld, sldFromViewer, indexSld, sldBoards, sld,
                get sldSymbolStyle() { return sldSymbolStyle; },
                set sldSymbolStyle(v) { sldSymbolStyle = (v === "BOX" ? "BOX" : "IEC"); },
                get sldZoom() { return sldZoom; },
                set sldZoom(v) { sldZoom = (+v > 0 ? +v : 1); },
                version: "1.14.3" };
  const root = (typeof window !== "undefined") ? window : globalThis;
  root.TamFlow = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
