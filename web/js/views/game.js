// Page d'un match : tableau d'affichage, résumé, box score, action par action, carte des tirs.

import { api } from "../api.js";
import { h, s } from "../dom.js";
import * as f from "../format.js";
import { compareRows, gameFlowChart, shotChart } from "../charts.js";
import { chips, errorState, headshot, loading, playerCell, section, segmented, statTable, staleBanner, swapIn, tabs, teamLogo, wl } from "../components.js";
import { team, teamPair } from "../teams.js";
import { gameKey, isHidden, isRevealed as isRevealedKey, setRevealed } from "../spoiler.js";
import { momentCard, nbaRecapCard, youtubeBlock } from "../media.js";
import { injuryRow } from "../news.js";
import { openShareDialog } from "../share-card.js";

const TAB_DEFS = [
  { id: "resume", label: "Résumé" },
  { id: "videos", label: "Vidéos" },
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
    { class: "scoreboard", style: { "--away": colors.away, "--home": colors.home, "--team": colors.away } },
    h("div", { class: "stage-band back", "aria-hidden": "true" }),
    h("div", { class: "stage-band back thin", "aria-hidden": "true" }),
    h("div", { class: "sb-grid" }, teamBlock("away"), center, teamBlock("home")),
    meta.length || (game.away?.id && game.home?.id)
      ? h(
          "p",
          { class: "sb-meta" },
          meta.join(". "),
          game.away?.id && game.home?.id ? [meta.length ? " " : "", h("a", { class: "sb-h2h", href: `#/face-a-face/${game.away.id}/${game.home.id}` }, "Historique des confrontations")] : null
        )
      : null
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

// Les joueurs qui ont marqué le match, côte à côte pour chaque équipe, avec leur portrait.
function standouts(box) {
  const wrap = h("div", { class: "standouts" });
  for (const key of ["away", "home"]) {
    const players = box.teams[key].players.filter((p) => p.played);
    if (!players.length) continue;
    const picks = [];
    for (const stat of ["pts", "reb", "ast"]) {
      const best = players.reduce((a, b) => (b[stat] > a[stat] ? b : a));
      if (!picks.includes(best)) picks.push(best);
    }
    wrap.append(
      h(
        "div",
        { class: `standouts-team ${key}` },
        picks.map((p, i) =>
          h(
            "a",
            { class: `standout${i === 0 ? " lead" : ""}`, href: `#/joueur/${p.id}` },
            headshot(p.id, { size: i === 0 ? "big" : "small", alt: "" }),
            h("span", { class: "nm" }, p.name),
            h("span", { class: "ln num" }, `${p.pts} pts ${p.reb} reb ${p.ast} pd`),
            h("span", { class: "tm" }, teamLogo(box.game[key]?.id, 16), box.game[key]?.tri)
          )
        )
      )
    );
  }
  return wrap;
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
    standouts(box),
    h(
      "div",
      { class: "two-col resume-grid" },
      h("div", null, periodsTable(g), facts.length ? h("div", { class: "facts-inline", style: { marginTop: "18px" } }, facts) : null),
      h("div", null, compareRows(rows, colors, { away: g.away?.tri, home: g.home?.tri }))
    ),
  ];
}

function boxTable(box, key, focusId = null) {
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
    { class: "section box-side", dataset: { side: key } },
    h("h2", { class: "section-title", style: { display: "flex", alignItems: "center", gap: "10px" } }, teamLogo(side?.id, 30), sideName(side).name),
    h("div", { class: "box-table-view" }, statTable(totalColumns, rows, { rowClass: (r) => (r.__total ? "total" : r.id === focusId ? "is-focus" : ""), caption: `Box score ${sideName(side).name}`, compact: false })),
    boxCards(rows, live, focusId)
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

// Box score sur téléphone : une ligne par joueur, lisible sans faire défiler de côté. Les points en
// grand à droite, les autres chiffres en dessous du nom, les meilleurs de l'équipe en orange.
function boxCards(rows, live, focusId = null) {
  const players = rows.filter((r) => !r.__group && !r.__total);
  const best = {};
  for (const k of ["pts", "reb", "ast", "stl", "blk"]) best[k] = Math.max(1, ...players.map((p) => p[k] || 0));
  const stat = (p, k, label, always = true) =>
    always || p[k] ? h("span", { class: `bc-stat${(p[k] || 0) === best[k] ? " is-best" : ""}` }, h("b", { class: "num" }, String(p[k] ?? 0)), ` ${label}`) : null;
  const shooting = (m, a, label) => (a ? `${label} ${m}/${a}` : null);

  return h(
    "div",
    { class: "box-cards" },
    rows.map((r) => {
      if (r.__group) return h("div", { class: "bc-group" }, r.__group);
      if (r.__total) {
        return h(
          "div",
          { class: "bc-row bc-total" },
          h(
            "div",
            { class: "bc-main" },
            h("div", { class: "bc-name" }, h("b", null, "Équipe")),
            h("div", { class: "bc-stats" }, stat(r, "reb", "reb"), stat(r, "ast", "pd"), stat(r, "stl", "int"), stat(r, "blk", "ctr"), stat(r, "tov", "bp")),
            h(
              "div",
              { class: "bc-more num" },
              [
                shooting(r.fgm, r.fga, "Tirs") && `${shooting(r.fgm, r.fga, "Tirs")} (${f.pct(r.fga ? r.fgm / r.fga : null)} %)`,
                shooting(r.tpm, r.tpa, "3 pts") && `${shooting(r.tpm, r.tpa, "3 pts")} (${f.pct(r.tpa ? r.tpm / r.tpa : null)} %)`,
                shooting(r.ftm, r.fta, "LF"),
              ]
                .filter(Boolean)
                .join("  ·  ")
            )
          ),
          h("div", { class: "bc-pts" }, h("b", { class: "num" }, String(r.pts ?? 0)), h("small", null, "pts"))
        );
      }
      const p = r;
      const more = [
        p.min ? `${p.min} min` : null,
        shooting(p.fgm, p.fga, "Tirs"),
        shooting(p.tpm, p.tpa, "3 pts"),
        shooting(p.ftm, p.fta, "LF"),
        p.pm !== null && p.pm !== undefined ? `${f.signed(p.pm)}` : null,
        p.pf >= 5 ? `${p.pf} fautes` : null,
      ].filter(Boolean);
      return h(
        "a",
        { class: p.id === focusId ? "bc-row is-focus" : "bc-row", href: `#/joueur/${p.id}` },
        h("span", { class: "bc-photo" }, headshot(p.id, { alt: "" })),
        h(
          "div",
          { class: "bc-main" },
          h(
            "div",
            { class: "bc-name" },
            live && p.oncourt ? h("span", { class: "oncourt", title: "Sur le terrain" }) : null,
            h("b", null, p.name),
            h("small", null, [p.jersey ? `n° ${p.jersey}` : "", f.position(p.pos)].filter(Boolean).join(" · "))
          ),
          h("div", { class: "bc-stats" }, stat(p, "reb", "reb"), stat(p, "ast", "pd"), stat(p, "stl", "int", false), stat(p, "blk", "ctr", false), stat(p, "tov", "bp", false)),
          h("div", { class: "bc-more num" }, more.join("  ·  "))
        ),
        h("div", { class: `bc-pts${(p.pts || 0) === best.pts ? " is-best" : ""}` }, h("b", { class: "num" }, String(p.pts ?? 0)), h("small", null, "pts"))
      );
    })
  );
}

// Choix d'équipe et de présentation du box score (téléphone seulement, masqué sur grand écran).
const BOX_VIEW_KEY = "parquet-box-vue";
// Joueur mis en avant (arrivée depuis l'accueil) : son équipe affichée, sa ligne au centre de
// l'écran, surlignée.
function focusBoxRow(panel) {
  requestAnimationFrame(() => {
    const row = [...panel.querySelectorAll(".is-focus")].find((el) => el.offsetParent !== null);
    row?.scrollIntoView({ block: "center", behavior: document.documentElement.dataset.motion === "reduce" ? "auto" : "smooth" });
  });
}

function boxPanel(box, panel, focusId = null) {
  let view = "lignes";
  try {
    view = localStorage.getItem(BOX_VIEW_KEY) || "lignes";
  } catch {
    /* préférence non mémorisée */
  }
  const apply = (side, v) => {
    panel.classList.toggle("bx-home", side === "home");
    panel.classList.toggle("bx-table", v === "tableau");
  };
  let side = focusId && box.teams.home.players.some((p) => p.id === focusId) ? "home" : "away";
  const a = box.game.away || {};
  const hm = box.game.home || {};
  const bar = h(
    "div",
    { class: "box-switch" },
    segmented(
      [
        { value: "away", label: a.tri || "Extérieur" },
        { value: "home", label: hm.tri || "Domicile" },
      ],
      side,
      (v) => {
        side = v;
        apply(side, view);
      },
      "Équipe"
    ),
    segmented(
      [
        { value: "lignes", label: "Joueurs" },
        { value: "tableau", label: "Tableau" },
      ],
      view,
      (v) => {
        view = v;
        try {
          localStorage.setItem(BOX_VIEW_KEY, v);
        } catch {
          /* préférence non mémorisée */
        }
        apply(side, view);
      },
      "Présentation"
    )
  );
  apply(side, view);
  return [bar, boxTable(box, "away", focusId), boxTable(box, "home", focusId)];
}

// ------------------------------------------------------------ faits marquants et clés du match

function eventsBlock(events) {
  if (!events?.length) return null;
  return h(
    "ul",
    { class: "events", "aria-label": "Faits marquants" },
    events.map((e) =>
      h(
        "li",
        { class: `event ${e.kind}` },
        e.personId ? headshot(e.personId, { alt: "" }) : teamLogo(e.teamId, 26),
        h(
          "span",
          { class: "event-txt" },
          h("b", { class: "event-k" }, e.label),
          " ",
          e.player ? (e.personId ? h("a", { class: "link", href: `#/joueur/${e.personId}` }, e.player) : e.player) : team(e.teamId)?.name || e.tri,
          e.detail ? ` (${e.detail})` : ""
        ),
        h("span", { class: "event-when num" }, `${f.periodName(e.period)} ${e.clock}`)
      )
    )
  );
}

function duration(text) {
  const [m, sec] = String(text || "").split(":");
  return sec !== undefined ? `${Number(m)} min ${String(Number(sec)).padStart(2, "0")} s` : text;
}

function keyLine(playerId, teamId, ...content) {
  return h("p", { class: "key-line" }, playerId ? headshot(playerId, { alt: "" }) : teamLogo(teamId, 28), h("span", null, ...content));
}

function keysBlock(page, pageUrl) {
  if (!page) return null;
  const lines = [];
  for (const d of page.defense || []) {
    lines.push(
      keyLine(d.defenderId, d.defTeamId, h("a", { class: "link", href: `#/joueur/${d.defenderId}` }, d.defender), ` a tenu ${d.attacker} à ${d.fgm} sur ${d.fga} au tir${d.tpa ? ` (${d.tpm} sur ${d.tpa} à 3 points)` : ""} en ${duration(d.time)} de duel.`)
    );
  }
  for (const x of page.hardest || []) {
    lines.push(
      keyLine(
        x.shooter.id,
        x.shooter.teamId,
        x.shooter.id ? h("a", { class: "link", href: `#/joueur/${x.shooter.id}` }, x.shooter.name) : x.shooter.name,
        ` a réussi un ${x.three ? "tir à 3 points" : "tir"} qui n'avait que ${Math.round(x.chance * 100)} % de chances de rentrer${x.period ? ` (${f.periodName(x.period)}${x.clock ? ` ${x.clock}` : ""})` : ""}.`
      )
    );
  }
  if (!lines.length && !page.story?.headline) return null;
  return h(
    "div",
    { class: "keys" },
    lines,
    page.story?.headline
      ? h("p", { class: "key-story" }, h("a", { class: "link", href: pageUrl, target: "_blank", rel: "noopener", lang: "en" }, page.story.headline), page.story.agency ? h("span", { class: "note" }, ` ${page.story.agency}`) : null)
      : null
  );
}

function videosView(panel, game, ctx, loadExtras) {
  const yt = h("div", { class: "video-main" });
  const nba = h("div");
  panel.replaceChildren(yt, nba);
  if (game.status === 3) {
    section(yt, () => api(`/game/${game.id}/video`, { signal: ctx.signal }), ({ data }) => {
      if (data.found) return youtubeBlock({ videoId: data.videoId, title: data.title, url: data.url, embeddable: data.embeddable });
      return h(
        "p",
        { class: "video-missing" },
        data.configured ? "Résumé YouTube pas encore publié." : "Résumé YouTube introuvable sans clé YouTube. ",
        data.configured ? null : h("a", { class: "link", href: "#/etat" }, "Ajouter une clé"),
        " ",
        h("a", { class: "btn", href: data.searchUrl, target: "_blank", rel: "noopener" }, "Chercher sur YouTube ↗")
      );
    });
  } else {
    yt.append(h("p", { class: "video-missing" }, "Les vidéos arrivent après le match."));
  }
  section(nba, loadExtras, (ex) => {
    const page = ex.page;
    if (!page) return ex.pageError ? h("p", { class: "note" }, `Vidéos NBA.com indisponibles (${ex.pageError}).`) : null;
    return [
      page.recap ? nbaRecapCard(page.recap) : null,
      page.moments?.length ? h("div", { class: "moments", "aria-label": "Moments décisifs" }, page.moments.map(momentCard)) : null,
      page.highlights?.length
        ? h("p", { class: "video-links" }, page.highlights.map((v) => h("a", { class: "link", href: v.url, target: "_blank", rel: "noopener", lang: "en" }, v.title, v.duration ? h("small", null, ` ${v.duration}`) : null)))
        : null,
    ];
  });
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
  const cols = h("div", { class: "pregame" });
  container.append(cols);
  if (game.tv?.length) container.append(h("p", { class: "note" }, `Diffusion aux États-Unis : ${game.tv.join(", ")}`));
  const injuries = {};
  for (const key of ["away", "home"]) {
    const side = game[key];
    const inj = h("div");
    const form = h("div");
    injuries[side?.id] = inj;
    cols.append(h("div", { class: "pregame-team" }, h("a", { class: "pregame-head", href: side?.id ? `#/equipe/${side.id}` : null }, teamLogo(side?.id, 40), sideName(side).name), inj, form));
    if (!side?.id) continue;
    section(
      form,
      () => api(`/team/${side.id}/schedule`, { signal: ctx.signal }),
      ({ data }) => {
        const played = data.games.filter((g) => g.status === 3).slice(-5).reverse();
        if (!played.length) return null;
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
            h("span", { class: "opp" }, `${home ? "contre" : "à"} ${sideName(opp).name}`),
            h("span", { class: "res num" }, wl(won ? "W" : "L"), `${me.score}-${opp.score}`)
          );
        });
      }
    );
  }
  api(`/injuries?game=${game.id}`, { signal: ctx.signal })
    .then(({ data }) => {
      const g = data.games[0];
      if (!g) return;
      for (const t of g.teams) {
        const box = injuries[t.id];
        if (!box) continue;
        if (!t.submitted) box.replaceChildren(h("p", { class: "note" }, "Rapport des blessures pas encore transmis"));
        else if (t.players.length) box.replaceChildren(h("ul", { class: "inj-list" }, t.players.map((p) => injuryRow(p))));
      }
    })
    .catch(() => {});
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
  // #/match/<id>/joueur/<joueur> : directement sur le box score, à la ligne du joueur.
  const focusId = ctx.params[1] ? Number(ctx.params[1]) : null;
  let focusPending = Boolean(focusId);
  let tab = focusId ? "box" : "resume";
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

  // L'entrée animée de l'en-tête (logos, score, bandes) ne se joue qu'au premier affichage,
  // pas à chaque actualisation du score en direct.
  let intro = true;
  const drawHead = () => {
    const sb = scoreboard(box.game, previous, { onToggleReveal: toggleReveal, isRevealed });
    if (intro) sb.classList.add("is-intro");
    intro = false;
    head.replaceChildren(staleBanner(meta) || "", sb);
  };

  let extrasPromise = null;
  const loadExtras = () => {
    if (!extrasPromise) {
      extrasPromise = api(`/game/${id}/extras`, { signal: ctx.signal })
        .then((r) => r.data)
        .catch((err) => {
          extrasPromise = null;
          throw err;
        });
    }
    return extrasPromise;
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
    el.replaceChildren(
      h(
        "p",
        { class: "legend", style: { margin: "0 0 10px" } },
        h("span", null, h("i", { class: "key-swatch", style: { background: colors.home } }), `Au-dessus : ${sideName(g.home).name} mènent`),
        h("span", null, h("i", { class: "key-swatch", style: { background: colors.away } }), `En dessous : ${sideName(g.away).name} mènent`)
      ),
      h("div", { class: "chart-card" }, gameFlowChart(pbp.actions, { awayColor: colors.away, homeColor: colors.home, awayTri: g.away?.tri, homeTri: g.home?.tri, live: g.status === 2 }))
    );
  };

  const drawPanel = async () => {
    if (!box.available) return;
    if (tab === "resume") {
      const parts = resume(box);
      const flow = h("div", { class: "section" });
      const more = h("div", { class: "section resume-more" });
      panel.replaceChildren(...parts, flow, more);
      drawFlow(flow);
      loadExtras()
        .then((ex) => {
          if (ctx.active && tab === "resume") more.replaceChildren(...[eventsBlock(ex.events), keysBlock(ex.page, ex.pageUrl)].filter(Boolean));
        })
        .catch(() => {});
    } else if (tab === "videos") {
      videosView(panel, box.game, ctx, loadExtras);
    }
    else if (tab === "box") {
      panel.replaceChildren(...boxPanel(box, panel, focusId));
      if (focusPending) {
        // Une seule fois : les actualisations en direct ne font pas sauter la page.
        focusBoxRow(panel);
        focusPending = false;
      }
    }
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
      ...[
      box.game.status === 3
        ? h(
            "div",
            { class: "game-actions" },
            h("button", { class: "btn", type: "button", onclick: () => openShareDialog(box) }, "Partager le résultat")
          )
        : null,
      tabs(TAB_DEFS, tab, (t) => {
        tab = t;
        swapIn(panel);
        drawPanel();
      }),
      panel,
      ].filter(Boolean)
    );
    drawPanel();
  };

  drawHead();
  if (box.available) drawBody();
  if (box.game.status === 3) {
    loadExtras()
      .then((ex) => {
        const img = ex.page?.recap?.image;
        if (img && ctx.active) {
          wrapper.style.setProperty("--hero-img", `url("${img.replace(/"/g, "")}")`);
          wrapper.classList.add("has-hero");
        }
      })
      .catch(() => {});
  }
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
        extrasPromise = null; // faits marquants à jour
        // L'onglet Vidéos n'est pas redessiné : une vidéo en cours de lecture ne doit pas s'interrompre.
        if (box.available && !gated && tab !== "videos") drawPanel();
      }
    );
  }
}
