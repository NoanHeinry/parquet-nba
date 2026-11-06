// Face-à-face (#/face-a-face/{a}/{b}) : tout l'historique entre deux équipes, saison régulière
// et playoffs, les derniers matchs et les prochains.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { errorState, loading, staleBanner, teamLogo } from "../components.js";
import { poster } from "../poster.js";
import { isSpoilerFree as spoilerFree } from "../spoiler.js";
import { team, teamColor, teams } from "../teams.js";

function picker(a, b) {
  const list = teams()
    .slice()
    .sort((x, y) => x.fullName.localeCompare(y.fullName));
  const sel = (value, label) =>
    h(
      "select",
      { class: "select", "aria-label": label },
      h("option", { value: "" }, "Choisir une équipe"),
      list.map((t) => h("option", { value: t.id, selected: Number(value) === t.id ? true : null }, t.fullName))
    );
  const sa = sel(a, "Première équipe");
  const sb = sel(b, "Deuxième équipe");
  const go = () => {
    if (sa.value && sb.value && sa.value !== sb.value) location.hash = `#/face-a-face/${sa.value}/${sb.value}`;
  };
  sa.addEventListener("change", go);
  sb.addEventListener("change", go);
  const swap = h("button", { class: "btn square", type: "button", title: "Inverser", "aria-label": "Inverser les deux équipes" }, "⇄");
  swap.addEventListener("click", () => {
    if (a && b) location.hash = `#/face-a-face/${b}/${a}`;
  });
  return h("div", { class: "toolbar h2h-pick" }, sa, swap, sb);
}

const rec = (r) => `${r.w}-${r.l}`;

function scoreLine(g, A, B) {
  const hidden = spoilerFree();
  const when = new Date(`${g.date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  const where = `à ${(g.home ? A : B).city || (g.home ? A : B).name}`;
  return h(
    "a",
    { class: `h2h-game${g.win ? " is-win" : " is-loss"}`, href: `#/match/${g.id}` },
    h("span", { class: "h2h-date" }, when, g.playoffs ? h("b", { class: "h2h-po" }, "Playoffs") : null),
    h("span", { class: "h2h-where" }, where),
    hidden
      ? h("span", { class: "h2h-score num" }, "Score masqué")
      : h("span", { class: "h2h-score num" }, h("b", null, `${g.pts}`), ` – ${g.opp}`, h("small", null, g.win ? ` victoire ${A.tri}` : ` victoire ${B.tri}`))
  );
}

export async function render(ctx) {
  const [pa, pb] = ctx.params.map(Number);
  const A = pa ? team(pa) : null;
  const B = pb ? team(pb) : null;
  const top = poster(ctx, {
    kicker: A && B ? "Face-à-face" : "Deux équipes, toute leur histoire",
    title: A && B ? `${A.name} – ${B.name}` : "Face-à-face",
    teamId: A?.id || null,
    actions: [picker(pa, pb)],
  });
  const body = h("div", { class: "h2h-page" });
  ctx.outlet.append(top.el, body);
  if (!A || !B || A.id === B.id) {
    body.append(h("p", { class: "note" }, "Choisis deux équipes pour voir leurs confrontations : bilan en saison régulière et en playoffs, séries, derniers matchs et prochains rendez-vous."));
    return;
  }
  body.append(loading("Chargement des confrontations…"));
  let res;
  try {
    res = await api(`/h2h/${A.id}/${B.id}`, { signal: ctx.signal });
  } catch (err) {
    if (err.name === "AbortError") return;
    body.replaceChildren(errorState(err, () => location.reload()));
    return;
  }
  if (!ctx.active) return;
  const { data, meta } = res;
  const hidden = spoilerFree();
  const r = data.regular;
  const po = data.playoffs;
  top.update({
    ghost: hidden ? "" : `${r.w}-${r.l}`,
    visual: h("span", { class: "h2h-logos", style: { "--a": teamColor(A.id), "--b": teamColor(B.id) } }, teamLogo(A.id, 220), teamLogo(B.id, 220)),
    visualKind: "logo",
    meta: data.total ? `${f.plural(data.total, "match", "matchs")} depuis ${data.since}` : "Aucune confrontation trouvée.",
    stats: hidden
      ? []
      : [
          { label: `Saison régulière, ${A.tri}`, v: rec(r) },
          { label: "Playoffs", v: po.w + po.l ? rec(po) : "–" },
          { label: "Séries de playoffs gagnées", v: data.series.length ? `${data.series.filter((s) => s.won).length}/${data.series.length}` : "–" },
          { label: "Série en cours", v: data.streak ? `${Math.abs(data.streak)} ${data.streak > 0 ? A.tri : B.tri}` : "–" },
        ],
  });
  const avg = data.avg;
  const sections = [staleBanner(meta)];
  if (data.upcoming.length) {
    sections.push(
      h(
        "section",
        { class: "section" },
        h("h2", { class: "section-title" }, "Prochains rendez-vous"),
        h(
          "div",
          { class: "h2h-next" },
          data.upcoming.map((g) =>
            h("a", { class: "h2h-next-item", href: `#/match/${g.id}` }, h("b", null, g.start ? f.localDayShort(g.start) : g.date), h("span", null, g.start ? f.clockTime(g.start) : ""), h("small", null, g.home ? `à ${A.city || A.name}` : `à ${B.city || B.name}`))
          )
        )
      )
    );
  }
  if (!hidden && avg) {
    const total = r.w + r.l + po.w + po.l || 1;
    const share = (r.w + po.w) / total;
    sections.push(
      h(
        "section",
        { class: "section" },
        h("h2", { class: "section-title" }, "Le rapport de force"),
        h(
          "div",
          { class: "h2h-tug", style: { "--a": teamColor(A.id), "--b": teamColor(B.id), "--k": share.toFixed(3) } },
          h("span", { class: "h2h-tug-side" }, teamLogo(A.id, 40), h("b", { class: "num" }, String(r.w + po.w)), h("small", null, `victoires ${A.tri}`)),
          h("span", { class: "h2h-tug-bar", "aria-hidden": "true" }, h("i")),
          h("span", { class: "h2h-tug-side is-b" }, h("small", null, `victoires ${B.tri}`), h("b", { class: "num" }, String(r.l + po.l)), teamLogo(B.id, 40))
        ),
        h(
          "p",
          { class: "note" },
          `Score moyen : ${f.num(avg.pts)} à ${f.num(avg.opp)} (${A.tri}–${B.tri}).`,
          data.best ? ` Plus gros écart pour ${A.tri} : ${data.best.pts}-${data.best.opp} en ${data.best.season}.` : "",
          data.worst ? ` Pour ${B.tri} : ${data.worst.opp}-${data.worst.pts} en ${data.worst.season}.` : ""
        )
      )
    );
  }
  if (data.series.length) {
    sections.push(
      h(
        "section",
        { class: "section" },
        h("h2", { class: "section-title" }, "En playoffs"),
        h(
          "div",
          { class: "h2h-series" },
          data.series.map((s) => {
            const winner = s.won ? A : B;
            return h(
              "div",
              { class: "h2h-serie" },
              h("span", { class: "h2h-serie-year num" }, s.season),
              hidden ? h("span", null, "Résultat masqué") : [teamLogo(winner.id, 28), h("span", null, h("b", null, winner.name), ` ${Math.max(s.w, s.l)}-${Math.min(s.w, s.l)}`)]
            );
          })
        )
      )
    );
  }
  if (data.recent.length) sections.push(h("section", { class: "section" }, h("h2", { class: "section-title" }, "Derniers matchs"), h("div", { class: "h2h-games" }, data.recent.map((g) => scoreLine(g, A, B)))));
  if (data.seasons.length && !hidden) {
    sections.push(
      h(
        "section",
        { class: "section" },
        h("h2", { class: "section-title" }, "Saison par saison"),
        h(
          "div",
          { class: "h2h-seasons" },
          data.seasons.map((s) => h("div", { class: `h2h-season${s.w > s.l ? " is-a" : s.w < s.l ? " is-b" : ""}` }, h("span", { class: "num" }, s.season), h("b", { class: "num" }, rec(s))))
        )
      )
    );
  }
  sections.push(h("p", { class: "note" }, `Bilans du point de vue de ${A.fullName}. Matchs disponibles sur NBA.com depuis le milieu des années 1980.`));
  body.replaceChildren(...sections.filter(Boolean));
}
