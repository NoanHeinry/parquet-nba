// Recherche globale (en-tête) : joueurs de toutes les époques et équipes.

import { api, once } from "./api.js";
import { h } from "./dom.js";
import { teamLogo, headshot } from "./components.js";
import { teams } from "./teams.js";

export function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Index des joueurs, chargé une fois puis gardé en mémoire.
export function playerIndex() {
  return once("player-index", async () => {
    const { data } = await api("/players/index");
    const fields = data.fields;
    const players = data.rows.map((row) => {
      const p = Object.fromEntries(fields.map((f, i) => [f, row[i]]));
      p.full = `${p.first} ${p.last}`.trim();
      p.key = normalize(p.full);
      return p;
    });
    return players;
  });
}

export function searchPlayers(players, query, limit = 8) {
  const q = normalize(query);
  if (!q) return [];
  const words = q.split(/\s+/);
  const scored = [];
  for (const p of players) {
    if (!words.every((w) => p.key.includes(w))) continue;
    let score = 0;
    if (p.key.startsWith(q)) score += 6;
    if (normalize(p.last).startsWith(words.at(-1))) score += 4;
    if (p.active) score += 5;
    score += Math.min(4, (p.pts || 0) / 7);
    scored.push([score, p]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map(([, p]) => p);
}

export function searchTeams(query, limit = 4) {
  const q = normalize(query);
  if (!q) return [];
  return teams()
    .filter((t) => [t.fullName, t.name, t.city, t.tri, t.wiki].some((v) => normalize(v).includes(q)))
    .slice(0, limit);
}

export function initGlobalSearch() {
  const input = document.getElementById("global-search");
  const panel = document.getElementById("search-results");
  let items = [];
  let active = -1;
  let players = null;

  const close = () => {
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    active = -1;
  };

  const go = (href) => {
    close();
    input.value = "";
    input.blur();
    location.hash = href;
  };

  const setActive = (i) => {
    active = i;
    items.forEach((el, k) => el.setAttribute("aria-selected", k === i ? "true" : "false"));
    if (items[i]) items[i].scrollIntoView({ block: "nearest" });
  };

  const render = () => {
    const q = input.value;
    if (!normalize(q)) return close();
    const teamHits = searchTeams(q);
    const playerHits = players ? searchPlayers(players, q) : [];
    const rows = [];
    items = [];
    const option = (href, icon, label, sub) => {
      const el = h("div", { class: "search-item", role: "option", "aria-selected": "false", dataset: { href } }, icon, h("div", null, h("div", null, label), sub ? h("div", { class: "sub" }, sub) : null));
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        go(href);
      });
      items.push(el);
      return el;
    };
    if (teamHits.length) {
      rows.push(h("div", { class: "search-group" }, "Équipes"));
      for (const t of teamHits) rows.push(option(`/equipe/${t.id}`, teamLogo(t.id, 28), t.fullName, `${t.confFr === "Est" ? "Conférence Est" : "Conférence Ouest"}, division ${t.divFr}`));
    }
    if (playerHits.length) {
      rows.push(h("div", { class: "search-group" }, "Joueurs"));
      for (const p of playerHits) {
        const years = p.from ? `${p.from}–${p.active ? "auj." : p.to || ""}` : "";
        const sub = [p.active && p.tri ? p.tri : null, years].filter(Boolean).join(", ");
        const pic = headshot(p.id, { cls: "headshot", alt: "" });
        pic.style.width = "38px";
        pic.style.height = "28px";
        pic.style.borderRadius = "4px";
        rows.push(option(`/joueur/${p.id}`, pic, p.full, sub));
      }
    }
    if (!players) rows.push(h("div", { class: "search-empty" }, "Chargement de la liste des joueurs…"));
    else if (!teamHits.length && !playerHits.length) rows.push(h("div", { class: "search-empty" }, `Aucun résultat pour « ${q} ».`));
    panel.replaceChildren(...rows);
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    setActive(items.length ? 0 : -1);
  };

  input.addEventListener("focus", () => {
    if (!players) {
      playerIndex()
        .then((list) => {
          players = list;
          if (document.activeElement === input) render();
        })
        .catch(() => {
          players = [];
        });
    }
  });
  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length) setActive((active + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length) setActive((active - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      if (items[active]) {
        e.preventDefault();
        go(items[active].dataset.href);
      }
    } else if (e.key === "Escape") {
      close();
      input.blur();
    }
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      input.focus();
    }
  });
}
