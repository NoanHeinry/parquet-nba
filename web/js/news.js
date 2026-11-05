// Affichage du rapport des blessures et des transactions, partagé par plusieurs pages.

import { h } from "./dom.js";
import * as f from "./format.js";
import { teamLogo } from "./components.js";
import { team } from "./teams.js";

const LEVEL_CLASS = ["out", "doubtful", "questionable", "probable", "available"];

export function statusBadge(p) {
  return h("span", { class: `inj-status ${LEVEL_CLASS[p.level] || "other"}`, title: p.status }, p.statusFr || p.status);
}

export function injuryRow(p, { showTeam = null } = {}) {
  const name = p.id ? h("a", { class: "link", href: `#/joueur/${p.id}` }, p.name) : h("span", null, p.name);
  return h(
    "li",
    { class: "inj-row" },
    statusBadge(p),
    h(
      "span",
      { class: "inj-who" },
      showTeam ? teamLogo(showTeam, 18) : null,
      name
    ),
    h("span", { class: "inj-why", title: p.reasonFr ? p.reason : null, lang: p.reasonFr ? null : "en" }, p.reasonFr || p.reason)
  );
}

export function injuryTeamBlock(t) {
  const meta = team(t.id);
  return h(
    "div",
    { class: "inj-team" },
    h("h4", null, teamLogo(t.id, 22), meta?.name || t.name),
    !t.submitted
      ? h("p", { class: "note" }, "Rapport pas encore transmis par l'équipe.")
      : t.players.length
        ? h("ul", { class: "inj-list" }, t.players.map((p) => injuryRow(p)))
        : h("p", { class: "note" }, "Aucun joueur signalé.")
  );
}

export function reportSource(data) {
  if (!data.url) return null;
  const when = data.publishedEt ? new Date(`${data.publishedEt}`) : null;
  const label = when && !Number.isNaN(when.getTime())
    ? `${when.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} à ${when.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}, heure de New York`
    : "";
  return h(
    "p",
    { class: "note" },
    "Rapport officiel de la NBA",
    label ? ` du ${label}` : "",
    ". ",
    h("a", { class: "link", href: data.url, target: "_blank", rel: "noopener" }, "Voir le PDF"),
    ". Statuts : forfait, peu probable (environ 25 % de chances de jouer), incertain (50 %), probable (75 %)."
  );
}

export function gameInjuries(game) {
  const when = game.start ? `${f.localDayShort(game.start)}, ${f.clockTime(game.start)}` : `${f.dayShort(game.date)}, ${game.timeEt} (heure de New York)`;
  const [away, home] = game.teams;
  const title = h(
    "div",
    { class: "inj-game-head" },
    game.gameId ? h("a", { class: "link", href: `#/match/${game.gameId}` }, `${away?.tri || "?"} à ${home?.tri || "?"}`) : h("span", null, game.matchup.replace("@", " à ")),
    h("span", { class: "note" }, when)
  );
  return h("section", { class: "inj-game" }, title, h("div", { class: "inj-teams" }, game.teams.map(injuryTeamBlock)));
}

// ------------------------------------------------------------ transactions

const TYPE_CLASS = { Signing: "sign", Waive: "waive", AwardOnWaivers: "claim", ContractConverted: "convert", Trade: "trade" };

export function moveRow(m, { showTeam = true } = {}) {
  const meta = team(m.teamId);
  const text = m.text || m.original;
  return h(
    "li",
    { class: "move-row" },
    h("span", { class: `move-type ${TYPE_CLASS[m.type] || ""}` }, m.typeFr),
    showTeam ? h("a", { class: "move-team", href: m.teamId ? `#/equipe/${m.teamId}` : null }, teamLogo(m.teamId, 20), meta?.name || "") : null,
    h(
      "span",
      { class: "move-text", lang: m.text ? null : "en", title: m.text ? m.original : null },
      text,
      m.playerId ? [" ", h("a", { class: "link small", href: `#/joueur/${m.playerId}` }, "fiche")] : null
    )
  );
}

export function movesByDay(items, opts) {
  const days = new Map();
  for (const m of items) {
    if (!days.has(m.date)) days.set(m.date, []);
    days.get(m.date).push(m);
  }
  return [...days.entries()].map(([day, list]) =>
    h("section", { class: "move-day" }, h("h3", { class: "move-date" }, f.dayTitle(day)), h("ul", { class: "move-list" }, list.map((m) => moveRow(m, opts))))
  );
}
