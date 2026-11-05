// Scène d'ouverture de l'accueil : le joueur du match de chaque rencontre de la nuit, en grand.
// Fond aux couleurs de son équipe, nom en très gros derrière lui, portrait détouré par-dessus
// (les portraits officiels de la NBA ont déjà un fond transparent), sa ligne de stats et le match.
// Un joueur par match ; on passe de l'un à l'autre avec les onglets, les flèches, le clavier ou
// en glissant le doigt, et la scène avance seule tant qu'on n'y touche pas.

import { api } from "../api.js";
import { h, s } from "../dom.js";
import * as f from "../format.js";
import { teamLogo } from "../components.js";
import { contrast, headshotUrl, team, teamBand } from "../teams.js";
import { isHidden, setRevealed } from "../spoiler.js";
import { reducedMotion } from "../scroll.js";

const AUTOPLAY_MS = 8000;

function arrow(dir) {
  return s(
    "svg",
    { viewBox: "0 0 24 24", "aria-hidden": "true" },
    s("path", { d: dir < 0 ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7", fill: "none", stroke: "currentColor", "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round" })
  );
}

function expandIcon() {
  return s(
    "svg",
    { viewBox: "0 0 24 24", "aria-hidden": "true" },
    s("path", { d: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" })
  );
}

// Les chiffres qui comptent : points, rebonds, passes, et le reste s'il sort de l'ordinaire.
function statItems(p) {
  const items = [
    { label: "Points", v: p.pts },
    { label: "Rebonds", v: p.reb },
    { label: "Passes", v: p.ast },
  ];
  if (p.stl >= 3) items.push({ label: "Interceptions", v: p.stl });
  else if (p.blk >= 3) items.push({ label: "Contres", v: p.blk });
  else if (p.tpm >= 4) items.push({ label: "À 3 points", v: p.tpm });
  return items;
}

// Le nom tient sur deux lignes de la même taille, aussi grandes que la scène le permet.
let measureCtx = null;
function textWidth(text, family) {
  measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
  measureCtx.font = `400 100px ${family}`;
  return measureCtx.measureText(text.toUpperCase()).width;
}

function fitName(stage) {
  const name = stage.querySelector(".stage-name");
  if (!name) return;
  const w = stage.clientWidth;
  const hgt = stage.clientHeight;
  const phone = w < 700;
  const lines = [...name.querySelectorAll(".sn-line")].map((l) => l.textContent);
  const widest = Math.max(1, ...lines.map((t) => textWidth(t, '"Anton", "Oswald", sans-serif')));
  const room = phone ? w - 28 : w * 0.84;
  const cap = ((phone ? 0.15 : 0.25) * hgt) / (lines.length > 1 ? 1 : 0.8);
  name.style.fontSize = `${Math.floor(Math.min(cap, (room / widest) * 100))}px`;
}

function countUp(el, value) {
  if (reducedMotion() || !value) {
    el.textContent = String(value);
    return;
  }
  const t0 = performance.now();
  const dur = 900;
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = String(Math.round(value * (1 - (1 - k) ** 3)));
    if (k < 1 && el.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function createStage(ctx) {
  const el = h("section", { class: "stage", id: "joueurs", "aria-label": "Joueurs du match" });
  const scene = h("div", { class: "stage-scene" });
  const tabs = h("div", { class: "stage-tabs", "aria-label": "Choisir le joueur" });
  const prevBtn = h("button", { type: "button", class: "stage-round", "aria-label": "Joueur précédent" }, arrow(-1));
  const nextBtn = h("button", { type: "button", class: "stage-round", "aria-label": "Joueur suivant" }, arrow(1));
  const arrows = h("div", { class: "stage-arrows" }, prevBtn, nextBtn);
  el.append(scene, arrows, tabs);
  ctx.onCleanup(() => document.body.style.removeProperty("--stage-ink"));

  // Deux bandes en biais aux couleurs de l'équipe, derrière le nom et le joueur.
  const bands = () => [
    h("div", { class: "stage-band back", "aria-hidden": "true" }),
    h("div", { class: "stage-band back thin", "aria-hidden": "true" }),
  ];

  let stars = [];
  let index = 0;
  let key = null;
  let day = null;
  let manual = reducedMotion();
  if (manual) el.classList.add("no-auto");
  const extras = new Map();

  const ro = new ResizeObserver(() => fitName(el));
  ro.observe(el);
  document.fonts?.load('100px "Anton"').then(() => fitName(el)).catch(() => {});

  // La scène arrête d'avancer seule quand elle n'est plus à l'écran.
  const io = new IntersectionObserver(([e]) => el.classList.toggle("is-paused", !e.isIntersecting), { threshold: 0.35 });
  io.observe(el);
  ctx.onCleanup(() => {
    ro.disconnect();
    io.disconnect();
  });

  const go = (i, byUser = false) => {
    if (!stars.length) return;
    if (byUser) {
      manual = true;
      el.classList.add("no-auto");
    }
    index = (i + stars.length) % stars.length;
    show();
  };
  prevBtn.addEventListener("click", () => go(index - 1, true));
  nextBtn.addEventListener("click", () => go(index + 1, true));
  el.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowRight") go(index + 1, true);
    else if (e.key === "ArrowLeft") go(index - 1, true);
  });

  // Glisser le doigt pour changer de joueur (sauf sur la bande des noms, qui défile seule).
  let touch = null;
  el.addEventListener(
    "touchstart",
    (e) => {
      touch = e.touches.length === 1 && !e.target.closest(".stage-tabs") ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    },
    { passive: true }
  );
  el.addEventListener(
    "touchend",
    (e) => {
      if (!touch) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      touch = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) go(index + (dx < 0 ? 1 : -1), true);
    },
    { passive: true }
  );

  function drawTabs() {
    tabs.replaceChildren(
      ...stars.map((p, i) => {
        const b = h(
          "button",
          { type: "button", class: "stage-tab", "aria-label": `${p.name}, ${p.game.away.tri} contre ${p.game.home.tri}` },
          h("span", { class: "st-num" }, String(i + 1).padStart(2, "0")),
          h("span", { class: "st-name" }, p.name),
          h("span", { class: "st-bar", "aria-hidden": "true" }, h("i", { class: "st-prog" }))
        );
        b.addEventListener("click", () => go(i, true));
        return b;
      })
    );
    const many = stars.length > 1;
    tabs.hidden = !many;
    arrows.hidden = !many;
  }

  function syncTabs() {
    [...tabs.children].forEach((b, i) => {
      const on = i === index;
      b.classList.toggle("is-active", on);
      if (on) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
      // La barre de progression du joueur affiché repart de zéro.
      const prog = b.querySelector(".st-prog");
      const fresh = prog.cloneNode();
      if (on && !manual) fresh.addEventListener("animationend", () => go(index + 1));
      prog.replaceWith(fresh);
    });
    const active = tabs.children[index];
    if (active && tabs.scrollWidth > tabs.clientWidth) {
      const left = active.offsetLeft - (tabs.clientWidth - active.offsetWidth) / 2;
      tabs.scrollTo({ left, behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }

  function paint(bgTeamId) {
    const band = teamBand(bgTeamId);
    el.style.setProperty("--c1", band.bg);
    el.style.setProperty("--ink", band.ink);
    // La bande prend la deuxième couleur de l'équipe si elle se distingue du texte, sinon un
    // ton voisin du fond (le texte posé dessus reste lisible).
    const vivid = band.accent !== band.ink && contrast(band.accent, band.ink) >= 1.6;
    el.style.setProperty("--c2", vivid ? band.accent : `color-mix(in oklab, ${band.bg} 80%, ${band.ink})`);
    el.dataset.ink = band.ink === "#ffffff" ? "light" : "dark";
    document.body.style.setProperty("--stage-ink", band.ink);
  }

  // Le petit encart du match, en bas à gauche : l'action du joueur en vidéo quand NBA.com
  // la publie, sinon la photo du match, sinon les deux logos et le score.
  function matchCard(p) {
    const g = p.game;
    const media = h(
      "span",
      { class: "sm-media" },
      h("span", { class: "sm-logos" }, teamLogo(g.away.id, 34, "", { plate: true }), h("b", { class: "num" }, `${g.away.score}-${g.home.score}`), teamLogo(g.home.id, 34, "", { plate: true })),
      h("span", { class: "sm-go", "aria-hidden": "true" }, expandIcon())
    );
    const kicker = h("span", { class: "sm-k" }, "Le match");
    const card = h(
      "a",
      { class: "stage-match", href: `#/match/${g.id}` },
      h("span", { class: "sm-t" }, `${g.away.tri} ${g.away.score} – ${g.home.score} ${g.home.tri}`),
      kicker,
      media
    );
    const fill = (ex) => {
      if (!card.isConnected || !ex?.page) return;
      const moment = (ex.page.moments || []).find((m) => m.playerId === p.id && m.video);
      if (moment && !reducedMotion()) {
        const video = h("video", { class: "sm-img", src: moment.video, poster: moment.poster || null, muted: "", loop: "", playsinline: "", preload: "none" });
        video.muted = true;
        card.addEventListener("mouseenter", () => video.play().catch(() => {}));
        card.addEventListener("focus", () => video.play().catch(() => {}));
        card.addEventListener("mouseleave", () => video.pause());
        card.addEventListener("blur", () => video.pause());
        media.prepend(video);
        media.classList.add("has-img");
        kicker.textContent = moment.category || "Son action";
        return;
      }
      const img = ex.page.recap?.image || moment?.poster;
      if (img) {
        media.prepend(h("img", { class: "sm-img", src: img, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }));
        media.classList.add("has-img");
      }
    };
    if (extras.has(g.id)) fill(extras.get(g.id));
    else
      api(`/game/${g.id}/extras`, { signal: ctx.signal })
        .then(({ data }) => {
          extras.set(g.id, data);
          fill(data);
        })
        .catch(() => extras.set(g.id, null));
    return card;
  }

  function nameBlock(lines) {
    return h(
      "h2",
      { class: "stage-name" },
      lines.filter(Boolean).map((t, i) => h("span", { class: "sn-line", style: { "--i": i } }, h("span", { class: "sn-in" }, t)))
    );
  }

  function show() {
    const p = stars[index];
    paint(p.teamId);
    const g = p.game;
    const label = f.gameLabel(g);
    const cut = h("img", {
      class: "stage-cutout",
      src: headshotUrl(p.id, "big"),
      alt: p.name,
      width: 1040,
      height: 760,
      decoding: "async",
      referrerpolicy: "no-referrer",
    });
    cut.addEventListener("error", () => cut.remove());
    const stats = h(
      "div",
      { class: "stage-stats" },
      statItems(p).map((it, i) => {
        const v = h("b", { class: "num" }, "0");
        countUp(v, it.v);
        return h("div", { class: "ss-item", style: { "--i": i } }, h("small", null, it.label), v);
      })
    );
    scene.replaceChildren(
      ...bands(),
      h("div", { class: "stage-top" }, h("span", { class: "k" }, index === 0 && stars.length > 2 ? "Joueur de la nuit" : "Joueur du match"), h("span", { class: "d" }, [f.dayShort(day), label].filter(Boolean).join(" · ")), h("a", { class: "stage-top-score num", href: `#/match/${g.id}` }, `${g.away.tri} ${g.away.score} – ${g.home.score} ${g.home.tri}`)),
      h("div", { class: "stage-layer name-layer" }, nameBlock([p.first, p.last])),
      h("a", { class: "stage-layer cut-layer", href: `#/joueur/${p.id}`, tabindex: "-1", "aria-hidden": "true" }, cut),
      h(
        "div",
        { class: "stage-left" },
        h(
          "a",
          { class: "stage-bio", href: `#/joueur/${p.id}` },
          h("span", { class: "plus", "aria-hidden": "true" }, "+"),
          h("span", { class: "bio-t" }, "Sa fiche"),
          h("small", null, [team(p.teamId)?.name, p.jersey ? `n° ${p.jersey}` : "", p.min ? `${p.min.split(":")[0]} min` : ""].filter(Boolean).join(" · "))
        ),
        matchCard(p)
      ),
      stats
    );
    fitName(el);
    syncTabs();
    // Le portrait suivant est chargé d'avance.
    const next = stars[(index + 1) % stars.length];
    if (next && next !== p) new Image().src = headshotUrl(next.id, "big");
  }

  // Sans joueur à montrer (journée pas encore jouée), la date et le programme.
  function showDay(board) {
    paint(null);
    el.style.setProperty("--c1", "var(--stage-accent)");
    el.style.setProperty("--c2", "#d95400");
    el.dataset.ink = "light";
    const games = board.games || [];
    const first = games.filter((g) => g.status === 1 && g.start).sort((a, b) => a.start.localeCompare(b.start))[0];
    const live = games.filter((g) => g.status === 2).length;
    const title = f.dayTitle(board.date).split(" ");
    const items = [
      { label: "Matchs", v: games.length },
      live ? { label: "En direct", v: live } : null,
    ].filter(Boolean);
    scene.replaceChildren(
      ...bands(),
      h("div", { class: "stage-top" }, h("span", { class: "k" }, board.isToday ? "Aujourd'hui en NBA" : "Programme"), first ? h("span", { class: "d" }, `Premier match à ${f.clockTime(first.start)}`) : null),
      h("div", { class: "stage-layer name-layer" }, nameBlock([title[0], title.slice(1).join(" ")])),
      h("div", { class: "stage-stats centered" }, items.map((it, i) => h("div", { class: "ss-item", style: { "--i": i } }, h("small", null, it.label), h("b", { class: "num" }, String(it.v)))))
    );
    tabs.hidden = true;
    arrows.hidden = true;
    fitName(el);
  }

  function showGate(board, spoilerKey) {
    paint(null);
    el.style.setProperty("--c1", "var(--stage-accent)");
    el.style.setProperty("--c2", "#d95400");
    el.dataset.ink = "light";
    const btn = h("button", { type: "button", class: "stage-reveal" }, "Révéler les joueurs du match");
    btn.addEventListener("click", () => {
      setRevealed(spoilerKey, true);
      key = null;
      update(board);
    });
    scene.replaceChildren(
      ...bands(),
      h("div", { class: "stage-top" }, h("span", { class: "k" }, "Anti-spoiler actif"), h("span", { class: "d" }, f.dayShort(day))),
      h("div", { class: "stage-layer name-layer" }, nameBlock(["Joueurs", "du match"])),
      h("div", { class: "stage-gate" }, btn)
    );
    tabs.hidden = true;
    arrows.hidden = true;
    fitName(el);
  }

  async function update(board) {
    const finished = board.games.filter((g) => g.status === 3).length;
    // La nuit à raconter : celle de la journée affichée, ou la précédente si rien n'est fini.
    day = finished ? board.date : board.isToday && board.prev ? board.prev : null;
    if (!day) {
      key = null;
      showDay(board);
      return;
    }
    const spoilerKey = `recap:${day}`;
    if (isHidden(spoilerKey)) {
      key = null;
      showGate(board, spoilerKey);
      return;
    }
    const nextKey = `${day}:${finished}`;
    if (nextKey === key) return;
    try {
      const { data } = await api(`/recap?date=${day}`, { signal: ctx.signal });
      if (!ctx.active) return;
      const list = data.stars || [];
      if (!list.length) {
        key = null;
        showDay(board);
        return;
      }
      const current = stars[index]?.id;
      stars = list;
      key = nextKey;
      index = Math.max(0, stars.findIndex((p) => p.id === current));
      drawTabs();
      show();
    } catch (err) {
      if (err.name === "AbortError") return;
      key = null;
      showDay(board);
    }
  }

  return { el, update };
}
