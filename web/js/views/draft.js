// Drafts NBA : l'ordre complet de chaque draft (tour, choix, équipe, joueur, provenance) et ce
// que les joueurs sont devenus. Deux entrées : une année (#/draft/2003) ou une équipe
// (#/draft/equipe/1610612738, tous ses choix d'année en année).

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { chips, errorState, headshot, loading, staleBanner, swapIn, teamLogo } from "../components.js";
import { normalize } from "../search.js";
import { poster } from "../poster.js";
import { silhouetteUrl, team, teams } from "../teams.js";

const ORIGINS = [
  { value: "", label: "Toutes provenances" },
  { value: "College/University", label: "Université" },
  { value: "High School", label: "Lycée" },
  { value: "Other Team/Club", label: "Club ou étranger" },
  { value: "other", label: "Autre" },
];
const ORIGIN_LABEL = { "College/University": "Université", "High School": "Lycée", "Other Team/Club": "Club" };

const ordinal = (n) => (n === 1 ? "1er" : `${n}e`);
const roundName = (r) => (r ? `${ordinal(r)} tour` : "Hors tour");
const teamLabel = (p) => [p.teamCity, p.teamName].filter(Boolean).join(" ") || team(p.teamId)?.fullName || p.tri || "";
const hasPage = (p) => Boolean(p.profile || p.career);

function originText(p) {
  const kind = ORIGIN_LABEL[p.orgType];
  if (!p.org) return kind || "";
  return p.orgType === "High School" ? `${p.org} (lycée)` : p.org;
}

// Ce que le joueur est devenu : saisons jouées et moyennes, ou rien si on ne le retrouve pas
// dans l'index des joueurs NBA.
function future(p) {
  const c = p.career;
  if (!c) return h("div", { class: "dr-future is-none" }, "N'a pas joué en NBA");
  const seasons = c.seasons ? f.plural(c.seasons, "saison", "saisons") : "";
  const avg = c.pts !== null && c.pts !== undefined ? `${f.num(c.pts)} pts, ${f.num(c.reb)} reb, ${f.num(c.ast)} pd` : "";
  const when = c.timeframe === "Season" ? "cette saison" : "en carrière";
  return h(
    "div",
    { class: "dr-future" },
    h("span", { class: "dr-seasons" }, c.active ? h("span", { class: "dr-active" }, "En activité") : null, seasons),
    avg ? h("span", { class: "dr-avg num" }, avg, h("span", { class: "muted" }, ` ${when}`)) : null
  );
}

function pickRow(p, { byTeam = false } = {}) {
  const name = hasPage(p) ? h("a", { class: "dr-name", href: `#/joueur/${p.id}` }, p.name) : h("span", { class: "dr-name" }, p.name);
  const sub = [p.career?.pos ? f.position(p.career.pos) : "", originText(p)].filter(Boolean).join(", ");
  const club = byTeam
    ? h("a", { class: "dr-team is-year", href: `#/draft/${p.year}` }, h("b", null, roundName(p.round)), h("small", null, `${ordinal(p.roundPick || p.pick)} choix du tour, ${ordinal(p.pick)} au total`))
    : h("a", { class: "dr-team", href: `#/draft/equipe/${p.teamId}`, title: `Tous les choix de draft de ${teamLabel(p)}` }, teamLogo(p.teamId, 30), h("span", null, teamLabel(p)));
  return h(
    "div",
    { class: `draft-row${p.pick === 1 ? " is-first" : ""}`, dataset: { id: p.id } },
    h("span", { class: "dr-pick num", title: `${ordinal(p.pick)} choix` }, String(p.pick || "–")),
    h("span", { class: "dr-photo" }, headshot(p.id, { alt: "" })),
    h("div", { class: "dr-who" }, name, sub ? h("small", null, sub) : null),
    club,
    future(p)
  );
}

function groupHead(title, count, href) {
  const label = href ? h("a", { href }, title) : title;
  return h("h2", { class: "draft-group" }, label, h("span", { class: "count" }, f.plural(count, "choix", "choix")));
}

// Visuel de l'en-tête : le 1er choix en pied (photo « silos »), sinon son portrait.
function firstPickVisual(p, top) {
  if (!p || !hasPage(p)) return null;
  const img = h("img", { src: silhouetteUrl(p.id), alt: "", decoding: "async", referrerpolicy: "no-referrer" });
  img.addEventListener(
    "error",
    () => {
      top.update({ visual: headshot(p.id, { size: "big", alt: "" }), visualKind: "cutout" });
    },
    { once: true }
  );
  return img;
}

function matches(p, state) {
  if (state.round && String(p.round) !== state.round) return false;
  if (state.origin) {
    const known = Boolean(ORIGIN_LABEL[p.orgType]);
    if (state.origin === "other" ? known : p.orgType !== state.origin) return false;
  }
  if (state.q) {
    const hay = normalize(`${p.name} ${p.org || ""} ${teamLabel(p)}`);
    if (!state.q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

// Deux tours depuis 1989 : des puces. Les anciennes drafts en comptaient jusqu'à vingt : une liste.
function roundFilter(rounds, onChange) {
  if (rounds.length < 2) return null;
  const options = [{ value: "", label: "Tous les tours" }, ...rounds.map((r) => ({ value: String(r), label: roundName(r) }))];
  if (rounds.length <= 4) return chips(options, "", onChange, "Tour");
  const sel = h("select", { class: "select", "aria-label": "Tour" }, options.map((o) => h("option", { value: o.value }, o.label)));
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function yearSelect(years, value) {
  const sel = h(
    "select",
    { class: "select", "aria-label": "Année de la draft" },
    years.map((y) => h("option", { value: y, selected: y === value ? true : null }, String(y)))
  );
  sel.addEventListener("change", () => (location.hash = `#/draft/${sel.value}`));
  return sel;
}

function teamSelect(value, year) {
  const sel = h(
    "select",
    { class: "select", "aria-label": "Choix de draft d'une équipe" },
    h("option", { value: "" }, "Toutes les équipes"),
    teams()
      .slice()
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map((t) => h("option", { value: t.id, selected: Number(value) === t.id ? true : null }, t.fullName))
  );
  sel.addEventListener("change", () => (location.hash = sel.value ? `#/draft/equipe/${sel.value}` : `#/draft${year ? `/${year}` : ""}`));
  return sel;
}

function yearStep(years, year, delta) {
  const i = years.indexOf(year);
  const target = years[i - delta];
  const label = delta > 0 ? `${target ?? ""} ›` : `‹ ${target ?? ""}`;
  return target
    ? h("a", { class: "chip dr-step", href: `#/draft/${target}`, "aria-label": delta > 0 ? `Draft ${target}, suivante` : `Draft ${target}, précédente` }, label)
    : null;
}

function load(ctx, path) {
  return api(path, { signal: ctx.signal });
}

async function page(ctx, { year = null, teamId = null } = {}) {
  const t = teamId ? team(teamId) : null;
  const byTeam = Boolean(teamId);
  const top = poster(ctx, {
    kicker: t ? t.fullName : "Draft NBA",
    title: "Draft",
    teamId: t?.id || null,
    ...(t ? { visual: teamLogo(t.id, 300), visualKind: "logo", ghost: t.tri } : {}),
  });
  const body = h("div", { class: "draft-page" }, loading("Chargement des drafts…"));
  ctx.outlet.append(top.el, body);

  let res;
  try {
    res = await load(ctx, teamId ? `/draft?team=${teamId}` : `/draft${year ? `?year=${year}` : ""}`);
  } catch (err) {
    if (!ctx.active) return;
    body.replaceChildren(errorState(err, () => location.reload()));
    return;
  }
  if (!ctx.active) return;
  const { data, meta } = res;
  const picks = data.picks;
  const played = picks.filter((p) => p.career).length;
  const active = picks.filter((p) => p.career?.active).length;

  if (byTeam) {
    const name = t?.fullName || (picks[0] ? teamLabel(picks[0]) : "Équipe");
    const years = new Set(picks.map((p) => p.year));
    top.update({
      kicker: `${name}, tous les choix de draft`,
      stats: [
        { label: "Choix", v: picks.length },
        { label: "Drafts", v: years.size },
        { label: "1ers choix", v: picks.filter((p) => p.pick === 1).length },
        { label: "En activité", v: active },
      ],
    });
  } else {
    const first = picks.find((p) => p.pick === 1) || picks[0];
    const rounds = new Set(picks.map((p) => p.round).filter(Boolean));
    top.update({
      kicker: `Draft NBA ${data.year}`,
      ghost: data.year ? String(data.year) : "",
      teamId: first?.teamId || null,
      meta: first ? h("span", null, "1er choix : ", hasPage(first) ? h("a", { href: `#/joueur/${first.id}` }, first.name) : first.name, `, ${teamLabel(first)}${first.org ? ` (${first.org})` : ""}`) : null,
      stats: [
        { label: "Choix", v: picks.length },
        { label: rounds.size > 1 ? "Tours" : "Tour", v: rounds.size || 1 },
        { label: "Ont joué en NBA", v: played },
        { label: "En activité", v: active },
      ],
      ...(first && hasPage(first) ? { visual: firstPickVisual(first, top), visualKind: "full" } : {}),
    });
  }

  if (!picks.length) {
    body.replaceChildren(
      ...[staleBanner(meta)].filter(Boolean),
      h("div", { class: "toolbar draft-tools" }, data.years.length ? yearSelect(data.years, data.year) : null, teamSelect(teamId, data.years[0])),
      h("p", { class: "note" }, byTeam ? "Aucun choix de draft trouvé pour cette équipe." : "L'ordre de cette draft n'est pas encore publié.")
    );
    return;
  }

  const state = { round: "", origin: "", q: "" };
  const list = h("div", { class: "draft-list" });
  const count = h("p", { class: "note draft-count", role: "status" });

  const draw = () => {
    const shown = picks.filter((p) => matches(p, state));
    count.textContent = shown.length === picks.length ? "" : `${f.plural(shown.length, "choix", "choix")} sur ${picks.length}`;
    const out = [];
    if (!shown.length) out.push(h("p", { class: "note" }, "Aucun choix ne correspond à ces filtres."));
    let group = null;
    for (const p of shown) {
      const key = byTeam ? p.year : p.round;
      if (key !== group) {
        group = key;
        const n = shown.filter((x) => (byTeam ? x.year : x.round) === key).length;
        out.push(byTeam ? groupHead(String(p.year), n, `#/draft/${p.year}`) : groupHead(roundName(p.round), n));
      }
      out.push(pickRow(p, { byTeam }));
    }
    list.replaceChildren(...out);
    swapIn(list);
  };

  const roundsHere = [...new Set(picks.map((p) => p.round).filter(Boolean))].sort((a, b) => a - b);
  const input = h("input", { type: "search", class: "select dr-search", placeholder: "Joueur, université, équipe", "aria-label": "Rechercher dans la draft" });
  let timer = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = normalize(input.value.trim());
      draw();
    }, 120);
  });

  const nav = byTeam
    ? h("div", { class: "dr-nav" }, teamSelect(teamId, null))
    : h("div", { class: "dr-nav" }, yearStep(data.years, data.year, -1), yearSelect(data.years, data.year), yearStep(data.years, data.year, 1), teamSelect(null, data.year));

  body.replaceChildren(
    ...[staleBanner(meta)].filter(Boolean),
    h(
      "div",
      { class: "toolbar draft-tools" },
      nav,
      roundFilter(roundsHere, (v) => {
        state.round = v;
        draw();
      }),
      chips(ORIGINS, "", (v) => {
        state.origin = v;
        draw();
      }, "Provenance"),
      input
    ),
    count,
    list,
    h("p", { class: "note draft-source" }, "L'équipe indiquée est celle qui a utilisé le choix le soir de la draft, sous son nom de l'époque. Les échanges conclus avant la draft ne sont pas détaillés.")
  );
  draw();
}

export function render(ctx) {
  const year = ctx.params[0] ? Number(ctx.params[0]) : null;
  return page(ctx, { year });
}

export function renderTeam(ctx) {
  return page(ctx, { teamId: Number(ctx.params[0]) });
}
