// Page d'un match : tableau d'affichage, résumé, box score, action par action, carte des tirs.

import { api } from "../api.js";
import { h, s } from "../dom.js";
import * as f from "../format.js";
import { compareRows, gameFlowChart, leadSeries, leadStats, shotChart } from "../charts.js";
import { chips, errorState, headshot, loading, playerCell, section, segmented, statTable, staleBanner, tabs, teamLogo, wl } from "../components.js";
import { team, teamPair } from "../teams.js";
import { gameKey, isHidden, isRevealed as isRevealedKey, setRevealed } from "../spoiler.js";

const TAB_DEFS = [
  { id: "resume", label: "Résumé" },
  { id: "box", label: "Box score" },
  { id: "pbp", label: "Action par action" },
  { id: "shots", label: "Carte des tirs" },
];

function sideName(side) {
  const t = team(side?.id);
  return { city: side?.city || t?.city || "", name: side?.name || t?.name || "À déterminer" };
}

function scoreboard(game, previous, { onToggleReveal, isRevealed } = {}) {
  const colors = teamPair(game.away?.id, game.home?.id);
  const status = f.gameStatus(game);
  const started = game.status >= 2;
  const winner = game.status === 3 ? (game.away.score > game.home.score ? "away" : "home") : null;

  const teamBlock = (key) => {
    const side = game[key];
    const n = sideName(side);
    const rec = side?.wins !== null && side?.wins !== undefined && side.wins + side.losses > 0 ? `${side.wins}-${side.losses}` : "";
    return h(
      "a",
      { class: `sb-team ${key}`, href: side?.id ? `#/equipe/${side.id}` : null },
      teamLogo(side?.id, 76, n.name),
      h("div", { class: "names" }, h("div", { class: "city" }, n.city), h("div", { class: "nick" }, n.name), rec ? h("div", { class: "rec" }, `Bilan ${rec}`) : null)
    );
  };

  let center;
  if (started) {
    const sc = (key) => {
      const el = h("span", { class: winner && winner !== key ? "lose" : "" }, String(game[key]?.score ?? 0));
      if (previous && previous[key] !== undefined && game[key]?.score > previous[key]) el.classList.add("bump");
      return el;
    };

    let revealBtn = null;
    if (onToggleReveal) {
      revealBtn = h(
        "button",
        {
          type: "button",
          class: "btn sb-reveal-btn",
          "aria-label": isRevealed ? "Masquer le score du match" : "Révéler le score du match",
        },
        isRevealed ? "Masquer le score" : "Révéler le score"
      );
      revealBtn.addEventListener("click", (e) => {
        e.preventDefault();
        onToggleReveal();
      });
    }

    const scoresEl = h(
      "div",
      {
        class: "sb-scores num",
        title: onToggleReveal && document.documentElement.dataset.spoiler === "1" ? "Cliquer pour révéler ou masquer le score" : null,
        "aria-label": onToggleReveal && document.documentElement.dataset.spoiler === "1" && !isRevealed ? "Score masqué" : `${game.away?.score} à ${game.home?.score}`,
      },
      sc("away"),
      h("span", { class: "dash" }, "–"),
      sc("home")
    );
    if (onToggleReveal) {
      scoresEl.addEventListener("click", (e) => {
        if (document.documentElement.dataset.spoiler === "1") {
          e.preventDefault();
          onToggleReveal();
        }
      });
    }

    center = h(
      "div",
      { class: "sb-center" },
      scoresEl,
      h("div", { class: `sb-status${status.live ? " live" : ""}` }, status.live ? h("span", { class: "live-dot", "aria-hidden": "true" }) : null, status.text),
      revealBtn
    );
  } else {
    center = h(
      "div",
      { class: "sb-center" },
      h("div", { class: "sb-time" }, game.start ? f.clockTime(game.start) : "–", h("small", null, game.start ? `${f.localDayShort(game.start)}, heure de Paris` : status.text))
    );
  }

  const meta = [
    [game.arena, game.arenaCity].filter(Boolean).join(", "),
    game.attendance ? `${f.int(game.attendance)} spectateurs` : "",
    game.series || f.gameLabel(game),
  ].filter(Boolean);

  return h(
    "div",
    { class: "scoreboard", style: { "--away": colors.away, "--home": colors.home } },
    h("div", { class: "sb-grid" }, teamBlock("away"), center, teamBlock("home")),
    meta.length ? h("p", { class: "sb-meta" }, meta.join(". ")) : null
  );
}

function periodsTable(game) {
  const n = Math.max(4, game.away?.periods?.length || 0, game.home?.periods?.length || 0);
  const head = ["Équipe"];
  for (let p = 1; p <= n; p++) head.push(p <= 4 ? String(p) : f.periodName(p));
  head.push("Total");
  const row = (key) => {
    const side = game[key];
    const cells = [h("td", null, h("span", { class: "team-cell", style: { display: "inline-flex", gap: "8px", alignItems: "center" } }, teamLogo(side?.id, 22), side?.tri || ""))];
    for (let p = 0; p < n; p++) cells.push(h("td", { class: "num" }, side?.periods?.[p] ?? "–"));
    cells.push(h("td", { class: "total num" }, side?.score ?? "–"));
    return h("tr", null, cells);
  };
  return h(
    "table",
    { class: "periods-table" },
    h("thead", null, h("tr", null, head.map((x) => h("th", { scope: "col" }, x)))),
    h("tbody", null, row("away"), row("home"))
  );
}

function leaderCards(box) {
  const cats = [
    { key: "pts", label: "Points" },
    { key: "reb", label: "Rebonds" },
    { key: "ast", label: "Passes décisives" },
  ];
  const grid = h("div", { class: "leaders-duo" });
  for (const c of cats) {
    const card = h("div", { class: "leader-card" }, h("h3", null, c.label));
    for (const key of ["away", "home"]) {
      const players = box.teams[key].players.filter((p) => p.played);
      if (!players.length) continue;
      const best = players.reduce((a, b) => (b[c.key] > a[c.key] ? b : a));
      card.append(
        h(
          "a",
          { class: "leader-line", href: `#/joueur/${best.id}` },
          headshot(best.id, { cls: "headshot pic", alt: "" }),
          h("div", null, h("div", { style: { fontWeight: 650 } }, best.name), h("div", { class: "note" }, box.game[key]?.tri)),
          h("span", { class: "v" }, best[c.key])
        )
      );
    }
    grid.append(card);
  }
  return grid;
}

function resume(box) {
  const g = box.game;
  const a = box.teams.away.stats;
  const b = box.teams.home.stats;
  const colors = teamPair(g.away?.id, g.home?.id);
  const pctFmt = (v) => (v === null || v === undefined ? "–" : `${f.pct(v)} %`);
  const rows = [
    { label: "Adresse au tir", away: a.fgPct, home: b.fgPct, format: pctFmt },
    { label: "À 3 points", away: a.tpPct, home: b.tpPct, format: pctFmt },
    { label: "Lancers francs", away: a.ftPct, home: b.ftPct, format: pctFmt },
    { label: "Rebonds", away: a.reb, home: b.reb },
    { label: "Passes décisives", away: a.ast, home: b.ast },
    { label: "Interceptions", away: a.stl, home: b.stl },
    { label: "Contres", away: a.blk, home: b.blk },
    { label: "Balles perdues", away: a.tov, home: b.tov, lowerIsBetter: true },
    { label: "Points dans la raquette", away: a.paint, home: b.paint },
    { label: "Contre-attaque", away: a.fast, home: b.fast },
    { label: "Points du banc", away: a.bench, home: b.bench },
    { label: "Plus gros écart", away: a.biggestLead, home: b.biggestLead },
  ].filter((r) => r.away !== null && r.away !== undefined && r.home !== null && r.home !== undefined);

  const facts = [];
  if (g.officials?.length) facts.push(h("span", null, h("b", null, "Arbitres"), g.officials.join(", ")));
  if (g.attendance) facts.push(h("span", null, h("b", null, "Affluence"), `${f.int(g.attendance)} spectateurs${g.sellout ? " (complet)" : ""}`));
  if (g.duration) facts.push(h("span", null, h("b", null, "Durée"), `${Math.floor(g.duration / 60)} h ${String(g.duration % 60).padStart(2, "0")}`));
  if (a.leadChanges !== null && a.leadChanges !== undefined) facts.push(h("span", null, h("b", null, "Changements de leader"), String(a.leadChanges)));
  if (a.timesTied !== null && a.timesTied !== undefined) facts.push(h("span", null, h("b", null, "Égalités"), String(a.timesTied)));

  return [
    h(
      "div",
      { class: "two-col" },
      h("div", null, h("h2", { class: "section-title" }, "Score par quart-temps"), periodsTable(g), facts.length ? h("div", { class: "facts-inline", style: { marginTop: "18px" } }, facts) : null),
      h("div", null, h("h2", { class: "section-title" }, "Duel des équipes"), compareRows(rows, colors, { away: g.away?.tri, home: g.home?.tri }))
    ),
    h("div", { class: "section" }, h("h2", { class: "section-title" }, "Meilleurs joueurs du match"), leaderCards(box)),
  ];
}

function boxTable(box, key) {
  const t = box.teams[key];
  const side = box.game[key];
  const live = box.game.status === 2;
  const players = t.players.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const starters = players.filter((p) => p.starter && p.played);
  const bench = players.filter((p) => !p.starter && p.played).sort((a, b) => b.sec - a.sec);
  const out = players.filter((p) => !p.played);
  const rows = [];
  if (starters.length) rows.push({ __group: "Cinq de départ" }, ...starters);
  if (bench.length) rows.push({ __group: "Banc" }, ...bench);

  const columns = [
    {
      key: "name",
      label: "Joueur",
      align: "l",
      cls: "sticky",
      render: (p) =>
        playerCell(p.id, p.name, [p.jersey ? `n° ${p.jersey}` : "", f.position(p.pos)].filter(Boolean).join(", ") || null),
    },
    { key: "min", label: "MIN", title: "Minutes jouées", render: (p) => h("span", null, live && p.oncourt ? h("span", { class: "oncourt", title: "Sur le terrain", style: { marginRight: "6px" } }) : null, p.min || "–") },
    { key: "pts", label: "PTS", title: "Points", render: (p) => h("b", null, p.pts) },
    { key: "reb", label: "REB", title: "Rebonds (offensifs + défensifs)" },
    { key: "ast", label: "PD", title: "Passes décisives" },
    { key: "stl", label: "INT", title: "Interceptions" },
    { key: "blk", label: "CTR", title: "Contres" },
    { key: "tov", label: "BP", title: "Balles perdues" },
    { key: "pf", label: "F", title: "Fautes personnelles" },
    { key: "fg", label: "Tirs", title: "Tirs réussis / tentés", render: (p) => f.ratio(p.fgm, p.fga) },
    { key: "tp", label: "3 pts", title: "Tirs à 3 points réussis / tentés", render: (p) => f.ratio(p.tpm, p.tpa) },
    { key: "ft", label: "LF", title: "Lancers francs réussis / tentés", render: (p) => f.ratio(p.ftm, p.fta) },
    { key: "pm", label: "+/-", title: "Écart au score quand le joueur était sur le terrain", render: (p) => f.signed(p.pm) },
  ];
  const ts = t.stats;
  rows.push({ __total: true, name: "Équipe", min: "", pts: ts.pts, reb: ts.reb, ast: ts.ast, stl: ts.stl, blk: ts.blk, tov: ts.tov, pf: ts.pf, fgm: ts.fgm, fga: ts.fga, tpm: ts.tpm, tpa: ts.tpa, ftm: ts.ftm, fta: ts.fta, pm: null });
  const totalColumns = columns.map((c) => (c.key === "name" ? { ...c, render: (p) => (p.__total ? h("b", null, "Total") : c.render(p)) } : c.key === "min" ? { ...c, render: (p) => (p.__total ? "" : c.render(p)) } : c.key === "pm" ? { ...c, render: (p) => (p.__total ? "" : c.render(p)) } : c));

  const wrap = h(
    "div",
    { class: "section" },
    h("h2", { class: "section-title", style: { display: "flex", alignItems: "center", gap: "10px" } }, teamLogo(side?.id, 30), sideName(side).name),
    statTable(totalColumns, rows, { rowClass: (r) => (r.__total ? "total" : ""), caption: `Box score ${sideName(side).name}` })
  );
  if (out.length) {
    wrap.append(
      h(
        "p",
        { class: "note", style: { marginTop: "10px" } },
        "N'ont pas joué : ",
        out.map((p, i) => [i ? ", " : "", h("a", { class: "link", href: `#/joueur/${p.id}` }, p.name), p.reason ? ` (${p.reason.toLowerCase()})` : ""])
      )
    );
  }
  return wrap;
}

const MINOR = new Set(["substitution", "timeout", "period", "jumpball", "game", "instantreplay", "stoppage"]);

function pbpView(pbp, game, state, rerender) {
  const actions = pbp.actions || [];
  if (!actions.length) return h("p", { class: "note" }, "Le fil des actions démarrera au coup d'envoi.");
  const periods = [...new Set(actions.map((a) => a.period))].filter(Boolean);
  // Pendant un match en direct, on suit la période en cours tant qu'on n'en a pas choisi une autre.
  const selected = state.period === "current" ? periods.at(-1) || 0 : state.period;
  const controls = h(
    "div",
    { class: "toolbar" },
    chips([{ value: 0, label: "Tout le match" }, ...periods.map((p) => ({ value: p, label: f.periodName(p) }))], selected, (v) => {
      state.period = v;
      rerender();
    }, "Période"),
    segmented(
      [
        { value: "all", label: "Toutes les actions" },
        { value: "scoring", label: "Paniers marqués" },
      ],
      state.filter,
      (v) => {
        state.filter = v;
        rerender();
      },
      "Filtre"
    )
  );
  let list = actions.filter((a) => (!selected || a.period === selected) && a.type !== "substitution");
  if (state.filter === "scoring") list = list.filter((a) => a.scoring);
  const live = game.status === 2;
  if (live) list = list.slice().reverse();

  const rows = h("div", { class: "pbp" });
  let currentPeriod = null;
  for (const a of list) {
    if (a.period !== currentPeriod) {
      currentPeriod = a.period;
      rows.append(h("div", { class: "pbp-period" }, f.periodName(a.period, false)));
    }
    const minor = MINOR.has(a.type);
    rows.append(
      h(
        "div",
        { class: `pbp-row${a.scoring ? " scoring" : ""}${minor ? " minor" : ""}` },
        h("span", { class: "clock num" }, a.clock),
        a.teamId ? teamLogo(a.teamId, 22) : h("span"),
        h("span", { class: "desc" }, a.desc || a.type),
        h("span", { class: "score num" }, `${a.away}-${a.home}`)
      )
    );
  }
  if (!list.length) rows.append(h("p", { class: "note" }, "Aucune action pour ce filtre."));
  return [controls, rows];
}

function shotsView(pbp, game, state, rerender) {
  const shots = (pbp.actions || []).filter((a) => a.fg && a.x !== null && a.y !== null);
  if (!shots.length) return h("p", { class: "note" }, "Aucun tir pour l'instant.");
  const colors = teamPair(game.away?.id, game.home?.id);
  const grid = h("div", { class: "shots-grid" });
  for (const key of ["away", "home"]) {
    const side = game[key];
    const mine = shots.filter((sh) => sh.teamId === side?.id);
    const playersList = [...new Map(mine.filter((x) => x.personId).map((x) => [x.personId, x.player])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const select = h("select", { class: "select", "aria-label": `Filtrer les tirs de ${sideName(side).name}` }, h("option", { value: "" }, "Tous les joueurs"), playersList.map(([id, name]) => h("option", { value: id, selected: String(state.player[key]) === String(id) ? true : null }, name)));
    select.addEventListener("change", () => {
      state.player[key] = select.value ? Number(select.value) : null;
      rerender();
    });
    const shown = state.player[key] ? mine.filter((x) => x.personId === state.player[key]) : mine;
    const made = shown.filter((x) => x.made).length;
    const three = shown.filter((x) => x.three);
    const threeMade = three.filter((x) => x.made).length;
    const enriched = shown.map((x) => ({ ...x, when: `${f.periodName(x.period)} ${x.clock}` }));
    grid.append(
      h(
        "div",
        { class: "court-card" },
        h("h3", null, teamLogo(side?.id, 26), sideName(side).name, h("span", { class: "sub" }, `${made}/${shown.length} aux tirs, ${threeMade}/${three.length} à 3 pts`)),
        h("div", { style: { marginBottom: "10px" } }, select),
        shotChart(enriched, colors[key])
      )
    );
  }
  const madeKey = s("svg", { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": "true" }, s("circle", { cx: 7, cy: 7, r: 5, style: { fill: "var(--text-2)" } }));
  const missKey = s(
    "svg",
    { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": "true" },
    s("path", { d: "M3,3L11,11M11,3L3,11", style: { stroke: "var(--muted)", strokeWidth: "2", strokeLinecap: "round" } })
  );
  return [
    grid,
    h(
      "div",
      { class: "legend", style: { marginTop: "12px" } },
      h("span", null, madeKey, "Tir réussi (couleur de l'équipe)"),
      h("span", null, missKey, "Tir manqué"),
      h("span", { class: "muted" }, "Survole un tir pour voir qui l'a pris et quand.")
    ),
  ];
}

async function pregame(container, game, ctx) {
  const forms = h("div", { class: "two-col" });
  container.append(
    h("div", { class: "banner", style: { marginTop: "18px" } }, "Le box score, le fil des actions et la carte des tirs apparaîtront au coup d'envoi. La page se met à jour toute seule."),
    h("div", { class: "section" }, h("h2", { class: "section-title" }, "Forme du moment"), forms)
  );
  if (game.tv?.length) container.append(h("p", { class: "note" }, `Diffusion aux États-Unis : ${game.tv.join(", ")}.`));
  for (const key of ["away", "home"]) {
    const side = game[key];
    const box = h("div");
    forms.append(h("div", null, h("h3", { style: { display: "flex", gap: "10px", alignItems: "center", marginBottom: "10px" } }, teamLogo(side?.id, 26), sideName(side).name), box));
    if (!side?.id) {
      box.append(h("p", { class: "note" }, "Équipe pas encore connue."));
      continue;
    }
    section(
      box,
      () => api(`/team/${side.id}/schedule`, { signal: ctx.signal }),
      ({ data }) => {
        const played = data.games.filter((g) => g.status === 3).slice(-5).reverse();
        if (!played.length) return h("p", { class: "note" }, "Pas encore de match joué cette saison.");
        return played.map((g) => {
          const home = g.home?.id === side.id;
          const me = home ? g.home : g.away;
          const opp = home ? g.away : g.home;
          const won = me.score > opp.score;
          return h(
            "a",
            { class: "sched-row", href: `#/match/${g.id}` },
            h("span", { class: "date" }, f.dayShort(g.etDate)),
            teamLogo(opp?.id, 24),
            h("span", { class: "opp" }, `${home ? "contre" : "à"} ${sideName(opp).name}`, g.kind === "pre" ? h("small", null, " (présaison)") : null),
            h("span", { class: "res num" }, wl(won ? "W" : "L"), `${me.score}-${opp.score}`)
          );
        });
      }
    );
  }
}

export async function render(ctx) {
  const id = ctx.params[0];
  const wrapper = h("div", { class: "game-page" });
  const head = h("div");
  const body = h("div");
  wrapper.append(head, body);
  ctx.outlet.append(wrapper);
  head.append(loading("Chargement du match…"));

  let boxRes;
  try {
    boxRes = await api(`/game/${id}`, { signal: ctx.signal });
  } catch (err) {
    if (err.name === "AbortError") return;
    head.replaceChildren(errorState(err, () => location.reload()));
    return;
  }

  let box = boxRes.data;
  let meta = boxRes.meta;
  let pbp = null;
  let tab = "resume";
  let previous = null;
  const key = gameKey(id);
  let isRevealed = isRevealedKey(key);
  wrapper.classList.toggle("is-revealed", isRevealed);
  const toggleReveal = () => {
    isRevealed = !isRevealed;
    setRevealed(key, isRevealed);
    wrapper.classList.toggle("is-revealed", isRevealed);
    drawHead();
    drawBody();
  };
  const pbpState = { period: box.game.status === 2 ? "current" : 0, filter: "all" };
  const shotState = { player: { away: null, home: null } };
  const panel = h("div");

  document.title = `${box.game.away?.tri || "?"} – ${box.game.home?.tri || "?"} · Parquet`;
  ctx.onCleanup(() => (document.title = "Parquet"));

  const drawHead = () => {
    head.replaceChildren(staleBanner(meta) || "", scoreboard(box.game, previous, { onToggleReveal: toggleReveal, isRevealed }));
  };

  const ensurePbp = async () => {
    if (!pbp) pbp = (await api(`/game/${id}/pbp`, { signal: ctx.signal })).data;
  };

  // Scénario du match : courbe de l'écart au score, tirée du fil des actions.
  const drawFlow = async (el) => {
    if (!pbp) el.replaceChildren(loading("Chargement du scénario du match…"));
    try {
      await ensurePbp();
    } catch (err) {
      if (err.name !== "AbortError") el.replaceChildren(h("p", { class: "note" }, `Scénario indisponible (${err.message}).`));
      return;
    }
    if (!ctx.active || !pbp.actions?.length) {
      el.replaceChildren();
      return;
    }
    const g = box.game;
    const colors = teamPair(g.away?.id, g.home?.id);
    const { points } = leadSeries(pbp.actions);
    const st = leadStats(points);
    const lead = (p, tri) => `${tri} +${Math.abs(p.lead)} (${p.period <= 4 ? `Q${p.period}` : "prolongation"}, ${p.clock})`;
    const facts = [
      st.maxAway.lead < 0 ? `Plus gros écart ${g.away?.tri} : ${lead(st.maxAway, g.away?.tri)}` : `${g.away?.tri} n'a jamais mené`,
      st.maxHome.lead > 0 ? `Plus gros écart ${g.home?.tri} : ${lead(st.maxHome, g.home?.tri)}` : `${g.home?.tri} n'a jamais mené`,
      `${f.plural(st.changes, "changement", "changements")} de leader`,
      `${f.plural(st.ties, "égalité", "égalités")}`,
    ];
    el.replaceChildren(
      h("h2", { class: "section-title" }, "Scénario du match"),
      h(
        "p",
        { class: "legend", style: { margin: "-4px 0 10px" } },
        h("span", null, h("i", { class: "key-swatch", style: { background: colors.home } }), `Au-dessus : ${sideName(g.home).name} mènent`),
        h("span", null, h("i", { class: "key-swatch", style: { background: colors.away } }), `En dessous : ${sideName(g.away).name} mènent`)
      ),
      h("div", { class: "chart-card" }, gameFlowChart(pbp.actions, { awayColor: colors.away, homeColor: colors.home, awayTri: g.away?.tri, homeTri: g.home?.tri, live: g.status === 2 })),
      h("p", { class: "note", style: { marginTop: "10px" } }, facts.join(". ") + ".")
    );
  };

  const drawPanel = async () => {
    if (!box.available) return;
    if (tab === "resume") {
      const parts = resume(box);
      const flow = h("div", { class: "section" });
      panel.replaceChildren(parts[0], flow, ...parts.slice(1));
      drawFlow(flow);
    }
    else if (tab === "box") panel.replaceChildren(boxTable(box, "away"), boxTable(box, "home"));
    else {
      if (!pbp) panel.replaceChildren(loading("Chargement des actions…"));
      try {
        await ensurePbp();
      } catch (err) {
        if (err.name !== "AbortError") panel.replaceChildren(errorState(err, drawPanel));
        return;
      }
      if (tab === "pbp") panel.replaceChildren(...[pbpView(pbp, box.game, pbpState, drawPanel)].flat());
      else panel.replaceChildren(...[shotsView(pbp, box.game, shotState, drawPanel)].flat());
    }
  };

  // En mode anti-spoiler, le box score, les actions et les tirs donnent le score :
  // ils restent cachés derrière un écran tant que le match n'est pas révélé.
  let gated = null;
  const drawBody = () => {
    if (!box.available) return;
    const hide = isHidden(key) && box.game.status >= 2;
    if (hide === gated && body.childNodes.length) return;
    gated = hide;
    if (hide) {
      body.replaceChildren(
        h(
          "div",
          { class: "spoiler-gate" },
          h("p", null, h("strong", null, "Mode anti-spoiler actif. "), "Le box score, le fil des actions et la carte des tirs donnent le résultat : ils restent masqués."),
          h("button", { class: "btn primary", type: "button", onclick: toggleReveal }, "Révéler le match")
        )
      );
      return;
    }
    body.replaceChildren(
      tabs(TAB_DEFS, tab, (t) => {
        tab = t;
        drawPanel();
      }),
      panel
    );
    drawPanel();
  };

  drawHead();
  if (box.available) drawBody();
  else pregame(body, box.game, ctx);

  // Actualisation automatique pendant le match (et juste avant le coup d'envoi).
  const delay = () => (box.game.status === 2 ? 10000 : box.game.status === 1 ? 30000 : 0);
  if (box.game.status !== 3) {
    ctx.every(
      () => delay() || 600000,
      async () => {
        if (box.game.status === 3 && box.available) return;
        const wasAvailable = box.available;
        previous = { away: box.game.away?.score, home: box.game.home?.score };
        const res = await api(`/game/${id}`, { signal: ctx.signal });
        box = res.data;
        meta = res.meta;
        drawHead();
        if (!wasAvailable && box.available) {
          // Le match vient de commencer : on bascule vers l'affichage complet.
          gated = null;
          drawBody();
        }
        if (pbp) pbp = (await api(`/game/${id}/pbp`, { signal: ctx.signal })).data;
        if (box.available && !gated) drawPanel();
      }
    );
  }
}
