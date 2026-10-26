// Fiche d'une franchise : effectif, calendrier, histoire et palmarès.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { columnChart } from "../charts.js";
import { favorites, loading, playerCell, section, segmented, statTable, tabs, teamLogo, toggleFavorite, wl } from "../components.js";
import { team, teamBand, teamColor } from "../teams.js";
import { iconCalendar, iconStar } from "../icons.js";

const SOCIAL = { Facebook: "Facebook", Instagram: "Instagram", Twitter: "X (Twitter)", X: "X", Website: "Site officiel", Tiktok: "TikTok", YouTube: "YouTube" };

function hero(t, ctx) {
  const band = teamBand(t.id);
  const meta = h("div", { class: "hero-meta" }, h("span", null, `Fondée en ${t.founded}`), h("span", null, `Conférence ${t.confFr}, division ${t.divFr}`));
  const favBtn = h("button", { class: "fav-btn", type: "button", style: { display: "inline-flex", alignItems: "center", gap: "6px" } });
  const syncFav = () => {
    const on = favorites().has(t.id);
    favBtn.replaceChildren(iconStar(on, 14), on ? "Équipe favorite" : "Ajouter aux favorites");
    favBtn.setAttribute("aria-pressed", on ? "true" : "false");
  };
  favBtn.addEventListener("click", () => {
    toggleFavorite(t.id);
    syncFav();
  });
  syncFav();

  api("/standings", { signal: ctx.signal })
    .then(({ data }) => {
      const r = data.rows.find((x) => x.teamId === t.id);
      if (r) {
        const conf = t.conf === "East" ? "l'Est" : "l'Ouest";
        meta.prepend(h("span", null, `${data.fallback ? `Saison ${data.season} : ` : ""}${r.w}-${r.l}, ${r.rank}e de ${conf}`));
      }
    })
    .catch(() => {});

  return h(
    "section",
    { class: "hero", style: { "--team-bg": band.bg, "--team-ink": band.ink } },
    teamLogo(t.id, 108, t.fullName, { plate: true }),
    h("div", null, h("div", { class: "kicker" }, t.city), h("h1", null, t.name), meta),
    favBtn
  );
}

function rosterView(container, t, ctx) {
  section(
    container,
    () => api(`/team/${t.id}/roster`, { signal: ctx.signal }),
    ({ data }) => {
      const columns = [
        { key: "num", label: "N°", sort: (p) => Number(p.num) || 999, render: (p) => p.num || "–" },
        { key: "name", label: "Joueur", align: "l", cls: "sticky", render: (p) => playerCell(p.id, p.name, f.position(p.pos)) },
        { key: "age", label: "Âge", render: (p) => (p.age ? Math.floor(p.age) : f.age(p.birth) ?? "–") },
        { key: "height", label: "Taille", sort: (p) => { const m = /^(\d+)-(\d+)$/.exec(p.height || ""); return m ? Number(m[1]) * 12 + Number(m[2]) : 0; }, render: (p) => f.heightM(p.height) },
        { key: "weight", label: "Poids", sort: (p) => Number(p.weight) || 0, render: (p) => f.weightKg(p.weight) },
        { key: "exp", label: "Saisons", title: "Saisons d'expérience en NBA", sort: (p) => (p.exp === "R" ? 0 : Number(p.exp) || 0), render: (p) => (p.exp === "R" ? "Rookie" : p.exp) },
        { key: "school", label: "Formation", align: "l" },
        { key: "how", label: "Arrivée", align: "l", render: (p) => translateHow(p.how) },
      ];
      const head = data.coaches.find((c) => c.head);
      const staff = data.coaches.filter((c) => !c.head);
      return [
        h("p", { class: "note", style: { margin: "0 0 12px" } }, `Effectif ${data.season}, ${data.players.length} joueurs.`),
        statTable(columns, data.players, { sortable: true, initialSort: { key: "num", dir: "asc" }, caption: `Effectif ${t.fullName}` }),
        h(
          "div",
          { class: "section" },
          h("h2", { class: "section-title" }, "Staff"),
          head ? h("p", null, h("b", null, head.name), h("span", { class: "muted" }, `, ${head.type.toLowerCase()}`)) : null,
          staff.length ? h("p", { class: "note" }, staff.map((c) => `${c.name} (${c.type.toLowerCase()})`).join(", ")) : null
        ),
      ];
    }
  );
}

// « Signed on 07/14/26 » -> « Signé le 14/07/26 », etc. Le texte d'origine reste si rien ne correspond.
function translateHow(text) {
  if (!text) return "–";
  return text
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g, (_, m, d, y) => `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`)
    .replace(/^Re-signed( on)?/i, (_, on) => (on ? "Re-signé le" : "Re-signé"))
    .replace(/^Signed( on)?/i, (_, on) => (on ? "Signé le" : "Signé"))
    .replace(/^Traded from (.+?) on/i, "Échangé par $1 le")
    .replace(/^Traded from (.+)$/i, "Échangé par $1")
    .replace(/^Claimed off waivers( on)?/i, (_, on) => (on ? "Récupéré après libération le" : "Récupéré après libération"))
    .replace(/^Draft(?:ed)? (\d{4}) Rnd (\d) Pick (\d+)/i, "Drafté en $1, tour $2, choix $3")
    .replace(/^#(\d+) Pick in (\d{4}) Draft/i, "Choix n° $1 de la draft $2")
    .replace(/ via (.+)$/i, " ($1)");
}

// ---------------------------------------------------------------- calendrier mensuel

const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const DAY_LONG = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

// Jour du match à l'heure locale (celle des horaires affichés) ; date américaine en secours.
function gameDay(g) {
  const d = g.start ? new Date(g.start) : null;
  if (d && !Number.isNaN(d.getTime())) return dayKey(d);
  return g.etDate || null;
}

function sides(g, teamId) {
  const home = g.home?.id === teamId;
  return { home, me: home ? g.home : g.away, opp: home ? g.away : g.home };
}

function calendarCell(g, teamId) {
  const { home, me, opp } = sides(g, teamId);
  const oppTeam = team(opp?.id);
  const oppName = oppTeam?.name || opp?.name || "À déterminer";
  const label = f.gameLabel(g);
  let result;
  let aria;
  if (g.status === 3) {
    const won = me.score > opp.score;
    result = h(
      "span",
      { class: "cal-res" },
      h("span", { class: `cal-wl ${won ? "w" : "l"}`, title: won ? "Victoire" : "Défaite" }, won ? "V" : "D"),
      h("span", { class: "cal-score num" }, `${me.score}-${opp.score}`)
    );
    aria = `${won ? "victoire" : "défaite"} ${me.score} à ${opp.score}`;
  } else if (g.status === 2) {
    result = h("span", { class: "cal-res cal-live" }, h("span", { class: "live-dot" }), h("span", { class: "cal-score num" }, `${me.score}-${opp.score}`));
    aria = `en cours, ${me.score} à ${opp.score}`;
  } else {
    const time = g.start ? f.clockTime(g.start) : "";
    result = h("span", { class: "cal-res cal-time num" }, time || "Horaire à venir");
    aria = time ? `à ${time}` : "horaire à venir";
  }
  const special = g.kind && g.kind !== "reg" ? h("span", { class: "cal-tag" }, label) : null;
  return h(
    "a",
    {
      class: `cal-game${g.status === 3 ? (me.score > opp.score ? " is-w" : " is-l") : ""}${g.status === 2 ? " is-live" : ""}${g.status === 1 || !g.status ? " is-upcoming" : ""}`,
      href: `#/match/${g.id}`,
      "aria-label": `${home ? "Contre" : "À"} ${oppName}${label ? ` (${label})` : ""}, ${aria}`,
      title: `${home ? "Contre" : "À"} ${oppName}${label ? ` · ${label}` : ""}`,
    },
    h("span", { class: "cal-opp" }, teamLogo(opp?.id, 26), h("span", { class: "cal-tri" }, h("small", null, home ? "vs" : "@"), opp?.tri || "?")),
    result,
    special
  );
}

function monthGrid(month, byDay, teamId) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const offset = (first.getDay() + 6) % 7; // lundi en premier
  const today = dayKey(new Date());
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(h("div", { class: "cal-day is-out", "aria-hidden": "true" }));
  for (let d = 1; d <= days; d++) {
    const date = new Date(y, m - 1, d);
    const key = dayKey(date);
    const games = byDay.get(key) || [];
    cells.push(
      h(
        "div",
        {
          class: `cal-day${games.length ? " has-game" : ""}${key === today ? " is-today" : ""}${key < today ? " is-past" : ""}`,
          role: "gridcell",
          "aria-label": DAY_LONG.format(date) + (games.length ? "" : ", pas de match"),
        },
        h("span", { class: "cal-num" }, d),
        games.map((g) => calendarCell(g, teamId))
      )
    );
  }
  while (cells.length % 7) cells.push(h("div", { class: "cal-day is-out", "aria-hidden": "true" }));
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(h("div", { class: "cal-week", role: "row" }, cells.slice(i, i + 7)));
  return h(
    "div",
    { class: "cal-grid", role: "grid", "aria-label": `Matchs de ${MONTH.format(first)}` },
    h("div", { class: "cal-week cal-head", role: "row" }, WEEKDAYS.map((w) => h("span", { role: "columnheader" }, w))),
    rows
  );
}

function teamCalendar(games, teamId) {
  const byDay = new Map();
  for (const g of games) {
    const key = gameDay(g);
    if (!key) continue;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(g);
  }
  const months = [...new Set([...byDay.keys()].map((k) => k.slice(0, 7)))].sort();
  const el = h("div", { class: "team-cal" });
  if (!months.length) {
    el.append(h("p", { class: "note" }, "Aucun match au calendrier pour l'instant."));
    return el;
  }

  // Mois affiché au départ : le mois en cours s'il a des matchs, sinon celui du prochain match, sinon le dernier.
  const now = monthKey(new Date());
  const next = games.find((g) => g.status !== 3);
  let current = months.includes(now) ? now : next && gameDay(next) ? gameDay(next).slice(0, 7) : months[months.length - 1];
  if (!months.includes(current)) current = months[0];

  const prev = h("button", { class: "btn cal-nav", type: "button", "aria-label": "Mois précédent" }, "‹");
  const nextBtn = h("button", { class: "btn cal-nav", type: "button", "aria-label": "Mois suivant" }, "›");
  const title = h("h3", { class: "cal-title", "aria-live": "polite" });
  const record = h("span", { class: "cal-record" });
  const body = h("div");
  const picker = h("div", { class: "cal-months", role: "group", "aria-label": "Choisir un mois" });

  const draw = () => {
    const i = months.indexOf(current);
    const [y, m] = current.split("-").map(Number);
    title.textContent = MONTH.format(new Date(y, m - 1, 1)).replace(/^./, (c) => c.toUpperCase());
    prev.disabled = i <= 0;
    nextBtn.disabled = i >= months.length - 1;

    const inMonth = games.filter((g) => gameDay(g)?.startsWith(current));
    const done = inMonth.filter((g) => g.status === 3);
    const w = done.filter((g) => { const s = sides(g, teamId); return s.me.score > s.opp.score; }).length;
    record.replaceChildren(
      done.length
        ? h("span", { class: "cal-rec" }, h("span", { class: "cal-wl w" }, "V"), ` ${w}`, h("span", { class: "cal-wl l" }, "D"), ` ${done.length - w}`)
        : "",
      h("span", { class: "muted" }, `${done.length ? " · " : ""}${f.plural(inMonth.length, "match", "matchs")}`)
    );
    for (const b of picker.children) b.setAttribute("aria-pressed", b.dataset.month === current ? "true" : "false");
    body.replaceChildren(monthGrid(current, byDay, teamId));
  };

  for (const mk of months) {
    const [y, m] = mk.split("-").map(Number);
    const b = h("button", { type: "button", class: "chip", "data-month": mk }, new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(new Date(y, m - 1, 1)).replace(".", ""));
    b.addEventListener("click", () => {
      current = mk;
      draw();
    });
    picker.append(b);
  }
  prev.addEventListener("click", () => {
    current = months[Math.max(0, months.indexOf(current) - 1)];
    draw();
  });
  nextBtn.addEventListener("click", () => {
    current = months[Math.min(months.length - 1, months.indexOf(current) + 1)];
    draw();
  });
  draw();

  el.append(h("div", { class: "cal-bar" }, prev, h("div", { class: "cal-heading" }, title, record), nextBtn), picker, body);
  return el;
}

function scheduleView(container, t, ctx) {
  section(
    container,
    () => api(`/team/${t.id}/schedule`, { signal: ctx.signal }),
    ({ data }) => {
      const games = data.games;
      const upcoming = games.filter((g) => g.status !== 3);
      const results = games.filter((g) => g.status === 3).reverse();
      let mode = "calendar";
      const list = h("div");
      const draw = () => {
        if (mode === "calendar") {
          list.replaceChildren(teamCalendar(games, t.id));
          return;
        }
        const rows = mode === "next" ? upcoming : mode === "results" ? results : games;
        list.replaceChildren(
          ...(rows.length
            ? rows.map((g) => scheduleRow(g, t.id))
            : [h("p", { class: "note" }, mode === "next" ? "Aucun match à venir dans le calendrier." : "Aucun match joué pour l'instant.")])
        );
      };
      draw();
      return [
        h(
          "div",
          { class: "toolbar" },
          segmented(
            [
              { value: "calendar", label: "Calendrier" },
              { value: "next", label: `À venir (${upcoming.length})` },
              { value: "results", label: `Résultats (${results.length})` },
              { value: "all", label: "Liste complète" },
            ],
            mode,
            (v) => {
              mode = v;
              draw();
            },
            "Affichage des matchs"
          )
        ),
        h(
          "div",
          { class: "ics-row" },
          h("p", { class: "note", style: { margin: 0 } }, `Saison ${data.season}. Horaires à l'heure de Paris.`),
          h(
            "a",
            { class: "btn", href: `/api/team/${t.id}/calendar.ics`, download: `parquet-${t.tri.toLowerCase()}-${data.season}.ics`, title: "Fichier à importer dans Google Agenda, Apple Calendrier ou Outlook" },
            iconCalendar(15),
            "Ajouter à mon agenda"
          )
        ),
        list,
      ];
    }
  );
}

function scheduleRow(g, teamId) {
  const home = g.home?.id === teamId;
  const me = home ? g.home : g.away;
  const opp = home ? g.away : g.home;
  const label = f.gameLabel(g);
  let result;
  if (g.status === 3) {
    result = h("span", { class: "res num" }, wl(me.score > opp.score ? "W" : "L"), `${me.score}-${opp.score}`);
  } else if (g.status === 2) {
    const st = f.gameStatus(g);
    result = h("span", { class: "res num", style: { color: "var(--live)" } }, h("span", { class: "live-dot" }), `${me.score}-${opp.score} ${st.text}`);
  } else {
    result = h("span", { class: "res num muted" }, g.start ? f.clockTime(g.start) : "–");
  }
  const oppName = team(opp?.id)?.name || opp?.name || "À déterminer";
  return h(
    "a",
    { class: "sched-row", href: `#/match/${g.id}` },
    h("span", { class: "date" }, g.start ? f.localDayShort(g.start) : f.dayShort(g.etDate)),
    teamLogo(opp?.id, 26),
    h("span", { class: "opp" }, `${home ? "contre" : "à"} ${oppName}`, label && (g.kind !== "reg" || g.label) ? h("small", null, ` (${label})`) : null),
    result
  );
}

function playoffText(s) {
  if (s.champion) return "Champion NBA";
  if (s.finals) return "Finaliste";
  if ((s.poW || 0) + (s.poL || 0) > 0) return `Playoffs (${s.poW}-${s.poL})`;
  return "Pas de playoffs";
}

function franchiseView(container, t, ctx) {
  const intro = h("div");
  const numbers = h("div");
  const titles = h("div");
  const chart = h("div");
  const people = h("div");
  container.replaceChildren(
    h("div", { class: "profile-grid" }, h("div", null, h("h2", { class: "section-title" }, "Histoire"), intro), h("div", null, h("h2", { class: "section-title" }, "En chiffres"), numbers)),
    titles,
    h("div", { class: "section" }, h("h2", { class: "section-title" }, "Victoires saison par saison"), chart),
    people
  );

  section(
    intro,
    () => api(`/team/${t.id}/bio`, { signal: ctx.signal }),
    ({ data }) => {
      if (!data) return h("p", { class: "note" }, "Pas de résumé disponible.");
      return [
        h("div", { class: "prose" }, data.paragraphs.map((p) => h("p", null, p))),
        h("p", { class: "source" }, "Source : ", h("a", { class: "link", href: data.url, target: "_blank", rel: "noopener" }, `Wikipédia, « ${data.title} »`), " (CC BY-SA)."),
      ];
    }
  );

  section(
    chart,
    () => api(`/team/${t.id}/history`, { signal: ctx.signal }),
    ({ data }) => {
      const fr = data.franchise;
      if (fr) {
        numbers.replaceChildren(
          h(
            "div",
            { class: "tiles" },
            tile("Saisons en NBA", f.int(fr.years)),
            tile("Victoires", f.int(fr.w), `pour ${f.int(fr.l)} défaites`),
            tile("Victoires (%)", `${f.pct(fr.pct)} %`),
            tile("Participations aux playoffs", f.int(fr.playoffs)),
            tile("Titres de conférence", f.int(fr.confTitles)),
            tile("Titres NBA", f.int(fr.titles))
          ),
          ...(data.eras.length > 1
            ? [h("p", { class: "note", style: { marginTop: "12px" } }, "Noms successifs : ", data.eras.map((e) => `${e.city} ${e.name} (${e.start}–${e.end >= new Date().getFullYear() - 1 ? "auj." : e.end})`).join(", "), ".")]
            : [])
        );
      } else {
        numbers.replaceChildren(h("p", { class: "note" }, "Chiffres indisponibles."));
      }
      const seasons = data.seasons;
      if (!seasons.length) return h("p", { class: "note" }, "Historique indisponible.");
      const bars = seasons.map((s) => ({
        label: s.season.slice(0, 4),
        value: s.w,
        cls: s.champion ? "hl" : s.finals ? "finals" : "",
        tip: [`${s.season} : ${s.w}-${s.l}`, s.team, s.confRank ? `${s.confRank}e de la conférence` : "", playoffText(s)].filter(Boolean),
      }));
      const tableBox = h("div", { hidden: true, style: { marginTop: "12px" } });
      const toggle = h("button", { class: "btn", type: "button", "aria-expanded": "false" }, "Voir le tableau des saisons");
      toggle.addEventListener("click", () => {
        const open = tableBox.hidden;
        tableBox.hidden = !open;
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.textContent = open ? "Masquer le tableau" : "Voir le tableau des saisons";
        if (open && !tableBox.childNodes.length) {
          tableBox.append(
            statTable(
              [
                { key: "season", label: "Saison", align: "l" },
                { key: "team", label: "Nom", align: "l" },
                { key: "w", label: "V" },
                { key: "l", label: "D" },
                { key: "pct", label: "%", render: (s) => f.pct(s.pct) },
                { key: "confRank", label: "Rang conf." },
                { key: "po", label: "Playoffs", align: "l", sortable: false, render: (s) => playoffText(s) },
              ],
              seasons.slice().reverse(),
              { sortable: true }
            )
          );
        }
      });
      return [
        h("div", { class: "chart-card" }, columnChart(bars, { ariaLabel: `Victoires par saison de ${t.fullName}` })),
        h(
          "div",
          { class: "legend", style: { marginTop: "10px", justifyContent: "space-between" } },
          h("span", null, h("i", { class: "key-swatch", style: { background: "var(--accent)" } }), "Saison du titre NBA", h("i", { class: "key-swatch", style: { background: "var(--muted)", marginLeft: "14px" } }), "Autres saisons (plus soutenu : finale perdue)"),
          toggle
        ),
        tableBox,
      ];
    }
  );

  section(
    people,
    () => api(`/team/${t.id}`, { signal: ctx.signal }),
    ({ data }) => {
      const out = [];
      if (data.titles.length) {
        out.push(
          h("div", { class: "section" }, h("h2", { class: "section-title" }, `Titres NBA `, h("span", { class: "count" }, `(${data.titles.length})`)),
            h("div", { class: "titles-list" }, data.titles.slice().reverse().map((x) => h("span", { class: "title-pill" }, h("b", null, x.year), x.opp ? `contre ${x.opp}` : "")))
          )
        );
      }
      if (data.cupTitles?.length) {
        out.push(h("div", { class: "section" }, h("h2", { class: "section-title" }, "NBA Cup"), h("div", { class: "titles-list" }, data.cupTitles.map((x) => h("span", { class: "title-pill" }, h("b", null, x.year), x.opp ? `contre ${x.opp}` : "")))));
      }
      if (data.confTitles.length || data.divTitles.length) {
        out.push(
          h(
            "div",
            { class: "section two-col" },
            data.confTitles.length
              ? h("div", null, h("h2", { class: "section-title" }, "Titres de conférence ", h("span", { class: "count" }, `(${data.confTitles.length})`)), h("p", { class: "note" }, data.confTitles.map((x) => x.year).join(", ")))
              : h("div"),
            data.divTitles.length
              ? h("div", null, h("h2", { class: "section-title" }, "Titres de division ", h("span", { class: "count" }, `(${data.divTitles.length})`)), h("p", { class: "note" }, data.divTitles.map((x) => x.year).join(", ")))
              : h("div")
          )
        );
      }
      if (data.retired.length) {
        out.push(
          h("div", { class: "section" }, h("h2", { class: "section-title" }, "Maillots retirés"),
            h("div", { class: "jerseys", style: { "--team-accent": teamColor(t.id) } },
              data.retired.map((p) =>
                h(
                  p.id ? "a" : "div",
                  { class: "jersey-card", href: p.id ? `#/joueur/${p.id}` : null },
                  h("div", { class: "no" }, p.jersey || "—"),
                  h("div", { class: "nm" }, p.name),
                  h("div", { class: "sub" }, [p.seasons, p.year ? `retiré en ${p.year}` : ""].filter(Boolean).join(", "))
                )
              )
            )
          )
        );
      }
      if (data.hof.length) {
        out.push(
          h("div", { class: "section" }, h("h2", { class: "section-title" }, "Au Hall of Fame"),
            h("p", { class: "note" }, "Membres du Basketball Hall of Fame passés par la franchise, avec leur année d'intronisation."),
            h("div", { class: "titles-list" }, data.hof.map((p) => h(p.id ? "a" : "span", { class: "title-pill", href: p.id ? `#/joueur/${p.id}` : null }, h("b", null, p.year || ""), p.name, p.pos ? h("span", { class: "muted" }, ` (${f.position(p.pos)})`) : "")))
          )
        );
      }
      if (data.social.length) {
        out.push(
          h("div", { class: "section" }, h("h2", { class: "section-title" }, "Liens officiels"),
            h("p", null, data.social.map((sct, i) => [i ? ", " : "", h("a", { class: "link", href: sct.url, target: "_blank", rel: "noopener" }, SOCIAL[sct.type] || sct.type)]))
          )
        );
      }
      return out;
    }
  );
}

function tile(k, v, s) {
  return h("div", { class: "tile" }, h("div", { class: "k" }, k), h("div", { class: "v" }, v), s ? h("div", { class: "s" }, s) : null);
}

export async function render(ctx) {
  const id = Number(ctx.params[0]);
  const t = team(id);
  if (!t) {
    ctx.outlet.append(h("div", { class: "state" }, h("p", null, "Cette équipe n'existe pas."), h("a", { class: "btn", href: "#/equipes" }, "Voir les 30 équipes")));
    return;
  }
  document.title = `${t.fullName} · Parquet`;
  ctx.onCleanup(() => (document.title = "Parquet"));

  const facts = h("dl", { class: "facts" });
  const panel = h("div");
  let tab = "roster";
  const drawTab = () => {
    if (tab === "roster") rosterView(panel, t, ctx);
    else if (tab === "schedule") scheduleView(panel, t, ctx);
    else franchiseView(panel, t, ctx);
  };
  ctx.outlet.append(
    hero(t, ctx),
    facts,
    tabs(
      [
        { id: "roster", label: "Effectif" },
        { id: "schedule", label: "Calendrier" },
        { id: "franchise", label: "Histoire et palmarès" },
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

  api(`/team/${id}`, { signal: ctx.signal })
    .then(({ data }) => {
      const b = data.background;
      const item = (k, v) => (v ? h("div", null, h("dt", null, k), h("dd", null, v)) : null);
      facts.replaceChildren(
        ...[
          item("Salle", b.arena ? `${b.arena}${b.capacity ? `, ${f.int(b.capacity)} places` : ""}` : ""),
          item("Entraîneur principal", b.coach),
          item("Manager général", b.gm),
          item("Propriétaire", b.owner),
          item("Équipe affiliée en G League", b.gLeague),
          item("Titres NBA", data.titles.length ? `${data.titles.length}, le dernier en ${Math.max(...data.titles.map((x) => x.year))}` : "Aucun"),
        ].filter(Boolean)
      );
    })
    .catch(() => facts.remove());
}
