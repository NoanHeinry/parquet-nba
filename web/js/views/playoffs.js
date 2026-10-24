// Vue de l'arbre et des séries des playoffs NBA.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { errorState, loading, segmented, staleBanner, teamLogo } from "../components.js";
import { team, teamColor } from "../teams.js";
import { iconEye, iconTrophy } from "../icons.js";

function renderMatchupCard(series) {
  if (!series) {
    return h("div", { class: "matchup-card empty" }, h("span", { class: "note" }, "À déterminer"));
  }

  const t1 = series.topTeam;
  const t2 = series.bottomTeam;
  const isFinished = series.status === "Terminée";
  const winnerId = series.winnerId;

  const t1Win = winnerId && winnerId === t1.id;
  const t2Win = winnerId && winnerId === t2.id;

  const t1Row = h(
    "div",
    { class: `matchup-team ${t1Win ? "winner" : isFinished && winnerId ? "loser" : ""}` },
    h("span", { class: "seed" }, t1.seed ? `#${t1.seed}` : ""),
    teamLogo(t1.id, 22),
    h("a", { class: "team-name", href: `#/equipe/${t1.id}`, title: t1.fullName }, t1.tri),
    h("span", { class: "wins" }, f.int(t1.wins))
  );

  const t2Row = h(
    "div",
    { class: `matchup-team ${t2Win ? "winner" : isFinished && winnerId ? "loser" : ""}` },
    h("span", { class: "seed" }, t2.seed ? `#${t2.seed}` : ""),
    teamLogo(t2.id, 22),
    h("a", { class: "team-name", href: `#/equipe/${t2.id}`, title: t2.fullName }, t2.tri),
    h("span", { class: "wins" }, f.int(t2.wins))
  );

  const gamesList = h(
    "div",
    { class: "matchup-games", hidden: true },
    series.games && series.games.length
      ? series.games.map((g) => {
          const played = g.played;
          const hTeam = team(g.homeTeamId);
          const vTeam = team(g.visitorTeamId);
          const hTri = hTeam?.tri || "DOM";
          const vTri = vTeam?.tri || "EXT";
          const scoreText = played ? `${vTri} ${g.visitorPts} - ${g.homePts} ${hTri}` : "À venir";
          const dateText = g.date ? f.dateShort(g.date) : "";
          const gameRow = h(
            played ? "a" : "div",
            {
              class: "matchup-game-row",
              href: played ? `#/match/${g.gameId}` : null,
              title: played ? "Voir le box score du match" : null,
            },
            h("span", { class: "g-num" }, `M${g.gameNum}`),
            h("span", { class: "g-score" }, scoreText),
            h("span", { class: "g-date" }, dateText)
          );
          return gameRow;
        })
      : h("div", { class: "note", style: { padding: "6px" } }, "Aucun match disputé")
  );

  const expandBtn = h(
    "button",
    {
      class: "matchup-expand-btn",
      type: "button",
      "aria-label": "Afficher les matchs de la série",
      title: "Détail des matchs",
    },
    h("span", { class: "summary-text" }, series.summary),
    h("span", { class: "expand-arrow" }, "▾")
  );

  const revealBtn = h(
    "button",
    {
      class: "tile-reveal-btn matchup-reveal-btn",
      type: "button",
      "aria-label": "Révéler le score de cette série",
      title: "Révéler le score",
    },
    iconEye(16)
  );

  const card = h(
    "div",
    { class: `matchup-card ${isFinished ? "is-finished" : ""}` },
    revealBtn,
    t1Row,
    t2Row,
    expandBtn,
    gamesList
  );

  expandBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = gamesList.hidden;
    gamesList.hidden = !isHidden;
    expandBtn.classList.toggle("is-open", !isHidden);
  });

  revealBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    card.classList.toggle("is-revealed");
  });

  return card;
}

function renderChampionBanner(champ, finalsSeries) {
  if (!champ) return null;
  const col = teamColor(champ.id);
  return h(
    "div",
    {
      class: "playoffs-champion-card",
      style: {
        "--team-color": col,
        borderLeft: `5px solid ${col}`,
      },
    },
    h("div", { class: "trophy-icon", "aria-hidden": "true" }, iconTrophy(26)),
    teamLogo(champ.id, 54),
    h(
      "div",
      { class: "champion-info" },
      h("span", { class: "label" }, "Champion NBA"),
      h("h2", { class: "name" }, champ.fullName),
      finalsSeries ? h("p", { class: "sub" }, finalsSeries.summary) : null
    )
  );
}

function renderBracketTree(data) {
  const east = data.east || {};
  const west = data.west || {};
  const finals = data.finals;

  const colEastR1 = h("div", { class: "bracket-col col-r1" },
    h("div", { class: "col-header" }, "1er tour"),
    h("div", { class: "col-matches" }, ...(east.round1 || []).map((s) => renderMatchupCard(s)))
  );

  const colEastSemi = h("div", { class: "bracket-col col-semi" },
    h("div", { class: "col-header" }, "Demi-finales"),
    h("div", { class: "col-matches" }, ...(east.semifinals || []).map((s) => renderMatchupCard(s)))
  );

  const colEastFinals = h("div", { class: "bracket-col col-conf-finals" },
    h("div", { class: "col-header" }, "Finale Est"),
    h("div", { class: "col-matches" }, renderMatchupCard(east.finals))
  );

  const colFinals = h("div", { class: "bracket-col col-finals" },
    h("div", { class: "col-header finals-header" }, iconTrophy(15), "Finales NBA"),
    h("div", { class: "col-matches finals-match" }, renderMatchupCard(finals))
  );

  const colWestFinals = h("div", { class: "bracket-col col-conf-finals" },
    h("div", { class: "col-header" }, "Finale Ouest"),
    h("div", { class: "col-matches" }, renderMatchupCard(west.finals))
  );

  const colWestSemi = h("div", { class: "bracket-col col-semi" },
    h("div", { class: "col-header" }, "Demi-finales"),
    h("div", { class: "col-matches" }, ...(west.semifinals || []).map((s) => renderMatchupCard(s)))
  );

  const colWestR1 = h("div", { class: "bracket-col col-r1" },
    h("div", { class: "col-header" }, "1er tour"),
    h("div", { class: "col-matches" }, ...(west.round1 || []).map((s) => renderMatchupCard(s)))
  );

  return h(
    "div",
    { class: "bracket-scroll-container" },
    h("div", { class: "bracket-conferences-head" },
      h("span", { class: "conf-tag east" }, "Conférence Est"),
      h("span", { class: "conf-tag finals" }, "Finales"),
      h("span", { class: "conf-tag west" }, "Conférence Ouest")
    ),
    h(
      "div",
      { class: "bracket-tree" },
      colEastR1,
      colEastSemi,
      colEastFinals,
      colFinals,
      colWestFinals,
      colWestSemi,
      colWestR1
    )
  );
}

function renderConferenceView(seriesList, confName) {
  const byRound = [
    { title: "Finales de conférence", items: seriesList.filter((s) => s && s.round === 3) },
    { title: "Demi-finales de conférence", items: seriesList.filter((s) => s && s.round === 2) },
    { title: "1er tour", items: seriesList.filter((s) => s && s.round === 1) },
  ];

  return h(
    "div",
    { class: "conf-rounds-list" },
    byRound.map((grp) =>
      grp.items.length
        ? h(
            "section",
            { class: "section", style: { marginTop: "24px" } },
            h("h2", { class: "section-title" }, `${grp.title} — ${confName}`),
            h("div", { class: "playoff-grid" }, grp.items.map((s) => renderMatchupCard(s)))
          )
        : ""
    )
  );
}

export async function render(ctx) {
  let selectedSeason = ctx.params?.[0] || null;
  let viewMode = "tree";

  const container = h("div");
  ctx.outlet.append(container);

  const load = async () => {
    container.replaceChildren(loading("Chargement de l'arbre des playoffs…"));
    let res;
    try {
      res = await api(`/playoffs${selectedSeason ? `?season=${selectedSeason}` : ""}`, { signal: ctx.signal });
    } catch (err) {
      if (err.name === "AbortError") return;
      container.replaceChildren(errorState(err, load));
      return;
    }

    const { data, meta } = res;
    const seasonList = data.availableSeasons || [data.season];
    const seasonSel = h(
      "select",
      { class: "select", "aria-label": "Saison des playoffs" },
      seasonList.map((s) => h("option", { value: s, selected: s === data.season ? true : null }, `Playoffs ${s}`))
    );

    seasonSel.addEventListener("change", () => {
      selectedSeason = seasonSel.value;
      location.hash = `#/playoffs/${selectedSeason}`;
    });

    const toggleAllBtn = h(
      "button",
      {
        class: "btn spoiler-all-btn",
        type: "button",
        "aria-label": "Révéler tous les scores des playoffs",
        title: "Révéler tous les scores",
      },
      "Révéler tout"
    );

    toggleAllBtn.addEventListener("click", () => {
      const cards = container.querySelectorAll(".matchup-card");
      const allRev = [...cards].length > 0 && [...cards].every((c) => c.classList.contains("is-revealed"));
      for (const c of cards) {
        if (allRev) c.classList.remove("is-revealed");
        else c.classList.add("is-revealed");
      }
      toggleAllBtn.textContent = allRev ? "Révéler tout" : "Tout masquer";
    });

    const sub = data.fallback
      ? `Les playoffs ${data.requested} n'ont pas encore commencé : voici l'arbre de la saison ${data.season}.`
      : `Playoffs NBA ${data.season}, mis à jour à ${f.updatedAt(meta.fetchedAt)}.`;

    const VIEW_OPTIONS = [
      { value: "tree", label: "Arbre complet" },
      { value: "east", label: "Conférence Est" },
      { value: "west", label: "Conférence Ouest" },
      { value: "finals", label: "Finales" },
    ];

    const contentArea = h("div", { class: "playoffs-content-area" });

    const updateView = () => {
      if (viewMode === "tree") {
        contentArea.replaceChildren(renderBracketTree(data));
      } else if (viewMode === "east") {
        const eastSeries = [
          ...(data.east?.round1 || []),
          ...(data.east?.semifinals || []),
          data.east?.finals,
        ].filter(Boolean);
        contentArea.replaceChildren(renderConferenceView(eastSeries, "Est"));
      } else if (viewMode === "west") {
        const westSeries = [
          ...(data.west?.round1 || []),
          ...(data.west?.semifinals || []),
          data.west?.finals,
        ].filter(Boolean);
        contentArea.replaceChildren(renderConferenceView(westSeries, "Ouest"));
      } else if (viewMode === "finals") {
        contentArea.replaceChildren(
          h(
            "section",
            { class: "section", style: { marginTop: "20px" } },
            h("h2", { class: "section-title" }, "Finales NBA"),
            h("div", { style: { maxWidth: "420px", margin: "0 auto" } }, renderMatchupCard(data.finals))
          )
        );
      }
    };

    const modeToolbar = h(
      "div",
      { class: "toolbar", style: { marginTop: "14px", marginBottom: "16px" } },
      segmented(
        VIEW_OPTIONS,
        viewMode,
        (val) => {
          viewMode = val;
          updateView();
        },
        "Mode d'affichage des playoffs"
      )
    );

    const champBanner = renderChampionBanner(data.champion, data.finals);

    updateView();

    container.replaceChildren(
      h(
        "div",
        { class: "page-head" },
        h("div", null, h("h1", { class: "page-title" }, "Playoffs NBA"), h("p", { class: "page-sub" }, sub)),
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, toggleAllBtn, seasonSel)
      ),
      staleBanner(meta) || "",
      champBanner || "",
      modeToolbar,
      contentArea
    );
  };

  load();
}
