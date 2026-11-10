// Les 30 franchises, rangées par conférence et division.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { efficiencyMap } from "../charts.js";
import { errorState, favorites, loading, segmented, staleBanner, statTable, teamLogo } from "../components.js";
import { teamColor } from "../teams.js";
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
    { key: "w", label: "Bilan", prio: 1, sort: (r) => r.w / Math.max(1, r.w + r.l), render: (r) => `${r.w}-${r.l}` },
    { key: "net", label: "Écart", prio: 1, render: (r) => h("b", { class: r.net > 0 ? "pos" : r.net < 0 ? "neg" : "" }, `${r.net > 0 ? "+" : ""}${one(r.net)}`) },
    { key: "off", label: "Attaque", sort: byRank("off"), render: cell("off", one) },
    { key: "def", label: "Défense", sort: byRank("def"), render: cell("def", one) },
    { key: "pace", label: "Rythme", prio: 3, sort: byRank("pace"), render: cell("pace", one) },
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
    h("section", { class: "section" }, h("h2", { class: "section-title" }, "Les 30 équipes"), statTable(cols, data.teams, { caption: "Statistiques avancées des équipes", sortable: true, initialSort: { key: "net", dir: "desc" } })),
    h(
      "p",
      { class: "note" },
      "Attaque et défense : points marqués et encaissés pour 100 possessions. Rythme : possessions par match. Adresse réelle : adresse qui compte les tirs à 3 points et les lancers francs. Le petit chiffre donne le rang dans la ligue (1er = le meilleur)."
    )
  );
}

const ORDER_KEY = "parquet-equipes-ordre";

const streakText = (st) => {
  const m = /^([WL])\s*(\d+)$/.exec(st || "");
  return m ? `${m[1] === "W" ? "V" : "D"}${m[2]}` : st || "";
};

// Carte d'une équipe : aux couleurs de la franchise, bilan, rang, forme récente.
function teamCard(t, st, fav, rankLabel) {
  const rec = t.record;
  const games = rec ? rec.w + rec.l : 0;
  const pct = games ? rec.w / games : null;
  const streak = streakText(st?.streak);
  return h(
    "a",
    { class: "tcard", href: `#/equipe/${t.id}`, style: { "--tc": teamColor(t.id) } },
    rankLabel ? h("span", { class: "tc-rank num", "aria-hidden": "true" }, rankLabel) : null,
    h("span", { class: "tc-logo" }, teamLogo(t.id, 64)),
    h(
      "span",
      { class: "tc-txt" },
      h("b", { class: "tc-name" }, t.name, fav ? h("span", { class: "fav-star", title: "Équipe favorite" }, iconStar(true, 12)) : null),
      h("small", null, t.city)
    ),
    rec
      ? h(
          "span",
          { class: "tc-rec" },
          h("b", { class: "num" }, `${rec.w}-${rec.l}`),
          h("small", null, st?.rank ? `${st.rank}${st.rank === 1 ? "er" : "e"} ${t.confFr}` : rec.rank ? `${rec.rank}${rec.rank === 1 ? "er" : "e"} ${t.confFr}` : "")
        )
      : null,
    pct !== null ? h("span", { class: "tc-bar", role: "img", "aria-label": `${f.num(pct * 100, 1)} % de victoires` }, h("i", { style: { width: `${(pct * 100).toFixed(1)}%` } })) : null,
    st
      ? h(
          "span",
          { class: "tc-meta" },
          st.l10 ? h("span", null, "10 der. ", h("b", { class: "num" }, st.l10)) : null,
          streak ? h("span", { class: streak.startsWith("V") ? "pos" : "neg" }, "Série ", h("b", { class: "num" }, streak)) : null,
          st.diff !== null && st.diff !== undefined ? h("span", null, "Écart ", h("b", { class: "num" }, f.signed(st.diff))) : null
        )
      : null
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
  // Forme récente (10 derniers matchs, série, écart) : depuis le classement, si disponible.
  const standing = new Map();
  try {
    const st = (await api("/standings", { signal: ctx.signal })).data;
    for (const r of st.rows || []) standing.set(r.teamId, r);
  } catch (err) {
    if (err.name === "AbortError") return;
  }
  if (!ctx.active) return;
  const favs = favorites();
  // En vedette : la première équipe favorite, sinon le meilleur bilan.
  const winPct = (t) => (t.record && t.record.w + t.record.l ? t.record.w / (t.record.w + t.record.l) : -1);
  const star = data.teams.find((t) => favs.has(t.id)) || data.teams.slice().sort((a, b) => winPct(b) - winPct(a))[0];
  if (star) {
    top.update({
      teamId: star.id,
      visual: teamLogo(star.id, 400),
      visualKind: "logo",
      meta: [h("a", { href: `#/equipe/${star.id}` }, favs.has(star.id) ? `Ton équipe : ${star.fullName || star.name}` : `Meilleur bilan : ${star.fullName || star.name}${star.record ? `, ${star.record.w}-${star.record.l}` : ""}`)],
    });
  }

  let order = "division";
  try {
    order = localStorage.getItem(ORDER_KEY) || "division";
  } catch {
    /* rien */
  }
  const content = h("div");
  const card = (t, rank) => teamCard(t, standing.get(t.id), favs.has(t.id), rank);
  const byRecord = (a, b) => winPct(b) - winPct(a) || (b.record?.w || 0) - (a.record?.w || 0);

  const draw = () => {
    if (order === "bilan") {
      const list = data.teams.slice().sort(byRecord);
      content.replaceChildren(
        h("section", { class: "conf-block" }, h("h2", { class: "section-title" }, "Toute la ligue, du meilleur au moins bon bilan"), h("div", { class: "tcard-grid" }, list.map((t, i) => card(t, String(i + 1)))))
      );
    } else if (order === "nom") {
      const list = data.teams.slice().sort((a, b) => a.name.localeCompare(b.name, "fr"));
      content.replaceChildren(h("section", { class: "conf-block" }, h("h2", { class: "section-title" }, "De A à Z"), h("div", { class: "tcard-grid" }, list.map((t) => card(t)))));
    } else {
      content.replaceChildren(
        ...LAYOUT.map((c) =>
          h(
            "section",
            { class: "conf-block", "aria-label": c.title },
            h("h2", { class: "section-title" }, c.title),
            c.divs.map((div) => {
              const list = data.teams.filter((t) => t.conf === c.conf && t.div === div).sort(byRecord);
              return h("div", { class: "tdiv" }, h("h3", { class: "tdiv-title" }, `Division ${list[0]?.divFr || div}`), h("div", { class: "tcard-grid" }, list.map((t) => card(t))));
            })
          )
        )
      );
    }
  };

  const control = segmented(
    [
      { value: "division", label: "Par division" },
      { value: "bilan", label: "Par bilan" },
      { value: "nom", label: "De A à Z" },
    ],
    order,
    (v) => {
      order = v;
      try {
        localStorage.setItem(ORDER_KEY, v);
      } catch {
        /* rien */
      }
      draw();
    },
    "Ordre des équipes"
  );
  draw();
  body.replaceChildren(h("div", { class: "toolbar" }, control), content);
}
