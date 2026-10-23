// Briques d'interface réutilisées par les pages.

import { h } from "./dom.js";
import * as f from "./format.js";
import { headshotUrl, isDarkTheme, logoUrl, team, teamPair } from "./teams.js";

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

// Charge une section de page de façon indépendante (chargement, erreur, réessai).
export async function section(container, loader, render) {
  container.replaceChildren(loading());
  try {
    const result = await loader();
    container.replaceChildren();
    const out = render(result, container);
    if (out) container.append(...[out].flat().filter(Boolean));
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
  return set.has(teamId);
}

// ------------------------------------------------------------ matchs

export function isSpoilerFree() {
  return document.documentElement.dataset.spoiler === "1";
}

function teamName(side) {
  return side?.name || team(side?.id)?.name || "À déterminer";
}

export function gameTile(game, { favs = favorites(), previous } = {}) {
  const status = f.gameStatus(game);
  const started = game.status >= 2;
  const colors = teamPair(game.away?.id, game.home?.id);
  const isFav = favs.has(game.away?.id) || favs.has(game.home?.id);
  const tile = h("a", {
    class: `game-tile${status.live ? " is-live" : ""}${isFav ? " is-fav" : ""}`,
    href: `#/match/${game.id}`,
    style: { "--away": colors.away, "--home": colors.home },
    "aria-label": `${teamName(game.away)} contre ${teamName(game.home)}, ${status.text}`,
  });

  const winner = game.status === 3 && game.away && game.home ? (game.away.score > game.home.score ? "away" : "home") : null;

  const row = (sideKey) => {
    const side = game[sideKey];
    const prevScore = previous?.get(`${game.id}:${sideKey}`);
    const score = h("span", { class: "score", title: "Cliquer pour révéler ou masquer le score" }, started ? String(side?.score ?? 0) : "");
    if (started) {
      score.addEventListener("click", (e) => {
        if (isSpoilerFree()) {
          e.preventDefault();
          e.stopPropagation();
          tile.classList.toggle("is-revealed");
          syncRevealBtn();
        }
      });
    }
    if (started && prevScore !== undefined && side?.score > prevScore) score.classList.add("bump");
    if (winner === sideKey) score.append(h("i", { class: "winmark", "aria-label": "vainqueur" }));
    const record = side?.wins !== null && side?.wins !== undefined && (side.wins + side.losses > 0) ? `${side.wins}-${side.losses}` : "";
    return h(
      "div",
      { class: `tile-team${winner && winner !== sideKey ? " loser" : ""}` },
      teamLogo(side?.id, 34),
      h(
        "div",
        { class: "who" },
        h("span", { class: "tri" }, side?.tri || "?", favs.has(side?.id) ? h("span", { class: "fav-star", title: "Équipe favorite" }, " ★") : null),
        h("span", { class: "nick" }, teamName(side), record ? `, ${record}` : "")
      ),
      started ? score : null
    );
  };

  if (started) {
    tile.append(row("away"), row("home"));
  } else {
    const time = game.start ? f.clockTime(game.start) : "–";
    const sameDay = f.sameLocalDay(game.start, game.etDate);
    tile.append(
      h(
        "div",
        { class: "tile-upcoming" },
        row("away"),
        h("div", { class: "time" }, status.text.includes("confirmer") ? "–" : time, h("small", null, sameDay ? "heure de Paris" : f.localDayShort(game.start))),
        row("home")
      )
    );
  }

  if (status.live) {
    const bar = h("div", { class: "progress", "aria-hidden": "true" });
    for (const p of f.gameProgress(game)) bar.append(h("span", { class: p.ot ? "ot" : "" }, h("i", { style: { width: `${p.filled * 100}%` } })));
    tile.append(bar);
  }

  // Meilleurs marqueurs (match commencé) ou lieu et diffusion (match à venir).
  const extra = h("div", { class: "tile-leaders", title: started ? "Cliquer pour révéler le score et les leaders" : null });
  if (started) {
    extra.addEventListener("click", (e) => {
      if (isSpoilerFree()) {
        e.preventDefault();
        e.stopPropagation();
        tile.classList.toggle("is-revealed");
        syncRevealBtn();
      }
    });
  }
  const leaders = game.leaders;
  if (started && leaders) {
    for (const key of ["away", "home"]) {
      const l = leaders[key];
      if (l) extra.append(h("span", null, h("b", null, l.name), ` ${l.pts ?? 0} pts, ${l.reb ?? 0} reb, ${l.ast ?? 0} pd`));
    }
  } else if (started && game.topScorers?.length) {
    const t = game.topScorers[0];
    extra.append(h("span", null, "Meilleur marqueur : ", h("b", null, t.name), ` ${t.pts} pts`));
  } else if (!started) {
    if (game.arena) extra.append(h("span", null, [game.arena, game.arenaCity].filter(Boolean).join(", ")));
    if (game.tv?.length) extra.append(h("span", null, `TV US : ${game.tv.join(", ")}`));
  }
  if (extra.childNodes.length) tile.append(extra);

  let revealBtn = null;
  const syncRevealBtn = () => {
    if (!revealBtn) return;
    const isRev = tile.classList.contains("is-revealed");
    revealBtn.textContent = isRev ? "Masquer" : "Révéler";
    revealBtn.setAttribute("aria-label", isRev ? "Masquer le score de ce match" : "Révéler le score de ce match");
    revealBtn.title = isRev ? "Masquer le score" : "Révéler le score";
  };

  if (started) {
    revealBtn = h("button", {
      type: "button",
      class: "tile-reveal-btn",
      "aria-label": "Révéler le score de ce match",
    });
    syncRevealBtn();
    revealBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      tile.classList.toggle("is-revealed");
      syncRevealBtn();
    });
  }

  const footRight = h(
    "div",
    { class: "tile-foot-right" },
    revealBtn,
    h("span", { class: "tile-label" }, game.series || f.gameLabel(game))
  );

  tile.append(
    h(
      "div",
      { class: "tile-foot" },
      h("span", { class: `tile-status${status.live ? " live" : ""}` }, status.live ? h("span", { class: "live-dot", "aria-hidden": "true" }) : null, started || status.text.includes("confirmer") || game.postponed ? status.text : "À venir"),
      footRight
    )
  );
  return tile;
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
