// Annuaire des joueurs : recherche dans toute l'histoire de la NBA, filtres par équipe, poste, pays.

import { h } from "../dom.js";
import * as f from "../format.js";
import { errorState, headshot, loading, segmented } from "../components.js";
import { normalize, playerIndex } from "../search.js";
import { team, teamColor, teams } from "../teams.js";

const PAGE = 60;

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
  ctx.outlet.append(loading("Chargement de la liste des joueurs…"));
  let players;
  try {
    players = await playerIndex();
  } catch (err) {
    ctx.outlet.replaceChildren(errorState(err, () => location.reload()));
    return;
  }
  if (!ctx.active) return;

  const params = new URLSearchParams(sessionStorage.getItem("parquet-players") || "");
  const state = {
    q: params.get("q") || "",
    scope: params.get("scope") || "active",
    team: params.get("team") || "",
    pos: params.get("pos") || "",
    country: params.get("country") || "",
    sort: params.get("sort") || "pts",
    shown: PAGE,
  };
  const save = () => {
    try {
      sessionStorage.setItem("parquet-players", new URLSearchParams({ q: state.q, scope: state.scope, team: state.team, pos: state.pos, country: state.country, sort: state.sort }).toString());
    } catch {
      /* rien */
    }
  };

  const countries = [...new Set(players.map((p) => p.country).filter(Boolean))].sort((a, b) => f.country(a).localeCompare(f.country(b), "fr"));
  const input = h("input", { type: "search", class: "select", style: { width: "min(420px, 100%)", height: "42px", fontSize: "16px" }, placeholder: "Nom d'un joueur, actuel ou ancien", value: state.q, "aria-label": "Rechercher un joueur" });
  const teamSel = h("select", { "aria-label": "Équipe" }, h("option", { value: "" }, "Toutes"), teams().map((t) => h("option", { value: t.id, selected: String(t.id) === state.team ? true : null }, t.fullName)));
  const posSel = h(
    "select",
    { "aria-label": "Poste" },
    [["", "Tous"], ["G", "Arrières"], ["F", "Ailiers"], ["C", "Pivots"]].map(([v, l]) => h("option", { value: v, selected: v === state.pos ? true : null }, l))
  );
  const countrySel = h(
    "select",
    { "aria-label": "Pays" },
    h("option", { value: "" }, "Tous"),
    h("option", { value: "France", selected: state.country === "France" ? true : null }, "France"),
    h("option", { value: "__intl", selected: state.country === "__intl" ? true : null }, "Hors États-Unis"),
    countries.filter((c) => c !== "France").map((c) => h("option", { value: c, selected: c === state.country ? true : null }, f.country(c)))
  );
  const sortSel = h(
    "select",
    { "aria-label": "Tri" },
    [["pts", "Points par match"], ["name", "Nom"], ["recent", "Plus récents"]].map(([v, l]) => h("option", { value: v, selected: v === state.sort ? true : null }, l))
  );

  const count = h("p", { class: "note", "aria-live": "polite", style: { margin: "0 0 12px" } });
  const grid = h("div", { class: "players-grid" });
  const more = h("button", { class: "btn", type: "button", style: { marginTop: "18px" } }, "Afficher plus de joueurs");

  const filtered = () => {
    const words = normalize(state.q).split(/\s+/).filter(Boolean);
    let list = players.filter((p) => {
      if (state.scope === "active" && !p.active) return false;
      if (state.team && String(p.teamId) !== state.team) return false;
      if (state.pos && !(p.pos || "").includes(state.pos)) return false;
      if (state.country === "__intl" && (!p.country || p.country === "USA")) return false;
      if (state.country && state.country !== "__intl" && p.country !== state.country) return false;
      if (words.length && !words.every((w) => p.key.includes(w))) return false;
      return true;
    });
    if (state.sort === "name") list.sort((a, b) => a.last.localeCompare(b.last, "fr") || a.first.localeCompare(b.first, "fr"));
    else if (state.sort === "recent") list.sort((a, b) => (b.to || 0) - (a.to || 0) || (b.pts || 0) - (a.pts || 0));
    else list.sort((a, b) => (b.pts || 0) - (a.pts || 0));
    return list;
  };

  const draw = () => {
    const list = filtered();
    count.textContent = list.length ? `${f.plural(list.length, "joueur", "joueurs")}` : "";
    grid.replaceChildren(...list.slice(0, state.shown).map(card));
    if (!list.length) grid.append(h("p", { class: "note" }, "Aucun joueur ne correspond. Essaie l'orthographe anglaise du nom ou élargis à « Toute l'histoire »."));
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
  for (const [sel, key] of [[teamSel, "team"], [posSel, "pos"], [countrySel, "country"], [sortSel, "sort"]]) {
    sel.addEventListener("change", () => {
      state[key] = sel.value;
      state.shown = PAGE;
      draw();
    });
  }
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

  const field = (label, control) => h("label", { class: "field" }, label, control);
  ctx.outlet.replaceChildren(
    h("div", { class: "page-head" }, h("div", null, h("h1", { class: "page-title" }, "Joueurs"), h("p", { class: "page-sub" }, `Les ${f.int(players.length)} joueurs passés par la NBA depuis 1946, avec leur fiche complète.`))),
    h("div", { class: "toolbar" }, input, scopeHolder),
    h("div", { class: "toolbar" }, field("Équipe actuelle", teamSel), field("Poste", posSel), field("Pays", countrySel), field("Trier par", sortSel)),
    count,
    grid,
    more
  );
  draw();
  if (!state.q) input.focus({ preventScroll: true });
}
