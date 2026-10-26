// Gestionnaire des alertes et notifications pour Parquet.
// Notifications natives du navigateur + toasts intégrés à l'application.

import { api } from "./api.js";
import { favorites } from "./components.js";
import { h } from "./dom.js";
import { iconBasketball, iconLightning, iconFlag, iconAlertCircle, iconInfo } from "./icons.js";
import { isSpoilerFree } from "./spoiler.js";

function resolveIcon(icon) {
  if (icon instanceof Node) return icon;
  if (icon === "lightning" || icon === "clutch") return iconLightning(18);
  if (icon === "flag" || icon === "end") return iconFlag(18);
  return iconBasketball(18);
}

const SETTINGS_KEY = "parquet-notifications-settings";
const DEFAULT_SETTINGS = {
  enabled: false,
  onStart: true,
  onClutch: true,
  onEnd: true,
  clutchOnlyFavs: false,
};

let currentSettings = { ...DEFAULT_SETTINGS };
try {
  const saved = localStorage.getItem(SETTINGS_KEY);
  if (saved) currentSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
} catch {
  /* préférences non chargées */
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings));
  } catch {
    /* stockage indisponible */
  }
}

// Suivi des états de match pour éviter les notifications en double.
// Les alertes déjà envoyées sont mémorisées deux jours : un rechargement de page ne les renvoie pas.
const seenGameStates = new Map();
const NOTIFIED_KEY = "parquet-notified";
const notifiedEvents = new Map();
try {
  const saved = JSON.parse(localStorage.getItem(NOTIFIED_KEY) || "{}");
  const limit = Date.now() - 2 * 24 * 3600 * 1000;
  for (const [k, at] of Object.entries(saved)) if (at > limit) notifiedEvents.set(k, at);
} catch {
  /* mémoire des alertes indisponible */
}

function markNotified(key) {
  notifiedEvents.set(key, Date.now());
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(Object.fromEntries(notifiedEvents)));
  } catch {
    /* rien */
  }
}

// Secondes restantes à partir de l'horloge affichée (« 4:32 » ou « 48.2 »).
function clockSeconds(clock) {
  if (!clock) return null;
  if (clock.includes(":")) {
    const [m, s] = clock.split(":");
    return Number(m) * 60 + Number(s);
  }
  const v = Number(clock);
  return Number.isFinite(v) ? v : null;
}

// Définition officielle de la NBA : 5 dernières minutes du 4e quart-temps
// (ou d'une prolongation) avec 5 points d'écart ou moins.
export function isClutch(game) {
  if (game.status !== 2 || (game.period || 0) < 4) return false;
  const h = game.home?.score;
  const a = game.away?.score;
  if (h === null || h === undefined || a === null || a === undefined) return false;
  const left = clockSeconds(game.clock);
  if (left === null || left > 300) return false;
  return Math.abs(h - a) <= 5;
}

// Notifications système : réservées par les navigateurs aux connexions sécurisées
// (HTTPS ou localhost). Depuis un téléphone en http://192.168.x.x, seules les alertes
// affichées dans la page fonctionnent.
export function systemNotificationsPossible() {
  return window.isSecureContext && "Notification" in window;
}

let toastContainer = null;
function getToastContainer() {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = h("div", { class: "toast-container", id: "toast-container", "aria-live": "polite" });
    document.body.append(toastContainer);
  }
  return toastContainer;
}

export function showToast({ icon = "basketball", title, body, gameId }) {
  const container = getToastContainer();

  const closeBtn = h("button", { class: "toast-close", type: "button", "aria-label": "Fermer l'alerte" }, "✕");
  const card = h(
    "div",
    { class: "toast-card", role: "alert" },
    h("span", { class: "toast-icon", "aria-hidden": "true" }, resolveIcon(icon)),
    h(
      "div",
      { class: "toast-body" },
      h("strong", { class: "toast-title" }, title),
      body ? h("p", { class: "toast-desc" }, body) : null
    ),
    closeBtn
  );

  const dismiss = () => {
    card.classList.add("toast-leaving");
    setTimeout(() => card.remove(), 250);
  };

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dismiss();
  });

  if (gameId) {
    card.style.cursor = "pointer";
    card.addEventListener("click", () => {
      location.hash = `#/match/${gameId}`;
      dismiss();
    });
  }

  container.append(card);
  setTimeout(dismiss, 6500);
}

export async function sendNotification({ icon = "basketball", title, body, gameId }) {
  // 1. Toujours afficher le toast dans l'application
  showToast({ icon, title, body, gameId });

  // 2. Si le navigateur autorise les notifications et que l'utilisateur les a activées
  if (!currentSettings.enabled || !systemNotificationsPossible() || Notification.permission !== "granted") {
    return;
  }

  const url = gameId ? `#/match/${gameId}` : "./";

  try {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification(title, {
        body,
        icon: "img/icon-192.png",
        badge: "img/icon-192.png",
        data: { url },
      });
      return;
    }
  } catch {
    /* repli notification classique */
  }

  try {
    const notif = new Notification(title, {
      body,
      icon: "img/icon-192.png",
    });
    notif.onclick = () => {
      window.focus();
      if (gameId) location.hash = url;
    };
  } catch {
    /* notification système non délivrée */
  }
}

export function checkScoreboard(games) {
  // L'interrupteur « Activer les alertes » coupe tout, y compris les alertes dans la page.
  if (!currentSettings.enabled || !games || !games.length) return;
  const favs = favorites();
  const hide = isSpoilerFree();

  for (const g of games) {
    const gid = g.id;
    if (!gid) continue;

    const isFav = favs.has(g.home?.id) || favs.has(g.away?.id);
    const prev = seenGameStates.get(gid);
    const status = g.status;
    const hScore = g.home?.score ?? null;
    const aScore = g.away?.score ?? null;
    const matchup = `${g.away?.tri || "EXT"} – ${g.home?.tri || "DOM"}`;
    const scoreLine = `${g.away?.tri} ${aScore} - ${hScore} ${g.home?.tri}`;

    seenGameStates.set(gid, { status });
    if (!prev) continue; // premier passage : on mémorise l'état sans notifier en masse

    // 1. Coup d'envoi d'une équipe favorite
    const startKey = `start:${gid}`;
    if (currentSettings.onStart && isFav && prev.status === 1 && status === 2 && !notifiedEvents.has(startKey)) {
      markNotified(startKey);
      sendNotification({
        icon: "basketball",
        title: `Coup d'envoi : ${matchup}`,
        body: `Le match entre les ${g.away?.name || "visiteurs"} et les ${g.home?.name || "locaux"} vient de commencer.`,
        gameId: gid,
      });
    }

    // 2. Clutch time (5 dernières minutes, 5 points d'écart ou moins)
    const clutchKey = `clutch:${gid}`;
    if (currentSettings.onClutch && (!currentSettings.clutchOnlyFavs || isFav) && isClutch(g) && !notifiedEvents.has(clutchKey)) {
      markNotified(clutchKey);
      const diff = Math.abs(hScore - aScore);
      const when = g.statusText ? ` (${g.statusText})` : "";
      sendNotification({
        icon: "lightning",
        title: hide ? `Fin de match serrée : ${matchup}` : `Fin de match serrée : ${scoreLine}`,
        body: hide
          ? `Les 5 dernières minutes se jouent avec 5 points d'écart ou moins${when}.`
          : diff === 0
          ? `Égalité${when}. Suis la fin du match en direct.`
          : `${diff} point${diff > 1 ? "s" : ""} d'écart${when}. Suis la fin du match en direct.`,
        gameId: gid,
      });
    }

    // 3. Résultat final d'une équipe favorite
    const endKey = `end:${gid}`;
    if (currentSettings.onEnd && isFav && prev.status === 2 && status === 3 && !notifiedEvents.has(endKey)) {
      markNotified(endKey);
      const homeWon = (hScore || 0) > (aScore || 0);
      const winTeam = homeWon ? g.home : g.away;
      const loseTeam = homeWon ? g.away : g.home;
      sendNotification({
        icon: "flag",
        title: hide ? `Match terminé : ${matchup}` : `Fin du match : ${scoreLine}`,
        body: hide
          ? "Le résultat est masqué (mode anti-spoiler). Ouvre le match pour le découvrir."
          : `Victoire des ${winTeam?.name || "vainqueurs"} face aux ${loseTeam?.name || "vaincus"}.`,
        gameId: gid,
      });
    }
  }
}

// Vérification autonome en arrière-plan (toutes les 45 secondes si activé)
let bgInterval = null;
function startBackgroundCheck() {
  if (bgInterval) return;
  bgInterval = setInterval(async () => {
    if (!currentSettings.enabled) return;
    try {
      const res = await api("/scoreboard");
      if (res?.data?.games) checkScoreboard(res.data.games);
    } catch {
      /* vérification silencieuse */
    }
  }, 45000);
}

export function initNotificationsUI() {
  const btn = document.getElementById("notif-toggle");
  if (!btn) return;

  const BELL_OFF =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
  const BELL_ON =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="none"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  const syncBtn = () => {
    const on = currentSettings.enabled;
    btn.innerHTML = on ? BELL_ON : BELL_OFF;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("title", on ? "Notifications activées" : "Configurer les alertes de match");
    btn.setAttribute("aria-label", on ? "Notifications activées" : "Activer les notifications");
  };

  // Panneau popover de configuration
  let panel = null;
  const closePanel = () => {
    if (panel) {
      panel.remove();
      panel = null;
    }
  };

  const openPanel = () => {
    if (panel) {
      closePanel();
      return;
    }

    const perm = !window.isSecureContext ? "insecure" : "Notification" in window ? Notification.permission : "unsupported";

    const chkEnabled = h("input", { type: "checkbox", checked: currentSettings.enabled || null });
    const chkStart = h("input", { type: "checkbox", checked: currentSettings.onStart || null });
    const chkClutch = h("input", { type: "checkbox", checked: currentSettings.onClutch || null });
    const chkEnd = h("input", { type: "checkbox", checked: currentSettings.onEnd || null });
    const chkClutchFavs = h("input", { type: "checkbox", checked: currentSettings.clutchOnlyFavs || null });

    const insecureNotice =
      perm === "insecure"
        ? h(
            "div",
            { class: "note note-warning notif-insecure" },
            h("p", { style: { margin: "0 0 6px", display: "flex", alignItems: "center", gap: "6px" } }, iconAlertCircle(15), "Connexion non sécurisée : les notifications du téléphone sont bloquées."),
            h(
              "p",
              { style: { margin: 0 } },
              "Les alertes s'afficheront dans la page. Pour les recevoir aussi en notification (et installer l'application), ouvre ",
              h("code", null, "chrome://flags/#unsafely-treat-insecure-origin-as-secure"),
              " dans Chrome, ajoute ",
              h("code", null, location.origin),
              ", active l'option puis relance Chrome."
            )
          )
        : null;

    const permNotice =
      perm === "denied"
        ? h("p", { class: "note note-warning", style: { color: "var(--loss)", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" } }, iconAlertCircle(15), "Les notifications sont bloquées dans les paramètres de votre navigateur.")
        : perm === "default"
        ? h("p", { class: "note note-info", style: { margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" } }, iconInfo(15), "Autorisez les notifications du navigateur lors de l'activation.")
        : null;

    const testBtn = h(
      "button",
      { class: "btn btn-sm", type: "button", style: { width: "100%", marginTop: "10px" } },
      "Envoyer une notification test"
    );

    testBtn.addEventListener("click", () => {
      sendNotification({
        icon: "basketball",
        title: "Alerte de test Parquet",
        body: "Les alertes fonctionnent. Tu recevras les coups d'envoi, les fins de match serrées et les résultats.",
      });
    });

    chkEnabled.addEventListener("change", async () => {
      if (chkEnabled.checked && systemNotificationsPossible() && Notification.permission === "default") {
        const p = await Notification.requestPermission();
        if (p !== "granted") {
          chkEnabled.checked = false;
          currentSettings.enabled = false;
          saveSettings();
          syncBtn();
          return;
        }
      }
      currentSettings.enabled = chkEnabled.checked;
      saveSettings();
      syncBtn();
      if (currentSettings.enabled) startBackgroundCheck();
    });

    chkStart.addEventListener("change", () => {
      currentSettings.onStart = chkStart.checked;
      saveSettings();
    });
    chkClutch.addEventListener("change", () => {
      currentSettings.onClutch = chkClutch.checked;
      saveSettings();
    });
    chkEnd.addEventListener("change", () => {
      currentSettings.onEnd = chkEnd.checked;
      saveSettings();
    });
    chkClutchFavs.addEventListener("change", () => {
      currentSettings.clutchOnlyFavs = chkClutchFavs.checked;
      saveSettings();
    });

    panel = h(
      "div",
      { class: "notif-panel", role: "dialog", "aria-label": "Réglages des alertes" },
      h("div", { class: "notif-panel-head" }, h("strong", null, "Alertes & Notifications"), h("button", { class: "toast-close", type: "button", "aria-label": "Fermer" }, "✕")),
      insecureNotice || permNotice || "",
      h(
        "label",
        { class: "notif-opt main-opt" },
        chkEnabled,
        h("span", null, h("strong", null, "Activer les alertes"), h("small", null, "Tant qu'un onglet Parquet reste ouvert"))
      ),
      h("hr", { class: "notif-sep" }),
      h("label", { class: "notif-opt" }, chkStart, h("span", null, "Coup d'envoi des équipes favorites")),
      h("label", { class: "notif-opt" }, chkClutch, h("span", null, "Fin de match serrée (5 dernières minutes, 5 pts d'écart ou moins)")),
      h("label", { class: "notif-opt" }, chkClutchFavs, h("span", null, "Fins de match serrées : uniquement mes favoris")),
      h("label", { class: "notif-opt" }, chkEnd, h("span", null, "Résultat final des équipes favorites")),
      h("p", { class: "note", style: { margin: "8px 0 0", fontSize: "11px" } }, "Conseil : marque tes équipes préférées sur leur page pour recevoir leurs alertes."),
      testBtn
    );

    panel.querySelector(".toast-close").addEventListener("click", closePanel);
    document.body.append(panel);

    // Positionner sous le bouton
    const r = btn.getBoundingClientRect();
    panel.style.top = `${r.bottom + 8}px`;
    panel.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;

    const onOutside = (e) => {
      if (panel && !panel.contains(e.target) && !btn.contains(e.target)) {
        closePanel();
        document.removeEventListener("pointerdown", onOutside);
      }
    };
    setTimeout(() => document.addEventListener("pointerdown", onOutside), 10);
  };

  btn.addEventListener("click", openPanel);
  syncBtn();

  if (currentSettings.enabled) {
    startBackgroundCheck();
  }
}
