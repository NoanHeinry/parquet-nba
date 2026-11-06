// Records de tous les temps (#/records) : les 50 meilleurs dans chaque catégorie, en saison
// régulière ou en playoffs, et ce qu'il manque aux joueurs en activité pour grimper.

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

export async function render(ctx) {
  const top = poster(ctx, { kicker: "Toute l'histoire de la NBA", title: "Records" });
  const body = h("div", { class: "rc-page" }, loading("Chargement des records…"));
  ctx.outlet.append(top.el, body);
  let type = "regular";
  let cat = "PTS";
  let cache = {};

  const load = async () => {
    body.replaceChildren(loading("Chargement des records…"));
    let res = cache[type];
    if (!res) {
      try {
        res = await api(`/records${type === "playoffs" ? "?type=playoffs" : ""}`, { signal: ctx.signal });
      } catch (err) {
        if (err.name === "AbortError") return;
        body.replaceChildren(errorState(err, load));
        return;
      }
      cache[type] = res;
    }
    if (!ctx.active) return;
    const { data, meta } = res;
    const boards = Object.fromEntries(data.boards.map((b) => [b.key, b]));
    const pts = boards.PTS?.leaders[0];
    top.update({
      kicker: type === "playoffs" ? "Toute l'histoire des playoffs" : "Toute l'histoire de la saison régulière",
      ghost: pts ? big(pts.value) : "",
      visual: pts ? headshot(pts.id, { size: "big", alt: "" }) : null,
      visualKind: "cutout",
      meta: pts ? h("span", null, `Meilleur marqueur ${type === "playoffs" ? "des playoffs" : "de l'histoire"} : `, h("a", { href: `#/joueur/${pts.id}` }, pts.name), `, ${big(pts.value)} points`) : null,
    });
    const box = h("div");
    const draw = () => {
      box.replaceChildren(boardView(boards[cat] || data.boards[0]));
      swapIn(box);
    };
    body.replaceChildren(
      ...[staleBanner(meta)].filter(Boolean),
      h(
        "div",
        { class: "toolbar rc-tools" },
        segmented(
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
        ),
        chips(data.boards.map((b) => ({ value: b.key, label: b.label })), cat, (v) => {
          cat = v;
          draw();
        }, "Catégorie")
      ),
      box,
      h("p", { class: "note" }, "Totaux en carrière, NBA seulement (la ligue ABA n'est pas comptée). Les interceptions et les contres ne sont comptés que depuis 1973-74, les paniers à 3 points depuis 1979-80.")
    );
    draw();
  };
  load();
}
