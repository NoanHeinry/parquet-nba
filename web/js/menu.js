// Site sans en-tête : le logo et un bouton rond flottent au-dessus des pages, et le menu
// descend en plein écran (liens en grand, recherche, alertes, anti-spoiler, animations, thème).
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
  // Même ballon que le logo de l'en-tête.
  return s(
    "svg",
    { viewBox: "0 0 32 32", "aria-hidden": "true" },
    s("circle", { cx: 16, cy: 16, r: 13, fill: "none", stroke: "currentColor", "stroke-width": 2.4 }),
    s("path", {
      d: "M3 16h26M16 3v26M7.2 6.6c3.6 2.6 5.6 5.9 5.6 9.4s-2 6.8-5.6 9.4M24.8 6.6c-3.6 2.6-5.6 5.9-5.6 9.4s2 6.8 5.6 9.4",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 2,
    })
  );
}

function build() {
  if (built) return built;
  const links = [...document.querySelectorAll(".mainnav a")].map((a, i) =>
    h(
      "a",
      { class: "menu-link", href: a.getAttribute("href"), dataset: { nav: a.dataset.nav || "" }, style: `--i: ${i}` },
      h("span", { class: "menu-num" }, `${String(i + 1).padStart(2, "0")}.`),
      h("span", { class: "menu-label" }, a.textContent)
    )
  );
  const tools = h("div", { class: "menu-tools" });
  const panel = h(
    "div",
    { class: "menu-panel", id: "menu-panel", role: "dialog", "aria-modal": "true", "aria-label": "Menu", hidden: true },
    h(
      "div",
      { class: "menu-inner" },
      h("nav", { class: "menu-nav", "aria-label": "Navigation principale" }, links),
      h("div", { class: "menu-side" }, tools, h("a", { class: "menu-small", href: "#/etat" }, "État des sources"))
    )
  );
  const fab = h(
    "button",
    { class: "menu-fab", type: "button", "aria-expanded": "false", "aria-controls": "menu-panel", "aria-label": "Ouvrir le menu" },
    burger()
  );
  const brand = h("a", { class: "float-brand", href: "#/", "aria-label": "Parquet, retour aux matchs" }, brandMark(), h("span", null, "Parquet"));

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
  built = { panel, fab, brand, tools };
  return built;
}

function open() {
  const { panel, fab } = built;
  lastFocus = document.activeElement;
  for (const a of panel.querySelectorAll(".menu-link")) {
    const current = document.querySelector(`.mainnav a[data-nav="${a.dataset.nav}"]`)?.getAttribute("aria-current");
    if (current) a.setAttribute("aria-current", current);
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

// Tout le site est sans en-tête : la recherche et les boutons passent dans le menu, une fois
// pour toutes, et le logo et le bouton rond flottent au-dessus de chaque page.
export function enableImmersive() {
  const { panel, fab, brand, tools } = build();
  const inner = document.querySelector(".topbar-inner");
  const search = inner?.querySelector(".search");
  const actions = inner?.querySelector(".topbar-actions");
  if (search) tools.append(search);
  if (actions) tools.append(actions);
  document.body.append(brand, fab, panel);
  document.body.classList.add("is-immersive");
}
