// Palmarès (#/trophees/palmares) : champions et grands trophées individuels depuis 1947.

import { api } from "../api.js";
import { h } from "../dom.js";
import { chips, errorState, headshot, loading, swapIn, teamLogo } from "../components.js";
import { poster } from "../poster.js";
import { trophyTabs } from "./awards.js";

const SHORT = { mvp: "MVP", fmvp: "MVP des Finales", roy: "Rookie", dpoy: "Défenseur", smoy: "6e homme", mip: "Progression" };

const seasonOf = (endYear) => `${endYear - 1}-${String(endYear).slice(2)}`;

function person(w, { size = "small", cls = "pl-person" } = {}) {
  const pic = w.id ? headshot(w.id, { alt: "", size }) : h("span", { class: "pl-nopic", "aria-hidden": "true" }, w.name.charAt(0));
  const inner = [h("span", { class: "pl-pic" }, pic), h("span", { class: "pl-name" }, h("b", null, w.name), h("small", null, w.team))];
  return w.id ? h("a", { class: cls, href: `#/joueur/${w.id}` }, inner) : h("span", { class: cls }, inner);
}

function teamName(id, name) {
  return id ? h("a", { href: `#/equipe/${id}` }, name) : h("span", null, name);
}

function seasonsView(data) {
  const bySeason = {};
  for (const a of data.awards) for (const w of a.winners) (bySeason[w.season] ||= []).push({ ...w, key: a.key });
  const build = (fin) => {
    const season = seasonOf(fin.year);
    const winners = bySeason[season] || [];
    return h(
      "article",
      { class: "pl-season", style: { "--i": 0 } },
      h("span", { class: "pl-year num" }, season),
      h(
        "div",
        { class: "pl-champ" },
        fin.championId ? teamLogo(fin.championId, 52) : h("span", { class: "pl-nologo", "aria-hidden": "true" }, "🏆"),
        h(
          "span",
          null,
          h("small", null, "Champion"),
          h("b", null, teamName(fin.championId, fin.champion)),
          h("small", null, `${fin.result} contre `, teamName(fin.runnerUpId, fin.runnerUp))
        )
      ),
      h(
        "div",
        { class: "pl-awards" },
        winners.length
          ? winners.map((w) => h("div", { class: "pl-award" }, h("small", { class: "pl-award-label" }, SHORT[w.key]), person(w)))
          : h("p", { class: "note" }, "Pas encore de trophées individuels à cette époque.")
      )
    );
  };
  // Près de 80 saisons et des centaines de photos : les premières s'affichent tout de suite, les
  // suivantes par petits paquets quand le navigateur est libre (la page ne se fige plus).
  const box = h("div", { class: "pl-seasons" }, data.finals.slice(0, FIRST_SEASONS).map(build));
  let next = FIRST_SEASONS;
  const later = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 250 }) : setTimeout(fn, 30));
  const step = () => {
    if (!box.isConnected) return; // autre affichage choisi entre-temps
    const until = performance.now() + 10;
    const chunk = [];
    do chunk.push(build(data.finals[next++]));
    while (next < data.finals.length && performance.now() < until);
    box.append(...chunk);
    if (next < data.finals.length) later(step);
  };
  if (next < data.finals.length) later(step);
  return box;
}

const FIRST_SEASONS = 8;

function awardView(a) {
  return h(
    "div",
    { class: "pl-award-page" },
    h("header", { class: "pl-head" }, h("h2", { class: "pl-title" }, a.label), h("p", null, a.sub, `, depuis ${a.winners.at(-1)?.season || "–"}`)),
    a.most.length
      ? h(
          "div",
          { class: "pl-most" },
          h("h3", { class: "pl-h3" }, "Les plus titrés"),
          h(
            "div",
            { class: "pl-most-list" },
            a.most.map((m) =>
              h(
                m.id ? "a" : "span",
                { class: "pl-most-item", href: m.id ? `#/joueur/${m.id}` : null },
                h("b", { class: "num" }, `${m.count}×`),
                h("span", { class: "pl-pic" }, m.id ? headshot(m.id, { alt: "" }) : h("span", { class: "pl-nopic" }, m.name.charAt(0))),
                h("span", null, m.name)
              )
            )
          )
        )
      : null,
    h(
      "div",
      { class: "pl-grid" },
      a.winners.map((w) =>
        h(
          "div",
          { class: "pl-card" },
          h("span", { class: "pl-card-season num" }, w.season),
          person(w, { size: "small", cls: "pl-person is-card" }),
          w.teamId ? teamLogo(w.teamId, 26) : null
        )
      )
    )
  );
}

function titlesView(data) {
  const max = data.titles[0]?.count || 1;
  return h(
    "div",
    { class: "pl-titles" },
    h("header", { class: "pl-head" }, h("h2", { class: "pl-title" }, "Titres par franchise"), h("p", null, `Depuis la première finale, en ${data.finals.at(-1)?.year}. Les titres des anciens noms comptent pour la franchise d'aujourd'hui.`)),
    data.titles.map((t) =>
      h(
        t.teamId ? "a" : "div",
        { class: "pl-title-row", href: t.teamId ? `#/equipe/${t.teamId}` : null, style: { "--k": (t.count / max).toFixed(3) } },
        t.teamId ? teamLogo(t.teamId, 34) : h("span", { class: "pl-nologo" }, "·"),
        h("span", { class: "pl-title-name" }, t.name),
        h("span", { class: "pl-title-bar", "aria-hidden": "true" }, h("i")),
        h("b", { class: "num" }, String(t.count))
      )
    )
  );
}

export async function render(ctx) {
  const top = poster(ctx, { kicker: "Depuis 1947", title: "Palmarès", actions: trophyTabs("palmares") });
  const body = h("div", { class: "pl-page" }, loading("Chargement du palmarès…"));
  ctx.outlet.append(top.el, body);
  let res;
  try {
    res = await api("/palmares", { signal: ctx.signal });
  } catch (err) {
    if (err.name === "AbortError") return;
    body.replaceChildren(errorState(err, () => location.reload()));
    return;
  }
  if (!ctx.active) return;
  const { data } = res;
  const last = data.finals[0];
  const mvp = data.awards[0].winners[0];
  top.update({
    ghost: String(data.finals.length),
    teamId: last?.championId || null,
    visual: last?.championId ? teamLogo(last.championId, 380) : null,
    visualKind: "logo",
    meta: last ? h("span", null, `Dernier champion : `, teamName(last.championId, last.champion), ` (${last.year}). MVP ${mvp.season} : ${mvp.name}.`) : null,
  });
  let view = "saisons";
  const box = h("div");
  const draw = () => {
    const award = data.awards.find((a) => a.key === view);
    box.replaceChildren(view === "saisons" ? seasonsView(data) : view === "titres" ? titlesView(data) : awardView(award));
    swapIn(box);
  };
  body.replaceChildren(
    h(
      "div",
      { class: "toolbar" },
      chips(
        [{ value: "saisons", label: "Saison par saison" }, { value: "titres", label: "Titres par franchise" }, ...data.awards.map((a) => ({ value: a.key, label: a.label }))],
        view,
        (v) => {
          view = v;
          draw();
        },
        "Affichage"
      )
    ),
    box,
    h("p", { class: "note" }, `Sources : listes officielles des lauréats publiées par NBA.com, à jour jusqu'à la saison ${data.lastSeason}. Les trophées de la saison en cours sont ajoutés après leur remise, en fin de saison.`)
  );
  draw();
}
