// « La nuit en chiffres » : le résumé d'une journée, sous les matchs de l'accueil.
// Meilleurs dans chaque catégorie, match le plus serré, plus large victoire, triples-doubles, etc.
// (les joueurs du match sont présentés plus haut, dans la scène d'ouverture).

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { headshot, teamLogo } from "../components.js";
import { teamColor } from "../teams.js";
import { isHidden, setRevealed } from "../spoiler.js";
import { youtubeBlock } from "../media.js";

// Une catégorie : le chiffre en très grand, le joueur détouré devant, puis qui et contre qui.
function category(label, p, value) {
  if (!p) return null;
  return h(
    "a",
    { class: "night-num", href: `#/joueur/${p.id}`, style: { "--team": teamColor(p.teamId) } },
    h("span", { class: "nn-big num" }, value),
    h("span", { class: "nn-cut" }, headshot(p.id, { size: "big", alt: "" })),
    h("span", { class: "nn-label" }, label),
    h("span", { class: "nn-who" }, p.name),
    h("span", { class: "nn-vs" }, `${p.tri} contre ${p.oppTri}, ${p.won ? "victoire" : "défaite"}`)
  );
}

function gameLine(g, text) {
  if (!g) return null;
  return h(
    "a",
    { class: "night-line", href: `#/match/${g.id}` },
    h("span", { class: "nl-k" }, text),
    h("span", { class: "nl-score" }, teamLogo(g.away.id, 30), h("b", { class: "num" }, `${g.away.score}-${g.home.score}`), teamLogo(g.home.id, 30))
  );
}

function render(data) {
  const out = [h("p", { class: "home-kicker" }, "La nuit en chiffres")];
  const cats = [
    category("points", data.topScorer, data.topScorer?.pts),
    category("rebonds", data.topRebounder, data.topRebounder?.reb),
    category("passes", data.topPasser, data.topPasser?.ast),
    data.topShooter?.tpm ? category("à 3 points", data.topShooter, data.topShooter.tpm) : null,
  ].filter(Boolean);
  if (cats.length) out.push(h("div", { class: "night-nums" }, cats));
  const lines = [
    data.finished > 1 ? gameLine(data.closest, data.closest?.margin === 0 ? "Égalité" : `Le plus serré${data.closest?.overtime ? ", après prolongation" : ""}`) : null,
    data.finished > 1 ? gameLine(data.blowout, `Le plus large, ${f.plural(data.blowout.margin, "point", "points")} d'écart`) : null,
    data.finished > 1 && data.highestScoring && data.highestScoring.id !== data.blowout?.id && data.highestScoring.id !== data.closest?.id
      ? gameLine(data.highestScoring, `Le plus prolifique, ${data.highestScoring.total} points`)
      : null,
  ].filter(Boolean);
  const notes = [];
  if ((data.tripleDoubles || []).length) {
    notes.push(h("p", { class: "night-note" }, data.tripleDoubles.length > 1 ? "Triples-doubles : " : "Triple-double : ", data.tripleDoubles.map((p, i) => [i ? ", " : "", h("a", { class: "link", href: `#/joueur/${p.id}` }, p.name), ` (${p.pts}-${p.reb}-${p.ast})`])));
  }
  if ((data.overtimes || []).length) {
    notes.push(h("p", { class: "night-note" }, data.overtimes.length > 1 ? `${data.overtimes.length} prolongations : ` : "Prolongation : ", data.overtimes.map((g, i) => [i ? ", " : "", h("a", { class: "link", href: `#/match/${g.id}` }, `${g.away.tri} ${g.away.score}-${g.home.score} ${g.home.tri}`)])));
  }
  if (lines.length || notes.length) out.push(h("div", { class: "night-lines" }, lines, notes));
  return out;
}

// Crée le bloc une fois ; update() le recharge seulement quand un nouveau match se termine.
export function createRecap(ctx) {
  const el = h("section", { class: "recap", "aria-live": "polite", "aria-label": "Cette nuit en NBA" });
  let lastKey = null;

  const update = async (board) => {
    const finished = board.games.filter((g) => g.status === 3).length;
    // Même nuit que la scène d'ouverture : celle de la journée, ou la précédente si rien n'est fini.
    const day = finished ? board.date : board.isToday && board.prev ? board.prev : null;
    el.hidden = !day;
    if (!day) return;
    const spoilerKey = `recap:${day}`;

    if (isHidden(spoilerKey)) {
      lastKey = null;
      const btn = h("button", { class: "btn", type: "button" }, "Afficher le résumé");
      btn.addEventListener("click", () => {
        setRevealed(spoilerKey, true);
        update(board);
      });
      el.replaceChildren(h("p", { class: "home-kicker" }, "La nuit en chiffres"), h("div", { class: "spoiler-gate" }, h("p", null, "Résumé de la nuit masqué (anti-spoiler)."), btn));
      return;
    }

    const key = `${day}:${finished}`;
    if (key === lastKey) return;
    lastKey = key;
    try {
      const { data } = await api(`/recap?date=${day}`, { signal: ctx.signal });
      if (!ctx.active) return;
      el.hidden = !data.finished;
      el.replaceChildren(...render(data));
      // Le résumé et le top 10 de la nuit publiés par la NBA sur YouTube, quand ils existent.
      api(`/videos/night?date=${day}`, { signal: ctx.signal })
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
