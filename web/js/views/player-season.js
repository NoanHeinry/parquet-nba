// Fiche joueur, onglet « Saison en détail » : carte de tous ses tirs de la saison (zones
// chaudes comparées à la ligue, ou chaque tir) et ses moyennes selon le contexte.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { chips, errorState, loading, statTable, swapIn, teamLogo } from "../components.js";
import { heatChart, heatColor, shotChart } from "../charts.js";
import { teamByTri } from "../teams.js";

const pct = (v) => (v === null || v === undefined ? "–" : `${f.pct(v)} %`);
const signedPts = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${f.num(Math.abs(v * 100), 1)}`;

function zonesView(zones) {
  const max = Math.max(0.01, ...zones.map((z) => z.share));
  return h(
    "div",
    { class: "ps-zones" },
    zones.map((z) => {
      const diff = z.pct !== null && z.league !== null ? z.pct - z.league : null;
      return h(
        "div",
        { class: "ps-zone" },
        h("span", { class: "ps-zone-name" }, h("b", null, z.label), h("small", { class: "num" }, `${z.fgm}/${z.fga}, ${Math.round(z.share * 100)} % de ses tirs`)),
        h("span", { class: "ps-zone-bar", "aria-hidden": "true" }, h("i", { style: { "--k": (z.share / max).toFixed(3) } })),
        h("span", { class: "ps-zone-pct num" }, pct(z.pct)),
        h(
          "span",
          { class: "ps-zone-diff num", style: { "--c": diff === null ? "var(--muted)" : heatColor(diff) }, title: z.league !== null ? `Moyenne de la ligue : ${pct(z.league)}` : null },
          diff === null ? "–" : `${signedPts(diff)} pts`
        )
      );
    })
  );
}

function legend() {
  const stops = [-0.12, -0.06, 0, 0.06, 0.12];
  return h(
    "div",
    { class: "ps-legend" },
    h("span", null, "Moins adroit que la ligue"),
    h("span", { class: "ps-legend-scale", "aria-hidden": "true" }, stops.map((d) => h("i", { style: { background: heatColor(d) } }))),
    h("span", null, "Plus adroit"),
    h("span", { class: "ps-legend-size" }, "Taille : nombre de tirs")
  );
}

function shotsBlock(data) {
  if (data.shotsError) return h("p", { class: "note" }, "La carte des tirs n'est pas disponible pour l'instant (NBA.com ne répond pas).");
  if (!data.shots.length) return h("p", { class: "note" }, "Pas de tirs enregistrés pour cette saison (les cartes des tirs existent depuis 1996-97).");
  let mode = "heat";
  const box = h("div", { class: "ps-court" });
  const draw = () => {
    const shots = data.shots.map(([x, y, made, , , , dist, action, date]) => ({ x, y, made: !!made, desc: [action, dist !== null ? `${dist} pieds` : ""].filter(Boolean).join(", "), when: date }));
    box.replaceChildren(mode === "heat" ? heatChart(data.shots, data.league) : shotChart(shots, "var(--accent)"));
    swapIn(box);
  };
  draw();
  const made = data.shots.filter((s) => s[2]).length;
  return h(
    "div",
    { class: "ps-shots" },
    h(
      "div",
      { class: "ps-court-col" },
      chips(
        [
          { value: "heat", label: "Zones chaudes" },
          { value: "all", label: "Tous les tirs" },
        ],
        mode,
        (v) => {
          mode = v;
          draw();
        },
        "Affichage de la carte"
      ),
      box,
      legend()
    ),
    h(
      "div",
      { class: "ps-zones-col" },
      h("p", { class: "ps-total" }, h("b", { class: "num" }, String(data.shots.length)), ` tirs tentés, ${made} réussis (${pct(made / data.shots.length)})`),
      zonesView(data.zones),
      h("p", { class: "note" }, "Écart en points de pourcentage avec l'adresse moyenne de tous les joueurs de la ligue dans la même zone.")
    )
  );
}

function splitsBlock(data) {
  if (!data.splits.length) return h("p", { class: "note" }, "Pas de match joué cette saison.");
  const rows = [];
  for (const g of data.splits) {
    rows.push({ __group: g.label });
    for (const r of g.rows) rows.push(r);
  }
  const cols = [
    {
      key: "label",
      label: "",
      align: "l",
      render: (r) => {
        const t = r.tri ? teamByTri(r.tri) : null;
        return t ? h("a", { class: "player-cell", href: `#/equipe/${t.id}` }, teamLogo(t.id, 20), h("span", { class: "nm" }, t.name)) : r.label;
      },
    },
    { key: "gp", label: "MJ", render: (r) => r.gp },
    { key: "w", label: "V-D", render: (r) => (r.gp ? `${r.w}-${r.gp - r.w}` : "–") },
    { key: "min", label: "Min", render: (r) => f.num(r.min) },
    { key: "pts", label: "Pts", render: (r) => h("b", null, f.num(r.pts)) },
    { key: "reb", label: "Reb", render: (r) => f.num(r.reb) },
    { key: "ast", label: "Pd", render: (r) => f.num(r.ast) },
    { key: "fgPct", label: "Tirs", render: (r) => pct(r.fgPct) },
    { key: "tpPct", label: "3 pts", render: (r) => pct(r.tpPct) },
    { key: "ts", label: "Adr. réelle", render: (r) => pct(r.ts) },
    { key: "pm", label: "+/-", render: (r) => (r.pm === null || r.pm === undefined ? "–" : `${r.pm > 0 ? "+" : ""}${f.num(r.pm)}`) },
  ];
  return h("div", { class: "table-wrap" }, statTable(cols, rows, { caption: "Moyennes selon le contexte" }));
}

export function seasonView(container, id, ctx, career) {
  let season = null;
  const body = h("div", { class: "ps-body" });
  const select = h("select", { class: "select", "aria-label": "Saison" });
  select.addEventListener("change", () => {
    season = select.value;
    load();
  });
  container.replaceChildren(h("div", { class: "toolbar ps-tools" }, select), body);

  // Saisons de la carrière (pour choisir), dès que la carrière est chargée.
  career()
    .then((c) => {
      const seasons = [...new Set((c.regular || []).map((r) => r.season).filter(Boolean))].sort().reverse();
      select.replaceChildren(...seasons.map((s) => h("option", { value: s, selected: s === season ? true : null }, `Saison ${s}`)));
      select.hidden = !seasons.length;
    })
    .catch(() => (select.hidden = true));

  const load = async () => {
    body.replaceChildren(loading("Chargement de la saison…"));
    let res;
    try {
      res = await api(`/player/${id}/season${season ? `?season=${season}` : ""}`, { signal: ctx.signal });
    } catch (err) {
      if (err.name === "AbortError") return;
      body.replaceChildren(errorState(err, load));
      return;
    }
    if (!ctx.active) return;
    const { data } = res;
    season = data.season;
    if (![...select.options].some((o) => o.value === season)) select.prepend(h("option", { value: season }, `Saison ${season}`));
    select.value = season;
    body.replaceChildren(
      h("section", { class: "section" }, h("h2", { class: "section-title" }, `Carte des tirs, saison ${data.season}`), shotsBlock(data)),
      h("section", { class: "section" }, h("h2", { class: "section-title" }, `En détail, ${f.plural(data.games, "match", "matchs")}`), splitsBlock(data))
    );
    swapIn(body);
  };
  load();
}
