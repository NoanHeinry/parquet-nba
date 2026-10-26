// Comparateur de deux joueurs : face-à-face graphique, moyennes, totaux et palmarès.

import { api, appStatus } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { compareRows, dualLineChart } from "../charts.js";
import { errorState, headshot, loading, segmented, teamLogo } from "../components.js";
import { playerIndex, searchPlayers } from "../search.js";
import { team, teamColor, teamPair } from "../teams.js";
import { iconScale } from "../icons.js";

const PRESETS = [
  { label: "LeBron James vs Michael Jordan", p1: 2544, p2: 893 },
  { label: "Victor Wembanyama vs Chet Holmgren", p1: 1641705, p2: 1631096 },
  { label: "Stephen Curry vs Magic Johnson", p1: 201939, p2: 77142 },
  { label: "Nikola Jokić vs Joel Embiid", p1: 203999, p2: 203954 },
  { label: "Kobe Bryant vs LeBron James", p1: 977, p2: 2544 },
  { label: "Shaquille O'Neal vs Tim Duncan", p1: 406, p2: 1495 },
];

const STAT_COLS = [
  { key: "pts", label: "Points par match", fmt: (v) => f.num(v) },
  { key: "reb", label: "Rebonds par match", fmt: (v) => f.num(v) },
  { key: "ast", label: "Passes par match", fmt: (v) => f.num(v) },
  { key: "stl", label: "Interceptions", fmt: (v) => f.num(v) },
  { key: "blk", label: "Contres", fmt: (v) => f.num(v) },
  { key: "tov", label: "Balles perdues", fmt: (v) => f.num(v), lowerIsBetter: true },
  { key: "fgPct", label: "Adresse globale (% FG)", fmt: (v) => `${f.pct(v)} %` },
  { key: "tpPct", label: "Adresse à 3 points (% 3P)", fmt: (v) => `${f.pct(v)} %` },
  { key: "ftPct", label: "Lancers francs (% FT)", fmt: (v) => `${f.pct(v)} %` },
  { key: "ts", label: "Adresse réelle (TS%)", fmt: (v) => `${f.pct(v)} %` },
  { key: "gp", label: "Matchs disputés", fmt: (v) => f.int(v) },
  { key: "min", label: "Minutes par match", fmt: (v) => f.num(v) },
];

const AWARDS_KEY_MAP = [
  { key: "NBA Champion", label: "Titres de Champion NBA" },
  { key: "NBA Most Valuable Player", label: "MVP de la saison" },
  { key: "NBA Finals Most Valuable Player", label: "MVP des Finales" },
  { key: "NBA All-Star", label: "Sélections All-Star" },
  { key: "All-NBA", label: "Sélections All-NBA" },
  { key: "All-Defensive Team", label: "Sélections All-Defensive" },
  { key: "NBA Defensive Player of the Year", label: "Défenseur de l'année (DPOY)" },
  { key: "NBA Rookie of the Year", label: "Rookie de l'année (ROY)" },
];

function perGame(row, key) {
  if (!row) return 0;
  const v = row[key];
  if (v === null || v === undefined) return 0;
  if (key === "fgPct" || key === "tpPct" || key === "ftPct" || key === "ts") return v;
  if (key === "gp") return v;
  return row.gp ? v / row.gp : 0;
}

function careerSeries(rows) {
  const bySeason = new Map();
  for (const r of rows || []) {
    const prev = bySeason.get(r.season);
    if (!prev || r.tri === "TOT") bySeason.set(r.season, r);
  }
  return [...bySeason.values()];
}

function playerCard(p, onRemove, color) {
  if (!p) return null;
  const t = team(p.teamId);
  const years = p.from ? `${p.from}–${p.active ? "auj." : p.to || ""}` : "";
  const sub = [t?.fullName || p.tri, f.position(p.pos), years].filter(Boolean).join(" · ");

  return h(
    "div",
    { class: "compare-player-card", style: { "--player-color": color } },
    headshot(p.id, { cls: "pic", alt: p.name || p.full || "" }),
    h(
      "div",
      { class: "info" },
      h("div", { class: "name-row" },
        h("a", { class: "name", href: `#/joueur/${p.id}` }, p.name || p.full),
        teamLogo(p.teamId, 22)
      ),
      h("div", { class: "sub" }, sub),
      p.height ? h("div", { class: "note" }, `${f.heightM(p.height)} · ${f.weightKg(p.weight)}`) : null
    ),
    onRemove
      ? h("button", {
          type: "button",
          class: "btn square mini remove-btn",
          title: "Changer de joueur",
          "aria-label": "Changer de joueur",
          onclick: onRemove,
        }, "✕")
      : null
  );
}

function searchSlot(label, onSelect, allPlayers, placeholder = "Chercher un joueur…") {
  const box = h("div", { class: "compare-search-slot" });
  const input = h("input", {
    type: "search",
    class: "compare-search-input",
    placeholder,
    "aria-label": label,
    autocomplete: "off",
  });
  const results = h("div", { class: "compare-search-dropdown", hidden: true });

  const close = () => {
    results.hidden = true;
  };

  input.addEventListener("input", () => {
    const q = input.value.trim();
    if (!q || !allPlayers) return close();
    const hits = searchPlayers(allPlayers, q, 6);
    if (!hits.length) {
      results.replaceChildren(h("div", { class: "search-empty" }, `Aucun résultat pour « ${q} »`));
      results.hidden = false;
      return;
    }
    results.replaceChildren(
      ...hits.map((p) => {
        const row = h(
          "div",
          { class: "search-item" },
          headshot(p.id, { cls: "headshot mini", alt: "" }),
          h("div", null, h("div", { style: { fontWeight: 650 } }, p.full), h("div", { class: "sub" }, [p.tri, p.pos, p.from ? `${p.from}–${p.to || "auj."}` : ""].filter(Boolean).join(" · ")))
        );
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          close();
          input.value = "";
          onSelect(p);
        });
        return row;
      })
    );
    results.hidden = false;
  });

  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  box.append(
    h("div", { class: "slot-header" }, h("span", { class: "slot-label" }, label)),
    input,
    results
  );
  return box;
}

export async function render(ctx) {
  const container = h("div", { class: "compare-page" });
  ctx.outlet.replaceChildren(container);

  let p1Id = ctx.params[0] ? Number(ctx.params[0]) : null;
  let p2Id = ctx.params[1] ? Number(ctx.params[1]) : null;

  let allPlayers = null;
  try {
    allPlayers = await playerIndex();
  } catch {
    allPlayers = [];
  }
  if (!ctx.active) return;

  // En mode démonstration, les vrais joueurs n'existent pas : duels suggérés entre joueurs fictifs.
  let presets = PRESETS;
  try {
    if ((await appStatus()).demo) {
      const stars = allPlayers.filter((p) => p.active).sort((a, b) => (b.pts || 0) - (a.pts || 0)).slice(0, 8);
      presets = [0, 2, 4, 6]
        .filter((i) => stars[i + 1])
        .map((i) => ({ label: `${stars[i].full} vs ${stars[i + 1].full}`, p1: stars[i].id, p2: stars[i + 1].id }));
    }
  } catch {
    /* duels suggérés par défaut */
  }

  let mode = "avg"; // "avg" | "tot" | "playoffs"

  // Changer de joueurs = changer d'adresse : le routeur redessine la page lui-même.
  // On ne redessine ici que si l'adresse ne change pas (sinon tout serait chargé deux fois).
  const updateUrl = () => {
    const next = p1Id && p2Id ? `#/comparer/${p1Id}/${p2Id}` : p1Id ? `#/comparer/${p1Id}` : p2Id ? `#/comparer/${p2Id}` : "#/comparer";
    if (location.hash !== next) location.hash = next;
    else draw();
  };

  const draw = async () => {
    container.replaceChildren();

    // En-tête de la page
    const head = h(
      "div",
      { class: "page-head" },
      h("div", null,
        h("h1", { class: "page-title" }, "Comparateur de joueurs"),
        h("p", { class: "page-sub" }, "Compare les trajectoires, moyennes de carrière, records et palmarès de deux joueurs.")
      )
    );

    // Duels suggérés (presets)
    const presetsBar = h(
      "div",
      { class: "compare-presets" },
      h("span", { class: "presets-label" }, "Duels suggérés :"),
      ...presets.map((pr) => {
        const btn = h("button", { type: "button", class: "btn preset-chip" }, pr.label);
        btn.addEventListener("click", () => {
          p1Id = pr.p1;
          p2Id = pr.p2;
          updateUrl();
        });
        return btn;
      })
    );

    // Grille de sélection des 2 joueurs
    const p1Obj = allPlayers.find((p) => p.id === p1Id);
    const p2Obj = allPlayers.find((p) => p.id === p2Id);

    // Choix des couleurs pour le duel
    // Couleurs des deux équipes, différenciées si elles se ressemblent trop (teamPair).
    let c1 = p1Obj?.teamId ? teamColor(p1Obj.teamId) : "#3b82f6";
    let c2 = p2Obj?.teamId ? teamColor(p2Obj.teamId) : "#f97316";
    if (p1Obj?.teamId && p2Obj?.teamId && p1Obj.teamId !== p2Obj.teamId) {
      ({ away: c1, home: c2 } = teamPair(p1Obj.teamId, p2Obj.teamId));
    } else if (c1 === c2) {
      c2 = "#f59e0b";
    }

    const col1 = h("div", { class: "compare-col" });
    if (p1Obj) {
      col1.append(playerCard(p1Obj, () => { p1Id = null; updateUrl(); }, c1));
    } else {
      col1.append(
        searchSlot("Joueur 1", (selected) => {
          p1Id = selected.id;
          updateUrl();
        }, allPlayers, "Choisir le premier joueur…")
      );
    }

    const col2 = h("div", { class: "compare-col" });
    if (p2Obj) {
      col2.append(playerCard(p2Obj, () => { p2Id = null; updateUrl(); }, c2));
    } else {
      col2.append(
        searchSlot("Joueur 2", (selected) => {
          p2Id = selected.id;
          updateUrl();
        }, allPlayers, "Choisir le second joueur…")
      );
    }

    const vsBadge = h("div", { class: "compare-vs" }, "VS");
    const selectionGrid = h("div", { class: "compare-selection-grid" }, col1, vsBadge, col2);

    container.append(head, presetsBar, selectionGrid);

    // Si les deux joueurs ne sont pas encore sélectionnés
    if (!p1Id || !p2Id) {
      container.append(
        h(
          "div",
          { class: "empty-state-card", style: { marginTop: "32px", textAlign: "center", padding: "48px 20px" } },
          h("div", { class: "compare-empty-icon", "aria-hidden": "true" }, iconScale(28)),
          h("h3", { style: { marginBottom: "8px" } }, "Sélectionne deux joueurs pour lancer le face-à-face"),
          h("p", { class: "note" }, "Utilise la recherche ci-dessus ou clique sur l'un des duels suggérés pour afficher la comparaison complète.")
        )
      );
      return;
    }

    // Chargement des données des deux joueurs
    const statsContainer = h("div", { style: { marginTop: "28px" } });
    container.append(statsContainer);
    statsContainer.append(loading("Chargement des statistiques et palmarès…"));

    try {
      const [p1Info, p1Career, p1Awards, p2Info, p2Career, p2Awards] = await Promise.all([
        api(`/player/${p1Id}`, { signal: ctx.signal }).then((r) => r.data),
        api(`/player/${p1Id}/career`, { signal: ctx.signal }).then((r) => r.data),
        api(`/player/${p1Id}/awards`, { signal: ctx.signal }).then((r) => r.data),
        api(`/player/${p2Id}`, { signal: ctx.signal }).then((r) => r.data),
        api(`/player/${p2Id}/career`, { signal: ctx.signal }).then((r) => r.data),
        api(`/player/${p2Id}/awards`, { signal: ctx.signal }).then((r) => r.data),
      ]);
      if (!ctx.active) return;

      const renderDuel = () => {
        const d1 = mode === "playoffs" ? p1Career.careerPlayoffs : p1Career.careerRegular;
        const d2 = mode === "playoffs" ? p2Career.careerPlayoffs : p2Career.careerRegular;

        if (!d1 && !d2) {
          return h("p", { class: "note" }, "Pas de données statistiques pour ce mode.");
        }

        const rows = STAT_COLS.map((col) => {
          let a = 0;
          let b = 0;
          if (mode === "tot") {
            a = d1 ? d1[col.key] ?? 0 : 0;
            b = d2 ? d2[col.key] ?? 0 : 0;
          } else {
            a = perGame(d1, col.key);
            b = perGame(d2, col.key);
          }
          return {
            label: col.label,
            away: a,
            home: b,
            format: col.fmt,
            lowerIsBetter: Boolean(col.lowerIsBetter),
          };
        });

        return compareRows(rows, { away: c1, home: c2 }, { away: p1Info.name, home: p2Info.name });
      };

      // Comparaison des palmarès
      const renderAwards = () => {
        const getAwardCount = (awards, key) => {
          const it = (awards.awards || []).find((a) => a.key === key);
          return it ? it.count : 0;
        };

        const awardRows = AWARDS_KEY_MAP.map((item) => {
          const cA = getAwardCount(p1Awards, item.key);
          const cB = getAwardCount(p2Awards, item.key);
          return {
            label: item.label,
            away: cA,
            home: cB,
            format: (v) => String(v),
          };
        }).filter((r) => r.away > 0 || r.home > 0);

        if (!awardRows.length) return null;

        return h(
          "section",
          { class: "section", style: { marginTop: "32px" } },
          h("h2", { class: "section-title" }, "Palmarès & Distinctions"),
          compareRows(awardRows, { away: c1, home: c2 }, { away: p1Info.name, home: p2Info.name })
        );
      };

      const modeToolbar = h(
        "div",
        { class: "toolbar", style: { marginBottom: "16px" } },
        segmented(
          [
            { value: "avg", label: "Moyennes de carrière" },
            { value: "tot", label: "Totaux de carrière" },
            { value: "playoffs", label: "Playoffs" },
          ],
          mode,
          (v) => {
            mode = v;
            duelBox.replaceChildren(renderDuel());
          },
          "Mode de comparaison"
        )
      );

      const duelBox = h("div", null, renderDuel());
      const awardsSection = renderAwards();

      // Graphique de trajectoire de carrière saison par saison
      let chartStat = "pts";
      const CHART_STATS = [
        { value: "pts", label: "Points" },
        { value: "reb", label: "Rebonds" },
        { value: "ast", label: "Passes" },
        { value: "min", label: "Minutes" },
        { value: "fgPct", label: "% Tirs" },
      ];

      const s1 = careerSeries(p1Career.regular);
      const s2 = careerSeries(p2Career.regular);

      const chartCard = h("div", { class: "chart-card", style: { marginTop: "14px" } });
      const drawChart = () => {
        const isPct = chartStat === "fgPct";
        const fmt = (v) => (isPct ? `${f.pct(v)} %` : f.num(v));
        const val = (r) => (isPct ? r[chartStat] : r.gp ? r[chartStat] / r.gp : 0);

        const seriesA = {
          name: p1Info.name,
          color: c1,
          points: s1.map((r) => ({
            label: r.season,
            value: val(r),
          })),
        };
        const seriesB = {
          name: p2Info.name,
          color: c2,
          points: s2.map((r) => ({
            label: r.season,
            value: val(r),
          })),
        };

        const activeChoice = CHART_STATS.find((c) => c.value === chartStat) || CHART_STATS[0];
        chartCard.replaceChildren(
          h(
            "div",
            { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px", marginBottom: "8px" } },
            h("strong", null, `${activeChoice.label} par match (aligné par saison de carrière)`),
            h("span", { class: "note" }, "Survole la courbe pour comparer chaque saison.")
          ),
          dualLineChart(seriesA, seriesB, { format: fmt })
        );
      };

      const chartToolbar = h(
        "div",
        { class: "toolbar", style: { marginBottom: "8px" } },
        segmented(CHART_STATS, chartStat, (v) => {
          chartStat = v;
          drawChart();
        }, "Statistique du graphique")
      );
      drawChart();

      const trajectorySection = (s1.length || s2.length)
        ? h(
            "section",
            { class: "section", style: { marginTop: "36px" } },
            h("h2", { class: "section-title" }, "Évolution de carrière (saison par saison)"),
            h("p", { class: "note", style: { margin: "0 0 14px" } }, "Compare leurs moyennes à chaque étape de carrière depuis leur saison rookie (S1 = 1re saison)."),
            chartToolbar,
            chartCard
          )
        : null;

      statsContainer.replaceChildren(
        h("section", { class: "section" },
          h("h2", { class: "section-title" }, "Face-à-face statistique"),
          modeToolbar,
          duelBox
        ),
        awardsSection || "",
        trajectorySection || ""
      );
    } catch (err) {
      if (err.name === "AbortError") return;
      statsContainer.replaceChildren(errorState(err, draw));
    }
  };

  draw();
}
