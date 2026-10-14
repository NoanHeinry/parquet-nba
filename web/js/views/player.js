// Fiche d'un joueur : identité, biographie, palmarès, parcours, statistiques de carrière, derniers matchs.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { lineChart } from "../charts.js";
import { chips, errorState, headshot, loading, section, segmented, statTable, tabs, teamLogo, wl } from "../components.js";
import { team, teamBand, teamByTri } from "../teams.js";

// ---------------------------------------------------------------- palmarès

const AWARDS = [
  ["NBA Champion", "Champion NBA"],
  ["NBA Finals Most Valuable Player", "MVP des Finales"],
  ["NBA Most Valuable Player", "MVP de la saison régulière"],
  ["NBA Defensive Player of the Year", "Défenseur de l'année"],
  ["NBA Rookie of the Year", "Rookie de l'année"],
  ["NBA Sixth Man of the Year", "Sixième homme de l'année"],
  ["NBA Most Improved Player", "Joueur ayant le plus progressé"],
  ["NBA Clutch Player of the Year", "Joueur décisif de l'année"],
  ["NBA Cup Most Valuable Player", "MVP de la NBA Cup"],
  ["NBA In-Season Tournament Most Valuable Player", "MVP de la NBA Cup"],
  ["NBA All-Star Most Valuable Player", "MVP du All-Star Game"],
  ["NBA All-Star", "Sélections au All-Star Game"],
  ["All-NBA", "Équipes All-NBA"],
  ["All-Defensive Team", "Équipes All-Defensive"],
  ["All-Rookie Team", "Équipe All-Rookie"],
  ["NBA Cup All-Tournament Team", "Équipe-type de la NBA Cup"],
  ["NBA In-Season Tournament All-Tournament", "Équipe-type de la NBA Cup"],
  ["Olympic Gold Medal", "Médaille d'or olympique"],
  ["Olympic Silver Medal", "Médaille d'argent olympique"],
  ["Olympic Bronze Medal", "Médaille de bronze olympique"],
  ["NBA Sporting News Most Valuable Player of the Year", "MVP selon le Sporting News"],
  ["NBA Sporting News Rookie of the Year", "Rookie de l'année selon le Sporting News"],
  ["Hall of Fame Inductee", "Intronisé au Hall of Fame"],
];
const FREQUENT = new Map([
  ["NBA Player of the Week", "Joueur de la semaine"],
  ["NBA Player of the Month", "Joueur du mois"],
  ["NBA Rookie of the Month", "Rookie du mois"],
  ["NBA Defensive Player of the Month", "Défenseur du mois"],
  ["NBA Coach of the Month", "Entraîneur du mois"],
]);

function seasonsText(items) {
  return [...new Set(items.map((i) => i.season))].filter(Boolean).join(", ");
}

function allNbaBreakdown(items) {
  const byNumber = new Map();
  for (const i of items) {
    const n = String(i.number || "").trim();
    byNumber.set(n, (byNumber.get(n) || 0) + 1);
  }
  const ord = { "1": "1re équipe", "2": "2e équipe", "3": "3e équipe" };
  return [...byNumber.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([n, c]) => `${ord[n] || "équipe"} ×${c}`)
    .join(", ");
}

function awardsView(awards) {
  if (!awards.length) return h("p", { class: "note" }, "Pas de distinction individuelle enregistrée par la NBA.");
  const byKey = new Map(awards.map((a) => [a.key, a]));
  const used = new Set();
  const rows = [];
  for (const [key, label] of AWARDS) {
    const a = byKey.get(key);
    if (!a || used.has(label)) continue;
    used.add(label);
    used.add(key);
    const isTeam = key === "All-NBA" || key.includes("All-Defensive") || key.includes("All-Rookie");
    const when = isTeam ? `${allNbaBreakdown(a.items)}. Saisons : ${seasonsText(a.items)}` : seasonsText(a.items);
    rows.push(h("div", { class: "award" }, h("div", { class: "times" }, `×${a.count}`), h("div", null, h("div", { class: "what" }, label), h("div", { class: "when" }, when))));
  }
  const frequent = [];
  for (const a of awards) {
    if (used.has(a.key)) continue;
    if (FREQUENT.has(a.key)) {
      frequent.push(`${FREQUENT.get(a.key)} ×${a.count}`);
      continue;
    }
    rows.push(h("div", { class: "award" }, h("div", { class: "times" }, `×${a.count}`), h("div", null, h("div", { class: "what" }, a.key), h("div", { class: "when" }, seasonsText(a.items)))));
  }
  if (frequent.length) rows.push(h("p", { class: "note", style: { margin: "4px 0 0" } }, `Récompenses hebdomadaires et mensuelles : ${frequent.join(", ")}.`));
  return h("div", { class: "awards" }, rows);
}

// ---------------------------------------------------------------- parcours

function stints(regular) {
  const rows = regular.filter((r) => r.tri !== "TOT" && r.teamId);
  const out = [];
  for (const r of rows) {
    const last = out.at(-1);
    if (last && last.teamId === r.teamId) {
      last.to = r.season;
      last.seasons.add(r.season);
      last.gp += r.gp || 0;
      last.pts += r.pts || 0;
    } else {
      out.push({ teamId: r.teamId, tri: r.tri, from: r.season, to: r.season, seasons: new Set([r.season]), gp: r.gp || 0, pts: r.pts || 0 });
    }
  }
  return out;
}

function stintsView(regular) {
  const list = stints(regular);
  if (!list.length) return h("p", { class: "note" }, "Pas encore de match en saison régulière NBA.");
  return h(
    "div",
    { class: "timeline" },
    list.map((s) => {
      const t = team(s.teamId);
      const startYear = Number(s.from.slice(0, 4));
      const endYear = Number(s.to.slice(0, 4)) + 1;
      const name = t ? (t.tri === s.tri || !s.tri ? t.fullName : `${t.fullName} (alors ${s.tri})`) : s.tri;
      return h(
        t ? "a" : "div",
        { class: "stint", href: t ? `#/equipe/${t.id}` : null },
        h("span", { class: "yrs num" }, `${startYear}–${endYear}`),
        teamLogo(s.teamId, 30),
        h(
          "div",
          null,
          h("div", { class: "nm" }, name),
          h("div", { class: "sub" }, `${f.plural(s.seasons.size, "saison", "saisons")}, ${f.plural(s.gp, "match", "matchs")}, ${f.num(s.gp ? s.pts / s.gp : null)} pts par match`)
        )
      );
    })
  );
}

// ---------------------------------------------------------------- records

const HIGHS = [
  ["PTS", "Points"],
  ["REB", "Rebonds"],
  ["AST", "Passes décisives"],
  ["STL", "Interceptions"],
  ["BLK", "Contres"],
  ["FG3M", "Paniers à 3 points"],
];

function highsView(highs) {
  const byStat = new Map(highs.map((x) => [x.stat, x]));
  const tiles = HIGHS.filter(([k]) => byStat.has(k)).map(([k, label]) => {
    const x = byStat.get(k);
    return h(
      x.gameId ? "a" : "div",
      { class: "tile", href: x.gameId ? `#/match/${x.gameId}` : null },
      h("div", { class: "k" }, label),
      h("div", { class: "v" }, x.value),
      h("div", { class: "s" }, `le ${f.dateLong(x.date)}`, x.vsTri ? ` contre ${x.vsTri}` : "")
    );
  });
  if (!tiles.length) return h("p", { class: "note" }, "Pas de record enregistré.");
  return h("div", { class: "highs" }, tiles);
}

// ---------------------------------------------------------------- statistiques

const STAT_CHOICES = [
  { value: "pts", label: "Points" },
  { value: "reb", label: "Rebonds" },
  { value: "ast", label: "Passes" },
  { value: "stl", label: "Interceptions" },
  { value: "blk", label: "Contres" },
  { value: "min", label: "Minutes" },
  { value: "fgPct", label: "% aux tirs" },
  { value: "tpPct", label: "% à 3 points" },
];
const PCT_KEYS = new Set(["fgPct", "tpPct", "ftPct"]);

function perGame(row, key) {
  const v = row[key];
  if (v === null || v === undefined) return null;
  if (PCT_KEYS.has(key)) return v;
  return row.gp ? v / row.gp : null;
}

function careerSeries(rows) {
  // Une ligne par saison : la ligne « TOT » quand le joueur a changé d'équipe en cours de saison.
  const bySeason = new Map();
  for (const r of rows) {
    const prev = bySeason.get(r.season);
    if (!prev || r.tri === "TOT") bySeason.set(r.season, r);
  }
  return [...bySeason.values()];
}

function statsView(container, career) {
  const state = { type: "regular", mode: "avg", stat: "pts" };
  const chartBox = h("div", { class: "chart-card" });
  const tableBox = h("div");
  const summary = h("p", { class: "note", style: { margin: "0 0 14px" } });

  const draw = () => {
    const rows = state.type === "regular" ? career.regular : career.playoffs;
    const total = state.type === "regular" ? career.careerRegular : career.careerPlayoffs;
    if (!rows.length) {
      chartBox.replaceChildren(h("p", { class: "note" }, state.type === "regular" ? "Aucune saison régulière jouée." : "Pas encore de match de playoffs."));
      tableBox.replaceChildren();
      summary.textContent = "";
      return;
    }
    const value = (r, key) => (state.mode === "avg" ? perGame(r, key) : PCT_KEYS.has(key) ? r[key] : r[key]);
    const fmt = (key, v) => (PCT_KEYS.has(key) ? `${f.pct(v)} %` : state.mode === "avg" ? f.num(v) : f.int(v));
    const series = careerSeries(rows);
    const choice = STAT_CHOICES.find((c) => c.value === state.stat);
    chartBox.replaceChildren(
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px", marginBottom: "6px" } },
        h("strong", null, `${choice.label}${PCT_KEYS.has(state.stat) ? "" : state.mode === "avg" ? " par match" : " sur la saison"}`),
        h("span", { class: "note" }, "Survole la courbe pour le détail de chaque saison.")
      ),
      lineChart(
        series.map((r) => ({
          label: r.season.slice(2),
          value: value(r, state.stat),
          tip: [`Saison ${r.season}`, `${r.tri === "TOT" ? "Plusieurs équipes" : team(r.teamId)?.fullName || r.tri}, ${f.plural(r.gp, "match", "matchs")}`],
        })),
        {
          format: (v) => (PCT_KEYS.has(state.stat) ? `${f.pct(v)} %` : state.mode === "avg" ? f.num(v) : f.int(v)),
          tickFormat: (v) => (PCT_KEYS.has(state.stat) ? `${f.pct(v, 0)} %` : Number.isInteger(v) ? f.int(v) : f.num(v)),
        }
      )
    );

    if (total) {
      summary.textContent = `En carrière : ${f.plural(total.gp, "match", "matchs")}, ${f.int(total.pts)} points, ${f.int(total.reb)} rebonds et ${f.int(total.ast)} passes décisives, soit ${f.num(perGame(total, "pts"))} pts, ${f.num(perGame(total, "reb"))} reb et ${f.num(perGame(total, "ast"))} pd par match.`;
      if (state.type === "regular" && career.allStarGames) summary.textContent += ` ${f.plural(career.allStarGames, "participation", "participations")} au All-Star Game.`;
    }

    const cols = [
      { key: "season", label: "Saison", align: "l", cls: "sticky" },
      { key: "tri", label: "Équipe", align: "l", render: (r) => (r.tri === "TOT" ? "2 équipes ou +" : h("span", { style: { display: "inline-flex", gap: "6px", alignItems: "center" } }, r.teamId ? teamLogo(r.teamId, 18) : null, r.tri)) },
      { key: "age", label: "Âge" },
      { key: "gp", label: "MJ", title: "Matchs joués" },
      { key: "gs", label: "TIT", title: "Titularisations", render: (r) => r.gs ?? "–" },
      { key: "min", label: "MIN", title: "Minutes", render: (r) => fmt("min", value(r, "min")) },
      { key: "pts", label: "PTS", title: "Points", render: (r) => h("b", null, fmt("pts", value(r, "pts"))) },
      { key: "reb", label: "REB", title: "Rebonds", render: (r) => fmt("reb", value(r, "reb")) },
      { key: "ast", label: "PD", title: "Passes décisives", render: (r) => fmt("ast", value(r, "ast")) },
      { key: "stl", label: "INT", title: "Interceptions", render: (r) => fmt("stl", value(r, "stl")) },
      { key: "blk", label: "CTR", title: "Contres", render: (r) => fmt("blk", value(r, "blk")) },
      { key: "tov", label: "BP", title: "Balles perdues", render: (r) => fmt("tov", value(r, "tov")) },
      { key: "fgPct", label: "% tirs", title: "Adresse aux tirs", render: (r) => f.pct(r.fgPct) },
      { key: "tpPct", label: "% 3 pts", title: "Adresse à 3 points", render: (r) => f.pct(r.tpPct) },
      { key: "ftPct", label: "% LF", title: "Adresse aux lancers francs", render: (r) => f.pct(r.ftPct) },
    ];
    const hasTot = new Set(rows.filter((r) => r.tri === "TOT").map((r) => r.season));
    const tableRows = rows.map((r) => ({ ...r }));
    if (total) tableRows.push({ ...total, season: "Carrière", tri: "", teamId: null, age: null, __total: true });
    tableBox.replaceChildren(
      statTable(cols.map((c) => (c.key === "tri" ? { ...c, render: (r) => (r.__total ? "" : c.render(r)) } : c)), tableRows, {
        rowClass: (r) => (r.__total ? "total" : hasTot.has(r.season) && r.tri !== "TOT" ? "dim" : ""),
        caption: "Statistiques saison par saison",
      })
    );
  };

  container.replaceChildren(
    h(
      "div",
      { class: "toolbar" },
      segmented(
        [
          { value: "regular", label: "Saison régulière" },
          { value: "playoffs", label: "Playoffs" },
        ],
        state.type,
        (v) => {
          state.type = v;
          draw();
        },
        "Type de saison"
      ),
      segmented(
        [
          { value: "avg", label: "Par match" },
          { value: "tot", label: "Totaux" },
        ],
        state.mode,
        (v) => {
          state.mode = v;
          draw();
        },
        "Mode"
      )
    ),
    summary,
    h("div", { style: { marginBottom: "10px" } }, chips(STAT_CHOICES, state.stat, (v) => {
      state.stat = v;
      draw();
    }, "Statistique du graphique")),
    chartBox,
    h("div", { class: "section" }, h("h2", { class: "section-title" }, "Saison par saison"), h("p", { class: "note", style: { margin: "-6px 0 12px" } }, "Lignes grisées : détail par équipe d'une saison partagée entre plusieurs clubs."), tableBox)
  );
  draw();
}

const SEASON_TYPES = { "Regular Season": "saison régulière", "Pre Season": "présaison", Playoffs: "playoffs" };

function gamelogView(container, id, ctx) {
  section(
    container,
    () => api(`/player/${id}/gamelog`, { signal: ctx.signal }),
    ({ data }) => {
      if (!data.games.length) return h("p", { class: "note" }, "Aucun match récent.");
      const cols = [
        { key: "date", label: "Date", align: "l", cls: "sticky", render: (g) => h("a", { class: "link", href: `#/match/${g.gameId}` }, f.dayShort(g.date)) },
        {
          key: "opp",
          label: "Adversaire",
          align: "l",
          render: (g) => {
            const t = teamByTri(g.opp);
            return h("span", { style: { display: "inline-flex", gap: "8px", alignItems: "center" } }, g.home ? "contre" : "à", t ? teamLogo(t.id, 20) : null, g.opp);
          },
        },
        { key: "wl", label: "Rés.", title: "Victoire ou défaite", render: (g) => wl(g.wl) },
        { key: "min", label: "MIN", render: (g) => f.int(g.min) },
        { key: "pts", label: "PTS", render: (g) => h("b", { class: g.pts >= 30 ? "hi" : "" }, g.pts) },
        { key: "reb", label: "REB" },
        { key: "ast", label: "PD" },
        { key: "stl", label: "INT" },
        { key: "blk", label: "CTR" },
        { key: "tov", label: "BP" },
        { key: "fg", label: "Tirs", render: (g) => f.ratio(g.fgm, g.fga) },
        { key: "tp", label: "3 pts", render: (g) => f.ratio(g.tpm, g.tpa) },
        { key: "ft", label: "LF", render: (g) => f.ratio(g.ftm, g.fta) },
        { key: "pm", label: "+/-", render: (g) => f.signed(g.pm) },
      ];
      return [
        h("p", { class: "note", style: { margin: "0 0 12px" } }, `Saison ${data.season}, ${SEASON_TYPES[data.type] || data.type}. ${f.plural(data.games.length, "match", "matchs")}, du plus récent au plus ancien.`),
        statTable(cols, data.games, { caption: "Derniers matchs" }),
      ];
    }
  );
}

// ---------------------------------------------------------------- page

function draftText(p) {
  if (p.undrafted) return "Non drafté";
  if (!p.draftYear) return "–";
  if (!p.draftRound) return String(p.draftYear);
  return `${p.draftYear}, ${p.draftRound === 1 ? "1er" : `${p.draftRound}e`} tour, ${p.draftNumber === 1 ? "1er" : `${p.draftNumber}e`} choix`;
}

function heroView(p) {
  const t = p.teamId ? team(p.teamId) : null;
  const band = t ? teamBand(t.id) : { bg: "var(--surface-2)", ink: "var(--text)" };
  const pic = headshot(p.id, { size: "big", cls: "shot", alt: p.name });
  const badges = [];
  if (p.greatest75) badges.push(h("span", { class: "badge" }, "Parmi les 75 plus grands joueurs de l'histoire"));
  if (!p.active) badges.push(h("span", { class: "badge" }, p.to ? `Carrière terminée en ${p.to}` : "Retraité"));
  const metaBits = [];
  if (t && p.active) metaBits.push(h("a", { href: `#/equipe/${t.id}`, style: { display: "inline-flex", gap: "8px", alignItems: "center" } }, teamLogo(t.id, 20, "", { plate: true }), t.fullName));
  if (p.jersey && p.active) metaBits.push(h("span", null, `n° ${p.jersey}`));
  if (p.pos) metaBits.push(h("span", null, f.position(p.pos)));
  return h(
    "section",
    { class: "hero player-hero", style: { "--team-bg": band.bg, "--team-ink": band.ink } },
    p.jersey && p.active ? h("div", { class: "jersey", "aria-hidden": "true" }, p.jersey) : null,
    pic,
    h(
      "div",
      { class: "info" },
      h("div", { class: "first" }, p.first),
      h("h1", null, p.last),
      h("div", { class: "hero-meta" }, metaBits),
      badges.length ? h("div", { class: "hero-meta", style: { marginTop: "12px" } }, badges) : null
    )
  );
}

function factsView(p) {
  const years = p.from ? `${p.from}–${p.active ? "aujourd'hui" : p.to}` : "–";
  const item = (k, v) => (v ? h("div", null, h("dt", null, k), h("dd", null, v)) : null);
  const ageNow = f.age(p.birth);
  return h(
    "dl",
    { class: "facts" },
    item("Naissance", p.birth ? `${f.dateLong(p.birth)}${p.active && ageNow !== null ? ` (${ageNow} ans)` : ""}` : ""),
    item("Pays", f.country(p.country)),
    item("Taille", f.heightM(p.height)),
    item("Poids", f.weightKg(p.weight)),
    item("Formation", p.school),
    item("Draft", draftText(p)),
    item("Carrière NBA", years),
    item("Expérience", p.exp ? f.plural(p.exp, "saison", "saisons") : p.active ? "Rookie" : "")
  );
}

export async function render(ctx) {
  const id = Number(ctx.params[0]);
  ctx.outlet.append(loading("Chargement de la fiche…"));
  let info;
  try {
    info = (await api(`/player/${id}`, { signal: ctx.signal })).data;
  } catch (err) {
    if (err.name === "AbortError") return;
    ctx.outlet.replaceChildren(errorState(err, () => location.reload()));
    return;
  }
  document.title = `${info.name} · Parquet`;
  ctx.onCleanup(() => (document.title = "Parquet"));

  const headline = info.headline && info.headline.pts !== null
    ? h(
        "div",
        { class: "section", style: { marginTop: "22px" } },
        h("div", { class: "tiles" },
          h("div", { class: "tile" }, h("div", { class: "k" }, "Points par match"), h("div", { class: "v" }, f.num(info.headline.pts)), h("div", { class: "s" }, info.headline.season === "Career" ? "en carrière" : `saison ${info.headline.season}`)),
          h("div", { class: "tile" }, h("div", { class: "k" }, "Rebonds par match"), h("div", { class: "v" }, f.num(info.headline.reb)), h("div", { class: "s" }, info.headline.season === "Career" ? "en carrière" : `saison ${info.headline.season}`)),
          h("div", { class: "tile" }, h("div", { class: "k" }, "Passes par match"), h("div", { class: "v" }, f.num(info.headline.ast)), h("div", { class: "s" }, info.headline.season === "Career" ? "en carrière" : `saison ${info.headline.season}`))
        )
      )
    : null;

  const panel = h("div");
  let tab = "profile";
  let careerPromise = null;
  const career = () => {
    if (!careerPromise) {
      careerPromise = api(`/player/${id}/career`, { signal: ctx.signal })
        .then((r) => r.data)
        .catch((err) => {
          careerPromise = null;
          throw err;
        });
    }
    return careerPromise;
  };

  const drawTab = () => {
    if (tab === "profile") {
      const bio = h("div");
      const highs = h("div");
      const awards = h("div");
      const path = h("div");
      panel.replaceChildren(
        h(
          "div",
          { class: "profile-grid" },
          h("div", null, h("h2", { class: "section-title" }, "Biographie"), bio, h("div", { class: "section" }, h("h2", { class: "section-title" }, "Records en carrière"), highs)),
          h("div", null, h("h2", { class: "section-title" }, "Palmarès"), awards, h("div", { class: "section" }, h("h2", { class: "section-title" }, "Parcours en NBA"), path))
        )
      );
      section(bio, () => api(`/player/${id}/bio`, { signal: ctx.signal }), ({ data }) => {
        if (!data) return h("p", { class: "note" }, "Pas d'article Wikipédia trouvé pour ce joueur.");
        return [
          h("div", { class: "prose" }, data.paragraphs.map((p) => h("p", null, p))),
          h("p", { class: "source" }, "Source : ", h("a", { class: "link", href: data.url, target: "_blank", rel: "noopener" }, `Wikipédia${data.lang === "en" ? " (en anglais)" : ""}, « ${data.title} »`), " (CC BY-SA)."),
        ];
      });
      section(awards, () => api(`/player/${id}/awards`, { signal: ctx.signal }), ({ data }) => awardsView(data.awards));
      section(path, career, (c) => stintsView(c.regular));
      section(highs, career, (c) => highsView(c.careerHighs));
    } else if (tab === "stats") {
      section(panel, career, (c) => {
        const box = h("div");
        statsView(box, c);
        return box;
      });
    } else {
      gamelogView(panel, id, ctx);
    }
  };

  ctx.outlet.replaceChildren(
    heroView(info),
    factsView(info),
    headline || "",
    tabs(
      [
        { id: "profile", label: "Profil" },
        { id: "stats", label: "Statistiques" },
        { id: "games", label: "Derniers matchs" },
      ],
      tab,
      (v) => {
        tab = v;
        drawTab();
      }
    ),
    panel
  );
  drawTab();
}
