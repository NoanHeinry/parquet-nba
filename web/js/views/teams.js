// Les 30 franchises, rangées par conférence et division.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { efficiencyMap } from "../charts.js";
import { errorState, favorites, loading, staleBanner, statTable, teamLogo } from "../components.js";
import { iconStar } from "../icons.js";
import { poster } from "../poster.js";

const LAYOUT = [
  { conf: "East", title: "Conférence Est", divs: ["Atlantic", "Central", "Southeast"] },
  { conf: "West", title: "Conférence Ouest", divs: ["Northwest", "Pacific", "Southwest"] },
];

function viewLinks(active) {
  return h(
    "nav",
    { class: "seg-links", "aria-label": "Affichage des équipes" },
    h("a", { href: "#/equipes", "aria-current": active === "list" ? "page" : null }, "Par division"),
    h("a", { href: "#/equipes/stats", "aria-current": active === "stats" ? "page" : null }, "Statistiques avancées"),
    h("a", { href: "#/face-a-face" }, "Face-à-face")
  );
}

const pct = (v) => (v === null || v === undefined ? "–" : `${f.num(v * 100, 1)} %`);
const one = (v) => (v === null || v === undefined ? "–" : f.num(v, 1));

// Statistiques avancées des 30 équipes : la carte attaque / défense, puis le tableau complet.
export async function renderStats(ctx) {
  const top = poster(ctx, { kicker: "Pour 100 possessions", title: "Équipes", ghost: "30", actions: [viewLinks("stats")] });
  const body = h("div", { class: "ts-page" }, loading("Chargement des statistiques…"));
  ctx.outlet.append(top.el, body);
  let res;
  try {
    res = await api("/teams/advanced", { signal: ctx.signal });
  } catch (err) {
    if (err.name === "AbortError") return;
    body.replaceChildren(errorState(err, () => location.reload()));
    return;
  }
  if (!ctx.active) return;
  const { data, meta } = res;
  const best = data.teams[0];
  if (best) {
    top.update({
      kicker: `Saison ${data.season}${data.fallback ? ", bilan final" : ""}, pour 100 possessions`,
      teamId: best.teamId,
      visual: teamLogo(best.teamId, 400),
      visualKind: "logo",
      meta: h("span", null, "Meilleur écart de la ligue : ", h("a", { href: `#/equipe/${best.teamId}` }, best.name), `, ${best.net > 0 ? "+" : ""}${one(best.net)} points pour 100 possessions`),
    });
  }
  const rank = (r, key) => (r.ranks?.[key] ? h("small", { class: "ts-rank" }, `${r.ranks[key]}e`) : null);
  const cell = (key, fmt) => (r) => h("span", { class: "ts-cell" }, fmt(r[key]), rank(r, key));
  const byRank = (key) => (r) => -(r.ranks?.[key] ?? 99);
  const cols = [
    { key: "name", label: "Équipe", align: "l", render: (r) => h("a", { class: "player-cell", href: `#/equipe/${r.teamId}` }, teamLogo(r.teamId, 24), h("span", { class: "nm" }, r.name)) },
    { key: "w", label: "Bilan", sort: (r) => r.w / Math.max(1, r.w + r.l), render: (r) => `${r.w}-${r.l}` },
    { key: "net", label: "Écart", render: (r) => h("b", { class: r.net > 0 ? "pos" : r.net < 0 ? "neg" : "" }, `${r.net > 0 ? "+" : ""}${one(r.net)}`) },
    { key: "off", label: "Attaque", sort: byRank("off"), render: cell("off", one) },
    { key: "def", label: "Défense", sort: byRank("def"), render: cell("def", one) },
    { key: "pace", label: "Rythme", sort: byRank("pace"), render: cell("pace", one) },
    { key: "ts", label: "Adr. réelle", sort: byRank("ts"), render: cell("ts", pct) },
    { key: "astPct", label: "Paniers assistés", sort: byRank("astPct"), render: cell("astPct", pct) },
    { key: "orebPct", label: "Reb. off.", sort: byRank("orebPct"), render: cell("orebPct", pct) },
    { key: "tov", label: "Balles perdues", sort: byRank("tov"), render: cell("tov", pct) },
  ];
  body.replaceChildren(
    ...[staleBanner(meta)].filter(Boolean),
    h(
      "section",
      { class: "section" },
      h("h2", { class: "section-title" }, "Attaque et défense"),
      h("div", { class: "ts-map" }, efficiencyMap(data.teams, { onPick: (t) => (location.hash = `#/equipe/${t.teamId}`), fmt: one }))
    ),
    h("section", { class: "section" }, h("h2", { class: "section-title" }, "Les 30 équipes"), h("div", { class: "table-wrap" }, statTable(cols, data.teams, { caption: "Statistiques avancées des équipes", sortable: true, initialSort: { key: "net", dir: "desc" } }))),
    h(
      "p",
      { class: "note" },
      "Attaque et défense : points marqués et encaissés pour 100 possessions. Rythme : possessions par match. Adresse réelle : adresse qui compte les tirs à 3 points et les lancers francs. Le petit chiffre donne le rang dans la ligue (1er = le meilleur)."
    )
  );
}

export async function render(ctx) {
  const top = poster(ctx, { kicker: "Deux conférences, six divisions", title: "Équipes", ghost: "30", actions: [viewLinks("list")] });
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
