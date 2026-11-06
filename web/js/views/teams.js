// Les 30 franchises, rangées par conférence et division.

import { api } from "../api.js";
import { h } from "../dom.js";
import { errorState, favorites, loading, teamLogo } from "../components.js";
import { iconStar } from "../icons.js";
import { poster } from "../poster.js";

const LAYOUT = [
  { conf: "East", title: "Conférence Est", divs: ["Atlantic", "Central", "Southeast"] },
  { conf: "West", title: "Conférence Ouest", divs: ["Northwest", "Pacific", "Southwest"] },
];

export async function render(ctx) {
  const top = poster(ctx, { kicker: "Deux conférences, six divisions", title: "Équipes", ghost: "30" });
  const body = h("div", null, loading("Chargement des équipes…"));
  ctx.outlet.append(top.el, body);
  let data;
  try {
    data = (await api("/teams", { signal: ctx.signal })).data;
  } catch (err) {
    if (err.name === "AbortError") return;
    body.replaceChildren(errorState(err, () => location.reload()));
    return;
  }
  const favs = favorites();
  // En vedette : la première équipe favorite, sinon le meilleur bilan.
  const withRecord = data.teams.filter((t) => t.record);
  const star = data.teams.find((t) => favs.has(t.id)) || withRecord.sort((a, b) => b.record.w - a.record.w)[0];
  if (star) {
    top.update({
      teamId: star.id,
      visual: teamLogo(star.id, 400),
      visualKind: "logo",
      meta: [h("a", { href: `#/equipe/${star.id}` }, favs.has(star.id) ? `Ton équipe : ${star.fullName || star.name}` : `Meilleur bilan : ${star.fullName || star.name}${star.record ? `, ${star.record.w}-${star.record.l}` : ""}`)],
    });
  }

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
                teamLogo(t.id, 72),
                h("span", { class: "nm" }, t.name, favs.has(t.id) ? h("span", { class: "fav-star", title: "Équipe favorite", style: { marginLeft: "4px" } }, iconStar(true, 11)) : null, h("small", null, t.city)),
                t.record ? h("span", { class: "rec num" }, `${t.record.w}-${t.record.l}`) : null
              )
            )
          );
        })
      )
    )
  );

  body.replaceChildren(...blocks);
}
