import { route, start } from "./router.js";
import { loadTeams } from "./teams.js";
import { appStatus } from "./api.js";
import { initGlobalSearch } from "./search.js";
import { errorState, refreshLogos } from "./components.js";
import * as home from "./views/home.js";
import * as game from "./views/game.js";
import * as multi from "./views/multi.js";
import * as teamsView from "./views/teams.js";
import * as teamView from "./views/team.js";
import * as players from "./views/players.js";
import * as player from "./views/player.js";
import * as standings from "./views/standings.js";
import * as playoffs from "./views/playoffs.js";
import * as leaders from "./views/leaders.js";
import * as compare from "./views/compare.js";
import * as status from "./views/status.js";
import * as infos from "./views/infos.js";
import * as draft from "./views/draft.js";
import * as quiz from "./views/quiz.js";
import * as race from "./views/race.js";
import * as awards from "./views/awards.js";
import * as palmaresView from "./views/palmares.js";
import * as records from "./views/records.js";
import * as h2h from "./views/h2h.js";
import { initNotificationsUI } from "./notifications.js";
import { enableImmersive } from "./menu.js";

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
    const metaTheme = document.getElementById("meta-theme-color");
    if (metaTheme) metaTheme.setAttribute("content", dark ? "#0f1113" : "#efefec");
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

// Animations : par défaut, Parquet suit le réglage du système (Windows, macOS, Android…).
// Le bouton permet de les forcer ou de les couper, quel que soit ce réglage.
function initMotion() {
  const btn = document.getElementById("motion-toggle");
  if (!btn) return;
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const pref = () => {
    try {
      return localStorage.getItem("parquet-motion") || "auto";
    } catch {
      return "auto";
    }
  };
  const apply = () => {
    const p = pref();
    root.dataset.motion = p === "off" || (p !== "on" && media.matches) ? "reduce" : "full";
  };
  const ON =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="15" cy="12" r="6"/><path d="M15 6v12M9.6 9.4c1.6 1.4 1.6 3.8 0 5.2M2 9h4M1 12h4M2 15h4"/></svg>';
  const OFF =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="6"/><path d="M12 6v12M6.6 9.4c1.6 1.4 1.6 3.8 0 5.2M3 3l18 18"/></svg>';
  const sync = () => {
    const on = root.dataset.motion !== "reduce";
    btn.setAttribute("aria-label", on ? "Réduire les animations" : "Activer les animations");
    btn.title = on ? "Animations activées (cliquer pour les réduire)" : "Animations réduites (cliquer pour les activer)";
    btn.innerHTML = on ? ON : OFF;
  };
  btn.addEventListener("click", () => {
    const next = root.dataset.motion === "reduce" ? "on" : "off";
    try {
      localStorage.setItem("parquet-motion", next);
    } catch {
      /* préférence non mémorisée */
    }
    apply();
    sync();
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  media.addEventListener("change", () => {
    apply();
    sync();
  });
  apply();
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

function initPwa() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .catch((err) => console.debug("ServiceWorker non disponible:", err));
    });
  }

  let deferredPrompt = null;
  const installBtn = document.getElementById("pwa-install-btn");
  if (!installBtn) return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });

  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) {
      alert("Pour installer Parquet sur votre appareil :\n- Sur Android : ouvrez le menu Chrome puis sélectionnez 'Installer l'application'\n- Sur iPhone/iPad : touchez Partager puis 'Sur l'écran d'accueil'");
      return;
    }
    installBtn.hidden = true;
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } finally {
      deferredPrompt = null;
    }
  });

  window.addEventListener("appinstalled", () => {
    installBtn.hidden = true;
  });
}

route("/", home.render, "matchs");
route("/matchs/(\\d{4}-\\d{2}-\\d{2})", home.render, "matchs");
route("/match/(\\d{10})", game.render, "matchs");
route("/multi", multi.render, "matchs");
route("/equipes", teamsView.render, "equipes");
route("/equipes/stats", teamsView.renderStats, "equipes");
route("/face-a-face", h2h.render, "equipes");
route("/face-a-face/(\\d+)/(\\d+)", h2h.render, "equipes");
route("/equipe/(\\d+)", teamView.render, "equipes");
route("/joueurs", players.render, "joueurs");
route("/joueur/(\\d+)", player.render, "joueurs");
route("/classement", standings.render, "classement");
route("/classement/course", race.render, "classement");
route("/trophees", awards.render, "trophees");
route("/trophees/palmares", palmaresView.render, "trophees");
route("/records", records.render, "records");
route("/playoffs", playoffs.render, "playoffs");
route("/playoffs/(\\d{4}-\\d{2})", playoffs.render, "playoffs");
route("/leaders", leaders.render, "leaders");
route("/comparer", compare.render, "comparer");
route("/comparer/(\\d+)", compare.render, "comparer");
route("/comparer/(\\d+)/(\\d+)", compare.render, "comparer");
route("/draft", draft.render, "draft");
route("/draft/(\\d{4})", draft.render, "draft");
route("/draft/equipe/(\\d+)", draft.renderTeam, "draft");
route("/jeu", quiz.renderHome, "jeu");
route("/jeu/(defi|partie|serie|chrono)", quiz.renderPlay, "jeu");
route("/infos", infos.render, "infos");
route("/infos/(mouvements)", infos.render, "infos");
route("/etat", status.render, null);

enableImmersive();
initTheme();
initSpoilerMode();
initMotion();
initPwa();
initNotificationsUI();
const outlet = document.getElementById("main");

// Version de l'interface : elle doit correspondre à celle du serveur (parquet/__init__.py).
const APP_VERSION = "1.20.0";
document.documentElement.dataset.version = APP_VERSION;

// Compare deux numéros de version (1.5.0 < 1.12.0).
const versionCmp = (a, b) => {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

function topBanner(text) {
  const banner = document.createElement("div");
  banner.className = "demo-banner";
  banner.textContent = text;
  document.querySelector(".topbar").after(banner);
}

// Avertissement de version : un encart fixé en bas de l'écran, qu'on peut fermer.
function updateNotice(text) {
  const box = document.createElement("div");
  box.className = "update-notice";
  box.setAttribute("role", "alert");
  const msg = document.createElement("p");
  msg.textContent = text;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "update-close";
  close.setAttribute("aria-label", "Fermer");
  close.textContent = "×";
  close.addEventListener("click", () => box.remove());
  box.append(msg, close);
  document.body.append(box);
}

// Mode démonstration (python run.py --demo) : un bandeau rappelle que les données sont fictives.
// Après une mise à jour, si Parquet tourne encore avec l'ancien serveur (fenêtre jamais
// refermée), les nouvelles pages n'ont pas de données : un bandeau dit quoi faire.
appStatus()
  .then((st) => {
    const diff = st.version ? versionCmp(st.version, APP_VERSION) : 0;
    if (diff < 0) {
      updateNotice(
        `Parquet a été mis à jour (${APP_VERSION}), mais le programme lancé sur l'ordinateur est encore l'ancienne version (${st.version}). Ferme la fenêtre de Parquet puis relance-le : certaines pages restent vides en attendant.`
      );
    } else if (diff > 0) {
      updateNotice(`Une nouvelle version de Parquet (${st.version}) est prête : recharge la page (Ctrl+F5 sur ordinateur) pour l'afficher.`);
    }
    if (!st.demo) return;
    document.documentElement.dataset.demo = "1";
    topBanner("Mode démonstration : joueurs, scores et statistiques fictifs, sans connexion à NBA.com.");
  })
  .catch(() => {});

loadTeams()
  .then(() => {
    initGlobalSearch();
    start(outlet);
  })
  .catch((err) => {
    outlet.replaceChildren(errorState(err, () => location.reload()));
  });
