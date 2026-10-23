import { route, start } from "./router.js";
import { loadTeams } from "./teams.js";
import { initGlobalSearch } from "./search.js";
import { errorState, refreshLogos } from "./components.js";
import * as home from "./views/home.js";
import * as game from "./views/game.js";
import * as teamsView from "./views/teams.js";
import * as teamView from "./views/team.js";
import * as players from "./views/players.js";
import * as player from "./views/player.js";
import * as standings from "./views/standings.js";
import * as leaders from "./views/leaders.js";
import * as status from "./views/status.js";

// Les couleurs d'équipe et les versions de logos dépendent du thème : on redessine la page.
function redraw() {
  refreshLogos();
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function initTheme() {
  const btn = document.getElementById("theme-toggle");
  const root = document.documentElement;
  const isDark = () => {
    const forced = root.dataset.theme;
    if (forced) return forced === "dark";
    return !window.matchMedia("(prefers-color-scheme: light)").matches;
  };
  const SUN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g></svg>';
  const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" fill="currentColor"/></svg>';
  const sync = () => {
    const dark = isDark();
    btn.setAttribute("aria-label", dark ? "Passer au thème clair" : "Passer au thème sombre");
    btn.title = dark ? "Thème clair" : "Thème sombre";
    btn.innerHTML = dark ? SUN : MOON;
  };
  btn.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("parquet-theme", next);
    } catch {
      /* préférence non mémorisée */
    }
    sync();
    redraw();
  });
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (!root.dataset.theme) {
      sync();
      redraw();
    }
  });
  sync();
}

function initSpoilerMode() {
  const btn = document.getElementById("spoiler-toggle");
  if (!btn) return;
  const root = document.documentElement;
  const isSpoiler = () => root.dataset.spoiler === "1";

  const EYE =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  const sync = () => {
    const on = isSpoiler();
    btn.setAttribute("aria-label", on ? "Désactiver le mode anti-spoiler (afficher les scores)" : "Activer le mode anti-spoiler (masquer les scores)");
    btn.title = on ? "Mode anti-spoiler actif (scores masqués) — cliquer pour afficher" : "Mode anti-spoiler inactif — cliquer pour masquer les scores";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.innerHTML = on ? EYE_OFF : EYE;
    if (on) btn.classList.add("is-active");
    else btn.classList.remove("is-active");
  };

  btn.addEventListener("click", () => {
    const next = isSpoiler() ? "" : "1";
    if (next) root.dataset.spoiler = "1";
    else delete root.dataset.spoiler;
    try {
      localStorage.setItem("parquet-spoiler-free", next);
    } catch {
      /* préférence non mémorisée */
    }
    sync();
    window.dispatchEvent(new CustomEvent("parquet:spoiler-change", { detail: { active: Boolean(next) } }));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

  sync();
}

route("/", home.render, "matchs");
route("/matchs/(\\d{4}-\\d{2}-\\d{2})", home.render, "matchs");
route("/match/(\\d{10})", game.render, "matchs");
route("/equipes", teamsView.render, "equipes");
route("/equipe/(\\d+)", teamView.render, "equipes");
route("/joueurs", players.render, "joueurs");
route("/joueur/(\\d+)", player.render, "joueurs");
route("/classement", standings.render, "classement");
route("/leaders", leaders.render, "leaders");
route("/etat", status.render, null);

initTheme();
initSpoilerMode();
const outlet = document.getElementById("main");
loadTeams()
  .then(() => {
    initGlobalSearch();
    start(outlet);
  })
  .catch((err) => {
    outlet.replaceChildren(errorState(err, () => location.reload()));
  });
