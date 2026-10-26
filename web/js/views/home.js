// Page d'accueil : les matchs d'une journée NBA, en direct quand il y en a.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { errorState, favorites, gameTile, loading, scoreMap, section, setTileRevealed, staleBanner, teamLogo } from "../components.js";
import { checkScoreboard } from "../notifications.js";
import { createRecap } from "./recap.js";
import { iconGrid } from "../icons.js";
import { team } from "../teams.js";

function refreshDelay(data) {
  if (!data) return 60000;
  const games = data.games || [];
  if (games.some((g) => g.status === 2)) return 15000;
  const now = Date.now();
  if (games.some((g) => g.status === 1 && g.start && new Date(g.start).getTime() - now < 30 * 60000)) return 30000;
  return data.isToday ? 120000 : 600000;
}

function subtitle(data) {
  const games = data.games;
  if (!games.length) return "Pas de match ce jour-là.";
  const kinds = new Set(games.map((g) => g.kind));
  const label = kinds.size === 1 && kinds.has("pre") ? " de présaison" : kinds.size === 1 && kinds.has("playoffs") ? " de playoffs" : "";
  const starts = games.map((g) => g.start).filter(Boolean).sort();
  let when = "";
  if (starts.length) {
    const first = starts[0];
    const last = starts.at(-1);
    const fmt = (iso) => (f.sameLocalDay(iso, data.date) ? f.clockTime(iso) : `${f.localWeekday(iso)} ${f.clockTime(iso)}`);
    when = first === last ? `, coup d'envoi ${fmt(first)}` : `, coups d'envoi entre ${fmt(first)} et ${fmt(last)}`;
    when += " (heure de Paris)";
  }
  return `${f.plural(games.length, "match", "matchs")}${label}${when}.`;
}

export async function render(ctx) {
  const requested = ctx.params[0] || null;
  const layout = h("div", { class: "matches-layout" });
  const mainCol = h("section", { "aria-labelledby": "day-title" });
  const rail = h("aside", { class: "rail", "aria-label": "Classement et leaders" });
  layout.append(mainCol, rail);
  ctx.outlet.append(layout);
  mainCol.append(loading("Chargement des matchs…"));

  let previous = new Map();
  let last = null;
  const recap = createRecap(ctx);
  const updatedLine = h("p", { class: "updated", "aria-live": "polite" });

  const draw = (data, meta) => {
    const favs = favorites();
    const isFav = (g) => (favs.has(g.away?.id) || favs.has(g.home?.id) ? 1 : 0);
    const games = [...data.games].sort((a, b) => isFav(b) - isFav(a));
    const live = games.filter((g) => g.status === 2).length;

    const dateInput = h("input", { type: "date", value: data.date, "aria-label": "Choisir une date" });
    dateInput.addEventListener("change", () => {
      if (dateInput.value) location.hash = `#/matchs/${dateInput.value}`;
    });

    const toggleAllBtn = h(
      "button",
      {
        class: "btn spoiler-all-btn",
        type: "button",
        "aria-label": "Révéler tous les scores de cette journée",
        title: "Révéler tous les scores",
      },
      "Révéler tout"
    );
    const startedTiles = () => [...mainCol.querySelectorAll(".game-tile")].filter((el) => el.querySelector(".tile-reveal-btn"));
    const syncAllBtn = () => {
      const tiles = startedTiles();
      const allRev = tiles.length > 0 && tiles.every((el) => el.classList.contains("is-revealed"));
      toggleAllBtn.textContent = allRev ? "Masquer tout" : "Révéler tout";
      toggleAllBtn.title = allRev ? "Masquer tous les scores" : "Révéler tous les scores";
    };
    toggleAllBtn.addEventListener("click", () => {
      const tiles = startedTiles();
      const allRev = tiles.length > 0 && tiles.every((el) => el.classList.contains("is-revealed"));
      for (const el of tiles) setTileRevealed(el, !allRev);
      syncAllBtn();
    });
    queueMicrotask(syncAllBtn);

    const nav = h(
      "div",
      { class: "day-nav" },
      h("a", { class: "btn square", href: data.prev ? `#/matchs/${data.prev}` : "#/", "aria-disabled": data.prev ? null : "true", "aria-label": "Journée précédente", title: data.prev ? f.dayShort(data.prev) : "" }, "‹"),
      data.isToday ? null : h("a", { class: "btn", href: "#/" }, "Aujourd'hui"),
      dateInput,
      h("a", { class: "btn square", href: data.next ? `#/matchs/${data.next}` : "#/", "aria-disabled": data.next ? null : "true", "aria-label": "Journée suivante", title: data.next ? f.dayShort(data.next) : "" }, "›"),
      games.some((g) => g.status >= 2) ? toggleAllBtn : null
    );

    const head = h(
      "div",
      { class: "day-head" },
      h("div", null, h("h1", { class: "page-title", id: "day-title" }, f.dayTitle(data.date)), h("p", { class: "page-sub" }, subtitle(data))),
      nav
    );

    let content;
    if (games.length) {
      content = h("div", { class: "games-grid" }, games.map((g) => gameTile(g, { favs, previous })));
    } else {
      content = h(
        "div",
        { class: "empty-day" },
        h("p", null, "Aucun match n'est programmé ce jour-là."),
        data.next ? h("a", { class: "btn primary", href: `#/matchs/${data.next}` }, `Voir la journée suivante, ${f.dayShort(data.next)}`) : null
      );
    }

    updatedLine.textContent = live
      ? `Mis à jour à ${f.updatedAt(meta.fetchedAt)}. Les scores se rafraîchissent toutes les 15 secondes.`
      : `Mis à jour à ${f.updatedAt(meta.fetchedAt)}.`;

    const liveStrip = live
      ? h(
          "div",
          { class: "live-row" },
          h("p", { class: "live-strip" }, h("span", { class: "live-dot", "aria-hidden": "true" }), live > 1 ? `${live} matchs en cours` : "1 match en cours"),
          h("a", { class: "btn", href: "#/multi" }, iconGrid(15), "Mode multi-matchs")
        )
      : "";

    mainCol.replaceChildren(head, staleBanner(meta) || "", liveStrip, recap.el, content, updatedLine);
    recap.update(data);
  };

  const load = async () => {
    const { data, meta } = await api(`/scoreboard${requested ? `?date=${requested}` : ""}`, { signal: ctx.signal });
    if (!ctx.active) return;
    draw(data, meta);
    previous = scoreMap(data.games);
    last = data;
    checkScoreboard(data.games);
  };

  try {
    await load();
  } catch (err) {
    if (err.name === "AbortError") return;
    mainCol.replaceChildren(errorState(err, () => location.reload()));
    renderRail(rail, ctx);
    return;
  }

  ctx.every(
    () => refreshDelay(last),
    async () => {
      try {
        await load();
      } catch (err) {
        if (err.name !== "AbortError") updatedLine.textContent = `Actualisation impossible pour l'instant (${err.message}). Nouvel essai dans un moment.`;
      }
    }
  );
  renderRail(rail, ctx);
}

function renderRail(rail, ctx) {
  const standingsBox = h("div");
  const leadersBox = h("div");
  rail.append(
    h("section", null, h("h2", null, "Classement", h("a", { href: "#/classement" }, "Tout voir")), standingsBox),
    h("section", null, h("h2", null, "Meilleurs marqueurs", h("a", { href: "#/leaders" }, "Tous les leaders")), leadersBox)
  );

  section(
    standingsBox,
    () => api("/standings", { signal: ctx.signal }),
    ({ data }) => {
      const out = [];
      if (data.fallback) out.push(h("p", { class: "note", style: { margin: "0 0 8px" } }, `Bilan final ${data.season}, la nouvelle saison n'a pas encore commencé.`));
      for (const conf of ["East", "West"]) {
        const rows = data.rows.filter((r) => r.conf === conf).slice(0, 6);
        out.push(h("p", { class: "mini-sub" }, conf === "East" ? "Conférence Est" : "Conférence Ouest"));
        out.push(
          h(
            "table",
            { class: "mini-table num" },
            h(
              "tbody",
              null,
              rows.map((r) =>
                h(
                  "tr",
                  null,
                  h("td", null, r.rank),
                  h("td", null, h("a", { class: "team-cell", href: `#/equipe/${r.teamId}` }, teamLogo(r.teamId, 20), team(r.teamId)?.name || r.name)),
                  h("td", { class: "r" }, `${r.w}-${r.l}`)
                )
              )
            )
          )
        );
      }
      return out;
    }
  );

  section(
    leadersBox,
    () => api("/leaders", { signal: ctx.signal }),
    ({ data }) => {
      const rows = (data.boards.pts || []).slice(0, 5);
      return [
        data.fallback ? h("p", { class: "note", style: { margin: "0 0 8px" } }, `Saison ${data.season}.`) : null,
        h(
          "table",
          { class: "mini-table num" },
          h(
            "tbody",
            null,
            rows.map((r, i) =>
              h(
                "tr",
                null,
                h("td", null, i + 1),
                h("td", null, h("a", { class: "team-cell", href: `#/joueur/${r.id}` }, teamLogo(r.teamId, 20), r.name)),
                h("td", { class: "r" }, f.num(r.value))
              )
            )
          )
        ),
      ];
    }
  );
}
