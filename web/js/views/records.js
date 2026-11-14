// Records (#/records) :
// - en carrière : les 50 meilleurs dans chaque catégorie, en saison régulière ou en playoffs, et ce
//   qu'il manque aux joueurs en activité pour grimper ;
// - sur une saison et en un match : le top 10 de l'histoire et les meilleurs de la saison en cours.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { chips, errorState, headshot, loading, segmented, staleBanner, swapIn } from "../components.js";
import { poster } from "../poster.js";

const UNIT = { PTS: "points", REB: "rebonds", AST: "passes", STL: "interceptions", BLK: "contres", FG3M: "paniers à 3 pts", FTM: "lancers francs", GP: "matchs" };
const SHORT = { PTS: "pts", REB: "reb", AST: "pd", STL: "int", BLK: "ct", FG3M: "3 pts", FTM: "LF", GP: "matchs" };

const big = (v) => Math.round(v || 0).toLocaleString("fr-FR");

function chase(key, p) {
  if (!p.next) return null;
  const parts = [`À ${big(p.next.gap)} ${SHORT[key]} de ${p.next.name}`];
  if (p.gamesToPass) parts.push(`environ ${f.plural(p.gamesToPass, "match", "matchs")} à son rythme actuel`);
  return h("small", { class: "rc-chase" }, parts.join(", "));
}

function leaderRow(key, p, top) {
  return h(
    "a",
    { class: `rc-row${p.active ? " is-active" : ""}`, href: `#/joueur/${p.id}`, style: { "--k": top ? ((p.value || 0) / top).toFixed(4) : 0 } },
    h("span", { class: "rc-rank num" }, String(p.rank)),
    h("span", { class: "rc-pic" }, headshot(p.id, { alt: "" })),
    h("span", { class: "rc-who" }, h("b", null, p.name), p.active ? h("span", { class: "rc-active" }, "En activité") : null, p.active ? chase(key, p) : null),
    h("span", { class: "rc-val" }, h("b", { class: "num" }, big(p.value)), h("i", { "aria-hidden": "true" }))
  );
}

function podium(key, list) {
  return h(
    "div",
    { class: "rc-podium" },
    list.slice(0, 3).map((p) =>
      h(
        "a",
        { class: `rc-step is-${p.rank}${p.active ? " is-active" : ""}`, href: `#/joueur/${p.id}` },
        h("span", { class: "rc-step-rank num" }, String(p.rank)),
        h("span", { class: "rc-step-pic" }, headshot(p.id, { size: "big", alt: "" })),
        h("b", { class: "rc-step-name" }, p.name),
        h("span", { class: "rc-step-val num" }, big(p.value), h("small", null, ` ${UNIT[key]}`)),
        p.active ? h("span", { class: "rc-active" }, "En activité") : null
      )
    )
  );
}

function boardView(board) {
  const list = board.leaders;
  if (!list.length) return h("p", { class: "note" }, "Pas de données pour cette catégorie.");
  const top = list[0].value || 1;
  const active = list.filter((p) => p.active);
  return h(
    "div",
    { class: "rc-board" },
    podium(board.key, list),
    active.length
      ? h(
          "section",
          { class: "rc-actives", "aria-label": "Joueurs en activité" },
          h("h2", { class: "rc-h2" }, "En activité dans le top 50", h("span", { class: "count" }, String(active.length))),
          h(
            "div",
            { class: "rc-active-list" },
            active.map((p) =>
              h(
                "a",
                { class: "rc-chip", href: `#/joueur/${p.id}` },
                h("span", { class: "rc-chip-rank num" }, `${p.rank}e`),
                headshot(p.id, { alt: "" }),
                h("span", null, h("b", null, p.name), chase(board.key, p) || h("small", { class: "rc-chase" }, "Le plus haut placé de l'histoire"))
              )
            )
          )
        )
      : null,
    h("div", { class: "rc-list" }, list.slice(3).map((p) => leaderRow(board.key, p, top)))
  );
}

const SPLIT_NOTE = {
  match: "Saison régulière, NBA seulement. Records de l'histoire d'après le livre des records (Basketball-Reference, Wikipédia) ; saison en cours calculée en direct. Interceptions et contres comptés depuis 1973-74, paniers à 3 points depuis 1979-80.",
  saison: "Saison régulière, NBA seulement. Moyennes par match (il faut avoir joué au moins 70 % des matchs de son équipe), sauf les paniers à 3 points : total de la saison. Saison en cours calculée en direct, encore loin d'être terminée.",
};

const fmtValue = (board, v) => (board.perGame ? f.num(v, v >= 10 ? 1 : 2) : big(v));
const fmtDate = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");

function splitRow(board, r, kind) {
  const ctxLine =
    kind === "match"
      ? r.tri
        ? `${r.tri} ${r.home ? "contre" : "à"} ${r.opp}, ${fmtDate(r.date)}`
        : `${r.team}${r.opp ? ` contre ${r.opp}` : ""}, ${fmtDate(r.date)}`
      : r.tri
        ? `${r.tri}, ${f.plural(r.gp, "match", "matchs")}`
        : `Saison ${r.season}`;
  const badge = r.historic ? h("span", { class: "rs-badge" }, kind === "match" ? `${r.historicRank}e de l'histoire` : board.perGame ? "Rythme du top 10 historique" : "Top 10 de l'histoire") : null;
  const inner = [
    h("span", { class: "rs-rank num" }, String(r.rank)),
    h("span", { class: "rs-pic" }, r.id ? headshot(r.id, { alt: "" }) : h("span", { class: "rs-nopic", "aria-hidden": "true" }, (r.name || "?").charAt(0))),
    h("span", { class: "rs-who" }, h("b", null, r.name), h("small", null, ctxLine), badge),
    h("span", { class: "rs-val" }, h("b", { class: "num" }, fmtValue(board, r.value)), h("small", null, board.perGame ? `${board.unit} / match` : board.unit)),
  ];
  // Un match de la saison mène au match ; un record ancien, à la fiche du joueur (si on la connaît).
  const href = r.gameId ? `#/match/${r.gameId}` : r.id ? `#/joueur/${r.id}` : null;
  return h(href ? "a" : "div", { class: `rs-row${r.rank === 1 ? " is-first" : ""}${r.historic ? " is-historic" : ""}`, href }, inner);
}

function splitBoard(board, kind, season, live) {
  const label = season ? `Saison ${season}` : "Cette saison";
  return h(
    "div",
    { class: "rs-board" },
    h(
      "section",
      { class: "rs-col", "aria-label": "De tous les temps" },
      h("h2", { class: "rc-h2" }, "De tous les temps"),
      board.allTime.length ? h("div", { class: "rs-list" }, board.allTime.map((r) => splitRow(board, r, kind))) : h("p", { class: "note" }, "Pas de données.")
    ),
    h(
      "section",
      { class: "rs-col is-current", "aria-label": label },
      h("h2", { class: "rc-h2" }, label, live ? h("span", { class: "rs-live" }, "En direct") : h("span", { class: "rs-live is-past" }, "Saison terminée")),
      board.current.length
        ? h("div", { class: "rs-list" }, board.current.map((r) => splitRow(board, r, kind)))
        : h("p", { class: "note" }, "Pas encore assez de matchs cette saison.")
    )
  );
}

export async function render(ctx) {
  const top = poster(ctx, { kicker: "Toute l'histoire de la NBA", title: "Records" });
  const body = h("div", { class: "rc-page" }, loading("Chargement des records…"));
  ctx.outlet.append(top.el, body);
  let scope = "carriere";
  let type = "regular";
  let cat = "PTS";
  const cache = {};

  const scopeControl = () =>
    segmented(
      [
        { value: "carriere", label: "Carrière" },
        { value: "saison", label: "Sur une saison" },
        { value: "match", label: "En un match" },
      ],
      scope,
      (v) => {
        scope = v;
        load();
      },
      "Portée des records"
    );

  const load = async () => {
    body.replaceChildren(loading("Chargement des records…"));
    const key = scope === "carriere" ? `carriere:${type}` : scope;
    let res = cache[key];
    if (!res) {
      const url = scope === "carriere" ? `/records${type === "playoffs" ? "?type=playoffs" : ""}` : `/records/${scope}`;
      try {
        res = await api(url, { signal: ctx.signal });
      } catch (err) {
        if (err.name === "AbortError") return;
        body.replaceChildren(errorState(err, load));
        return;
      }
      cache[key] = res;
    }
    if (!ctx.active) return;
    const { data, meta } = res;
    const boards = Object.fromEntries(data.boards.map((b) => [b.key, b]));
    if (!boards[cat]) cat = data.boards[0]?.key || "PTS";
    const box = h("div");

    if (scope === "carriere") {
      const pts = boards.PTS?.leaders[0];
      top.update({
        kicker: type === "playoffs" ? "Toute l'histoire des playoffs" : "Toute l'histoire de la saison régulière",
        ghost: pts ? big(pts.value) : "",
        visual: pts ? headshot(pts.id, { size: "big", alt: "" }) : null,
        visualKind: "cutout",
        meta: pts ? h("span", null, `Meilleur marqueur ${type === "playoffs" ? "des playoffs" : "de l'histoire"} : `, h("a", { href: `#/joueur/${pts.id}` }, pts.name), `, ${big(pts.value)} points`) : null,
      });
    } else {
      const rec = boards.PTS?.allTime[0];
      top.update({
        kicker: scope === "match" ? "Les plus grands matchs de l'histoire" : "Les plus grandes saisons de l'histoire",
        ghost: rec ? (scope === "match" ? String(rec.value) : f.num(rec.value, 1)) : "",
        visual: rec?.id ? headshot(rec.id, { size: "big", alt: "" }) : null,
        visualKind: "cutout",
        meta: rec ? h("span", null, scope === "match" ? `Record : ${rec.value} points, ${rec.name}, ${fmtDate(rec.date)}` : `Record : ${f.num(rec.value, 1)} points par match, ${rec.name}, ${rec.season}`) : null,
      });
    }

    const draw = () => {
      box.replaceChildren(scope === "carriere" ? boardView(boards[cat] || data.boards[0]) : splitBoard(boards[cat] || data.boards[0], scope, data.season, data.live));
      swapIn(box);
    };
    body.replaceChildren(
      ...[staleBanner(meta)].filter(Boolean),
      h(
        "div",
        { class: "toolbar rc-tools" },
        scopeControl(),
        scope === "carriere"
          ? segmented(
              [
                { value: "regular", label: "Saison régulière" },
                { value: "playoffs", label: "Playoffs" },
              ],
              type,
              (v) => {
                type = v;
                load();
              },
              "Type de matchs"
            )
          : null,
        chips(data.boards.map((b) => ({ value: b.key, label: b.label })), cat, (v) => {
          cat = v;
          draw();
        }, "Catégorie")
      ),
      box,
      h(
        "p",
        { class: "note" },
        scope === "carriere"
          ? "Totaux en carrière, NBA seulement (la ligue ABA n'est pas comptée). Les interceptions et les contres ne sont comptés que depuis 1973-74, les paniers à 3 points depuis 1979-80."
          : SPLIT_NOTE[scope]
      )
    );
    draw();
  };
  load();
}
