// Mode multi-matchs : plusieurs matchs en direct côte à côte, actualisés toutes les 10 secondes.
// Pensé pour les grosses soirées : plein écran possible, dernières actions et alerte de fin de match serrée.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { errorState, loading, scoreMap, teamLogo } from "../components.js";
import { iconExpand, iconLightning } from "../icons.js";
import { checkScoreboard, isClutch } from "../notifications.js";
import { gameKey, isHidden, setRevealed } from "../spoiler.js";
import { team, teamPair } from "../teams.js";

const SELECTION_KEY = "parquet-multi-selection";

function loadSelection() {
  try {
    return JSON.parse(sessionStorage.getItem(SELECTION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSelection(ids) {
  try {
    sessionStorage.setItem(SELECTION_KEY, JSON.stringify(ids));
  } catch {
    /* rien */
  }
}

const IMPORTANT = new Set(["2pt", "3pt", "freethrow", "turnover", "steal", "block", "foul", "timeout", "made shot", "missed shot"]);

function lastActions(pbp, n = 4) {
  return (pbp?.actions || []).filter((a) => a.desc && (a.scoring || IMPORTANT.has(a.type))).slice(-n).reverse();
}

function panel(game, pbp, previous) {
  const colors = teamPair(game.away?.id, game.home?.id);
  const status = f.gameStatus(game);
  const started = game.status >= 2;
  const clutch = isClutch(game);
  const winner = game.status === 3 ? (game.away.score > game.home.score ? "away" : "home") : null;

  const side = (key) => {
    const s = game[key];
    const prev = previous.get(`${game.id}:${key}`);
    const score = h("span", { class: `mp-score${prev !== undefined && s?.score > prev ? " bump" : ""}` }, started ? String(s?.score ?? 0) : "");
    return h(
      "div",
      { class: `mp-team${winner && winner !== key ? " loser" : ""}` },
      teamLogo(s?.id, 40),
      h("div", { class: "mp-names" }, h("strong", null, s?.tri || "?"), h("small", null, s?.name || team(s?.id)?.name || "")),
      score
    );
  };

  const progress = status.live
    ? h("div", { class: "progress", "aria-hidden": "true" }, f.gameProgress(game).map((p) => h("span", { class: p.ot ? "ot" : "" }, h("i", { style: { width: `${p.filled * 100}%` } }))))
    : null;

  const actions = lastActions(pbp);
  return h(
    "article",
    { class: `multi-panel${status.live ? " is-live" : ""}${clutch ? " is-clutch" : ""}`, style: { "--away": colors.away, "--home": colors.home } },
    h(
      "div",
      { class: "mp-head" },
      h("span", { class: `tile-status${status.live ? " live" : ""}` }, status.live ? h("span", { class: "live-dot", "aria-hidden": "true" }) : null, started ? status.text : `${f.clockTime(game.start)}, heure de Paris`),
      clutch ? h("span", { class: "mp-clutch" }, iconLightning(14), "Fin de match serrée") : null,
      h("a", { class: "mp-link", href: `#/match/${game.id}` }, "Détails")
    ),
    side("away"),
    side("home"),
    progress,
    actions.length
      ? h(
          "ul",
          { class: "mp-actions" },
          actions.map((a) =>
            h("li", { class: a.scoring ? "scoring" : "" }, h("span", { class: "clock num" }, a.clock), a.teamId ? teamLogo(a.teamId, 16) : h("span"), h("span", { class: "desc" }, a.desc))
          )
        )
      : h("p", { class: "note mp-empty" }, started ? "Pas encore d'action." : "Le fil des actions démarrera au coup d'envoi.")
  );
}

export async function render(ctx) {
  const wrapper = h("div", { class: "multi-page" });
  ctx.outlet.append(wrapper);
  wrapper.append(loading("Chargement des matchs…"));

  let board = null;
  let selection = loadSelection();
  let previous = new Map();
  const pbps = new Map();
  const grid = h("div", { class: "multi-grid" });
  const updated = h("p", { class: "updated" });
  const chipsBox = h("div");
  const gateBox = h("div");

  const fullscreenBtn = h("button", { class: "btn", type: "button" }, iconExpand(15), "Plein écran");
  fullscreenBtn.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else wrapper.requestFullscreen?.().catch(() => {});
  });
  const onFs = () => (fullscreenBtn.lastChild.textContent = document.fullscreenElement ? "Quitter le plein écran" : "Plein écran");
  document.addEventListener("fullscreenchange", onFs);
  ctx.onCleanup(() => {
    document.removeEventListener("fullscreenchange", onFs);
    if (document.fullscreenElement) document.exitFullscreen?.();
  });

  const selectedGames = () => (board?.games || []).filter((g) => selection.includes(g.id));

  const drawGrid = () => {
    const games = selectedGames();
    const hidden = games.filter((g) => g.status >= 2 && isHidden(gameKey(g.id)));
    if (hidden.length) {
      const btn = h("button", { class: "btn primary", type: "button" }, `Afficher les scores (${f.plural(hidden.length, "match", "matchs")})`);
      btn.addEventListener("click", () => {
        for (const g of hidden) setRevealed(gameKey(g.id), true);
        drawGrid();
      });
      gateBox.replaceChildren(h("div", { class: "spoiler-gate" }, h("p", null, h("strong", null, "Mode anti-spoiler actif. "), "Le mode multi-matchs affiche les scores en direct."), btn));
      grid.replaceChildren();
      return;
    }
    gateBox.replaceChildren();
    if (!games.length) {
      grid.replaceChildren(h("div", { class: "empty-day" }, h("p", null, "Choisis un ou plusieurs matchs ci-dessus pour les suivre côte à côte.")));
      return;
    }
    grid.dataset.count = String(Math.min(games.length, 4));
    grid.replaceChildren(...games.map((g) => panel(g, pbps.get(g.id), previous)));
  };

  const drawChips = () => {
    const options = (board?.games || []).map((g) => ({
      value: g.id,
      label: `${g.away?.tri || "?"} – ${g.home?.tri || "?"}${g.status === 2 ? " (en direct)" : g.status === 3 ? " (terminé)" : ""}`,
    }));
    const group = h("div", { class: "chips", role: "group", "aria-label": "Matchs affichés" });
    for (const o of options) {
      const btn = h("button", { type: "button", class: "chip", "aria-pressed": selection.includes(o.value) ? "true" : "false" }, o.label);
      btn.addEventListener("click", async () => {
        selection = selection.includes(o.value) ? selection.filter((id) => id !== o.value) : [...selection, o.value];
        saveSelection(selection);
        btn.setAttribute("aria-pressed", selection.includes(o.value) ? "true" : "false");
        await refreshPbps();
        drawGrid();
      });
      group.append(btn);
    }
    chipsBox.replaceChildren(options.length ? group : h("p", { class: "note" }, "Aucun match aujourd'hui."));
  };

  const refreshPbps = async () => {
    const started = selectedGames().filter((g) => g.status >= 2);
    await Promise.all(
      started.map(async (g) => {
        if (g.status === 3 && pbps.has(g.id)) return;
        try {
          pbps.set(g.id, (await api(`/game/${g.id}/pbp`, { signal: ctx.signal })).data);
        } catch {
          /* les dernières actions resteront absentes pour ce match */
        }
      })
    );
  };

  const load = async () => {
    const res = await api("/scoreboard", { signal: ctx.signal });
    if (!ctx.active) return;
    previous = board ? scoreMap(board.games) : new Map();
    board = res.data;
    const ids = new Set(board.games.map((g) => g.id));
    if (!selection || !selection.some((id) => ids.has(id))) {
      // Par défaut : tous les matchs en cours (ou rien si aucun n'a commencé).
      selection = board.games.filter((g) => g.status === 2).map((g) => g.id);
    } else {
      selection = selection.filter((id) => ids.has(id));
    }
    saveSelection(selection);
    await refreshPbps();
    if (!ctx.active) return;
    checkScoreboard(board.games);
    updated.textContent = `Mis à jour à ${f.updatedAt(res.meta.fetchedAt)}. Actualisation toutes les 10 secondes.`;
  };

  try {
    await load();
  } catch (err) {
    if (err.name === "AbortError") return;
    wrapper.replaceChildren(errorState(err, () => location.reload()));
    return;
  }

  const live = board.games.filter((g) => g.status === 2).length;
  wrapper.replaceChildren(
    h(
      "div",
      { class: "page-head" },
      h(
        "div",
        null,
        h("h1", { class: "page-title" }, "Multi-matchs"),
        h("p", { class: "page-sub" }, live ? `${f.plural(live, "match en cours", "matchs en cours")} ce soir. Choisis ceux à suivre.` : "Aucun match en cours pour l'instant. Tu peux tout de même choisir des matchs à suivre.")
      ),
      h("div", { class: "toolbar", style: { margin: 0 } }, h("a", { class: "btn", href: "#/" }, "Retour aux matchs"), fullscreenBtn)
    ),
    chipsBox,
    gateBox,
    grid,
    updated
  );
  drawChips();
  drawGrid();

  ctx.every(10000, async () => {
    try {
      const before = (board?.games || []).map((g) => `${g.id}:${g.status}`).join();
      await load();
      if ((board?.games || []).map((g) => `${g.id}:${g.status}`).join() !== before) drawChips();
      drawGrid();
    } catch (err) {
      if (err.name !== "AbortError") updated.textContent = `Actualisation impossible pour l'instant (${err.message}).`;
    }
  });
}
