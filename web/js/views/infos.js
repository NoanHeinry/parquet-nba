// Page « Infos » : rapport officiel des blessures et transactions (signatures, échanges, joueurs libérés).

import { api } from "../api.js";
import { h } from "../dom.js";
import { chips, favorites, section, segmented, staleBanner } from "../components.js";
import { gameInjuries, movesByDay, reportSource } from "../news.js";
import { teams } from "../teams.js";

const MOVE_TYPES = [
  { value: "", label: "Tout" },
  { value: "Signing", label: "Signatures" },
  { value: "Trade", label: "Échanges" },
  { value: "Waive", label: "Libérés" },
  { value: "AwardOnWaivers", label: "Waivers" },
  { value: "ContractConverted", label: "Contrats modifiés" },
];

function teamSelect(value, onChange) {
  const sel = h(
    "select",
    { class: "select", "aria-label": "Filtrer par équipe" },
    h("option", { value: "" }, "Toutes les équipes"),
    teams()
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => h("option", { value: t.id, selected: String(value) === String(t.id) ? true : null }, t.name))
  );
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function injuriesView(box, ctx) {
  let mine = false;
  const draw = () =>
    section(box, () => api("/injuries", { signal: ctx.signal }), ({ data, meta }) => {
      const favs = new Set([...favorites()].map(Number));
      let games = data.games;
      if (mine) games = games.map((g) => ({ ...g, teams: g.teams.filter((t) => favs.has(t.id)) })).filter((g) => g.teams.length);
      const toolbar = h(
        "div",
        { class: "toolbar" },
        chips(
          [
            { value: false, label: "Tous les matchs" },
            { value: true, label: "Mes équipes favorites" },
          ],
          mine,
          (v) => {
            mine = v;
            draw();
          },
          "Matchs affichés"
        )
      );
      return [
        staleBanner(meta),
        toolbar,
        reportSource(data),
        games.length
          ? h("div", { class: "inj-games" }, games.map(gameInjuries))
          : h("p", { class: "note" }, mine ? "Aucun match à venir pour tes équipes favorites dans ce rapport." : "Le rapport ne contient aucun match à venir."),
      ];
    });
  draw();
}

function movesView(box, ctx) {
  let type = "";
  let teamId = "";
  const list = h("div");
  const draw = () =>
    section(
      list,
      () => api(`/transactions?days=120${type ? `&type=${type}` : ""}${teamId ? `&team=${teamId}` : ""}`, { signal: ctx.signal }),
      ({ data, meta }) => [
        staleBanner(meta),
        data.items.length ? movesByDay(data.items) : h("p", { class: "note" }, "Aucune transaction sur les quatre derniers mois pour ce filtre."),
        h("p", { class: "note", style: { marginTop: "16px" } }, "Source : liste officielle des mouvements de joueurs de la NBA. Les quatre derniers mois sont affichés."),
      ]
    );
  box.replaceChildren(
    h(
      "div",
      { class: "toolbar" },
      chips(MOVE_TYPES, type, (v) => {
        type = v;
        draw();
      }, "Type de transaction"),
      teamSelect(teamId, (v) => {
        teamId = v;
        draw();
      })
    ),
    list
  );
  draw();
}

export async function render(ctx) {
  const which = ctx.params[0] === "mouvements" ? "moves" : "injuries";
  const box = h("div");
  ctx.outlet.append(
    h(
      "div",
      { class: "page-head" },
      h(
        "div",
        null,
        h("h1", { class: "page-title" }, "Infos NBA"),
        h("p", { class: "page-sub" }, "Le rapport officiel des blessures avant chaque match, et les mouvements de joueurs dans toute la ligue.")
      )
    ),
    h(
      "div",
      { class: "toolbar" },
      segmented(
        [
          { value: "injuries", label: "Blessures" },
          { value: "moves", label: "Transactions" },
        ],
        which,
        (v) => {
          location.hash = v === "moves" ? "#/infos/mouvements" : "#/infos";
        },
        "Rubrique"
      )
    ),
    box
  );
  document.title = `${which === "moves" ? "Transactions" : "Blessures"} · Parquet`;
  ctx.onCleanup(() => (document.title = "Parquet"));
  if (which === "moves") movesView(box, ctx);
  else injuriesView(box, ctx);
}
