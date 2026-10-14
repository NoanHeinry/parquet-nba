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
const outlet = document.getElementById("main");
loadTeams()
  .then(() => {
    initGlobalSearch();
    start(outlet);
  })
  .catch((err) => {
    outlet.replaceChildren(errorState(err, () => location.reload()));
  });
