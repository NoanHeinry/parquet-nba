// Course aux playoffs : ce que chaque équipe peut encore espérer (#/classement/course).
// Les calculs (qualifié, éliminé, nombres magiques, calendrier restant) viennent du serveur.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { errorState, loading, segmented, staleBanner, teamLogo } from "../components.js";
import { poster } from "../poster.js";
import { team, teamColor } from "../teams.js";
import { iconTrophy } from "../icons.js";

const STATUS = {
  playoffs: { label: "Qualifié", cls: "is-in", title: "Assuré de finir dans les 6 premiers" },
  playin: { label: "Play-in assuré", cls: "is-pi", title: "Assuré de finir au moins 10e" },
  race: { label: "En course", cls: "is-race", title: "Rien n'est encore joué" },
  "playin-max": { label: "Au mieux play-in", cls: "is-max", title: "Ne peut plus finir dans les 6 premiers" },
  out: { label: "Éliminé", cls: "is-out", title: "Ne peut plus finir dans les 10 premiers" },
};

const matchs = (n) => f.plural(n, "match", "matchs");
const half = (n) => (Number.isInteger(n) ? String(n) : f.num(n, 1));

// La phrase qui dit où en est l'équipe.
function detail(r) {
  const out = [];
  if (r.status === "playoffs") out.push(r.clinch === "z" ? "Meilleur bilan de la ligue assuré" : r.clinch === "e" || r.clinch === "w" ? "1re place de la conférence assurée" : "Place dans les 6 premiers assurée");
  if (r.magic6 !== null && r.magic6 !== undefined) out.push(`Nombre magique pour le top 6 : ${r.magic6}`);
  if (r.magic10 !== null && r.magic10 !== undefined) out.push(`Nombre magique pour le play-in : ${r.magic10}`);
  if (r.gb6 > 0 && r.status !== "out" && r.status !== "playin-max") out.push(`${half(r.gb6)} ${r.gb6 > 1 ? "matchs" : "match"} de retard sur la 6e place`);
  if (r.gb10 > 0 && r.status !== "out") out.push(`${half(r.gb10)} ${r.gb10 > 1 ? "matchs" : "match"} de retard sur la 10e place`);
  if (r.elim10 !== null && r.elim10 !== undefined && r.status !== "out") out.push(`Éliminé dans ${r.elim10} (défaites ou victoires de la 10e)`);
  else if (r.elim6 !== null && r.elim6 !== undefined && r.status === "race" && r.rank > 6) out.push(`Top 6 hors de portée dans ${r.elim6}`);
  if (r.status === "out") out.push("Ne peut plus accrocher le play-in");
  return out;
}

function sosText(r, total) {
  if (r.sos === null || r.sos === undefined) return null;
  const rank = r.sosRank;
  const word = rank <= 6 ? "très difficile" : rank <= 12 ? "difficile" : rank <= 19 ? "moyen" : rank <= 25 ? "abordable" : "facile";
  return { word, rank, total };
}

function row(r, line, sosCount) {
  const t = team(r.teamId);
  const st = STATUS[r.status] || STATUS.race;
  const pos = (w) => `${Math.max(0, Math.min(100, (w / 82) * 100)).toFixed(2)}%`;
  const sos = sosText(r, sosCount);
  const bar = h(
    "div",
    { class: "rr-bar", role: "img", "aria-label": `${r.w} victoires, ${r.maxW} au mieux${r.pace ? `, rythme de ${r.pace}` : ""}` },
    h("span", { class: "rr-won", style: { width: pos(r.w) } }),
    r.left ? h("span", { class: "rr-poss", style: { left: pos(r.w), width: pos(r.left) } }) : null,
    line.six ? h("span", { class: "rr-line is-6", style: { left: pos(line.six) }, title: `Rythme de la 6e : ${line.six} victoires` }) : null,
    line.ten ? h("span", { class: "rr-line is-10", style: { left: pos(line.ten) }, title: `Rythme de la 10e : ${line.ten} victoires` }) : null,
    r.pace && r.left ? h("span", { class: "rr-pace", style: { left: pos(r.pace) }, title: `À ce rythme : ${r.pace} victoires` }) : null
  );
  return h(
    "div",
    { class: `race-row ${st.cls}`, style: { "--team": teamColor(r.teamId) } },
    h("span", { class: "rr-rank num" }, String(r.rank)),
    h(
      "a",
      { class: "rr-team", href: `#/equipe/${r.teamId}` },
      teamLogo(r.teamId, 34),
      h("span", null, h("b", null, t?.name || r.name), h("small", { class: "num" }, `${r.w}-${r.l}${r.pace && r.left ? `, rythme ${r.pace} V` : ""}`))
    ),
    h("div", { class: "rr-range" }, bar, h("small", { class: "num" }, r.left ? `${r.w} → ${r.maxW} au mieux` : `${r.w} victoires`)),
    h(
      "div",
      { class: "rr-left" },
      h("b", { class: "num" }, String(r.left)),
      h("small", null, r.left ? `${r.left > 1 ? "matchs" : "match"} à jouer${r.homeLeft !== null && r.homeLeft !== undefined ? `, ${r.homeLeft} à dom.` : ""}` : "saison finie")
    ),
    h("div", { class: "rr-status" }, h("span", { class: `rr-badge ${st.cls}`, title: st.title }, st.label), ...detail(r).map((d) => h("small", null, d))),
    h(
      "div",
      { class: "rr-sos" },
      sos
        ? [
            h("span", { class: "rr-sos-meter", "aria-hidden": "true" }, h("i", { style: { "--k": (1 - (sos.rank - 1) / Math.max(1, sos.total - 1)).toFixed(3) } })),
            h("small", null, `Calendrier ${sos.word}`, h("span", { class: "muted" }, ` (${sos.rank}e sur ${sos.total})`)),
          ]
        : h("small", { class: "muted" }, "–")
    )
  );
}

function conference(rows, name, sosCount) {
  const six = rows.find((r) => r.rank === 6);
  const ten = rows.find((r) => r.rank === 10);
  const line = { six: six?.left ? six.pace : null, ten: ten?.left ? ten.pace : null };
  const list = [];
  for (const r of rows) {
    if (r.rank === 7) list.push(h("div", { class: "race-cut" }, h("span", null, "Play-in, places 7 à 10")));
    if (r.rank === 11) list.push(h("div", { class: "race-cut is-out" }, h("span", null, "Hors du play-in")));
    list.push(row(r, line, sosCount));
  }
  return h(
    "section",
    { class: "race-conf", "aria-label": name },
    h("h2", { class: "race-title" }, name, line.six ? h("span", { class: "count" }, `Rythme de la 6e : ${line.six} victoires, de la 10e : ${line.ten ?? "–"}`) : null),
    h("div", { class: "race-list" }, list)
  );
}

export async function render(ctx) {
  const top = poster(ctx, { kicker: "Saison régulière", title: "Course aux playoffs" });
  const body = h("div", { class: "race-page" }, loading("Calcul de la course aux playoffs…"));
  ctx.outlet.append(top.el, body);
  let res;
  try {
    res = await api("/race", { signal: ctx.signal });
  } catch (err) {
    if (err.name === "AbortError") return;
    body.replaceChildren(errorState(err, () => location.reload()));
    return;
  }
  if (!ctx.active) return;
  const { data, meta } = res;
  const all = [...data.conferences.East, ...data.conferences.West];
  const count = (s) => all.filter((r) => r.status === s).length;
  const sosCount = all.filter((r) => r.sos !== null && r.sos !== undefined).length;
  const links = [
    h("a", { class: "btn", href: "#/classement" }, "Classement complet"),
    h("a", { class: "btn", href: "#/playoffs", style: { display: "inline-flex", alignItems: "center", gap: "8px" } }, iconTrophy(15), "Tableau des playoffs"),
  ];
  top.update({
    kicker: `Saison ${data.season}${data.fallback ? ", bilan final" : ""}`,
    ghost: data.gamesLeft ? String(data.gamesLeft) : "",
    meta: data.fallback
      ? `La saison ${data.requested} n'a pas encore commencé : voici comment s'est terminée la course en ${data.season}.`
      : data.gamesLeft
        ? `Encore ${matchs(data.gamesLeft)} de saison régulière. Qui est qualifié, qui peut encore y croire, qui a le calendrier le plus dur.`
        : "La saison régulière est terminée.",
    stats: [
      { label: "Qualifiés", v: count("playoffs") },
      { label: "Play-in assuré", v: count("playin") },
      { label: "En course", v: count("race") + count("playin-max") },
      { label: "Éliminés", v: count("out") },
    ],
    actions: links,
  });

  let conf = "both";
  const box = h("div", { class: "race-confs" });
  const draw = () => {
    const parts = [];
    if (conf !== "West") parts.push(conference(data.conferences.East, "Conférence Est", sosCount));
    if (conf !== "East") parts.push(conference(data.conferences.West, "Conférence Ouest", sosCount));
    box.replaceChildren(...parts);
  };
  draw();
  body.replaceChildren(
    ...[staleBanner(meta)].filter(Boolean),
    h(
      "div",
      { class: "toolbar" },
      segmented(
        [
          { value: "both", label: "Les deux conférences" },
          { value: "East", label: "Est" },
          { value: "West", label: "Ouest" },
        ],
        conf,
        (v) => {
          conf = v;
          draw();
        },
        "Conférence"
      )
    ),
    box,
    h(
      "details",
      { class: "race-how" },
      h("summary", null, "Comment c'est calculé"),
      h(
        "ul",
        null,
        h("li", null, "Les 6 premiers de chaque conférence vont directement en playoffs, les 7e à 10e passent par le play-in."),
        h("li", null, "Qualifié : au plus 5 équipes peuvent encore égaler ou dépasser son nombre de victoires. Éliminé : au moins 10 équipes ont déjà plus de victoires qu'il ne peut en avoir au mieux. Les égalités comptent toujours contre l'équipe, car les règles de départage (confrontations directes, bilan en conférence…) ne sont pas prises en compte : la NBA peut annoncer une qualification un peu plus tôt."),
        h("li", null, "Nombre magique : le total de victoires de l'équipe et de défaites de son premier poursuivant qu'il lui faut encore pour être sûre de le devancer. Il baisse d'un point à chaque victoire de l'équipe et à chaque défaite du poursuivant."),
        h("li", null, "Barre : en plein, les victoires déjà acquises ; en clair, ce qui reste possible ; le petit trait, le rythme actuel de l'équipe sur 82 matchs ; les lignes verticales, le rythme des 6e et 10e de la conférence."),
        h("li", null, "Calendrier : pourcentage de victoires moyen des adversaires qui restent à jouer, comparé à celui des 29 autres équipes.")
      )
    )
  );
}
