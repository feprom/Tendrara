/* gen_sld_review.js — regenerate eni/sld_review.html from the current sources.
 *
 *   node eni/gen_sld_review.js
 *
 * WHY THIS FILE EXISTS. sld_review.html is an OFFLINE SNAPSHOT: the kernel, the ELECTRICAL pack,
 * the renderer and a frozen copy of v_sld_nodes / v_sld_edges are all inlined so the page opens
 * from file:// with no network (rule G-8). That is the right design and it has one failure mode —
 * the copy drifts. It did: the file shipped tam-flow v1.1.0 and 205 nodes long after the renderer
 * was v1.2.0 and the view had 209. Regenerating it was a manual act nobody could repeat, so nobody
 * repeated it. Now it is one command.
 *
 * Inputs: eni/tam-sym.js, eni/tam-sym-elec.js, eni/tam-flow.js, and eni/sld_nodes.json /
 * eni/sld_edges.json dumped from the two views. The page SHELL (styles, header, board picker, coverage table) is lifted
 * verbatim from the previous snapshot, so regenerating never silently restyles the page.
 *
 * Refresh the data with:
 *   select json_agg(t order by t.display_rank, t.tag) from (select * from v_sld_nodes) t;
 *   select json_agg(t)                                from (select * from v_sld_edges) t;
 */
const fs=require('fs');
const path=require('path');
const HERE=__dirname;                 // eni/
const R = p => fs.readFileSync(p,'utf8');
const nodes=JSON.parse(R(path.join(HERE,'sld_nodes.json'))), edges=JSON.parse(R(path.join(HERE,'sld_edges.json')));
const old = R(path.join(HERE,'sld_review.html'));
// reuse the page shell verbatim from the previous snapshot: everything after the fixture block
const j = old.indexOf('<script>const FIXTURE'); const k = old.indexOf('</script>', j)+9;
let shell = old.slice(k);
shell = shell.replace('REVIEW RENDER · snapshot after migration 153','REVIEW RENDER · snapshot after migration 168 · renderer v1.5.0')
             .replace('migrations 150b · 151 · 152 series','migrations 150b · 151 · 152 · 154 · 166 series');
/* the banner NAMES the renderer, so it has to be rewritten every run, not
   matched once: the anchor above is consumed by its own replacement (trap
   T-11), after which each regeneration left a stale version in the header
   while the inlined renderer moved on — the same drift this file exists to
   stop. Read the version from the module rather than typing it. */
const T = require(path.join(HERE,'tam-flow.js'));
shell = shell.replace(/renderer v\d+\.\d+\.\d+/g, 'renderer v' + T.version);
shell = shell.replace('its data_status (green VERIFIED · amber NEEDS_REVIEW · red CONFLICT).',
  'its data_status (green VERIFIED · amber NEEDS_REVIEW · red CONFLICT) · a network analyser is drawn ' +
  'on the circuit it measures: CT on the conductor, tap to the instrument, dotted line back to the ' +
  'busbar it takes its voltage reference from (migration 166 · tam-flow v1.3.0) · a busbar reachable through a coupler that sits on ANOTHER busbar is labelled with its source and its coupler and that coupler N.O. state (v1.4.0).');

const html =
`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TAM · Electrical single-line — REVIEW RENDER (after migration 168)</title>
<!-- GENERATED FILE. Offline snapshot: kernel + ELECTRICAL pack + renderer + a frozen copy of
     v_sld_nodes / v_sld_edges, inlined so it opens from file:// with no network (rule G-8).
     Regenerate with SQL/../gen_review.js after any graphics or view change - do NOT hand-edit,
     and do NOT let it drift from eni/tam-flow.js (that is what happened to the v1.1.0 copy). -->
<script>
${R(path.join(HERE,'tam-sym.js'))}
</script>
<script>
${R(path.join(HERE,'tam-sym-elec.js'))}
</script>
<script>
${R(path.join(HERE,'tam-flow.js'))}
</script>
<script>const FIXTURE = ${JSON.stringify({nodes,edges})};</script>
${shell}`;
fs.writeFileSync(path.join(HERE,'sld_review.html'), html);
console.log('written', html.length, 'bytes');
