// Site sans en-tête : le logo et un bouton rond flottent au-dessus des pages, et le menu
// descend en plein écran : recherche et réglages en haut, puis toutes les pages rangées par
// thème, visibles d'un coup d'œil sans faire défiler.
//
// Les contrôles de l'en-tête (recherche, boutons) sont déplacés dans le menu, pas recopiés :
// ils gardent ainsi leur comportement.

import { h, s } from "./dom.js";

let built = null;
let isOpen = false;
let lastFocus = null;

function burger() {
  return s(
    "svg",
    { viewBox: "0 0 24 24", "aria-hidden": "true" },
    s("path", { class: "l1", d: "M4 8h16" }),
    s("path", { class: "l2", d: "M4 16h16" })
  );
}

function brandMark() {
  // Même logo que l'en-tête : web/img/logo.svg, vectorisé par scripts/logo.py depuis design/logo/.
  return s("svg", { class: "brand-logo", viewBox: "0 0 1000 525", "aria-hidden": "true" }, s("use", { href: "img/logo.svg#parquet-logo" }));
}

// Le menu, rangé par thème. Chaque lien a une courte description. Une page de la barre
// principale (index.html) absente d'ici est ajoutée au dernier groupe : rien ne se perd.
const GROUPS = [
  {
    title: "La saison",
    items: [
      ["#/", "Matchs", "Scores, résultats, calendrier"],
      ["#/classement", "Classement", "Conférences Est et Ouest"],
      ["#/classement/course", "Course aux playoffs", "Qualifiés, nombres magiques"],
      ["#/playoffs", "Playoffs", "Le tableau, série par série"],
      ["#/leaders", "Leaders", "Les meilleurs par catégorie"],
      ["#/trophees", "Trophées", "Les favoris de la saison"],
    ],
  },
  {
    title: "Équipes et joueurs",
    items: [
      ["#/equipes", "Équipes", "Les 30 franchises"],
      ["#/joueurs", "Joueurs", "D'hier et d'aujourd'hui"],
      ["#/comparer", "Comparer", "Deux joueurs côte à côte"],
      ["#/face-a-face", "Face-à-face", "L'histoire entre deux équipes"],
      ["#/draft", "Draft", "Chaque draft depuis 1947"],
    ],
  },
  {
    title: "Histoire",
    items: [
      ["#/trophees/palmares", "Palmarès", "Champions et trophées depuis 1947"],
      ["#/records", "Records", "Les meilleurs de tous les temps"],
    ],
  },
  {
    title: "Et aussi",
    items: [
      ["#/jeu", "Qui est-ce ?", "Le jeu des silhouettes"],
      ["#/infos", "Infos", "Blessures et transactions"],
    ],
  },
];

// Lien de la page affichée : celui dont l'adresse correspond le plus précisément.
function activeHref(hrefs) {
  const hash = location.hash || "#/";
  const path = hash.replace(/^#/, "") || "/";
  let best = null;
  for (const href of hrefs) {
    const p = href.replace(/^#/, "");
    const ok =
      p === "/"
        ? path === "/" || path.startsWith("/matchs") || path.startsWith("/match/") || path === "/multi"
        : path === p || path.startsWith(`${p}/`) || (p === "/joueurs" && path.startsWith("/joueur/")) || (p === "/equipes" && path.startsWith("/equipe/"));
    if (ok && (!best || p.length > best.replace(/^#/, "").length)) best = href;
  }
  return best;
}

function build() {
  if (built) return built;
  const known = new Set(GROUPS.flatMap((g) => g.items.map((it) => it[0])));
  const groups = GROUPS.map((g) => ({ ...g, items: [...g.items] }));
  for (const a of document.querySelectorAll(".mainnav a")) {
    const href = a.getAttribute("href");
    if (!known.has(href)) groups.at(-1).items.push([href, a.textContent, ""]);
  }
  let i = 0;
  const nav = h(
    "nav",
    { class: "menu-nav", "aria-label": "Navigation principale" },
    groups.map((g) =>
      h(
        "section",
        { class: "menu-group" },
        h("h2", { class: "menu-group-title" }, g.title),
        h(
          "div",
          { class: "menu-group-links" },
          g.items.map(([href, label, desc]) =>
            h(
              "a",
              { class: "menu-link", href, style: `--i: ${i++}` },
              h("span", { class: "menu-label" }, label),
              desc ? h("span", { class: "menu-desc" }, desc) : null
            )
          )
        )
      )
    )
  );
  const tools = h("div", { class: "menu-tools" });
  const panel = h(
    "div",
    { class: "menu-panel", id: "menu-panel", role: "dialog", "aria-modal": "true", "aria-label": "Menu", hidden: true },
    h(
      "div",
      { class: "menu-inner" },
      h("div", { class: "menu-side" }, tools, h("a", { class: "menu-small", href: "#/etat" }, "État des sources")),
      nav
    )
  );
  const fab = h(
    "button",
    { class: "menu-fab", type: "button", "aria-expanded": "false", "aria-controls": "menu-panel", "aria-label": "Ouvrir le menu" },
    burger()
  );
  const brand = h("a", { class: "float-brand", href: "#/", "aria-label": "Parquet, retour aux matchs" }, brandMark());

  fab.addEventListener("click", () => (isOpen ? close() : open()));
  panel.addEventListener("click", (e) => {
    // Un lien suivi ferme le menu ; la page change ensuite par l'ancre.
    if (e.target.closest("a")) close(false);
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    // Le focus reste dans le menu tant qu'il est ouvert.
    const items = [fab, ...panel.querySelectorAll("a[href], button:not([hidden]), input")].filter((el) => el.offsetParent !== null || el === fab);
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen && !document.querySelector(".notif-panel")) close();
  });
  window.addEventListener("hashchange", () => close(false));

  // Téléphone : le bouton s'efface en descendant, revient en remontant ou en haut de page.
  let lastY = window.scrollY;
  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const root = document.documentElement;
        if (y < 120 || y < lastY - 8) root.classList.remove("fab-away");
        else if (y > lastY + 8) root.classList.add("fab-away");
        if (Math.abs(y - lastY) > 8 || y < 120) lastY = y;
        ticking = false;
      });
    },
    { passive: true }
  );
  window.addEventListener("hashchange", () => document.documentElement.classList.remove("fab-away"));
  built = { panel, fab, brand, tools };
  return built;
}

function open() {
  const { panel, fab } = built;
  lastFocus = document.activeElement;
  const links = [...panel.querySelectorAll(".menu-link")];
  const current = activeHref(links.map((a) => a.getAttribute("href")));
  for (const a of links) {
    if (a.getAttribute("href") === current) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  panel.hidden = false;
  // Laisse le navigateur poser l'état fermé avant d'animer l'ouverture.
  requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add("is-open")));
  document.body.classList.add("menu-open");
  fab.setAttribute("aria-expanded", "true");
  fab.setAttribute("aria-label", "Fermer le menu");
  isOpen = true;
  panel.querySelector(".menu-link")?.focus({ preventScroll: true });
}

function close(restoreFocus = true) {
  if (!built || !isOpen) return;
  const { panel, fab } = built;
  panel.classList.remove("is-open");
  document.body.classList.remove("menu-open");
  fab.setAttribute("aria-expanded", "false");
  fab.setAttribute("aria-label", "Ouvrir le menu");
  isOpen = false;
  const done = () => {
    if (!isOpen) panel.hidden = true;
  };
  if (document.documentElement.dataset.motion === "reduce") done();
  else setTimeout(done, 420);
  if (restoreFocus && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}

const BUTTON_LABELS = { "pwa-install-btn": "Installer", "notif-toggle": "Alertes", "spoiler-toggle": "Anti-spoiler", "motion-toggle": "Animations", "theme-toggle": "Thème" };

// Tout le site est sans en-tête : la recherche et les boutons passent dans le menu, une fois
// pour toutes, et le logo et le bouton rond flottent au-dessus de chaque page.
export function enableImmersive() {
  const { panel, fab, brand, tools } = build();
  const inner = document.querySelector(".topbar-inner");
  const search = inner?.querySelector(".search");
  const actions = inner?.querySelector(".topbar-actions");
  if (search) tools.append(search);
  if (actions) {
    // Chaque réglage reçoit un nom visible sous son icône (cliquer sur le nom suffit).
    for (const [id, text] of Object.entries(BUTTON_LABELS)) {
      const btn = actions.querySelector(`#${id}`);
      if (!btn) continue;
      const wrap = h("span", { class: "menu-btn" });
      btn.replaceWith(wrap);
      wrap.append(btn, h("label", { class: "menu-btn-label", for: id }, text));
      // La case entière reflète l'état du bouton (activé, masqué) : les boutons gèrent eux-mêmes
      // leur icône, on recopie seulement leur état sur la case.
      const mirror = () => {
        wrap.classList.toggle("is-on", btn.getAttribute("aria-pressed") === "true" || btn.classList.contains("is-active"));
        wrap.hidden = btn.hidden;
      };
      new MutationObserver(mirror).observe(btn, { attributes: true, attributeFilter: ["aria-pressed", "class", "hidden"] });
      mirror();
    }
    tools.append(actions);
  }
  document.body.append(brand, fab, panel);
  document.body.classList.add("is-immersive");
}
