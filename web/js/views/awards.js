// Trophées : la course aux trophées de la saison (#/trophees), classement maison des favoris.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { errorState, headshot, loading, staleBanner, teamLogo } from "../components.js";
import { poster } from "../poster.js";
import { team, teamColor } from "../teams.js";

// Ce qui compte pour chaque trophée, en clair (mêmes poids que parquet/season.py).
const HOW = {
  mvp: "Impact global sur le jeu (PIE) 30 %, points 25 %, bilan de l'équipe 25 %, rebonds et passes 10 %, adresse réelle 10 %. Au moins 70 % des matchs joués et 28 minutes par match.",
  roy: "Points 40 %, impact global 20 %, rebonds 15 %, passes 15 %, minutes 10 %, parmi les joueurs dans leur première saison NBA.",
  dpoy: "Points encaissés par l'équipe quand il est sur le terrain 40 %, interceptions et contres 35 %, rebonds défensifs 25 %. Au moins 26 minutes par match.",
  smoy: "Statistiques en sortie de banc uniquement : points 55 %, rebonds et passes 20 %, impact global 15 %, adresse 10 %. Il doit être sorti du banc plus souvent qu'il n'a commencé.",
  mip: "Progression par rapport à la saison passée : points 60 %, rebonds et passes 25 %, minutes 15 %.",
};

const ICON = { mvp: "MVP", roy: "ROY", dpoy: "DPOY", smoy: "6MOY", mip: "MIP" };

function statLine(key, p) {
  const n = (v, d = 1) => (v === null || v === undefined ? "–" : f.num(v, d));
  const items = [];
  if (key === "dpoy") {
    items.push([n(p.stl), "int."], [n(p.blk), "contres"], [n(p.defReb ?? p.dreb ?? p.reb), "reb. déf."]);
    if (p.defRtg) items.push([n(p.defRtg), "pts encaissés / 100 poss."]);
  } else if (key === "mip") {
    items.push([`${n(p.prevPts)} → ${n(p.pts)}`, "pts"], [`${p.dRebAst > 0 ? "+" : ""}${n(p.dRebAst)}`, "reb. + passes"], [`${p.dMin > 0 ? "+" : ""}${n(p.dMin)}`, "minutes"]);
  } else {
    items.push([n(p.pts), "pts"], [n(p.reb), "reb"], [n(p.ast), "pd"]);
    if (key === "mvp") {
      if (p.ts) items.push([`${f.pct(p.ts)} %`, "adresse réelle"]);
      if (p.teamPct !== null && p.teamPct !== undefined) items.push([`${Math.round(p.teamPct * 100)} %`, "victoires de l'équipe"]);
    } else if (key === "smoy") {
      items.push([`${p.benchGp}/${p.gp}`, "matchs remplaçant"]);
    } else if (p.min) {
      items.push([n(p.min), "min"]);
    }
  }
  return h(
    "span",
    { class: "aw-stats" },
    items.map(([v, l]) => h("span", null, h("b", { class: "num" }, v), h("small", null, l)))
  );
}

function candidate(key, p, i) {
  const t = team(p.teamId);
  return h(
    "a",
    { class: `aw-row${i === 0 ? " is-first" : ""}`, href: `#/joueur/${p.id}`, style: { "--team": teamColor(p.teamId), "--share": (p.share / 100).toFixed(3) } },
    h("span", { class: "aw-rank num" }, String(i + 1)),
    h("span", { class: "aw-pic" }, headshot(p.id, { alt: "", size: i === 0 ? "big" : "small" })),
    h(
      "span",
      { class: "aw-who" },
      h("b", null, p.name),
      h("small", null, teamLogo(p.teamId, 18), t?.fullName || p.tri),
      statLine(key, p)
    ),
    h("span", { class: "aw-share", title: "Indice Parquet, en pourcentage de celui du favori" }, h("i", { "aria-hidden": "true" }), h("small", { class: "num" }, `${Math.round(p.share)}`))
  );
}

function awardBlock(a) {
  return h(
    "section",
    { class: "aw-block", id: `trophee-${a.key}`, "aria-labelledby": `aw-${a.key}` },
    h(
      "header",
      { class: "aw-head" },
      h("span", { class: "aw-tag", "aria-hidden": "true" }, ICON[a.key] || ""),
      h("div", null, h("h2", { class: "aw-title", id: `aw-${a.key}` }, a.label), h("p", null, a.sub))
    ),
    a.players.length
      ? h("div", { class: "aw-list" }, a.players.map((p, i) => candidate(a.key, p, i)))
      : h("p", { class: "note" }, "Pas encore assez de matchs joués pour ce trophée."),
    h("p", { class: "aw-how" }, HOW[a.key] || "")
  );
}

export async function render(ctx) {
  const top = poster(ctx, { kicker: "Saison régulière", title: "Trophées", size: "compact" });
  const body = h("div", { class: "aw-page" }, loading("Calcul de la course aux trophées…"));
  ctx.outlet.append(top.el, body);
  let res;
  try {
    res = await api("/awards/race", { signal: ctx.signal });
  } catch (err) {
    if (err.name === "AbortError") return;
    body.replaceChildren(errorState(err, () => location.reload()));
    return;
  }
  if (!ctx.active) return;
  const { data, meta } = res;
  const mvp = data.awards.find((a) => a.key === "mvp")?.players[0];
  const nav = h(
    "nav",
    { class: "aw-nav", "aria-label": "Trophées" },
    data.awards.map((a) => h("a", { href: `#/trophees`, onclick: (e) => (e.preventDefault(), document.getElementById(`trophee-${a.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" })) }, a.label))
  );
  top.update({
    kicker: `Saison ${data.season}${data.fallback ? ", bilan final" : ""}, après ${f.plural(data.gamesPlayed, "match", "matchs")}`,
    ghost: "MVP",
    teamId: mvp?.teamId || null,
    visual: mvp ? headshot(mvp.id, { size: "big", alt: "" }) : null,
    visualKind: "cutout",
    meta: mvp ? h("span", null, "Favori pour le MVP : ", h("a", { href: `#/joueur/${mvp.id}` }, mvp.name), `, ${team(mvp.teamId)?.fullName || mvp.tri}`) : null,
    actions: [h("a", { class: "btn", href: "#/leaders" }, "Leaders statistiques")],
  });
  body.replaceChildren(
    ...[
      staleBanner(meta),
      data.fallback ? h("p", { class: "note" }, `La saison ${data.requested} n'a pas encore commencé : voici le classement de fin de saison ${data.season}.`) : null,
    ].filter(Boolean),
    nav,
    ...data.awards.map(awardBlock),
    h(
      "p",
      { class: "note aw-disclaimer" },
      "Classement maison, calculé chaque jour à partir des statistiques officielles de la NBA. Ce n'est ni un sondage ni une cote : les vrais trophées sont votés en fin de saison par un jury de journalistes, qui tient aussi compte du récit de la saison."
    )
  );
}
