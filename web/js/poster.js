// En-tête « affiche » commun à toutes les pages, dans la grammaire de l'accueil : grand titre en
// capitales serrées, petite ligne au-dessus, halo à la couleur du sujet, bandes en biais, chiffre
// ou mot fantôme en arrière-plan et visuel détouré (portrait ou logo) à droite.
//
//   const top = poster(ctx, { kicker, title | lines, meta, stats, actions, visual, ghost, teamId, size });
//   ctx.outlet.append(top.el);
//   top.update({ stats, ghost, meta, visual, kicker });   // quand les données arrivent
//
// size : "full" (fiche joueur, fiche équipe), "compact" (pages de liste) ou "slim" (pages
// d'outil, où la place compte).

import { h } from "./dom.js";
import { teamColor } from "./teams.js";
import { countUp } from "./scroll.js";

let measureCtx = null;
function textWidth(text) {
  measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
  measureCtx.font = '400 100px "Anton", "Oswald", sans-serif';
  return measureCtx.measureText(text.toUpperCase()).width;
}

// Le titre prend toute la largeur disponible, dans la limite de la hauteur prévue.
function fitTitle(el) {
  const title = el.querySelector(".poster-title");
  if (!title) return;
  const lines = [...title.querySelectorAll(".sn-line")].map((l) => l.textContent);
  const widest = Math.max(1, ...lines.map(textWidth));
  const w = el.querySelector(".poster-copy").clientWidth || el.clientWidth;
  const size = el.dataset.size;
  const phone = window.innerWidth < 700;
  const cap = size === "slim" ? (phone ? 64 : 104) : size === "compact" ? (phone ? 92 : 168) : phone ? 104 : 210;
  // 4 % de marge : l'espacement des lettres et l'arrondi faisaient dépasser d'une fraction de pixel,
  // et le titre passait à la ligne (« QUI EST- / CE ? » sur téléphone).
  title.style.fontSize = `${Math.floor(Math.max(36, Math.min(cap, (w / widest) * 96)))}px`;
}

function statsRow(stats = []) {
  return stats.filter(Boolean).map((it, i) => {
    const v = h("b", { class: "num" }, String(it.v));
    countUp(v, it.v, 300);
    return h("div", { class: "ss-item", style: { "--i": i } }, h("small", null, it.label), v);
  });
}

export function poster(ctx, opts) {
  const size = opts.size || "compact";
  const lines = (opts.lines || [opts.title]).filter(Boolean);
  const kicker = h("p", { class: "poster-kicker" }, opts.kicker || "");
  const meta = h("div", { class: "poster-meta" }, opts.meta || []);
  const stats = h("div", { class: "poster-stats" }, statsRow(opts.stats));
  const actions = h("div", { class: "poster-actions" }, opts.actions || []);
  const ghost = h("span", { class: "poster-ghost num", "aria-hidden": "true" }, opts.ghost ?? "");
  const visual = h("div", { class: `poster-visual${opts.visualKind ? ` is-${opts.visualKind}` : ""}`, "aria-hidden": "true" }, opts.visual || []);
  const el = h(
    "section",
    { class: `poster poster-${size}${opts.cls ? ` ${opts.cls}` : ""}`, dataset: { size } },
    h("div", { class: "stage-band back", "aria-hidden": "true" }),
    h("div", { class: "stage-band back thin", "aria-hidden": "true" }),
    ghost,
    visual,
    h(
      "div",
      { class: "poster-copy" },
      kicker,
      h(
        "h1",
        { class: "poster-title page-title", id: opts.titleId || null },
        lines.map((t, i) => h("span", { class: "sn-line", style: { "--i": i } }, h("span", { class: "sn-in" }, t)))
      ),
      meta,
      stats,
      actions
    )
  );
  const paint = (teamId, color) => el.style.setProperty("--team", color || (teamId ? teamColor(teamId) : "var(--accent)"));
  paint(opts.teamId, opts.color);
  for (const part of [kicker, meta, stats, actions, ghost]) part.hidden = !part.textContent && !part.children.length;

  let lastWidth = 0;
  const ro = new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (w === lastWidth) return;
    lastWidth = w;
    fitTitle(el);
  });
  ro.observe(el);
  document.fonts?.load('100px "Anton"').then(() => fitTitle(el)).catch(() => {});
  ctx.onCleanup(() => ro.disconnect());

  return {
    el,
    update(next = {}) {
      if ("kicker" in next) kicker.textContent = next.kicker || "";
      if ("meta" in next) meta.replaceChildren(...[next.meta || []].flat().filter(Boolean));
      if ("stats" in next) stats.replaceChildren(...statsRow(next.stats));
      if ("actions" in next) actions.replaceChildren(...[next.actions || []].flat().filter(Boolean));
      if ("ghost" in next) ghost.textContent = next.ghost ?? "";
      if ("visual" in next) {
        visual.replaceChildren(...[next.visual || []].flat().filter(Boolean));
        visual.className = `poster-visual${next.visualKind ? ` is-${next.visualKind}` : ""}`;
      }
      if ("teamId" in next || "color" in next) paint(next.teamId, next.color);
      for (const part of [kicker, meta, stats, actions, ghost]) part.hidden = !part.textContent && !part.children.length;
    },
  };
}
