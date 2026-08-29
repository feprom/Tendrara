/* check_sld_layout.js — is the single-line actually readable?
 *
 *   node eni/check_sld_layout.js                 # the shipping zoom
 *   node eni/check_sld_layout.js 1.0,1.1,1.2,1.3,1.4  # sweep, and see where it breaks
 *   node eni/check_sld_layout.js 1.3 detail      # name every collision
 *
 * WHY. "the icons are too small" and "make the small text bigger" are easy to
 * act on and hard to verify: enlarge the marks and they start touching, and the
 * eye finds that late, on one board, at one zoom, after it has shipped. This
 * walks the rendered SVG, tracks every <g transform> so a symbol's own label
 * lands in PAGE coordinates, boxes each <text> (monospace approx 0.6 em) and
 * reports three things:
 *
 *   - text overlapping text
 *   - text running under a symbol (a glyph's own letter is excluded - it
 *     belongs inside its circle)
 *   - anything outside the viewBox, which SVG silently clips. That is how the
 *     "N edges not drawable" chip stayed invisible for a year (trap T-14).
 *
 * TamFlow.sldZoom was chosen with this, not by eye: 1.3 is the largest 10 %
 * step that is still clean on all four boards. At 1.4 the analyser tags start
 * hitting the incomer figures.
 */
const fs=require('fs');
function textBoxes(svg){
  const out=[]; const stack=[{x:0,y:0,s:1,g:0}]; let gid=0;
  const tok=/<g([^>]*)>|<\/g>|<text([^>]*)>([^<]*)<\/text>/g; let m;
  while((m=tok.exec(svg))){
    if(m[0].startsWith('</g')){ if(stack.length>1) stack.pop(); continue; }
    if(m[0].startsWith('<g')){
      const tr=/transform="([^"]*)"/.exec(m[1]);
      const p=stack[stack.length-1]; let dx=0,dy=0,s=1;
      if(tr){ const t=/translate\(([-\d.]+),([-\d.]+)\)/.exec(tr[1]);
              const sc=/scale\(([-\d.]+)\)/.exec(tr[1]);
              if(t){dx=+t[1];dy=+t[2];} if(sc)s=+sc[1]; }
      stack.push({x:p.x+dx*p.s, y:p.y+dy*p.s, s:p.s*s, g:++gid}); continue;
    }
    const a=m[2], t=m[3].replace(/&[a-z]+;/g,'x');
    if(!t.trim()) continue;
    const g=k=>{const r=new RegExp(k+'="([^"]*)"').exec(a); return r?r[1]:null;};
    const p=stack[stack.length-1];
    const fz=(+(g('font-size')||10))*p.s;
    const x=p.x+(+g('x')||0)*p.s, y=p.y+(+g('y')||0)*p.s;
    const an=g('text-anchor')||'start';
    const w=t.length*fz*0.6;
    const x0 = an==='middle' ? x-w/2 : an==='end' ? x-w : x;
    out.push({x0,x1:x0+w,y0:y-fz*0.8,y1:y+fz*0.25,t:t.trim(),fz:+fz.toFixed(2),g:p.g});
  }
  return out;
}
/* circles in page coordinates — the CT core, the analyser, motors, generators.
   Text running under a symbol is the other half of "unreadable", and the eye
   catches it late. */
function circles(svg){
  const out=[]; const stack=[{x:0,y:0,s:1,g:0}]; let gid=0;
  const tok=/<g([^>]*)>|<\/g>|<circle([^>]*)\/>/g; let m;
  while((m=tok.exec(svg))){
    if(m[0].startsWith('</g')){ if(stack.length>1) stack.pop(); continue; }
    if(m[0].startsWith('<g')){
      const tr=/transform="([^"]*)"/.exec(m[1]);
      const p=stack[stack.length-1]; let dx=0,dy=0,s=1;
      if(tr){ const t=/translate\(([-\d.]+),([-\d.]+)\)/.exec(tr[1]);
              const sc=/scale\(([-\d.]+)\)/.exec(tr[1]);
              if(t){dx=+t[1];dy=+t[2];} if(sc)s=+sc[1]; }
      stack.push({x:p.x+dx*p.s,y:p.y+dy*p.s,s:p.s*s,g:++gid}); continue;
    }
    const a=m[2], g=k=>{const r=new RegExp(k+'="([^"]*)"').exec(a); return r?+r[1]:0;};
    const p=stack[stack.length-1]; const r=g('r')*p.s;
    if(r<4) continue;                       // data-quality dots are not symbols
    out.push({cx:p.x+g('cx')*p.s, cy:p.y+g('cy')*p.s, r, g:p.g});
  }
  return out;
}
/* v2 - rectangles are symbols too. The checker only boxed CIRCLES, so a
   breaker glyph, a coil or an inverter box could sit under a label and the
   sweep reported zero. That blind spot hid the tie stub crossing a CT ratio
   and the contactor glyph running under a legend label. Only SMALL rects
   count: the page background and the source cards are not glyphs. */
function rects(svg){
  const out=[]; const stack=[{x:0,y:0,s:1,g:0}]; let gid=0;
  const tok=/<g([^>]*)>|<\/g>|<rect([^>]*)\/>/g; let m;
  while((m=tok.exec(svg))){
    if(m[0].startsWith('</g')){ if(stack.length>1) stack.pop(); continue; }
    if(m[0].startsWith('<g')){
      const tr=/transform="([^"]*)"/.exec(m[1]);
      const p=stack[stack.length-1]; let dx=0,dy=0,s=1;
      if(tr){ const t=/translate\(([-\d.]+),([-\d.]+)\)/.exec(tr[1]);
              const sc=/scale\(([-\d.]+)\)/.exec(tr[1]);
              if(t){dx=+t[1];dy=+t[2];} if(sc)s=+sc[1]; }
      stack.push({x:p.x+dx*p.s,y:p.y+dy*p.s,s:p.s*s,g:++gid}); continue;
    }
    const a=m[2], g=k=>{const r=new RegExp(k+'="([-\\d.]+)"').exec(a); return r?+r[1]:0;};
    const p=stack[stack.length-1];
    const w=g('width')*p.s, h=g('height')*p.s;
    if(w<4||h<4||w>60||h>60) continue;     // background and cards are not glyphs
    const x0=p.x+g('x')*p.s, y0=p.y+g('y')*p.s;
    out.push({x0,y0,x1:x0+w,y1:y0+h,g:p.g});
  }
  return out;
}
function textOverRect(bs,rs){
  const hits=[];
  for(const t of bs) for(const r of rs){
    if(t.g===r.g) continue;                // a glyph's own letter belongs inside it
    const ox=Math.min(t.x1,r.x1)-Math.max(t.x0,r.x0);
    const oy=Math.min(t.y1,r.y1)-Math.max(t.y0,r.y0);
    if(ox>1.5&&oy>1.5) hits.push({t:t.t, ox:+ox.toFixed(1), oy:+oy.toFixed(1)});
  }
  return hits;
}
function textOverSymbol(bs,cs){
  const hits=[];
  for(const t of bs) for(const c of cs){
    if(t.g===c.g) continue;          // a glyph's own letter belongs inside it
    const nx=Math.max(c.cx-c.r,Math.min(c.cx,t.x1)), // closest point of the text box
          px=Math.max(t.x0,Math.min(c.cx,t.x1)),
          py=Math.max(t.y0,Math.min(c.cy,t.y1));
    const d=Math.hypot(px-c.cx,py-c.cy);
    if(d < c.r-1) hits.push({t:t.t, r:+c.r.toFixed(1), d:+d.toFixed(1)});
  }
  return hits;
}
function overlaps(bs){
  const hits=[];
  for(let i=0;i<bs.length;i++)for(let j=i+1;j<bs.length;j++){
    const a=bs[i],b=bs[j];
    const ox=Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0);
    const oy=Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0);
    if(ox>1.5&&oy>1.5) hits.push({a:a.t,b:b.t,ox:+ox.toFixed(1),oy:+oy.toFixed(1)});
  }
  return hits;
}
global.window=undefined;
require(require('path').join(__dirname,'tam-sym.js')); require(require('path').join(__dirname,'tam-sym-elec.js'));
const T=require(require('path').join(__dirname,'tam-flow.js'));
const sld=T.indexSld({nodes:JSON.parse(fs.readFileSync(require('path').join(__dirname,'sld_nodes.json'))),edges:JSON.parse(fs.readFileSync(require('path').join(__dirname,'sld_edges.json')))});
const BOARDS=['480-JG-691','480-JG-692','480-JG-693','480-JG-694'];
const ZS = process.argv[2] ? process.argv[2].split(',').map(Number) : [T.sldZoom];
console.log('zoom | min font (page px) | collisions PC1,PC2,PC3,PC4 | total | PC1 canvas');
const detail={};
for(const z of ZS){
  T.sldZoom=z; const per=[]; let minf=99, tot=0, pc1='';
  for(const b of BOARDS){
    const h=T.sld(sld,b,{}); const bs=textBoxes(h);
    bs.forEach(x=>{if(x.fz<minf)minf=x.fz;});
    const vb=/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(h);
    const W=+vb[1], HH=+vb[2];
    const over=bs.filter(t=>t.y1>HH-0.5||t.x1>W-0.5||t.y0<0||t.x0<0);
    if(over.length) console.log('   OUTSIDE viewBox on',b,':',over.map(o=>'"'+o.t.slice(0,40)+'"').join(', '));
    const hits=overlaps(bs).concat(
      textOverSymbol(bs,circles(h)).map(x=>({a:x.t,b:'«symbol r'+x.r+'»',ox:x.d,oy:0})),
      textOverRect(bs,rects(h)).map(x=>({a:x.t,b:'«rect glyph»',ox:x.ox,oy:x.oy})));
    per.push(hits.length); tot+=hits.length;
    detail[z+'|'+b]=hits;
    if(b==='480-JG-691'){const m=h.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/); pc1=Math.round(+m[1])+'x'+Math.round(+m[2]);}
  }
  console.log(` ${z.toFixed(2).padStart(4)} |        ${minf.toFixed(2).padStart(5)}       | ${per.join(', ').padEnd(26)} | ${String(tot).padStart(5)} | ${pc1}`);
}
if(process.argv[3]==='detail'){
  for(const k of Object.keys(detail)) if(detail[k].length)
    console.log('\n'+k, detail[k].slice(0,8).map(h=>`"${h.a}" ∩ "${h.b}" (${h.ox}×${h.oy})`).join('\n   '));
}
