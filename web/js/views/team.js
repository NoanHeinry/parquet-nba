// Fiche d'une franchise : effectif, calendrier, histoire et palmarès.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { columnChart } from "../charts.js";
import { favorites, loading, playerCell, section, segmented, statTable, tabs, teamLogo, toggleFavorite, wl } from "../components.js";
import { team, teamBand, teamColor } from "../teams.js";

const SOCIAL = { Facebook: "Facebook", Instagram: "Instagram", Twitter: "X (Twitter)", X: "X", Website: "Site officiel", Tiktok: "TikTok", YouTube: "YouTube" };

function hero(t, ctx) {
  const band = teamBand(t.id);
  const meta = h("div", { class: "hero-meta" }, h("span", null, `Fondée en ${t.founded}`), h("span", null, `Conférence ${t.confFr}, division ${t.divFr}`));
  const favBtn = h("button", { class: "fav-btn", type: "button" });
  const syncFav = () => {
    const on = favorites().has(t.id);
    favBtn.textContent = on ? "★ Équipe favorite" : "☆ Ajouter aux favorites";
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

function scheduleView(container, t, ctx) {
  section(
    container,
    () => api(`/team/${t.id}/schedule`, { signal: ctx.signal }),
    ({ data }) => {
      const games = data.games;
      const upcoming = games.filter((g) => g.status !== 3);
      const results = games.filter((g) => g.status === 3).reverse();
      let mode = upcoming.length ? "next" : "results";
      const list = h("div");
      const draw = () => {
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
              { value: "next", label: `À venir (${upcoming.length})` },
              { value: "results", label: `Résultats (${results.length})` },
              { value: "all", label: "Toute la saison" },
            ],
            mode,
            (v) => {
              mode = v;
              draw();
            },
            "Matchs affichés"
          )
        ),
        h("p", { class: "note", style: { margin: "0 0 8px" } }, `Saison ${data.season}. Horaires à l'heure de Paris.`),
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
                  h("div", { class: "no" }, p.jersey || "★"),
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
