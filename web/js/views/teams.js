// Les 30 franchises, rangées par conférence et division.

import { api } from "../api.js";
import { h } from "../dom.js";
import { errorState, favorites, loading, teamLogo } from "../components.js";
import { iconStar } from "../icons.js";

const LAYOUT = [
  { conf: "East", title: "Conférence Est", divs: ["Atlantic", "Central", "Southeast"] },
  { conf: "West", title: "Conférence Ouest", divs: ["Northwest", "Pacific", "Southwest"] },
];

export async function render(ctx) {
  ctx.outlet.append(loading("Chargement des équipes…"));
  let data;
  try {
    data = (await api("/teams", { signal: ctx.signal })).data;
  } catch (err) {
    if (err.name === "AbortError") return;
    ctx.outlet.replaceChildren(errorState(err, () => location.reload()));
    return;
  }
  const favs = favorites();
  const sub = data.season
    ? data.fallback
      ? `Bilans de la saison ${data.season}. La nouvelle saison débute bientôt.`
      : `Bilans de la saison ${data.season}.`
    : "";

  const blocks = LAYOUT.map((c) =>
    h(
      "section",
      { class: "conf-block", "aria-label": c.title },
      h("h2", { class: "section-title" }, c.title),
      h(
        "div",
        { class: "div-grid" },
        c.divs.map((div) => {
          const list = data.teams.filter((t) => t.conf === c.conf && t.div === div);
          list.sort((a, b) => (a.record && b.record ? b.record.w - a.record.w || a.record.l - b.record.l : a.name.localeCompare(b.name)));
          return h(
            "div",
            { class: "div-col" },
            h("h3", null, `Division ${list[0]?.divFr || div}`),
            list.map((t) =>
              h(
                "a",
                { class: "team-row", href: `#/equipe/${t.id}` },
                teamLogo(t.id, 40),
                h("span", { class: "nm" }, t.name, favs.has(t.id) ? h("span", { class: "fav-star", title: "Équipe favorite", style: { marginLeft: "4px" } }, iconStar(true, 11)) : null, h("small", null, t.city)),
                t.record ? h("span", { class: "rec num" }, `${t.record.w}-${t.record.l}`) : null
              )
            )
          );
        })
      )
    )
  );

  ctx.outlet.replaceChildren(
    h("div", { class: "page-head" }, h("div", null, h("h1", { class: "page-title" }, "Équipes"), sub ? h("p", { class: "page-sub" }, sub) : null)),
    ...blocks
  );
}
