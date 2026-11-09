// Briques d'interface réutilisées par les pages.

import { h } from "./dom.js";
import * as f from "./format.js";
import { headshotUrl, isDarkTheme, logoUrl, team, teamPair } from "./teams.js";
import { iconStar } from "./icons.js";
import { gameKey, isRevealed, isSpoilerFree, setRevealed } from "./spoiler.js";

// ------------------------------------------------------------ images

// Logo d'équipe. Sur la surface de l'application, on prend la version adaptée au thème
// (sombre ou clair) ; sur un fond de couleur, le logo est posé sur une pastille claire (plate).
export function teamLogo(id, size = 32, label = "", { plate = false } = {}) {
  const t = team(id);
  if (!id || !t) {
    return h("span", { class: "logo-fallback", style: { width: `${size}px`, height: `${size}px` }, "aria-hidden": "true" }, "?");
  }
  const variant = plate ? "L" : isDarkTheme() ? "D" : "L";
  const img = h("img", {
    class: "logo",
    src: logoUrl(id, variant),
    width: size,
    height: size,
    alt: label || "",
    loading: "lazy",
    referrerpolicy: "no-referrer",
    decoding: "async",
    dataset: { team: id, plate: plate ? "1" : "" },
  });
  img.addEventListener("error", () => {
    if (!img.src.includes("/global/L/")) {
      img.src = logoUrl(id, "L");
      return;
    }
    img.replaceWith(h("span", { class: "logo-fallback", style: { width: `${size}px`, height: `${size}px` } }, t.tri));
  });
  if (!plate) return img;
  return h("span", { class: "logo-plate", style: { width: `${Math.round(size * 1.18)}px`, height: `${Math.round(size * 1.18)}px` } }, img);
}

// Après un changement de thème, les logos posés sur la surface changent de version.
export function refreshLogos() {
  const variant = isDarkTheme() ? "D" : "L";
  for (const img of document.querySelectorAll("img.logo[data-team]")) {
    if (img.dataset.plate) continue;
    img.src = logoUrl(img.dataset.team, variant);
  }
}

export function headshot(id, { size = "small", cls = "headshot", alt = "", width, height } = {}) {
  const img = h("img", {
    class: cls,
    src: headshotUrl(id, size),
    alt,
    loading: "lazy",
    referrerpolicy: "no-referrer",
    decoding: "async",
    width,
    height,
  });
  img.addEventListener("error", () => {
    if (!img.dataset.fallback) {
      img.dataset.fallback = "1";
      img.src = "https://cdn.nba.com/headshots/nba/latest/260x190/fallback.png";
    } else {
      img.style.visibility = "hidden";
    }
  });
  return img;
}

// ------------------------------------------------------------ états

export function loading(text = "Chargement…") {
  return h("div", { class: "state", role: "status" }, h("div", { class: "spinner", "aria-hidden": "true" }), h("p", null, text));
}

export function errorState(err, retry) {
  const message = err?.message || String(err);
  return h(
    "div",
    { class: "state", role: "alert" },
    h("p", null, h("strong", null, "Ces données n'ont pas pu être chargées. "), message),
    retry ? h("button", { class: "btn", type: "button", onclick: retry }, "Réessayer") : null,
    h("p", { class: "note" }, "Si le problème persiste, ouvre ", h("a", { class: "link", href: "#/etat" }, "l'état des sources"), ".")
  );
}

export function staleBanner(meta) {
  if (!meta?.stale) return null;
  return h(
    "div",
    { class: "banner warn", role: "status" },
    h("span", null, `NBA.com ne répond pas pour l'instant. Données affichées : celles de ${f.updatedAt(meta.fetchedAt)}, `,
      "elles se mettront à jour dès que possible.")
  );
}

// Fait apparaître en douceur un contenu qui vient de changer (onglet, filtre, chargement).
// Animation jouée directement (sans retirer puis remettre une classe, ce qui forçait le
// navigateur à remesurer toute la page au milieu du rendu).
export function swapIn(el) {
  if (!el?.animate || document.documentElement.dataset.motion === "reduce") return;
  el.animate(
    [
      { opacity: 0, transform: "translateY(12px)" },
      { opacity: 1, transform: "none" },
    ],
    { duration: 500, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
  );
}

// Charge une section de page de façon indépendante (chargement, erreur, réessai).
export async function section(container, loader, render) {
  container.replaceChildren(loading());
  try {
    const result = await loader();
    container.replaceChildren();
    const out = render(result, container);
    if (out) container.append(...[out].flat(Infinity).filter(Boolean));
    swapIn(container);
  } catch (err) {
    if (err.name === "AbortError") return;
    container.replaceChildren(errorState(err, () => section(container, loader, render)));
  }
}

// ------------------------------------------------------------ contrôles

export function tabs(defs, current, onChange) {
  const bar = h("div", { class: "tabs", role: "tablist" });
  for (const d of defs) {
    const btn = h(
      "button",
      { type: "button", role: "tab", "aria-selected": d.id === current ? "true" : "false", dataset: { tab: d.id } },
      d.label
    );
    btn.addEventListener("click", () => {
      for (const b of bar.querySelectorAll("button")) b.setAttribute("aria-selected", b === btn ? "true" : "false");
      onChange(d.id);
    });
    bar.append(btn);
  }
  return bar;
}

export function segmented(options, value, onChange, label = "") {
  const group = h("div", { class: "segmented", role: "group", "aria-label": label || null });
  for (const o of options) {
    const btn = h("button", { type: "button", "aria-pressed": o.value === value ? "true" : "false" }, o.label);
    btn.addEventListener("click", () => {
      for (const b of group.querySelectorAll("button")) b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      onChange(o.value);
    });
    group.append(btn);
  }
  return group;
}

export function chips(options, value, onChange, label = "") {
  const group = h("div", { class: "chips", role: "group", "aria-label": label || null });
  for (const o of options) {
    const btn = h("button", { type: "button", class: "chip", "aria-pressed": o.value === value ? "true" : "false" }, o.label);
    btn.addEventListener("click", () => {
      for (const b of group.querySelectorAll("button")) b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      onChange(o.value);
    });
    group.append(btn);
  }
  return group;
}

// ------------------------------------------------------------ favoris

const FAV_KEY = "parquet-favorites";
export function favorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function toggleFavorite(teamId) {
  const set = favorites();
  if (set.has(teamId)) set.delete(teamId);
  else set.add(teamId);
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...set]));
  } catch {
    /* stockage indisponible : le favori ne sera pas mémorisé */
  }
  window.dispatchEvent(new CustomEvent("parquet:favoris"));
  return set.has(teamId);
}

// ------------------------------------------------------------ matchs

export { isSpoilerFree } from "./spoiler.js";

function teamName(side) {
  return side?.name || team(side?.id)?.name || "À déterminer";
}

export function gameTile(game, { favs = favorites(), previous } = {}) {
  const status = f.gameStatus(game);
  const started = game.status >= 2;
  const colors = teamPair(game.away?.id, game.home?.id);
  const isFav = favs.has(game.away?.id) || favs.has(game.home?.id);
  const tile = h("a", {
    class: `game-tile${status.live ? " is-live" : ""}${isFav ? " is-fav" : ""}${started ? "" : " is-upcoming"}${isRevealed(gameKey(game.id)) ? " is-revealed" : ""}`,
    href: `#/match/${game.id}`,
    dataset: { gameId: game.id },
    style: { "--away": colors.away, "--home": colors.home },
    "aria-label": `${teamName(game.away)} contre ${teamName(game.home)}, ${status.text}`,
  });

  const winner = game.status === 3 && game.away && game.home ? (game.away.score > game.home.score ? "away" : "home") : null;
  let bumped = false;
  function toggleReveal() {
    setTileRevealed(tile, !tile.classList.contains("is-revealed"));
  }
  const revealOnClick = (el) =>
    el.addEventListener("click", (e) => {
      if (isSpoilerFree()) {
        e.preventDefault();
        e.stopPropagation();
        toggleReveal();
      }
    });

  // Une équipe : logo, sigle, nom et bilan, puis le score (côté extérieur à gauche, domicile à droite).
  const side = (sideKey) => {
    const s = game[sideKey];
    const record = s?.wins !== null && s?.wins !== undefined && s.wins + s.losses > 0 ? `${s.wins}-${s.losses}` : "";
    let score = null;
    if (started) {
      score = h("span", { class: "score num", title: "Cliquer pour révéler ou masquer le score" }, String(s?.score ?? 0));
      revealOnClick(score);
      const prevScore = previous?.get(`${game.id}:${sideKey}`);
      if (prevScore !== undefined && s?.score > prevScore) {
        // Le score qui change roule, et l'écart marqué s'envole au-dessus (+2, +3).
        score.classList.add("bump");
        score.dataset.delta = `+${s.score - prevScore}`;
        bumped = true;
      }
      if (winner === sideKey) score.append(h("i", { class: "winmark", "aria-label": "vainqueur" }));
    }
    return h(
      "div",
      { class: `tile-team ${sideKey}${winner && winner !== sideKey ? " loser" : ""}` },
      teamLogo(s?.id, 46),
      h(
        "div",
        { class: "who" },
        h("span", { class: "tri" }, s?.tri || "?", favs.has(s?.id) ? h("span", { class: "fav-star", title: "Équipe favorite" }, iconStar(true, 11)) : null),
        h("span", { class: "nick" }, teamName(s), record ? ` ${record}` : "")
      ),
      score
    );
  };

  // Au centre : l'état du match, ou l'heure du coup d'envoi.
  let center;
  if (started) {
    center = h(
      "div",
      { class: `tile-status${status.live ? " live" : ""}` },
      status.live ? h("span", { class: "live-dot", "aria-hidden": "true" }) : null,
      status.text
    );
  } else {
    const sameDay = f.sameLocalDay(game.start, game.etDate);
    center = h(
      "div",
      { class: "tile-time" },
      h("strong", { class: "num" }, status.text.includes("confirmer") || !game.start ? "–" : f.clockTime(game.start)),
      sameDay ? null : h("small", null, f.localDayShort(game.start))
    );
  }

  // À droite : les meilleurs joueurs du match, avec leur photo ; avant le match, la salle.
  const people = h("div", { class: "tile-leaders", title: started ? "Cliquer pour révéler le score et les leaders" : null });
  if (started) revealOnClick(people);
  const leaders = game.leaders;
  if (started && leaders) {
    for (const key of ["away", "home"]) {
      const l = leaders[key];
      if (!l) continue;
      people.append(
        h(
          "span",
          { class: "tl-player" },
          headshot(l.id, { alt: "" }),
          h("span", null, h("b", null, l.name), h("small", { class: "num" }, [`${l.pts ?? 0} pts`, `${l.reb ?? 0} reb`, `${l.ast ?? 0} pd`].flatMap((t, i) => [i ? " " : null, h("span", { class: "stat-tok" }, t)]).filter(Boolean)))
        )
      );
    }
  } else if (started && game.topScorers?.length) {
    const t = game.topScorers[0];
    people.append(h("span", { class: "tl-player" }, headshot(t.id, { alt: "" }), h("span", null, h("b", null, t.name), h("small", { class: "num" }, `${t.pts} pts`))));
  } else if (!started && game.arena) {
    people.append(h("span", { class: "tl-place" }, [game.arena, game.arenaCity].filter(Boolean).join(", "), game.tv?.length ? h("small", null, game.tv.join(", ")) : null));
  }

  let revealBtn = null;
  if (started) {
    revealBtn = h("button", { type: "button", class: "tile-reveal-btn", "aria-label": "Révéler le score de ce match" });
    revealBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleReveal();
    });
    // Le bouton doit être dans la tuile pour que syncTileReveal le retrouve.
    queueMicrotask(() => syncTileReveal(tile));
  }
  const label = game.series || f.gameLabel(game);

  tile.append(
    side("away"),
    center,
    side("home"),
    people,
    h("div", { class: "tile-foot-right" }, label ? h("span", { class: "tile-label" }, label) : null, revealBtn)
  );

  if (status.live) {
    const bar = h("div", { class: "progress", "aria-hidden": "true" });
    for (const p of f.gameProgress(game)) bar.append(h("span", { class: p.ot ? "ot" : "" }, h("i", { style: { width: `${p.filled * 100}%` } })));
    tile.append(bar);
  }
  if (bumped) tile.classList.add("has-bump");
  return tile;
}

// Révèle ou masque le score d'une tuile, et s'en souvient pour les actualisations suivantes.
export function setTileRevealed(tile, on) {
  tile.classList.toggle("is-revealed", on);
  if (tile.dataset.gameId) setRevealed(gameKey(tile.dataset.gameId), on);
  syncTileReveal(tile);
}

export function syncTileReveal(tile) {
  const btn = tile.querySelector(".tile-reveal-btn");
  if (!btn) return;
  const isRev = tile.classList.contains("is-revealed");
  btn.textContent = isRev ? "Masquer" : "Révéler";
  btn.setAttribute("aria-label", isRev ? "Masquer le score de ce match" : "Révéler le score de ce match");
  btn.title = isRev ? "Masquer le score" : "Révéler le score";
}

export function scoreMap(games) {
  const map = new Map();
  for (const g of games || []) {
    if (g.status >= 2) {
      map.set(`${g.id}:away`, g.away?.score);
      map.set(`${g.id}:home`, g.home?.score);
    }
  }
  return map;
}

// ------------------------------------------------------------ tableaux

// columns: [{key, label, title, cls, render(row), sort(row) , align:'l'}]
export function statTable(columns, rows, { sortable = false, initialSort = null, rowClass, caption } = {}) {
  const table = h("table", { class: "stat-table" });
  if (caption) table.append(h("caption", { class: "visually-hidden" }, caption));
  const thead = h("thead");
  const tbody = h("tbody");
  table.append(thead, tbody);
  let sort = initialSort;

  const renderBody = () => {
    let list = rows.slice();
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const get = col?.sort || ((r) => r[sort.key]);
      list.sort((a, b) => {
        const va = get(a);
        const vb = get(b);
        if (va === vb) return 0;
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        return (va < vb ? -1 : 1) * (sort.dir === "asc" ? 1 : -1);
      });
    }
    tbody.replaceChildren(
      ...list.map((row) => {
        if (row.__group) return h("tr", { class: "group" }, h("td", { colspan: columns.length }, row.__group));
        const tr = h("tr", { class: rowClass ? rowClass(row) || "" : "" });
        for (const c of columns) {
          const content = c.render ? c.render(row) : row[c.key];
          tr.append(h("td", { class: [c.align === "l" ? "l" : "", c.cls || ""].join(" ").trim() || null }, content ?? "–"));
        }
        return tr;
      })
    );
  };

  const headRow = h("tr");
  for (const c of columns) {
    const th = h(
      "th",
      { scope: "col", class: [c.align === "l" ? "l" : "", c.cls || ""].join(" ").trim() || null, title: c.title || null },
      c.label
    );
    if (sortable && c.sortable !== false && !rows.some((r) => r.__group)) {
      th.dataset.sort = c.key;
      th.tabIndex = 0;
      const activate = () => {
        sort = sort && sort.key === c.key ? { key: c.key, dir: sort.dir === "desc" ? "asc" : "desc" } : { key: c.key, dir: c.align === "l" ? "asc" : "desc" };
        for (const other of headRow.children) other.removeAttribute("aria-sort");
        th.setAttribute("aria-sort", sort.dir === "asc" ? "ascending" : "descending");
        renderBody();
      };
      th.addEventListener("click", activate);
      th.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
      if (sort && sort.key === c.key) th.setAttribute("aria-sort", sort.dir === "asc" ? "ascending" : "descending");
    }
    headRow.append(th);
  }
  thead.append(headRow);
  renderBody();
  return h("div", { class: "table-wrap" }, table);
}

export function playerCell(id, name, sub, { link = true } = {}) {
  return h(
    "div",
    { class: "player-cell" },
    headshot(id, { cls: "headshot pic", alt: "" }),
    h(
      "div",
      null,
      link && id ? h("a", { class: "nm", href: `#/joueur/${id}` }, name) : h("span", { class: "nm" }, name),
      sub ? h("div", { class: "sub" }, sub) : null
    )
  );
}

export function wl(result) {
  if (result === "W") return h("span", { class: "wl w", title: "Victoire" }, "V");
  if (result === "L") return h("span", { class: "wl l", title: "Défaite" }, "D");
  return h("span", { class: "muted" }, "–");
}
