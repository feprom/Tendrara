/* ═══════════════════════════════════════════════════════════════════════════
   tam-disc.js — DISCIPLINE SQUARES (treemap)  ·  v0.2.0
   ─────────────────────────────────────────────────────────────────────────
   Four squares, one per discipline, all the SAME SIZE. Inside each square the
   asset classes of that discipline are tiled by area: a class with twice the
   count gets twice the surface. The square is the discipline; the mosaic is
   what it is made of.

   WHY EQUAL SQUARES AND NOT PROPORTIONAL ONES
     Mechanical holds 362 assets and Instrumentation 1868. Sized against each
     other, Mechanical would be a stamp — and the reader would lose the ability
     to compare a pump count against a filter count, which is the comparison an
     operator actually makes. So the OUTER frame is constant (the disciplines are
     four equal chapters) and the INNER areas are proportional (inside a chapter,
     size means quantity). Cross-square areas are NOT comparable, and the corner
     total is printed on every square precisely so nobody has to guess.

   WHY A TREEMAP AND NOT A BAR CHART
     A bar chart of 7 classes needs 7 rows of label; the mosaic packs the same
     seven numbers into a square that sits next to three others without
     scrolling, and the eye reads "half of Mechanical is fans" in one look.

   THE ALGORITHM — squarified treemap (Bruls, Huizing & van Wijk, 2000)
     Rows are grown while adding one more item improves the WORST aspect ratio
     of the row; when it stops improving the row is laid down and a new one
     starts in the remaining rectangle. That is what keeps the tiles close to
     square and therefore readable. It is ~60 lines and has no dependencies —
     do not pull d3 for this.

   HOUSE RULES IT FOLLOWS
     · Zero dependencies, offline-first, one file, no build step. Same contract
       as tam-sym.js / tam-flow.js: drop the <script> in and call it.
     · It DRAWS what it is given and counts nothing itself. The caller passes the
       numbers already read from the registry (db-graphics §4: a graphic never
       invents a figure, and a figure absent from the data prints nothing).
     · Every tile can carry a `nav` string; the renderer wires the click and the
       cursor. No nav → no cursor change, no click.
     · Labels degrade instead of overflowing: a tile too small for its word keeps
       the number, a tile too small for the number keeps only its colour. Nothing
       is ever clipped mid-word.

   API
     TamDisc.square(group, opts)  → <svg> string for ONE discipline
     TamDisc.band(groups, opts)   → the four squares in a row (flex wrapper)
     TamDisc.squarify(items,w,h)  → [{item,x,y,w,h}]  (exported for tests)
     TamDisc.MARIO                → the four pure hues, keyed by discipline
     TamDisc.autoInk(hex)         → same hue, dark enough to read on the card

   COLOUR — one pure Mario hue per discipline, no exceptions
     MECHANICAL red #E52521 · ELECTRICAL yellow #FBD000 ·
     INSTRUMENTATION green #43B047 · CONTROL blue #049CD8.
     Those four values are the product's discipline code and they are used HERE
     AT FULL SATURATION: the rule bar and the biggest tile of every square carry
     the pure hue. Nothing is muted "for contrast" — the earlier v0.1.0 exception
     that shipped electrical as #E0A800 is gone.

     The one place a pure hue cannot be used verbatim is TEXT ON WHITE: pure
     #FBD000 as a 8.5 px title on a #FBFCFD card is unreadable, whatever the
     design intent. So the title ink is DERIVED from the pure hue instead of
     being a second colour — same hue and saturation, walked down in value only
     until it clears 4.5:1 against the card. Red, green and blue clear it almost
     unchanged; only yellow travels. See `autoInk()`.
     A caller may still pass `ink` explicitly and it wins.

     group = {
       title:"MECHANICAL", rule:"#E52521", ink:"#C8102E",   // ink optional
       total: 362,                       // printed in the corner, may be null
       totalLabel:"ASSETS",              // optional, defaults to ASSETS
       note:"tooltip for the total",     // optional
       items:[ {label:"PUMPS", value:52, nav:"nav('report/equipment')",
                sub:"52 assets"} , … ]   // sub is optional tooltip text
     }
     opts = { size:200, gap:8, pad:10, minLabel:34, minValue:18, font:"Consolas,monospace" }

   Depends on nothing. Offline. Tendrara Micro-LNG · Technical America.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var MONO = "Consolas,monospace";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ── squarified treemap ──────────────────────────────────────────────────
     Returns rectangles in the SAME ORDER as the items handed in, so the caller
     can zip them back to its own data without a lookup. */
  function squarify(items, W, H) {
    var out = [], total = 0, i;
    for (i = 0; i < items.length; i++) total += Math.max(0, +items[i].value || 0);
    if (!(total > 0) || !(W > 0) || !(H > 0)) return items.map(function (it) {
      return { item: it, x: 0, y: 0, w: 0, h: 0 };
    });

    // work on a copy sorted big → small: the algorithm needs descending input
    var list = items.map(function (it, k) {
      return { it: it, k: k, v: Math.max(0, +it.value || 0) };
    }).filter(function (r) { return r.v > 0; })
      .sort(function (a, b) { return b.v - a.v; });

    var scale = (W * H) / total;              // value → area
    var x = 0, y = 0, w = W, h = H;           // the rectangle still free
    var row = [], rowSum = 0;
    var placed = new Array(items.length);

    function shortest() { return Math.min(w, h); }

    // worst aspect ratio of `row` if it also had to hold `extra`
    function worst(extra) {
      var s = rowSum + (extra || 0);
      if (s <= 0) return Infinity;
      var side = shortest(), len = s * scale / side;   // thickness of the row
      var mx = 0, mn = Infinity, j, v;
      for (j = 0; j < row.length; j++) {
        v = row[j].v * scale / len;                    // the tile's other side
        if (v > mx) mx = v; if (v < mn) mn = v;
      }
      if (extra) {
        v = extra * scale / len;
        if (v > mx) mx = v; if (v < mn) mn = v;
      }
      if (!(mn > 0) || !(len > 0)) return Infinity;
      // Every tile in the row is `len` on one side. The least square tile is
      // either the smallest (len/mn) or the largest (mx/len); the worse of the
      // two IS the row's aspect ratio. Always ≥ 1.
      return Math.max(len / mn, mx / len);
    }

    function layRow() {
      if (!row.length) return;
      var side = shortest(), len = rowSum * scale / side, off = 0, j, t, sz;
      var horizontal = (w >= h);               // the row runs along the short side
      for (j = 0; j < row.length; j++) {
        t = row[j];
        sz = t.v * scale / len;
        placed[t.k] = horizontal
          ? { item: t.it, x: x, y: y + off, w: len, h: sz }
          : { item: t.it, x: x + off, y: y, w: sz, h: len };
        off += sz;
      }
      if (horizontal) { x += len; w -= len; } else { y += len; h -= len; }
      row = []; rowSum = 0;
    }

    for (i = 0; i < list.length; i++) {
      var v = list[i].v;
      if (row.length && worst(v) > worst(0)) layRow();
      row.push(list[i]); rowSum += v;
    }
    layRow();

    for (i = 0; i < items.length; i++)
      out.push(placed[i] || { item: items[i], x: 0, y: 0, w: 0, h: 0 });
    return out;
  }

  /* ── the palette ────────────────────────────────────────────────────────
     Four pure Mario hues, one per discipline. These are THE discipline code of
     the product — the same values the card band, the rules and the legends use.
     They are drawn at full saturation; nothing here is toned down. */
  var MARIO = {
    MECHANICAL:      "#E52521",   // red
    ELECTRICAL:      "#FBD000",   // yellow
    INSTRUMENTATION: "#43B047",   // green
    CONTROL:         "#049CD8"    // blue
  };
  var CARD = "#FBFCFD";           // the square's own background

  function rgbOf(hex) {
    var c = String(hex || "").replace("#", "");
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    return [parseInt(c.slice(0, 2), 16) || 0,
            parseInt(c.slice(2, 4), 16) || 0,
            parseInt(c.slice(4, 6), 16) || 0];
  }
  // WCAG relative luminance — the eye is not linear and neither is sRGB.
  function lum(r, g, b) {
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  }
  function contrast(a, b) {
    var la = lum(a[0], a[1], a[2]), lb = lum(b[0], b[1], b[2]);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function hex2(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? "0" : "") + n.toString(16); }

  /* Title ink: the SAME hue, darkened in value only, just far enough to be
     legible on the card (4.5:1). Red / green / blue barely move; pure yellow
     has to travel, which is exactly why v0.1.0 swapped it for a different
     colour — this keeps the colour and moves the brightness instead. */
  function autoInk(hex) {
    var c = rgbOf(hex), bg = rgbOf(CARD);
    for (var k = 1; k >= 0.14; k -= 0.02) {
      var t = [c[0] * k, c[1] * k, c[2] * k];
      if (contrast(t, bg) >= 4.5) return "#" + hex2(t[0]) + hex2(t[1]) + hex2(t[2]);
    }
    return "#15171A";
  }

  /* ── colour ramp inside a discipline ────────────────────────────────────
     One hue per discipline (the rule colour), stepped in lightness by RANK so
     the biggest tile is the darkest. Rank, not value: with 30 fans against 2
     heaters a value ramp would collapse every small tile into the same wash.

     The ramp STARTS at the pure hue: the biggest tile of every square is the
     discipline colour itself, undiluted, and only the smaller tiles are washed
     toward white. So each square shows the pure red / yellow / green / blue at
     its largest, which is where the reader looks first. */
  function ramp(hex, k, n) {
    var c = rgbOf(hex);
    var t = n > 1 ? (k / (n - 1)) : 0;          // 0 = biggest, 1 = smallest
    var mix = 0.66 * t;                         // 0 = pure hue, toward white
    return "rgb(" + Math.round(c[0] + (255 - c[0]) * mix) + "," +
                    Math.round(c[1] + (255 - c[1]) * mix) + "," +
                    Math.round(c[2] + (255 - c[2]) * mix) + ")";
  }
  // black or white text, whichever survives on that fill (WCAG contrast, not a
  // brightness guess — on pure yellow that is black, on pure red it is white)
  function inkOn(rgb) {
    var m = /rgb\((\d+),(\d+),(\d+)\)/.exec(rgb);
    if (!m) return "#15171A";
    var t = [+m[1], +m[2], +m[3]];
    return contrast(t, [21, 23, 26]) >= contrast(t, [255, 255, 255]) ? "#15171A" : "#FFFFFF";
  }

  function square(group, opts) {
    opts = opts || {};
    var S = opts.size || 200, pad = opts.pad == null ? 10 : opts.pad;
    var head = 22, gap = opts.gap == null ? 2 : opts.gap;
    var minLabel = opts.minLabel || 34, minValue = opts.minValue || 18;
    var font = opts.font || MONO;
    var items = (group.items || []).filter(function (it) { return (+it.value || 0) > 0; });

    /* Colour resolution. The discipline title alone is enough: MECHANICAL,
       ELECTRICAL, INSTRUMENTATION and CONTROL each have exactly one pure hue
       and the library knows them, so a caller cannot accidentally ship a
       fifth red. An explicit `rule` still wins for anything off-register. */
    var rule = group.rule || MARIO[String(group.title || "").toUpperCase()] || "#049CD8";
    var ink  = group.ink  || autoInk(rule);

    var W = S - 2 * pad, H = S - 2 * pad - head;
    var rects = squarify(items, W, H);
    var n = rects.length;

    // rank for the ramp: by value, descending
    var order = rects.map(function (r, i) { return { i: i, v: +r.item.value || 0 }; })
      .sort(function (a, b) { return b.v - a.v; });
    var rank = {}; order.forEach(function (o, k) { rank[o.i] = k; });

    var body = rects.map(function (r, i) {
      var fill = ramp(rule, rank[i], n), tint = inkOn(fill);
      var x = pad + r.x + gap / 2, y = pad + head + r.y + gap / 2;
      var w = Math.max(0, r.w - gap), h = Math.max(0, r.h - gap);
      var it = r.item, txt = "";
      if (w >= minValue && h >= minValue) {
        var showLabel = (w >= minLabel && h >= 30);
        var fs = Math.max(7, Math.min(11, Math.round(Math.min(w, h) / 4.2)));
        txt += '<text x="' + (x + 5) + '" y="' + (y + fs + 3) + '" font-family="' + font +
               '" font-size="' + fs + '" font-weight="700" fill="' + tint + '">' + esc(it.value) + '</text>';
        if (showLabel) {
          var lfs = Math.max(5.5, Math.min(8, w / 9));
          var max = Math.floor((w - 10) / (lfs * 0.62));
          var lb = String(it.label || "");
          if (lb.length > max) lb = lb.slice(0, Math.max(1, max - 1)) + "…";
          txt += '<text x="' + (x + 5) + '" y="' + (y + h - 5) + '" font-family="' + font +
                 '" font-size="' + lfs.toFixed(1) + '" font-weight="700" letter-spacing=".04em" fill="' +
                 tint + '" opacity=".85">' + esc(lb) + '</text>';
        }
      }
      var tip = it.sub || (it.label + " · " + it.value);
      return '<g' + (it.nav ? ' style="cursor:pointer" onclick="' + esc(it.nav) + '"' : "") + '>' +
        '<title>' + esc(tip) + '</title>' +
        '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
        '" rx="2.5" fill="' + fill + '"/>' + txt + '</g>';
    }).join("");

    var totalTxt = group.total == null ? "" :
      '<text x="' + (S - pad) + '" y="' + (pad + 11) + '" text-anchor="end" font-family="' + font +
      '" font-size="13" font-weight="700" fill="#15171A">' + esc(group.total) + '</text>' +
      '<text x="' + (S - pad) + '" y="' + (pad + 19) + '" text-anchor="end" font-family="' + font +
      '" font-size="6.5" font-weight="700" letter-spacing=".1em" fill="#4A4F57">' +
      esc(group.totalLabel || "ASSETS") + '</text>';

    return '<svg viewBox="0 0 ' + S + ' ' + S + '" width="100%" style="display:block">' +
      '<rect x="0.6" y="0.6" width="' + (S - 1.2) + '" height="' + (S - 1.2) +
      '" rx="9" fill="#FBFCFD" stroke="#D8DDE2"/>' +
      '<rect x="0.6" y="0.6" width="' + (S - 1.2) + '" height="3.4" rx="1.7" fill="' + rule + '"/>' +
      '<text x="' + pad + '" y="' + (pad + 11) + '" font-family="' + font +
      '" font-size="8.5" font-weight="700" letter-spacing=".1em" fill="' + ink + '">' +
      esc(group.title) + '</text>' +
      (group.note ? '<title>' + esc(group.note) + '</title>' : "") +
      totalTxt + body + '</svg>';
  }

  function band(groups, opts) {
    opts = opts || {};
    var gap = opts.bandGap == null ? 8 : opts.bandGap;
    return '<div style="display:grid;grid-template-columns:repeat(' + (groups.length || 1) +
      ',minmax(0,1fr));gap:' + gap + 'px;align-items:start">' +
      groups.map(function (g) { return '<div>' + square(g, opts) + '</div>'; }).join("") +
      '</div>';
  }

  var API = { square: square, band: band, squarify: squarify,
              MARIO: MARIO, autoInk: autoInk, VERSION: "0.2.0" };
  if (typeof window !== "undefined") window.TamDisc = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
