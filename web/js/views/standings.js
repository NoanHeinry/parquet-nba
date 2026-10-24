// Classement par conférence.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { errorState, loading, segmented, staleBanner, teamLogo } from "../components.js";
import { team } from "../teams.js";

const CLINCH = {
  x: "Qualifié pour les playoffs",
  y: "Champion de division",
  z: "Meilleur bilan de la ligue",
  e: "1er de la conférence Est",
  w: "1er de la conférence Ouest",
  pi: "Qualifié pour le play-in",
  o: "Éliminé",
};

function table(rows) {
  const head = [
    ["", "Rang"],
    ["Équipe", ""],
    ["V", "Victoires"],
    ["D", "Défaites"],
    ["%", "Pourcentage de victoires"],
    ["Écart", "Matchs de retard sur le premier"],
    ["Dom.", "Bilan à domicile"],
    ["Ext.", "Bilan à l'extérieur"],
    ["10 der.", "Bilan sur les 10 derniers matchs"],
    ["Série", "Série en cours"],
    ["Pts", "Points marqués par match"],
    ["Pts enc.", "Points encaissés par match"],
    ["Diff.", "Différence moyenne"],
  ];
  const body = rows.map((r) => {
    const zone = r.rank <= 6 ? "zone-po" : r.rank <= 10 ? "zone-pi" : "";
    const cut = r.rank === 6 || r.rank === 10 ? " cut" : "";
    const streak = r.streak ? r.streak.replace(/^W\s*/, "V").replace(/^L\s*/, "D") : "–";
    const clinch = r.clinch && CLINCH[r.clinch] ? h("span", { class: "clinch", title: CLINCH[r.clinch] }, r.clinch) : null;
    return h(
      "tr",
      { class: `${zone}${cut}` },
      h("td", { class: "num" }, r.rank),
      h("td", { class: "team l" }, h("a", { class: "player-cell", href: `#/equipe/${r.teamId}` }, teamLogo(r.teamId, 26), h("span", { class: "nm" }, team(r.teamId)?.fullName || `${r.city} ${r.name}`), clinch)),
      h("td", null, r.w),
      h("td", null, r.l),
      h("td", null, f.pct(r.pct)),
      h("td", null, r.gb ? f.num(r.gb) : "–"),
      h("td", null, r.home || "–"),
      h("td", null, r.road || "–"),
      h("td", null, r.l10 || "–"),
      h("td", null, streak),
      h("td", null, f.num(r.ppg)),
      h("td", null, f.num(r.oppg)),
      h("td", { style: { color: r.diff > 0 ? "var(--win)" : r.diff < 0 ? "var(--loss)" : null } }, r.diff > 0 ? `+${f.num(r.diff)}` : f.num(r.diff))
    );
  });
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "stat-table standings-table" },
      h("thead", null, h("tr", null, head.map(([l, t], i) => h("th", { scope: "col", class: i === 1 ? "l" : null, title: t || null }, l)))),
      h("tbody", null, body)
    )
  );
}

export async function render(ctx) {
  let season = null;
  const container = h("div");
  ctx.outlet.append(container);

  const load = async () => {
    container.replaceChildren(loading("Chargement du classement…"));
    let res;
    try {
      res = await api(`/standings${season ? `?season=${season}` : ""}`, { signal: ctx.signal });
    } catch (err) {
      if (err.name === "AbortError") return;
      container.replaceChildren(errorState(err, load));
      return;
    }
    const { data, meta } = res;
    const startYear = Number((data.requested || data.season).slice(0, 4));
    const options = [0, 1, 2, 3].map((k) => {
      const y = startYear - k;
      return `${y}-${String(y + 1).slice(-2)}`;
    });
    const seasonSel = h("select", { class: "select", "aria-label": "Saison" }, options.map((s) => h("option", { value: s, selected: s === data.season ? true : null }, `Saison ${s}`)));
    seasonSel.addEventListener("change", () => {
      season = seasonSel.value;
      load();
    });
    const sub = data.fallback
      ? `La saison ${data.requested} n'a pas encore commencé : voici le classement final ${data.season}.`
      : `Saison ${data.season}, mis à jour à ${f.updatedAt(meta.fetchedAt)}.`;
    const blocks = ["East", "West"].map((conf) =>
      h("section", { class: "section" }, h("h2", { class: "section-title" }, conf === "East" ? "Conférence Est" : "Conférence Ouest"), table(data.rows.filter((r) => r.conf === conf)))
    );
    const playoffsBtn = h(
      "a",
      { class: "btn", href: `#/playoffs${data.season ? `/${data.season}` : ""}` },
      "🏆 Tableau des playoffs"
    );
    container.replaceChildren(
      h(
        "div",
        { class: "page-head" },
        h("div", null, h("h1", { class: "page-title" }, "Classement"), h("p", { class: "page-sub" }, sub)),
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, playoffsBtn, seasonSel)
      ),
      staleBanner(meta) || "",
      ...blocks,
      h(
        "div",
        { class: "zone-legend" },
        h("span", null, h("i"), "Places 1 à 6 : qualifiés directement pour les playoffs"),
        h("span", null, h("i", { class: "pi" }), "Places 7 à 10 : play-in"),
        h("span", null, "Les lettres à côté d'un nom (x, y, z…) sont les indicateurs officiels de qualification ; survole-les pour leur sens.")
      )
    );
  };
  load();
}
