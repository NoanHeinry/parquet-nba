// Flèche « retour » en haut à gauche : revient à la page précédente de l'appli.
//
// L'appli garde la liste des pages visitées dans l'onglet (sessionStorage) pour savoir s'il existe
// une page précédente à elle. Sinon (page ouverte directement par un lien ou une notification),
// la flèche mène à l'accueil. Sur l'accueil sans page précédente, elle est cachée.

import { h } from "./dom.js";

const KEY = "parquet-pages";
const MAX = 60;

function load() {
  try {
    const list = JSON.parse(sessionStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* sans stockage : la flèche mène simplement à l'accueil */
  }
}

const here = () => location.hash || "#/";
const isHome = (hash) => hash === "#/" || hash === "#" || hash === "";

function arrow() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<path d="M15 5l-7 7 7 7M8.5 12H20"/>';
  return svg;
}

export function initBackNav() {
  let pages = load();
  if (pages[pages.length - 1] !== here()) pages.push(here());
  save(pages);

  const btn = h("button", { type: "button", class: "back-fab", "aria-label": "Revenir à la page précédente", title: "Page précédente" }, arrow());
  document.body.append(btn);

  const update = () => {
    const canBack = pages.length > 1;
    const show = canBack || !isHome(here());
    btn.hidden = !show;
    btn.setAttribute("aria-label", canBack ? "Revenir à la page précédente" : "Revenir à l'accueil");
    btn.title = canBack ? "Page précédente" : "Accueil";
    document.documentElement.classList.toggle("has-back", show);
  };

  let restart = false;
  window.addEventListener("hashchange", () => {
    const now = here();
    if (restart) {
      // Retour à l'accueil faute de page précédente : on repart de zéro.
      restart = false;
      pages = [now];
      save(pages);
      update();
      return;
    }
    // Retour (bouton, geste, flèche) : on retrouve l'avant-dernière page ; sinon c'est une nouvelle page.
    if (pages.length > 1 && pages[pages.length - 2] === now) pages.pop();
    else if (pages[pages.length - 1] !== now) pages.push(now);
    save(pages);
    update();
  });

  btn.addEventListener("click", () => {
    if (pages.length > 1) history.back();
    else {
      restart = true;
      location.replace("#/");
    }
  });
  update();
}
