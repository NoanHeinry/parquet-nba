// Mes joueurs (#/mes-joueurs) : les joueurs favoris, leur saison et leur forme du moment.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { favoritePlayers, headshot, teamLogo, toggleFavoritePlayer } from "../components.js";
import { team, teamColor } from "../teams.js";
import { iconStar } from "../icons.js";
import { poster } from "../poster.js";
import { statusBadge } from "../news.js";

const FORM_GAMES = 5;

// Forme : moyenne de points sur les derniers matchs comparée à la moyenne de la saison.
function formOf(games, seasonPts) {
  const recent = games.slice(0, FORM_GAMES);
  if (recent.length < 2 || seasonPts === null || seasonPts === undefined) return null;
  const avg = recent.reduce((s, g) => s + (g.pts || 0), 0) / recent.length;
  const diff = avg - seasonPts;
  const kind = diff >= 2 ? "up" : diff <= -2 ? "down" : "flat";
  const label = kind === "up" ? "En forme" : kind === "down" ? "En baisse" : "Régulier";
  return { avg, diff, kind, label, recent };
}

function formBars(recent) {
  const max = Math.max(10, ...recent.map((g) => g.pts || 0));
  // Du plus ancien au plus récent, de gauche à droite.
  return h(
    "div",
    { class: "mp-bars", role: "img", "aria-label": `Points sur les ${recent.length} derniers matchs : ${recent.map((g) => g.pts).reverse().join(", ")}` },
    recent
      .slice()
      .reverse()
      .map((g) =>
        h(
          "span",
          { class: `mp-bar${g.wl === "W" ? " is-win" : ""}`, title: `${f.dayShort(g.date)} ${g.home ? "contre" : "à"} ${g.opp} : ${g.pts} pts` },
          h("b", { class: "num" }, g.pts ?? "–"),
          h("i", { style: { height: `${Math.max(4, Math.round(((g.pts || 0) / max) * 52))}px` } })
        )
      )
  );
}

function card(fav) {
  const el = h(
    "article",
    { class: "mp-card is-loading", style: { "--tc": fav.teamId ? teamColor(fav.teamId) : "var(--line-strong)" } },
    // Bandeau du haut : nom et équipe à gauche, photo à droite à sa taille naturelle (sans zoom).
    h(
      "div",
      { class: "mp-top" },
      h("div", { class: "mp-id" }, h("a", { class: "mp-name", href: `#/joueur/${fav.id}` }, fav.name)),
      h("a", { class: "mp-photo", href: `#/joueur/${fav.id}`, "aria-label": `Fiche de ${fav.name}` }, headshot(fav.id, { size: "big", alt: "" }))
    ),
    h("div", { class: "mp-body" }, h("p", { class: "note" }, "Chargement…"))
  );
  const remove = h("button", { type: "button", class: "mp-remove", title: "Retirer des favoris", "aria-label": `Retirer ${fav.name} des favoris` }, iconStar(true, 16));
  remove.addEventListener("click", () => {
    toggleFavoritePlayer(fav);
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 250);
  });
  el.append(remove);
  return el;
}

async function fill(el, fav, signal) {
  const body = el.querySelector(".mp-body");
  let p;
  try {
    p = (await api(`/player/${fav.id}`, { signal })).data;
  } catch (err) {
    if (err.name === "AbortError") return;
    body.querySelector(".note").textContent = "Fiche indisponible pour le moment.";
    el.classList.remove("is-loading");
    return;
  }
  const t = p.active && p.teamId ? team(p.teamId) : null;
  if (t) el.style.setProperty("--tc", teamColor(t.id));
  const hl = p.headline && p.headline.pts !== null ? p.headline : null;
  let games = [];
  if (p.active) {
    try {
      games = (await api(`/player/${fav.id}/gamelog`, { signal })).data.games || [];
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  const form = formOf(games, hl?.pts);
  const last = games[0];
  // NBA.com écrit « Career » ou « career » pour un joueur retraité.
  const avgLabel = hl ? (/career/i.test(hl.season || "") ? "En carrière" : `Saison ${hl.season}`) : "";
  const diffText = (d) => (Math.abs(d) < 0.05 ? "comme sa moyenne de la saison" : `${d > 0 ? "+" : "−"}${f.num(Math.abs(d))} par rapport à sa saison`);
  // replaceChildren écrirait « null » en toutes lettres : on ne garde que les blocs présents.
  el.querySelector(".mp-id").replaceChildren(
    h("a", { class: "mp-name", href: `#/joueur/${fav.id}` }, p.name),
    h(
      "p",
      { class: "mp-team" },
      t ? [teamLogo(t.id, 20), h("a", { href: `#/equipe/${t.id}` }, t.fullName), p.jersey ? ` · n° ${p.jersey}` : ""] : p.to ? `Carrière ${p.from}–${p.to}` : "Retraité"
    )
  );
  body.replaceChildren(...[
    hl
      ? h(
          "div",
          { class: "mp-avg" },
          h("small", null, avgLabel),
          h("span", null, h("b", { class: "num" }, f.num(hl.pts)), " pts"),
          h("span", null, h("b", { class: "num" }, f.num(hl.reb)), " reb"),
          h("span", null, h("b", { class: "num" }, f.num(hl.ast)), " pd")
        )
      : null,
    form
      ? h(
          "div",
          { class: "mp-form" },
          h(
            "p",
            { class: `mp-trend is-${form.kind}` },
            h("b", null, form.kind === "up" ? "↑ " : form.kind === "down" ? "↓ " : "→ ", form.label),
            ` : ${f.num(form.avg)} pts sur ses ${form.recent.length} derniers matchs (${diffText(form.diff)})`
          ),
          formBars(form.recent)
        )
      : null,
    last
      ? h(
          "a",
          { class: "mp-last", href: `#/match/${last.gameId}` },
          h("small", null, `Dernier match, ${f.dayShort(last.date)}`),
          h("span", null, `${last.pts} pts, ${last.reb} reb, ${last.ast} pd ${last.home ? "contre" : "à"} ${last.opp}`, h("span", { class: last.wl === "W" ? "pos" : "neg" }, last.wl === "W" ? " · victoire" : " · défaite"))
        )
      : p.active
        ? h("p", { class: "note" }, "Pas encore de match cette saison.")
        : null,
  ].filter(Boolean));
  el.classList.remove("is-loading");
  if (p.active) addNews(el, fav.id, signal);
}

// État de santé (badge à côté du nom) et dernier fait marquant, d'après l'actualité du joueur.
async function addNews(el, id, signal) {
  let data;
  try {
    data = (await api(`/player/${id}/actu`, { signal })).data;
  } catch {
    return;
  }
  if (data.status) el.querySelector(".mp-id")?.append(h("p", { class: "mp-status" }, statusBadge(data.status), data.status.reason ? h("span", null, data.status.reason) : null));
  const top = data.items.find((i) => i.kind !== "transaction" || data.items.length === 1);
  if (top) {
    el.querySelector(".mp-body")?.prepend(
      h(
        top.gameId ? "a" : "p",
        { class: `mp-news tone-${top.tone || "info"}`, href: top.gameId ? `#/match/${top.gameId}` : null },
        h("small", null, `Actu, ${f.dayShort(top.date)}`),
        h("b", null, top.title),
        top.text ? h("span", null, top.text) : null
      )
    );
  }
}

export async function render(ctx) {
  const favs = favoritePlayers();
  const top = poster(ctx, {
    kicker: "Tes favoris",
    title: "Mes joueurs",
    ghost: favs.length ? String(favs.length) : "",
    actions: [h("a", { class: "btn", href: "#/joueurs" }, "Trouver un joueur")],
  });
  if (!favs.length) {
    ctx.outlet.append(
      top.el,
      h(
        "div",
        { class: "state mp-empty" },
        iconStar(false, 36),
        h("p", null, h("b", null, "Aucun joueur favori pour l'instant.")),
        h("p", null, "Sur la fiche d'un joueur, touche « Ajouter aux favoris » : il apparaîtra ici avec sa saison et sa forme du moment, et sur l'accueil."),
        h("a", { class: "btn primary", href: "#/joueurs" }, "Chercher un joueur")
      )
    );
    return;
  }
  const cards = favs.map((fav) => [fav, card(fav)]);
  ctx.outlet.append(top.el, h("div", { class: "mp-grid" }, cards.map(([, el]) => el)));
  await Promise.all(cards.map(([fav, el]) => fill(el, fav, ctx.signal)));
}
