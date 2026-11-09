// Page d'accueil : la scène des joueurs du match, puis les matchs d'une journée NBA (en direct
// quand il y en a), les chiffres de la nuit, le classement et les meilleurs marqueurs.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { errorState, favorites, gameTile, headshot, loading, scoreMap, section, setTileRevealed, staleBanner, teamLogo } from "../components.js";
import { gameKey, isRevealed, isSpoilerFree } from "../spoiler.js";
import { checkScoreboard } from "../notifications.js";
import { createRecap } from "./recap.js";
import { createStage } from "./stage.js";
import { countUp, reducedMotion, reveal, sectionIndex } from "../scroll.js";
import { createQuizTeaser } from "./quiz.js";
import { iconGrid } from "../icons.js";
import { team } from "../teams.js";

// Un titre découpé en mots, pour les faire monter l'un après l'autre.
function words(text) {
  return text.split(" ").flatMap((w, i) => [i ? " " : "", h("span", { class: "w", style: { "--i": i } }, h("span", null, w))]);
}

// Le bandeau des scores : un élément par match (sans score en mode anti-spoiler).
function tickerItems(games) {
  const hideAll = isSpoilerFree();
  return games.map((g) => {
    const hidden = hideAll && !isRevealed(gameKey(g.id));
    const a = g.away || {};
    const b = g.home || {};
    let mid;
    if (g.status === 1) mid = h("span", { class: "tk-time" }, g.start ? f.clockTime(g.start) : "–");
    else if (hidden) mid = h("span", { class: "tk-time" }, g.status === 2 ? "en cours" : "terminé");
    else {
      const loser = g.status === 3 ? (a.score > b.score ? "home" : "away") : null;
      mid = h(
        "span",
        { class: "tk-score" },
        h("b", { class: loser === "away" ? "lo" : null }, String(a.score ?? 0)),
        "–",
        h("b", { class: loser === "home" ? "lo" : null }, String(b.score ?? 0))
      );
    }
    const el = h(
      "span",
      { class: `tk-item${g.status === 2 ? " is-live" : ""}` },
      g.status === 2 ? h("i", { class: "live-dot" }) : null,
      teamLogo(a.id, 34),
      h("span", { class: "tk-tri" }, a.tri || "?"),
      mid,
      h("span", { class: "tk-tri" }, b.tri || "?"),
      teamLogo(b.id, 34),
      h("span", { class: "tk-sep" }, "/")
    );
    return { el, text: `${g.id}:${g.status}:${hidden ? "" : `${a.score}-${b.score}`}` };
  });
}

function refreshDelay(data) {
  if (!data) return 60000;
  const games = data.games || [];
  if (games.some((g) => g.status === 2)) return 15000;
  const now = Date.now();
  if (games.some((g) => g.status === 1 && g.start && new Date(g.start).getTime() - now < 30 * 60000)) return 30000;
  return data.isToday ? 120000 : 600000;
}

export async function render(ctx) {
  const requested = ctx.params[0] || null;
  document.body.classList.add("is-home");
  ctx.onCleanup(() => document.body.classList.remove("is-home"));

  // La page : la scène des joueurs du match, puis les matchs, les chiffres de la nuit,
  // le classement et les meilleurs marqueurs. Un sommaire numéroté suit la lecture à droite.
  const stage = createStage(ctx);
  const recap = createRecap(ctx);
  const gamesSec = h("section", { class: "home-sec home-games", id: "matchs", "aria-labelledby": "day-title" });
  const nightSec = h("section", { class: "home-sec home-night", id: "chiffres", "aria-label": "La nuit en chiffres" }, recap.el);
  const tablesSec = h("section", { class: "home-sec home-tables", id: "tableaux", "aria-label": "Classement et leaders" });
  const teaser = createQuizTeaser(ctx);
  const quizSec = h("section", { class: "home-sec home-quiz", id: "jeu", "aria-label": "Le jeu Qui est-ce ?" }, teaser.el);
  const ticker = h("div", { class: "ticker", "aria-hidden": "true" }, h("div", { class: "ticker-track" }));
  ctx.outlet.append(stage.el, ticker, h("div", { class: "home-body" }, gamesSec, nightSec, tablesSec, quizSec));
  // Bandeau défilant et scène en pause quand ils sont hors de l'écran : plus aucune animation
  // ne tourne pour rien pendant qu'on lit le reste de la page.
  if ("IntersectionObserver" in window) {
    const offscreen = new IntersectionObserver((entries) => {
      for (const e of entries) e.target.classList.toggle("is-offscreen", !e.isIntersecting);
    });
    offscreen.observe(ticker);
    offscreen.observe(stage.el);
    ctx.onCleanup(() => offscreen.disconnect());
  }
  gamesSec.append(loading("Chargement des matchs…"));

  const scroller = ctx.scroller;
  const index = sectionIndex(
    ctx,
    [
      { el: stage.el, label: "Joueurs du match", dark: true },
      { el: gamesSec, label: "Matchs" },
      { el: nightSec, label: "La nuit en chiffres" },
      { el: tablesSec, label: "Classement" },
      { el: quizSec, label: "Le jeu" },
    ],
    scroller
  );
  // Les sections glissent en place en arrivant ; les chiffres de la nuit comptent à ce moment-là.
  reveal(ctx, [gamesSec, nightSec, tablesSec, quizSec], (el) => {
    if (el === nightSec) for (const b of el.querySelectorAll(".nn-big")) countUp(b, b.textContent, 250);
    if (el === quizSec) teaser.show();
  });
  if (reducedMotion()) teaser.show();

  // Chaque ligne de match apparaît quand elle arrive à l'écran ; une ligne déjà vue reste en
  // place quand les scores s'actualisent.
  const seen = new Set();
  const rowIO = reducedMotion()
    ? null
    : new IntersectionObserver(
        (entries) => {
          let k = 0;
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            const tile = e.target;
            rowIO.unobserve(tile);
            seen.add(tile.dataset.gameId);
            // Les lignes qui arrivent ensemble montent l'une après l'autre.
            tile.style.transitionDelay = `${k++ * 70}ms`;
            tile.classList.add("row-in");
            setTimeout(() => (tile.style.transitionDelay = ""), 1600);
          }
        },
        { rootMargin: "0px 0px -8% 0px" }
      );
  ctx.onCleanup(() => rowIO?.disconnect());
  let tickerSig = "";

  let previous = new Map();
  let last = null;
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
    const startedTiles = () => [...gamesSec.querySelectorAll(".game-tile")].filter((el) => el.querySelector(".tile-reveal-btn"));
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

    const counts = [
      games.length ? f.plural(games.length, "match", "matchs") : null,
      live ? `${live} en direct` : null,
    ].filter(Boolean);
    const head = h(
      "div",
      { class: "day-head" },
      h("div", null, h("p", { class: "home-kicker" }, counts.join(" · ") || "Matchs"), h("h1", { class: "page-title", id: "day-title" }, words(f.dayTitle(data.date)))),
      nav
    );

    let content;
    if (games.length) {
      content = h("div", { class: "games-grid games-list" }, games.map((g, i) => {
        const tile = gameTile(g, { favs, previous });
        tile.style.setProperty("--i", i);
        return tile;
      }));
    } else {
      content = h(
        "div",
        { class: "empty-day" },
        h("p", null, "Aucun match n'est programmé ce jour-là."),
        data.next ? h("a", { class: "btn primary", href: `#/matchs/${data.next}` }, `Voir la journée suivante, ${f.dayShort(data.next)}`) : null
      );
    }

    updatedLine.textContent = `Mis à jour à ${f.updatedAt(meta.fetchedAt)}`;

    const liveStrip = live
      ? h(
          "div",
          { class: "live-row" },
          h("p", { class: "live-strip" }, h("span", { class: "live-dot", "aria-hidden": "true" }), live > 1 ? `${live} matchs en cours` : "1 match en cours"),
          h("a", { class: "btn", href: "#/multi" }, iconGrid(15), "Mode multi-matchs")
        )
      : "";

    gamesSec.replaceChildren(head, staleBanner(meta) || "", liveStrip, content, updatedLine);
    for (const tile of gamesSec.querySelectorAll(".game-tile")) {
      if (!rowIO || seen.has(tile.dataset.gameId)) tile.classList.add("row-in");
      else rowIO.observe(tile);
    }
    const sig = tickerItems(games).map((it) => it.text).join("|");
    if (sig !== tickerSig) {
      tickerSig = sig;
      const items = tickerItems(games);
      const once = items.map((it) => it.el);
      ticker.firstChild.replaceChildren(...once, ...items.map((it) => it.el.cloneNode(true)));
      // Le bandeau défile en continu (animation CSS) ; sa vitesse reste la même quel que soit
      // le nombre de matchs.
      ticker.style.setProperty("--tk-dur", `${Math.max(20, items.length * 6)}s`);
      ticker.hidden = !items.length;
    }
    stage.update(data);
    recap.update(data).then(() => {
      nightSec.hidden = recap.el.hidden;
      index.refresh();
    });
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
    stage.el.hidden = true;
    nightSec.hidden = true;
    gamesSec.replaceChildren(errorState(err, () => location.reload()));
    renderTables(tablesSec, ctx);
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
  renderTables(tablesSec, ctx);
}

// Bas de page : les deux conférences et les meilleurs marqueurs, côte à côte.
function renderTables(box, ctx) {
  const east = h("div", { class: "ht-col" });
  const west = h("div", { class: "ht-col" });
  const scorers = h("div", { class: "ht-col" });
  box.append(h("div", { class: "home-tables-grid" }, east, west, scorers));

  // Une seule requête pour les deux conférences (refaite si on réessaie après une erreur).
  let pending = null;
  const standings = () =>
    (pending ||= api("/standings", { signal: ctx.signal }).catch((err) => {
      pending = null;
      throw err;
    }));
  for (const [col, conf, label] of [
    [east, "East", "Conférence Est"],
    [west, "West", "Conférence Ouest"],
  ]) {
    section(
      col,
      standings,
      ({ data }) => [
        h("p", { class: "home-kicker" }, label, h("a", { href: "#/classement" }, data.fallback ? `Bilan ${data.season}` : "Classement complet")),
        h(
          "ol",
          { class: "ht-list" },
          data.rows
            .filter((r) => r.conf === conf)
            .slice(0, 8)
            .map((r) =>
              h(
                "li",
                null,
                h(
                  "a",
                  { href: `#/equipe/${r.teamId}` },
                  h("span", { class: "ht-rank num" }, r.rank),
                  teamLogo(r.teamId, 28),
                  h("span", { class: "ht-name" }, team(r.teamId)?.name || r.name),
                  h("span", { class: "ht-val num" }, `${r.w}-${r.l}`)
                )
              )
            )
        ),
      ]
    );
  }

  section(
    scorers,
    () => api("/leaders", { signal: ctx.signal }),
    ({ data }) => [
      h("p", { class: "home-kicker" }, "Meilleurs marqueurs", h("a", { href: "#/leaders" }, data.fallback ? `Saison ${data.season}` : "Tous les leaders")),
      h(
        "ol",
        { class: "ht-list players" },
        (data.boards.pts || []).slice(0, 6).map((r, i) =>
          h(
            "li",
            null,
            h(
              "a",
              { href: `#/joueur/${r.id}` },
              h("span", { class: "ht-rank num" }, i + 1),
              headshot(r.id, { alt: "" }),
              h("span", { class: "ht-name" }, r.name, h("small", null, team(r.teamId)?.name || "")),
              h("span", { class: "ht-val num" }, f.num(r.value))
            )
          )
        )
      ),
    ]
  );
}
