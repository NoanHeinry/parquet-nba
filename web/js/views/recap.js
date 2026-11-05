// « Cette nuit en NBA » : le résumé d'une journée, affiché en tête de la page des matchs.
// Meilleures performances (Game Score), meilleurs dans chaque catégorie, match le plus serré, etc.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { headshot, teamLogo } from "../components.js";
import { isHidden, setRevealed } from "../spoiler.js";
import { youtubeBlock } from "../media.js";

function statLine(p) {
  const parts = [`${p.pts} pts`, `${p.reb} reb`, `${p.ast} pd`];
  if (p.stl >= 3) parts.push(`${p.stl} int`);
  if (p.blk >= 3) parts.push(`${p.blk} ctr`);
  return parts.join(", ");
}

function category(label, p, value, unit) {
  if (!p) return null;
  return h(
    "a",
    { class: "recap-cat", href: `#/joueur/${p.id}`, title: `${label} : ${p.name}` },
    headshot(p.id, { alt: "" }),
    h("span", { class: "v num" }, value, h("small", null, ` ${unit}`)),
    h("span", { class: "who" }, p.name)
  );
}

function gameLine(g, text) {
  if (!g) return null;
  return h(
    "a",
    { class: "recap-game", href: `#/match/${g.id}` },
    teamLogo(g.away.id, 22),
    h("span", { class: "num" }, `${g.away.score}-${g.home.score}`),
    teamLogo(g.home.id, 22),
    h("span", null, text)
  );
}

function render(data, isNight) {
  const best = data.best || [];
  const top = best[0];
  const out = [];
  if (top) {
    out.push(
      h(
        "div",
        { class: "recap-feature" },
        h("a", { class: "recap-photo", href: `#/joueur/${top.id}`, tabindex: "-1", "aria-hidden": "true" }, headshot(top.id, { size: "big", alt: "" })),
        h(
          "div",
          { class: "recap-copy" },
          h("a", { class: "recap-name", href: `#/joueur/${top.id}` }, top.name),
          h("p", { class: "recap-line num" }, statLine(top)),
          h("p", { class: "recap-why" }, `Meilleur match ${isNight ? "de la nuit" : "du jour"}, ${top.won ? "victoire" : "défaite"} contre ${top.oppTri}`),
          best.length > 1
            ? h(
                "ol",
                { class: "recap-list", start: 2 },
                best.slice(1, 5).map((p) => h("li", null, h("a", { href: `#/joueur/${p.id}` }, headshot(p.id, { alt: "" }), h("span", { class: "nm" }, p.name), h("span", { class: "muted num" }, statLine(p)))))
              )
            : null
        )
      )
    );
  }
  const cats = [
    category("Meilleur marqueur", data.topScorer, data.topScorer?.pts, "pts"),
    category("Meilleur rebondeur", data.topRebounder, data.topRebounder?.reb, "reb"),
    category("Meilleur passeur", data.topPasser, data.topPasser?.ast, "pd"),
    data.topShooter?.tpm ? category("Le plus adroit à 3 points", data.topShooter, data.topShooter.tpm, "à 3 pts") : null,
  ].filter(Boolean);
  if (cats.length) out.push(h("div", { class: "recap-cats" }, cats));
  const games = [
    data.finished > 1 ? gameLine(data.closest, data.closest?.margin === 0 ? "égalité" : `le plus serré${data.closest?.overtime ? ", après prolongation" : ""}`) : null,
    data.finished > 1 ? gameLine(data.blowout, `le plus large, ${f.plural(data.blowout.margin, "point", "points")} d'écart`) : null,
  ].filter(Boolean);
  const notes = [];
  if ((data.tripleDoubles || []).length) {
    notes.push(h("span", null, data.tripleDoubles.length > 1 ? "Triples-doubles : " : "Triple-double : ", data.tripleDoubles.map((p, i) => [i ? ", " : "", h("a", { class: "link", href: `#/joueur/${p.id}` }, p.name)])));
  }
  if ((data.overtimes || []).length) {
    notes.push(h("span", null, data.overtimes.length > 1 ? `${data.overtimes.length} prolongations : ` : "Prolongation : ", data.overtimes.map((g, i) => [i ? ", " : "", h("a", { class: "link", href: `#/match/${g.id}` }, `${g.away.tri} ${g.away.score}-${g.home.score} ${g.home.tri}`)])));
  }
  if (games.length || notes.length) out.push(h("div", { class: "recap-more" }, games, notes));
  return out;
}

// Crée le bloc une fois ; update() le recharge seulement quand un nouveau match se termine.
export function createRecap(ctx) {
  const el = h("section", { class: "recap", "aria-live": "polite", "aria-label": "Cette nuit en NBA" });
  let lastKey = null;

  const update = async (board) => {
    const finished = board.games.filter((g) => g.status === 3).length;
    el.hidden = finished === 0;
    if (!finished) return;
    const spoilerKey = `recap:${board.date}`;

    if (isHidden(spoilerKey)) {
      lastKey = null;
      const btn = h("button", { class: "btn", type: "button" }, "Afficher le résumé");
      btn.addEventListener("click", () => {
        setRevealed(spoilerKey, true);
        update(board);
      });
      el.replaceChildren(h("div", { class: "spoiler-gate" }, h("p", null, "Résumé de la nuit masqué (anti-spoiler)."), btn));
      return;
    }

    const key = `${board.date}:${finished}`;
    if (key === lastKey) return;
    lastKey = key;
    try {
      const { data } = await api(`/recap?date=${board.date}`, { signal: ctx.signal });
      if (!ctx.active) return;
      el.replaceChildren(...render(data, board.isToday));
      // Le résumé et le top 10 de la nuit publiés par la NBA sur YouTube, quand ils existent.
      api(`/videos/night?date=${board.date}`, { signal: ctx.signal })
        .then(({ data: v }) => {
          if (!ctx.active || !v.videos.length || lastKey !== key) return;
          el.append(h("div", { class: "recap-videos" }, v.videos.map((x) => youtubeBlock({ videoId: x.videoId, title: `${x.label} : ${x.title}`, url: x.url }))));
        })
        .catch(() => {});
    } catch (err) {
      if (err.name === "AbortError") return;
      lastKey = null;
      el.replaceChildren(h("p", { class: "note" }, `Résumé indisponible pour l'instant (${err.message}).`));
    }
  };

  return { el, update };
}
