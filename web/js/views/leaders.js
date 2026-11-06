// Meilleurs joueurs de la saison dans chaque catégorie statistique.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { errorState, headshot, loading, staleBanner, teamLogo } from "../components.js";
import { poster } from "../poster.js";

const CATEGORIES = [
  { key: "pts", title: "Points", unit: "par match" },
  { key: "reb", title: "Rebonds", unit: "par match" },
  { key: "ast", title: "Passes décisives", unit: "par match" },
  { key: "stl", title: "Interceptions", unit: "par match" },
  { key: "blk", title: "Contres", unit: "par match" },
  { key: "tpm", title: "Paniers à 3 points", unit: "réussis par match" },
  { key: "fgPct", title: "Adresse aux tirs", unit: "pourcentage", pct: true },
  { key: "eff", title: "Évaluation", unit: "par match, formule NBA", digits: 1 },
];

function board(cat, rows) {
  const fmt = (v) => (cat.pct ? `${f.pct(v)} %` : f.num(v, cat.digits ?? 1));
  if (!rows.length) return h("section", { class: "board" }, h("h2", null, cat.title), h("p", { class: "note" }, "Pas de données."));
  const [top, ...rest] = rows;
  return h(
    "section",
    { class: "board" },
    h("h2", null, cat.title),
    h("div", { class: "unit" }, cat.unit),
    h(
      "a",
      { class: "board-top", href: `#/joueur/${top.id}` },
      headshot(top.id, { cls: "headshot", alt: "" }),
      h("div", null, h("div", { class: "v" }, fmt(top.value)), h("div", { class: "nm" }, top.name), h("div", { class: "note", style: { display: "flex", gap: "6px", alignItems: "center" } }, teamLogo(top.teamId, 18), top.tri))
    ),
    h(
      "ol",
      { class: "board-list", start: 2 },
      rest.slice(0, 9).map((r, i) =>
        h("li", null, h("a", { href: `#/joueur/${r.id}` }, h("span", { class: "rk num" }, i + 2), h("span", null, r.name, h("span", { class: "tm" }, r.tri)), h("span", { class: "v num" }, fmt(r.value))))
      )
    )
  );
}

export async function render(ctx) {
  const top = poster(ctx, { kicker: "Saison régulière", title: "Leaders" });
  const body = h("div", null, loading("Chargement des leaders…"));
  ctx.outlet.append(top.el, body);
  let res;
  try {
    res = await api("/leaders", { signal: ctx.signal });
  } catch (err) {
    if (err.name === "AbortError") return;
    body.replaceChildren(errorState(err, () => location.reload()));
    return;
  }
  const { data, meta } = res;
  // En tête de page, le meilleur marqueur de la saison.
  const best = (data.boards.pts || [])[0];
  top.update({
    kicker: `Saison ${data.season}, saison régulière`,
    ...(best
      ? {
          teamId: best.teamId,
          visual: headshot(best.id, { size: "big", alt: "" }),
          visualKind: "cutout",
          ghost: f.num(best.value, 1),
          meta: [h("a", { href: `#/joueur/${best.id}` }, `Meilleur marqueur : ${best.name}, ${f.num(best.value, 1)} points par match`)],
        }
      : {}),
  });
  body.replaceChildren(staleBanner(meta) || "", h("div", { class: "boards" }, CATEGORIES.map((c) => board(c, data.boards[c.key] || []))));
}
