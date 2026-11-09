// Palmarès (#/trophees/palmares) : champions et grands trophées individuels depuis 1947.

import { api } from "../api.js";
import { h } from "../dom.js";
import { chips, errorState, headshot, loading, swapIn, teamLogo } from "../components.js";
import { poster } from "../poster.js";
import { team, teamColor } from "../teams.js";
import { trophyIcon } from "../trophies.js";
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

const decadeOf = (endYear) => Math.floor((endYear - 1) / 10) * 10;

// Une récompense de la saison : icône du trophée, nom du lauréat, sa photo.
function awardTile(w) {
  const t = team(w.teamId);
  const inner = [
    h("span", { class: "pl-aw-ico" }, trophyIcon(w.key, 22)),
    h("span", { class: "pl-aw-txt" }, h("small", null, SHORT[w.key]), h("b", null, w.name), h("small", { class: "pl-aw-team" }, t ? h("i", { style: { background: teamColor(w.teamId) } }) : null, t?.fullName || w.team || "")),
    h("span", { class: "pl-aw-pic" }, w.id ? headshot(w.id, { alt: "", size: "small" }) : h("span", { class: "pl-nopic", "aria-hidden": "true" }, w.name.charAt(0))),
  ];
  return w.id ? h("a", { class: "pl-aw", href: `#/joueur/${w.id}` }, inner) : h("div", { class: "pl-aw" }, inner);
}

function seasonCard(fin, winners, latest) {
  const season = seasonOf(fin.year);
  const tc = fin.championId ? teamColor(fin.championId) : "var(--accent)";
  const champ = [
    fin.championId ? teamLogo(fin.championId, latest ? 92 : 64) : h("span", { class: "pl-nologo", "aria-hidden": "true" }, trophyIcon("champion", 30)),
    h(
      "span",
      { class: "pl-champ-txt" },
      h("small", { class: "pl-champ-kicker" }, trophyIcon("champion", 15), "Champion"),
      h("b", null, fin.champion),
      h("small", { class: "pl-final" }, `${fin.result} en finale contre `, h("span", { class: "pl-final-opp" }, fin.runnerUpId ? teamLogo(fin.runnerUpId, 16) : null, fin.runnerUp))
    ),
  ];
  return h(
    "article",
    { class: `pl-season${latest ? " is-latest" : ""}${winners.length ? "" : " is-bare"}`, style: { "--tc": tc } },
    h(
      "div",
      { class: "pl-s-main" },
      h("span", { class: "pl-year num" }, season),
      fin.championId ? h("a", { class: "pl-champ", href: `#/equipe/${fin.championId}` }, champ) : h("div", { class: "pl-champ" }, champ)
    ),
    winners.length ? h("div", { class: "pl-awards" }, winners.map(awardTile)) : null
  );
}

function seasonsView(data) {
  const bySeason = {};
  const order = Object.fromEntries(Object.keys(SHORT).map((k, i) => [k, i]));
  for (const a of data.awards) for (const w of a.winners) (bySeason[w.season] ||= []).push({ ...w, key: a.key });
  for (const list of Object.values(bySeason)) list.sort((x, y) => order[x.key] - order[y.key]);
  const firstAward = Math.min(...data.awards.flatMap((a) => a.winners.map((w) => Number(w.season.slice(0, 4)) + 1)));

  // Saut rapide vers une décennie.
  const decades = [...new Set(data.finals.map((fin) => decadeOf(fin.year)))];
  const jump = h(
    "nav",
    { class: "pl-jump", "aria-label": "Aller à une décennie" },
    decades.map((d) => {
      const a = h("a", { href: `#pl-${d}` }, `${d}s`);
      a.addEventListener("click", (e) => {
        e.preventDefault();
        while (!document.getElementById(`pl-${d}`) && next < data.finals.length) renderMore(Infinity);
        document.getElementById(`pl-${d}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return a;
    })
  );

  let lastDecade = null;
  const build = (fin, i) => {
    const out = [];
    const d = decadeOf(fin.year);
    if (d !== lastDecade) {
      lastDecade = d;
      out.push(
        h(
          "header",
          { class: "pl-decade", id: `pl-${d}` },
          h("span", { class: "pl-decade-num", "aria-hidden": "true" }, String(d).slice(2) + "s"),
          h("span", null, h("b", null, `Années ${d}`), d + 9 < firstAward ? h("small", null, `Premiers trophées individuels remis en ${firstAward}`) : null)
        )
      );
    }
    out.push(seasonCard(fin, bySeason[seasonOf(fin.year)] || [], i === 0));
    return out;
  };

  // Près de 80 saisons et des centaines de photos : les premières s'affichent tout de suite, les
  // suivantes par petits paquets quand le navigateur est libre (la page ne se fige plus).
  const box = h("div", { class: "pl-seasons" });
  let next = 0;
  const renderMore = (budgetMs) => {
    const until = performance.now() + budgetMs;
    const chunk = [];
    do chunk.push(...build(data.finals[next], next++));
    while (next < data.finals.length && performance.now() < until);
    box.append(...chunk);
  };
  while (next < FIRST_SEASONS && next < data.finals.length) box.append(...build(data.finals[next], next++));
  const later = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 250 }) : setTimeout(fn, 30));
  const step = () => {
    if (!box.isConnected || next >= data.finals.length) return; // autre affichage choisi entre-temps
    renderMore(10);
    if (next < data.finals.length) later(step);
  };
  if (next < data.finals.length) later(step);
  return h("div", { class: "pl-seasons-view" }, jump, box);
}

const FIRST_SEASONS = 8;

function awardView(a) {
  return h(
    "div",
    { class: "pl-award-page" },
    h("header", { class: "pl-head has-ico" }, h("span", { class: "pl-head-ico" }, trophyIcon(a.key, 44)), h("span", null, h("h2", { class: "pl-title" }, a.label), h("p", null, a.sub, `, depuis ${a.winners.at(-1)?.season || "–"}`))),
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
  return h(
    "div",
    { class: "pl-titles" },
    h("header", { class: "pl-head has-ico" }, h("span", { class: "pl-head-ico" }, trophyIcon("champion", 44)), h("span", null, h("h2", { class: "pl-title" }, "Titres par franchise"), h("p", null, `Depuis la première finale, en ${data.finals.at(-1)?.year}. Les titres des anciens noms comptent pour la franchise d'aujourd'hui.`))),
    data.titles.map((t) =>
      h(
        t.teamId ? "a" : "div",
        { class: "pl-title-row", href: t.teamId ? `#/equipe/${t.teamId}` : null, style: { "--tc": t.teamId ? teamColor(t.teamId) : "var(--accent)" } },
        t.teamId ? teamLogo(t.teamId, 34) : h("span", { class: "pl-nologo" }, "·"),
        h("span", { class: "pl-title-name" }, t.name),
        h("span", { class: "pl-cups", "aria-hidden": "true" }, Array.from({ length: t.count }, () => trophyIcon("champion", 22))),
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
        [
          { value: "saisons", label: "Saison par saison" },
          { value: "titres", label: [trophyIcon("champion", 16), "Titres par franchise"] },
          ...data.awards.map((a) => ({ value: a.key, label: [trophyIcon(a.key, 16), a.label] })),
        ],
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
