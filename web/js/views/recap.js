// « Cette nuit en NBA » : le résumé d'une journée, affiché en tête de la page des matchs.
// Meilleures performances (Game Score), meilleurs dans chaque catégorie, match le plus serré, etc.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { headshot, teamLogo } from "../components.js";
import { isHidden, setRevealed } from "../spoiler.js";

function statLine(p) {
  const parts = [`${p.pts} pts`, `${p.reb} reb`, `${p.ast} pd`];
  if (p.stl >= 3) parts.push(`${p.stl} int`);
  if (p.blk >= 3) parts.push(`${p.blk} ctr`);
  return parts.join(", ");
}

function playerHighlight(label, p, value, unit) {
  if (!p) return null;
  return h(
    "a",
    { class: "recap-tile", href: `#/joueur/${p.id}` },
    h("span", { class: "k" }, label),
    h("span", { class: "v" }, value, h("small", null, ` ${unit}`)),
    h("span", { class: "who" }, teamLogo(p.teamId, 18), p.name),
    h("span", { class: "s" }, `contre ${p.oppTri}, ${p.won ? "victoire" : "défaite"}`)
  );
}

function gameHighlight(label, g, detail) {
  if (!g) return null;
  return h(
    "a",
    { class: "recap-tile", href: `#/match/${g.id}` },
    h("span", { class: "k" }, label),
    h("span", { class: "v score" }, `${g.away.score}-${g.home.score}`),
    h("span", { class: "who" }, teamLogo(g.away.id, 18), g.away.tri, h("span", { class: "muted" }, " à "), teamLogo(g.home.id, 18), g.home.tri),
    h("span", { class: "s" }, detail)
  );
}

function render(data, title, isNight) {
  const best = data.best || [];
  const top = best[0];
  const others = best.slice(1, 5);
  const progress =
    data.finished === data.total
      ? `${f.plural(data.finished, "match terminé", "matchs terminés")}`
      : `${data.finished} sur ${data.total} matchs terminés`;

  const hero = top
    ? h(
        "a",
        { class: "recap-hero", href: `#/joueur/${top.id}` },
        headshot(top.id, { cls: "headshot", alt: "" }),
        h(
          "div",
          null,
          h("span", { class: "k" }, isNight ? "Performance de la nuit" : "Performance du jour"),
          h("strong", { class: "nm" }, top.name),
          h("span", { class: "line" }, statLine(top)),
          h("span", { class: "s" }, `${top.tri} contre ${top.oppTri}, ${top.won ? "victoire" : "défaite"}. Game Score ${f.num(top.gameScore)}.`)
        )
      )
    : null;

  const runnersUp = others.length
    ? h(
        "ol",
        { class: "recap-list", start: 2 },
        others.map((p) =>
          h("li", null, h("a", { href: `#/joueur/${p.id}` }, teamLogo(p.teamId, 18), h("span", { class: "nm" }, p.name), h("span", { class: "muted" }, statLine(p))))
        )
      )
    : null;

  const triple = (data.tripleDoubles || []).length
    ? h(
        "p",
        { class: "recap-note" },
        h("strong", null, data.tripleDoubles.length > 1 ? "Triples-doubles : " : "Triple-double : "),
        data.tripleDoubles.map((p, i) => [i ? ", " : "", h("a", { class: "link", href: `#/joueur/${p.id}` }, p.name), ` (${statLine(p)})`])
      )
    : null;

  const ot = (data.overtimes || []).length
    ? h("p", { class: "recap-note" }, h("strong", null, data.overtimes.length > 1 ? `${data.overtimes.length} matchs en prolongation : ` : "Prolongation : "),
        data.overtimes.map((g, i) => [i ? ", " : "", h("a", { class: "link", href: `#/match/${g.id}` }, `${g.away.tri} ${g.away.score}-${g.home.score} ${g.home.tri}`)]))
    : null;

  const tiles = [
    playerHighlight("Meilleur marqueur", data.topScorer, data.topScorer?.pts, "pts"),
    playerHighlight("Rebonds", data.topRebounder, data.topRebounder?.reb, "reb"),
    playerHighlight("Passes décisives", data.topPasser, data.topPasser?.ast, "pd"),
    data.topShooter?.tpm ? playerHighlight("Tirs à 3 points", data.topShooter, data.topShooter.tpm, "réussis") : null,
    data.finished > 1 ? gameHighlight("Match le plus serré", data.closest, data.closest?.margin === 0 ? "égalité" : `${f.plural(data.closest.margin, "point", "points")} d'écart${data.closest.overtime ? ", après prolongation" : ""}`) : null,
    data.finished > 1 ? gameHighlight("Plus large victoire", data.blowout, `${f.plural(data.blowout.margin, "point", "points")} d'écart`) : null,
  ].filter(Boolean);

  return [
    h("div", { class: "recap-head" }, h("h2", { class: "section-title" }, title), h("span", { class: "note" }, progress)),
    h("div", { class: "recap-top" }, hero, runnersUp),
    tiles.length ? h("div", { class: "recap-tiles" }, tiles) : null,
    triple,
    ot,
  ];
}

// Crée le bloc une fois ; update() le recharge seulement quand un nouveau match se termine.
export function createRecap(ctx) {
  const el = h("section", { class: "recap", "aria-live": "polite" });
  let lastKey = null;

  const update = async (board) => {
    const finished = board.games.filter((g) => g.status === 3).length;
    el.hidden = finished === 0;
    if (!finished) return;
    const title = board.isToday ? "Cette nuit en NBA" : "Résumé de la journée";
    const spoilerKey = `recap:${board.date}`;

    if (isHidden(spoilerKey)) {
      lastKey = null;
      const btn = h("button", { class: "btn", type: "button" }, "Afficher le résumé");
      btn.addEventListener("click", () => {
        setRevealed(spoilerKey, true);
        update(board);
      });
      el.replaceChildren(
        h("div", { class: "recap-head" }, h("h2", { class: "section-title" }, title), h("span", { class: "note" }, f.plural(finished, "match terminé", "matchs terminés"))),
        h("div", { class: "spoiler-gate" }, h("p", null, "Le résumé donne les résultats : il reste masqué en mode anti-spoiler."), btn)
      );
      return;
    }

    const key = `${board.date}:${finished}`;
    if (key === lastKey) return;
    lastKey = key;
    try {
      const { data } = await api(`/recap?date=${board.date}`, { signal: ctx.signal });
      if (!ctx.active) return;
      el.replaceChildren(...render(data, title, board.isToday).filter(Boolean));
    } catch (err) {
      if (err.name === "AbortError") return;
      lastKey = null;
      el.replaceChildren(h("p", { class: "note" }, `Résumé indisponible pour l'instant (${err.message}).`));
    }
  };

  return { el, update };
}
