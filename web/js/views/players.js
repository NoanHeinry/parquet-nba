// Annuaire des joueurs : recherche dans toute l'histoire de la NBA, filtres par équipe, poste, pays.

import { h } from "../dom.js";
import * as f from "../format.js";
import { errorState, headshot, loading, playerCell, segmented, statTable, teamLogo } from "../components.js";
import { normalize, playerIndex } from "../search.js";
import { poster } from "../poster.js";
import { team, teamColor, teams } from "../teams.js";

const PAGE = 60;

// Taille (« 6-10 », pieds-pouces) en centimètres, poids (livres) en kilos.
export function heightCm(hgt) {
  const m = /^(\d+)-(\d+)$/.exec(hgt || "");
  return m ? Math.round(Number(m[1]) * 30.48 + Number(m[2]) * 2.54) : null;
}
const weightKg = (w) => (Number(w) ? Math.round(Number(w) * 0.4536) : null);
const seasonsPlayed = (p) => (p.from && p.to ? Math.max(1, p.to - p.from + 1) : null);
const meters = (cm) => (cm ? `${f.num(cm / 100, 2)} m` : "–");

// Tris possibles : valeur lue sur le joueur et sens par défaut.
const SORTS = {
  pts: { label: "Points par match", get: (p) => p.pts, dir: "desc" },
  reb: { label: "Rebonds par match", get: (p) => p.reb, dir: "desc" },
  ast: { label: "Passes par match", get: (p) => p.ast, dir: "desc" },
  height: { label: "Taille", get: (p) => heightCm(p.height), dir: "desc" },
  weight: { label: "Poids", get: (p) => weightKg(p.weight), dir: "desc" },
  exp: { label: "Expérience", get: seasonsPlayed, dir: "desc" },
  draft: { label: "Rang de draft", get: (p) => p.draftNumber || null, dir: "asc" },
  name: { label: "Nom", get: (p) => `${p.last} ${p.first}`, dir: "asc" },
  recent: { label: "Plus récents", get: (p) => p.to || null, dir: "desc" },
  team: { label: "Équipe", get: (p) => (p.active ? team(p.teamId)?.name || null : null), dir: "asc", hidden: true },
  pos: { label: "Poste", get: (p) => p.pos || null, dir: "asc", hidden: true },
};

const DRAFT = [
  ["", "Tous"],
  ["first", "Premier choix"],
  ["lottery", "Loterie (1 à 14)"],
  ["r1", "Premier tour"],
  ["r2", "Second tour"],
  ["none", "Non draftés"],
];
const EXP = [
  ["", "Toute"],
  ["rookie", "Rookies"],
  ["2-4", "2 à 4 saisons"],
  ["5-9", "5 à 9 saisons"],
  ["10+", "10 saisons et plus"],
];
const HEIGHTS = [
  ["", "Toutes"],
  ["-190", "Moins de 1,90 m"],
  ["190-199", "1,90 à 1,99 m"],
  ["200-209", "2,00 à 2,09 m"],
  ["210-", "2,10 m et plus"],
];

function draftMatch(p, v) {
  if (!v) return true;
  const n = Number(p.draftNumber) || 0;
  const r = Number(p.draftRound) || 0;
  if (v === "none") return !n;
  if (v === "first") return n === 1;
  if (v === "lottery") return n >= 1 && n <= 14 && r === 1;
  if (v === "r1") return r === 1 && n > 0;
  if (v === "r2") return r === 2;
  return true;
}
function expMatch(p, v) {
  if (!v) return true;
  const n = seasonsPlayed(p);
  if (!n) return false;
  if (v === "rookie") return n === 1;
  if (v === "10+") return n >= 10;
  const [a, b] = v.split("-").map(Number);
  return n >= a && n <= b;
}
function heightMatch(p, v) {
  if (!v) return true;
  const cm = heightCm(p.height);
  if (!cm) return false;
  const [a, b] = v.split("-");
  return (!a || cm >= Number(a)) && (!b || cm <= Number(b));
}
function draftText(p) {
  return p.draftNumber ? `${p.draftYear}, ${p.draftNumber === 1 ? "1er" : `${p.draftNumber}e`} choix` : p.draftYear ? "Non drafté" : "–";
}

// Vue tableau : une ligne par joueur, chaque colonne triable.
function tableView(list, state, onSort) {
  const cols = [
    { key: "name", label: "Joueur", align: "l", cls: "sticky", render: (p) => playerCell(p.id, p.full, p.active ? null : [p.from, p.to].filter(Boolean).join("–")) },
    { key: "team", label: "Équipe", align: "l", prio: 2, render: (p) => (p.active && p.teamId ? h("span", { class: "pl-team-cell" }, teamLogo(p.teamId, 20), p.tri) : "–") },
    { key: "pos", label: "Poste", align: "l", prio: 3, render: (p) => f.position(p.pos) || "–" },
    { key: "height", label: "Taille", prio: 3, render: (p) => meters(heightCm(p.height)) },
    { key: "weight", label: "Poids", prio: 3, render: (p) => (weightKg(p.weight) ? `${weightKg(p.weight)} kg` : "–") },
    { key: "exp", label: "Saisons", title: "Saisons en NBA", prio: 3, render: (p) => seasonsPlayed(p) ?? "–" },
    { key: "draft", label: "Draft", prio: 3, render: draftText },
    { key: "pts", label: "PTS", title: "Points par match", prio: 1, render: (p) => (p.pts === null || p.pts === undefined ? "–" : h("b", null, f.num(p.pts))) },
    { key: "reb", label: "REB", title: "Rebonds par match", prio: 1, render: (p) => (p.reb === null || p.reb === undefined ? "–" : f.num(p.reb)) },
    { key: "ast", label: "PD", title: "Passes décisives par match", prio: 1, render: (p) => (p.ast === null || p.ast === undefined ? "–" : f.num(p.ast)) },
  ];
  return statTable(cols, list, { sortable: true, initialSort: { key: state.sort, dir: state.dir }, onSort, caption: "Liste des joueurs" });
}

function card(p) {
  const t = team(p.teamId);
  const color = p.active && t ? teamColor(t.id) : null;
  const years = p.from ? `${p.from}–${p.active ? "auj." : p.to || ""}` : "";
  const sub = p.active ? [t?.fullName || p.tri, f.position(p.pos)].filter(Boolean).join(", ") : [f.position(p.pos), years].filter(Boolean).join(", ");
  return h(
    "a",
    { class: "player-card", href: `#/joueur/${p.id}`, style: { "--team": color } },
    h("div", { class: "pic-wrap" }, headshot(p.id, { cls: "headshot", alt: "" }), p.active && p.jersey ? h("span", { class: "no" }, p.jersey) : null),
    h(
      "div",
      { class: "body" },
      h("div", { class: "nm" }, p.full),
      h("div", { class: "sub" }, sub || "–"),
      p.pts !== null && p.pts !== undefined ? h("div", { class: "stat num" }, `${f.num(p.pts)} pts, ${f.num(p.reb)} reb, ${f.num(p.ast)} pd`, h("span", { class: "muted" }, p.statsTf === "Season" ? " cette saison" : " en carrière")) : null
    )
  );
}

export async function render(ctx) {
  const top = poster(ctx, { kicker: "Actuels et anciens", title: "Joueurs" });
  const body = h("div", null, loading("Chargement de la liste des joueurs…"));
  ctx.outlet.append(top.el, body);
  let players;
  try {
    players = await playerIndex();
  } catch (err) {
    body.replaceChildren(errorState(err, () => location.reload()));
    return;
  }
  if (!ctx.active) return;
  // En tête de page : le meilleur marqueur parmi les joueurs en activité.
  const active = players.filter((p) => p.active);
  const star = active.slice().sort((a, b) => (b.pts || 0) - (a.pts || 0))[0];
  top.update({
    ghost: String(active.length || players.length),
    kicker: `${f.int(active.length)} en activité, ${f.int(players.length)} dans l'histoire`,
    ...(star ? { teamId: star.teamId || null, visual: headshot(star.id, { size: "big", alt: "" }), visualKind: "cutout" } : {}),
  });

  const KEYS = ["q", "scope", "team", "pos", "country", "draft", "exp", "height", "sort", "dir", "view"];
  const params = new URLSearchParams(sessionStorage.getItem("parquet-players") || "");
  const state = {
    q: params.get("q") || "",
    scope: params.get("scope") || "active",
    team: params.get("team") || "",
    pos: params.get("pos") || "",
    country: params.get("country") || "",
    draft: params.get("draft") || "",
    exp: params.get("exp") || "",
    height: params.get("height") || "",
    sort: SORTS[params.get("sort")] ? params.get("sort") : "pts",
    dir: params.get("dir") === "asc" ? "asc" : params.get("dir") === "desc" ? "desc" : null,
    view: params.get("view") === "table" ? "table" : "cards",
    shown: PAGE,
  };
  if (!state.dir) state.dir = SORTS[state.sort].dir;
  const save = () => {
    try {
      sessionStorage.setItem("parquet-players", new URLSearchParams(Object.fromEntries(KEYS.map((k) => [k, state[k]]))).toString());
    } catch {
      /* rien */
    }
  };

  const countries = [...new Set(players.map((p) => p.country).filter(Boolean))].sort((a, b) => f.country(a).localeCompare(f.country(b), "fr"));
  const input = h("input", { type: "search", class: "select", style: { width: "min(420px, 100%)", height: "42px", fontSize: "16px" }, placeholder: "Nom d'un joueur, actuel ou ancien", value: state.q, "aria-label": "Rechercher un joueur" });
  const select = (label, options, key) =>
    h(
      "select",
      { "aria-label": label },
      options.map(([v, l]) => h("option", { value: v, selected: v === state[key] ? true : null }, l))
    );
  const teamSel = select("Équipe", [["", "Toutes"], ...teams().map((t) => [String(t.id), t.fullName])], "team");
  const posSel = select("Poste", [["", "Tous"], ["G", "Arrières"], ["F", "Ailiers"], ["C", "Pivots"]], "pos");
  const countrySel = select(
    "Pays",
    [["", "Tous"], ["France", "France"], ["__intl", "Hors États-Unis"], ...countries.filter((c) => c !== "France").map((c) => [c, f.country(c)])],
    "country"
  );
  const draftSel = select("Draft", DRAFT, "draft");
  const expSel = select("Expérience", EXP, "exp");
  const heightSel = select("Taille", HEIGHTS, "height");
  const sortSel = select("Trier par", Object.entries(SORTS).filter(([, s]) => !s.hidden).map(([k, s]) => [k, s.label]), "sort");
  const dirBtn = h("button", { type: "button", class: "btn square sort-dir", "aria-label": "Inverser l'ordre" });
  const syncDir = () => {
    dirBtn.textContent = state.dir === "asc" ? "↑" : "↓";
    dirBtn.title = state.dir === "asc" ? "Ordre croissant (cliquer pour inverser)" : "Ordre décroissant (cliquer pour inverser)";
    if (sortSel.value !== state.sort) sortSel.value = SORTS[state.sort].hidden ? "" : state.sort;
  };
  const reset = h("button", { type: "button", class: "btn players-reset" }, "Réinitialiser les filtres");

  const count = h("p", { class: "note", "aria-live": "polite", style: { margin: "0 0 12px" } });
  const grid = h("div");
  const more = h("button", { class: "btn", type: "button", style: { marginTop: "18px" } }, "Afficher plus de joueurs");

  const FILTERS = ["team", "pos", "country", "draft", "exp", "height"];
  const filtered = () => {
    const words = normalize(state.q).split(/\s+/).filter(Boolean);
    const list = players.filter((p) => {
      if (state.scope === "active" && !p.active) return false;
      if (state.team && String(p.teamId) !== state.team) return false;
      if (state.pos && !(p.pos || "").includes(state.pos)) return false;
      if (state.country === "__intl" && (!p.country || p.country === "USA")) return false;
      if (state.country && state.country !== "__intl" && p.country !== state.country) return false;
      if (!draftMatch(p, state.draft) || !expMatch(p, state.exp) || !heightMatch(p, state.height)) return false;
      if (words.length && !words.every((w) => p.key.includes(w))) return false;
      return true;
    });
    const { get } = SORTS[state.sort];
    const sign = state.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      // Valeur inconnue : toujours en fin de liste.
      if (va === null || va === undefined) return vb === null || vb === undefined ? (b.pts || 0) - (a.pts || 0) : 1;
      if (vb === null || vb === undefined) return -1;
      const c = typeof va === "string" ? va.localeCompare(vb, "fr") : va - vb;
      return c * sign || (b.pts || 0) - (a.pts || 0);
    });
    return list;
  };

  const draw = () => {
    const list = filtered();
    const active = FILTERS.filter((k) => state[k]).length;
    count.textContent = [list.length ? f.plural(list.length, "joueur", "joueurs") : "", active ? f.plural(active, "filtre actif", "filtres actifs") : ""].filter(Boolean).join(" · ");
    reset.hidden = !active;
    syncDir();
    const shown = list.slice(0, state.shown);
    if (state.view === "table") {
      grid.className = "players-table";
      grid.replaceChildren(
        list.length
          ? tableView(shown, state, (s) => {
              state.sort = s.key;
              state.dir = s.dir;
              state.shown = PAGE;
              draw();
            })
          : ""
      );
    } else {
      grid.className = "players-grid";
      grid.replaceChildren(...shown.map(card));
    }
    if (!list.length) grid.append(h("p", { class: "note" }, "Aucun joueur ne correspond. Essaie l'orthographe anglaise du nom, retire un filtre ou élargis à « Toute l'histoire »."));
    more.hidden = list.length <= state.shown;
    save();
  };

  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = input.value;
      state.shown = PAGE;
      if (state.q && state.scope === "active") {
        // Une recherche par nom porte sur toute l'histoire si rien n'est trouvé chez les actifs.
        const words = normalize(state.q).split(/\s+/).filter(Boolean);
        const anyActive = players.some((p) => p.active && words.every((w) => p.key.includes(w)));
        if (!anyActive) {
          state.scope = "all";
          scopeHolder.replaceChildren(scopeControl());
        }
      }
      draw();
    }, 120);
  });
  const sels = [[teamSel, "team"], [posSel, "pos"], [countrySel, "country"], [draftSel, "draft"], [expSel, "exp"], [heightSel, "height"]];
  for (const [sel, key] of sels) {
    sel.addEventListener("change", () => {
      state[key] = sel.value;
      state.shown = PAGE;
      draw();
    });
  }
  sortSel.addEventListener("change", () => {
    state.sort = sortSel.value;
    state.dir = SORTS[state.sort].dir;
    state.shown = PAGE;
    draw();
  });
  dirBtn.addEventListener("click", () => {
    state.dir = state.dir === "asc" ? "desc" : "asc";
    state.shown = PAGE;
    draw();
  });
  reset.addEventListener("click", () => {
    for (const [sel, key] of sels) {
      state[key] = "";
      sel.value = "";
    }
    state.shown = PAGE;
    draw();
  });
  more.addEventListener("click", () => {
    state.shown += PAGE;
    draw();
  });

  const scopeControl = () =>
    segmented(
      [
        { value: "active", label: "Joueurs actuels" },
        { value: "all", label: "Toute l'histoire" },
      ],
      state.scope,
      (v) => {
        state.scope = v;
        state.shown = PAGE;
        draw();
      },
      "Période"
    );
  const scopeHolder = h("div", null, scopeControl());
  const viewControl = segmented(
    [
      { value: "cards", label: "Cartes" },
      { value: "table", label: "Tableau" },
    ],
    state.view,
    (v) => {
      state.view = v;
      draw();
    },
    "Affichage"
  );

  const field = (label, control) => h("label", { class: "field" }, label, control);
  body.replaceChildren(
    h("div", { class: "toolbar" }, input, scopeHolder, h("div", { class: "players-view" }, viewControl)),
    h(
      "div",
      { class: "toolbar players-filters" },
      field("Équipe actuelle", teamSel),
      field("Poste", posSel),
      field("Pays", countrySel),
      field("Draft", draftSel),
      field("Expérience", expSel),
      field("Taille", heightSel),
      h("div", { class: "field players-sort" }, "Trier par", h("div", { class: "sort-row" }, sortSel, dirBtn)),
      reset
    ),
    count,
    grid,
    more
  );
  draw();
  if (!state.q) input.focus({ preventScroll: true });
}
