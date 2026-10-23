// Graphiques en SVG : courbe de carrière, colonnes par saison, duel d'équipes, carte des tirs.
// Marques fines, grille discrète, valeurs dans une infobulle et toujours lisibles ailleurs (tableaux).

import { h, s } from "./dom.js";

// ------------------------------------------------------------ infobulle

const tip = () => document.getElementById("tooltip");

export function showTip(event, lines) {
  const el = tip();
  if (!el) return;
  el.replaceChildren(...lines.map((line, i) => (i === 0 ? h("strong", null, line) : h("div", { class: "t-sub" }, line))));
  el.hidden = false;
  const pad = 14;
  const rect = el.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = event.clientY - rect.height - pad;
  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${Math.max(8, y)}px`;
}

export function hideTip() {
  const el = tip();
  if (el) el.hidden = true;
}

function tipAt(target, lines) {
  const r = target.getBoundingClientRect();
  showTip({ clientX: r.left + r.width / 2, clientY: r.top }, lines);
}

function niceStep(max, ticks = 4) {
  if (!max || max <= 0) return 1;
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

// ------------------------------------------------------------ courbe

// points: [{label, value, tip: [..lignes]}]
export function lineChart(points, { format = (v) => String(v), tickFormat = null, height = 260, highlightMax = true } = {}) {
  const width = 760;
  const m = { top: 24, right: 44, bottom: 30, left: 44 };
  const values = points.map((p) => p.value).filter((v) => v !== null && v !== undefined);
  const maxV = values.length ? Math.max(...values) : 1;
  const step = niceStep(maxV);
  const top = Math.max(step, Math.ceil(maxV / step) * step);
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const x = (i) => m.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => m.top + ih - (v / top) * ih;

  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart", role: "img" });
  const grid = s("g", { class: "grid" });
  const axis = s("g", { class: "axis" });
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid.append(s("line", { x1: m.left, x2: width - m.right, y1: y(v), y2: y(v) }));
    axis.append(s("text", { x: m.left - 8, y: y(v) + 4, "text-anchor": "end" }, (tickFormat || format)(v)));
  }
  // Étiquettes de l'axe horizontal : régulièrement espacées, la dernière toujours visible.
  const labelEvery = Math.max(1, Math.ceil(points.length / 9));
  const labelled = points.map((_, i) => i).filter((i) => i % labelEvery === 0);
  const lastIndex = points.length - 1;
  if (labelled.at(-1) !== lastIndex) {
    if (lastIndex - labelled.at(-1) < labelEvery * 0.75) labelled.pop();
    labelled.push(lastIndex);
  }
  for (const i of labelled) {
    axis.append(s("text", { x: x(i), y: height - 8, "text-anchor": "middle" }, points[i].label));
  }
  svg.append(grid, axis);

  const defined = points.map((p, i) => ({ ...p, i })).filter((p) => p.value !== null && p.value !== undefined);
  if (defined.length) {
    const d = defined.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
    const area = `${d}L${x(defined.at(-1).i).toFixed(1)},${y(0)}L${x(defined[0].i).toFixed(1)},${y(0)}Z`;
    const gid = `wash-${Math.random().toString(36).slice(2, 9)}`;
    svg.append(
      s(
        "defs",
        null,
        s(
          "linearGradient",
          { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
          s("stop", { offset: 0, style: { stopColor: "var(--accent)", stopOpacity: "0.22" } }),
          s("stop", { offset: 1, style: { stopColor: "var(--accent)", stopOpacity: "0" } })
        )
      ),
      s("path", { class: "area", d: area, fill: `url(#${gid})` }),
      s("path", { class: "series", d })
    );

    // Étiquettes sélectives : le maximum et le dernier point.
    const maxP = defined.reduce((a, b) => (b.value > a.value ? b : a));
    const last = defined.at(-1);
    const labelled = new Set([last.i]);
    if (highlightMax) labelled.add(maxP.i);
    for (const p of defined) {
      if (!labelled.has(p.i)) continue;
      svg.append(s("circle", { class: "dot", cx: x(p.i), cy: y(p.value), r: 4.5 }));
      svg.append(s("text", { class: "label", x: x(p.i), y: y(p.value) - 10, "text-anchor": "middle" }, format(p.value)));
    }
  }

  // Calque de survol : réticule vertical qui s'aimante au point le plus proche.
  const cross = s("line", { class: "crosshair", y1: m.top, y2: m.top + ih, visibility: "hidden" });
  const hoverDot = s("circle", { class: "dot", r: 5, visibility: "hidden" });
  const overlay = s("rect", { x: m.left - 10, y: m.top, width: iw + 20, height: ih, fill: "transparent", tabindex: 0 });
  svg.append(cross, hoverDot, overlay);
  let focusIndex = defined.length - 1;
  const showIndex = (i, event) => {
    const p = points[i];
    if (!p || p.value === null || p.value === undefined) return;
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    hoverDot.setAttribute("cx", x(i));
    hoverDot.setAttribute("cy", y(p.value));
    hoverDot.setAttribute("visibility", "visible");
    const lines = [format(p.value), ...(p.tip || [p.label])];
    if (event) showTip(event, lines);
    else tipAt(hoverDot, lines);
  };
  const nearest = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * width;
    let best = 0;
    let bestD = Infinity;
    defined.forEach((p) => {
      const dd = Math.abs(x(p.i) - px);
      if (dd < bestD) {
        bestD = dd;
        best = p.i;
      }
    });
    return best;
  };
  overlay.addEventListener("pointermove", (e) => showIndex(nearest(e.clientX), e));
  overlay.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    hoverDot.setAttribute("visibility", "hidden");
    hideTip();
  });
  overlay.addEventListener("keydown", (e) => {
    if (!defined.length) return;
    const idx = defined.findIndex((p) => p.i === focusIndex);
    if (e.key === "ArrowLeft") focusIndex = defined[Math.max(0, idx - 1)].i;
    else if (e.key === "ArrowRight") focusIndex = defined[Math.min(defined.length - 1, idx + 1)].i;
    else return;
    e.preventDefault();
    showIndex(focusIndex);
  });
  overlay.addEventListener("focus", () => showIndex(focusIndex));
  overlay.addEventListener("blur", () => {
    cross.setAttribute("visibility", "hidden");
    hoverDot.setAttribute("visibility", "hidden");
    hideTip();
  });
  return svg;
}

// ------------------------------------------------------------ colonnes

// bars: [{label, value, cls, tip: [...]}]
export function columnChart(bars, { height = 230, format = (v) => String(v), ariaLabel = "" } = {}) {
  const width = 760;
  const m = { top: 16, right: 10, bottom: 28, left: 34 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const maxV = Math.max(1, ...bars.map((b) => b.value || 0));
  const step = niceStep(maxV);
  const top = Math.ceil(maxV / step) * step;
  const slot = iw / Math.max(1, bars.length);
  const bw = Math.max(2, Math.min(24, slot - 2));
  const y = (v) => m.top + ih - (v / top) * ih;

  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart", role: "img", "aria-label": ariaLabel || null });
  const grid = s("g", { class: "grid" });
  const axis = s("g", { class: "axis" });
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid.append(s("line", { x1: m.left, x2: width - m.right, y1: y(v), y2: y(v) }));
    axis.append(s("text", { x: m.left - 6, y: y(v) + 4, "text-anchor": "end" }, format(v)));
  }
  const every = Math.max(1, Math.ceil(bars.length / 10));
  bars.forEach((b, i) => {
    if (i % every === 0) axis.append(s("text", { x: m.left + slot * i + slot / 2, y: height - 8, "text-anchor": "middle" }, b.label));
  });
  svg.append(grid, axis);

  bars.forEach((b, i) => {
    const v = b.value || 0;
    const x0 = m.left + slot * i + (slot - bw) / 2;
    const y0 = y(v);
    const hgt = Math.max(0, m.top + ih - y0);
    const r = Math.min(4, bw / 2, hgt);
    // Extrémité arrondie, base carrée.
    const d = hgt > 0
      ? `M${x0},${m.top + ih}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${m.top + ih}Z`
      : "";
    const bar = s("path", { class: `bar ${b.cls || ""}`.trim(), d, tabindex: 0, role: "img", "aria-label": (b.tip || [b.label]).join(", ") });
    const hit = s("rect", { x: m.left + slot * i, y: m.top, width: slot, height: ih, fill: "transparent" });
    const on = (e) => {
      bar.classList.add("active");
      if (e?.clientX !== undefined) showTip(e, b.tip || [b.label, format(v)]);
      else tipAt(bar, b.tip || [b.label, format(v)]);
    };
    const off = () => {
      bar.classList.remove("active");
      hideTip();
    };
    hit.addEventListener("pointermove", on);
    hit.addEventListener("pointerleave", off);
    bar.addEventListener("focus", () => on());
    bar.addEventListener("blur", off);
    svg.append(bar, hit);
  });
  return svg;
}

// ------------------------------------------------------------ duel d'équipes

// rows: [{label, away, home, format, higherIsBetter}]
export function compareRows(rows, colors, names) {
  const wrap = h("div", { class: "compare" });
  wrap.append(
    h(
      "div",
      { class: "compare-head" },
      h("span", null, h("i", { class: "key-swatch", style: { background: colors.away } }), names.away),
      h("span"),
      h("span", null, names.home, h("i", { class: "key-swatch", style: { background: colors.home, marginLeft: "6px", marginRight: "0" } }))
    )
  );
  for (const r of rows) {
    const a = r.away ?? 0;
    const b = r.home ?? 0;
    const max = Math.max(a, b, 1e-9);
    const fmt = r.format || ((v) => String(v));
    const better = r.lowerIsBetter ? (a < b ? "away" : b < a ? "home" : null) : a > b ? "away" : b > a ? "home" : null;
    wrap.append(
      h(
        "div",
        { class: "compare-row" },
        h("span", { class: "val num", style: { opacity: better === "home" ? 0.7 : 1 } }, fmt(r.away)),
        h("div", { class: "bar-track left" }, h("i", { style: { width: `${(a / max) * 100}%`, background: colors.away } })),
        h("span", { class: "label" }, r.label),
        h("div", { class: "bar-track" }, h("i", { style: { width: `${(b / max) * 100}%`, background: colors.home } })),
        h("span", { class: "val right num", style: { opacity: better === "away" ? 0.7 : 1 } }, fmt(r.home))
      )
    );
  }
  return wrap;
}

// ------------------------------------------------------------ carte des tirs

// Demi-terrain en coordonnées NBA (dixièmes de pied, panier en 0,0).
export function shotChart(shots, color) {
  const svg = s("svg", { class: "court", viewBox: "-252 -55 504 400", role: "img" });
  const lines = s("g", { class: "lines" });
  lines.append(
    s("rect", { x: -250, y: -47.5, width: 500, height: 390 }),
    s("rect", { x: -80, y: -47.5, width: 160, height: 190 }),
    s("rect", { x: -60, y: -47.5, width: 120, height: 190 }),
    s("circle", { cx: 0, cy: 142.5, r: 60 }),
    s("circle", { cx: 0, cy: 0, r: 7.5 }),
    s("line", { x1: -30, x2: 30, y1: -7.5, y2: -7.5 }),
    s("path", { d: "M-40,0 A40,40 0 0 0 40,0" }),
    s("line", { x1: -220, x2: -220, y1: -47.5, y2: 92.5 }),
    s("line", { x1: 220, x2: 220, y1: -47.5, y2: 92.5 }),
    s("path", { d: "M-220,92.5 A237.5,237.5 0 0 0 220,92.5" })
  );
  svg.append(lines);
  const marks = s("g");
  for (const shot of shots) {
    if (shot.x === null || shot.y === null || shot.x === undefined || shot.y === undefined) continue;
    const x = Math.max(-246, Math.min(246, shot.x));
    const y = Math.max(-44, Math.min(338, shot.y));
    let mark;
    if (shot.made) {
      mark = s("circle", { class: "made", cx: x, cy: y, r: 6, fill: color });
    } else {
      mark = s("path", { class: "miss", d: `M${x - 4.5},${y - 4.5}L${x + 4.5},${y + 4.5}M${x + 4.5},${y - 4.5}L${x - 4.5},${y + 4.5}` });
    }
    const hit = s("circle", { class: "hit", cx: x, cy: y, r: 12 });
    const lines = [shot.made ? "Réussi" : "Manqué", shot.desc, shot.when].filter(Boolean);
    hit.addEventListener("pointermove", (e) => showTip(e, lines));
    hit.addEventListener("pointerleave", hideTip);
    marks.append(mark, hit);
  }
  svg.append(marks);
  return svg;
}

// ------------------------------------------------------------ double courbe (comparateur)

// seriesA: { name: string, color: string, points: [{ label, value, tip }] }
// seriesB: { name: string, color: string, points: [{ label, value, tip }] }
export function dualLineChart(seriesA, seriesB, { format = (v) => String(v), tickFormat = null, height = 280 } = {}) {
  const width = 760;
  const m = { top: 36, right: 44, bottom: 32, left: 44 };
  const allValues = [
    ...seriesA.points.map((p) => p.value),
    ...seriesB.points.map((p) => p.value),
  ].filter((v) => v !== null && v !== undefined);
  const maxV = allValues.length ? Math.max(...allValues) : 1;
  const step = niceStep(maxV);
  const top = Math.max(step, Math.ceil(maxV / step) * step);
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;

  const maxLen = Math.max(seriesA.points.length, seriesB.points.length, 1);
  const x = (i) => m.left + (maxLen === 1 ? iw / 2 : (i / (maxLen - 1)) * iw);
  const y = (v) => m.top + ih - (v / top) * ih;

  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart dual-chart", role: "img" });
  const grid = s("g", { class: "grid" });
  const axis = s("g", { class: "axis" });

  for (let v = 0; v <= top + 1e-9; v += step) {
    grid.append(s("line", { x1: m.left, x2: width - m.right, y1: y(v), y2: y(v) }));
    axis.append(s("text", { x: m.left - 8, y: y(v) + 4, "text-anchor": "end" }, (tickFormat || format)(v)));
  }

  // Étiquettes horizontales (Saison 1, Saison 2...)
  const labelEvery = Math.max(1, Math.ceil(maxLen / 10));
  for (let i = 0; i < maxLen; i++) {
    if (i % labelEvery === 0 || i === maxLen - 1) {
      axis.append(s("text", { x: x(i), y: height - 8, "text-anchor": "middle" }, `S${i + 1}`));
    }
  }

  svg.append(grid, axis);

  // Tracé pour chaque joueur
  const drawSeries = (series, color) => {
    const defined = series.points.map((p, i) => ({ ...p, i })).filter((p) => p.value !== null && p.value !== undefined);
    if (!defined.length) return;
    const d = defined.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
    svg.append(
      s("path", {
        class: "dual-series",
        d,
        fill: "none",
        stroke: color,
        "stroke-width": 2.5,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      })
    );
    for (const p of defined) {
      svg.append(s("circle", { cx: x(p.i), cy: y(p.value), r: 3.5, fill: color }));
    }
  };

  drawSeries(seriesA, seriesA.color);
  drawSeries(seriesB, seriesB.color);

  // Légende en haut du graphique
  const legend = s("g", { class: "legend" });
  legend.append(
    s("circle", { cx: width - 240, cy: 15, r: 5, fill: seriesA.color }),
    s("text", { x: width - 230, y: 19, fill: "var(--text-2)", "font-size": "12.5px", "font-weight": "600" }, seriesA.name),
    s("circle", { cx: width - 110, cy: 15, r: 5, fill: seriesB.color }),
    s("text", { x: width - 100, y: 19, fill: "var(--text-2)", "font-size": "12.5px", "font-weight": "600" }, seriesB.name)
  );
  svg.append(legend);

  // Calque de survol
  const cross = s("line", { class: "crosshair", y1: m.top, y2: m.top + ih, visibility: "hidden" });
  const dotA = s("circle", { r: 5.5, fill: seriesA.color, stroke: "var(--surface)", "stroke-width": 1.5, visibility: "hidden" });
  const dotB = s("circle", { r: 5.5, fill: seriesB.color, stroke: "var(--surface)", "stroke-width": 1.5, visibility: "hidden" });
  const overlay = s("rect", { x: m.left - 10, y: m.top, width: iw + 20, height: ih, fill: "transparent", tabindex: 0 });
  svg.append(cross, dotA, dotB, overlay);

  const showSeason = (i, event) => {
    if (i < 0 || i >= maxLen) return;
    const pA = seriesA.points[i];
    const pB = seriesB.points[i];

    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");

    if (pA && pA.value !== null && pA.value !== undefined) {
      dotA.setAttribute("cx", x(i));
      dotA.setAttribute("cy", y(pA.value));
      dotA.setAttribute("visibility", "visible");
    } else {
      dotA.setAttribute("visibility", "hidden");
    }

    if (pB && pB.value !== null && pB.value !== undefined) {
      dotB.setAttribute("cx", x(i));
      dotB.setAttribute("cy", y(pB.value));
      dotB.setAttribute("visibility", "visible");
    } else {
      dotB.setAttribute("visibility", "hidden");
    }

    const lines = [`Saison n°${i + 1} de carrière`];
    if (pA && pA.value !== null && pA.value !== undefined) {
      lines.push(`${seriesA.name} : ${format(pA.value)}${pA.label ? ` (${pA.label})` : ""}`);
    } else {
      lines.push(`${seriesA.name} : non disputée`);
    }
    if (pB && pB.value !== null && pB.value !== undefined) {
      lines.push(`${seriesB.name} : ${format(pB.value)}${pB.label ? ` (${pB.label})` : ""}`);
    } else {
      lines.push(`${seriesB.name} : non disputée`);
    }

    if (event) showTip(event, lines);
    else tipAt(cross, lines);
  };

  overlay.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < maxLen; i++) {
      const dd = Math.abs(x(i) - px);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    showSeason(best, e);
  });

  overlay.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    dotA.setAttribute("visibility", "hidden");
    dotB.setAttribute("visibility", "hidden");
    hideTip();
  });

  return svg;
}
