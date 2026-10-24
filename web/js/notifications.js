// Gestionnaire des alertes et notifications pour Parquet.
// Notifications natives du navigateur + toasts intégrés à l'application.

import { api } from "./api.js";
import { favorites } from "./components.js";
import { h } from "./dom.js";

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

// Suivi des états de match pour éviter les notifications en double
const seenGameStates = new Map();
const notifiedEvents = new Set();

let toastContainer = null;
function getToastContainer() {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = h("div", { class: "toast-container", id: "toast-container", "aria-live": "polite" });
    document.body.append(toastContainer);
  }
  return toastContainer;
}

export function showToast({ icon = "🏀", title, body, gameId }) {
  const container = getToastContainer();

  const closeBtn = h("button", { class: "toast-close", type: "button", "aria-label": "Fermer l'alerte" }, "✕");
  const card = h(
    "div",
    { class: "toast-card", role: "alert" },
    h("span", { class: "toast-icon", "aria-hidden": "true" }, icon),
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

export async function sendNotification({ icon = "🏀", title, body, gameId }) {
  // 1. Toujours afficher le toast dans l'application
  showToast({ icon, title, body, gameId });

  // 2. Si le navigateur autorise les notifications et que l'utilisateur les a activées
  if (!currentSettings.enabled || !("Notification" in window) || Notification.permission !== "granted") {
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
  if (!games || !games.length) return;
  const favs = favorites();

  for (const g of games) {
    const gid = g.id;
    if (!gid) continue;

    const isFav = favs.has(g.home?.id) || favs.has(g.away?.id);
    const prev = seenGameStates.get(gid);
    const status = g.status;
    const period = g.period || 0;
    const hScore = g.home?.score ?? null;
    const aScore = g.away?.score ?? null;

    // Mise en mémoire de l'état
    seenGameStates.set(gid, { status, period, hScore, aScore });
    if (!prev) continue; // Premier passage : on initialise les états sans notifier en masse

    // 1. Alerte coup d'envoi pour équipes favorites
    if (currentSettings.onStart && isFav) {
      const startKey = `start:${gid}`;
      if (prev.status === 1 && status === 2 && !notifiedEvents.has(startKey)) {
        notifiedEvents.add(startKey);
        sendNotification({
          icon: "🏀",
          title: `Coup d'envoi : ${g.away?.tri || "EXT"} @ ${g.home?.tri || "DOM"}`,
          body: `Le match vient de débuter entre les ${g.away?.name || "visiteurs"} et les ${g.home?.name || "locaux"}.`,
          gameId: gid,
        });
      }
    }

    // 2. Alerte Clutch Time (écart ≤ 5 points au 4e quart-temps ou prolongations)
    if (currentSettings.onClutch && status === 2 && period >= 4 && hScore !== null && aScore !== null) {
      const clutchKey = `clutch:${gid}`;
      const diff = Math.abs(hScore - aScore);
      const shouldAlert = (!currentSettings.clutchOnlyFavs || isFav) && diff <= 5;

      if (shouldAlert && !notifiedEvents.has(clutchKey)) {
        notifiedEvents.add(clutchKey);
        const leader = hScore > aScore ? g.home?.tri : aScore > hScore ? g.away?.tri : null;
        const scoreLine = `${g.away?.tri} ${aScore} - ${hScore} ${g.home?.tri}`;
        const clockText = g.statusText ? ` (${g.statusText})` : "";
        sendNotification({
          icon: "⚡",
          title: `Fin de match serrée : ${scoreLine}`,
          body: leader
            ? `Écart de ${diff} pt(s)${clockText}. Suis la fin du match en direct !`
            : `Égalité parfaite${clockText} ! Suis la fin du match en direct !`,
          gameId: gid,
        });
      }
    }

    // 3. Alerte résultat final pour équipes favorites
    if (currentSettings.onEnd && isFav) {
      const endKey = `end:${gid}`;
      if (prev.status === 2 && status === 3 && !notifiedEvents.has(endKey)) {
        notifiedEvents.add(endKey);
        const homeWon = (hScore || 0) > (aScore || 0);
        const winTeam = homeWon ? g.home : g.away;
        const loseTeam = homeWon ? g.away : g.home;
        sendNotification({
          icon: "🏁",
          title: `Fin du match : ${g.away?.tri} ${aScore} - ${hScore} ${g.home?.tri}`,
          body: `Victoire des ${winTeam?.name || "vainqueurs"} face aux ${loseTeam?.name || "vaincus"}.`,
          gameId: gid,
        });
      }
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

    const perm = "Notification" in window ? Notification.permission : "unsupported";

    const chkEnabled = h("input", { type: "checkbox", checked: currentSettings.enabled || null });
    const chkStart = h("input", { type: "checkbox", checked: currentSettings.onStart || null });
    const chkClutch = h("input", { type: "checkbox", checked: currentSettings.onClutch || null });
    const chkEnd = h("input", { type: "checkbox", checked: currentSettings.onEnd || null });
    const chkClutchFavs = h("input", { type: "checkbox", checked: currentSettings.clutchOnlyFavs || null });

    const permNotice =
      perm === "denied"
        ? h("p", { class: "note", style: { color: "var(--loss)", margin: "0 0 10px" } }, "⚠️ Les notifications sont bloquées dans les paramètres de votre navigateur.")
        : perm === "default"
        ? h("p", { class: "note", style: { margin: "0 0 10px" } }, "💡 Autorisez les notifications du navigateur lors de l'activation.")
        : null;

    const testBtn = h(
      "button",
      { class: "btn btn-sm", type: "button", style: { width: "100%", marginTop: "10px" } },
      "Envoyer une notification test"
    );

    testBtn.addEventListener("click", () => {
      sendNotification({
        icon: "🏀",
        title: "Alerte NBA Parquet",
        body: "Les alertes fonctionnent ! Tu recevras les coups d'envoi et les fins de match serrées.",
      });
    });

    chkEnabled.addEventListener("change", async () => {
      if (chkEnabled.checked && "Notification" in window && Notification.permission === "default") {
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
      permNotice || "",
      h(
        "label",
        { class: "notif-opt main-opt" },
        chkEnabled,
        h("span", null, h("strong", null, "Activer les alertes"), h("small", null, "Notifications navigateur et alertes en direct"))
      ),
      h("hr", { class: "notif-sep" }),
      h("label", { class: "notif-opt" }, chkStart, h("span", null, "Coup d'envoi des équipes favorites")),
      h("label", { class: "notif-opt" }, chkClutch, h("span", null, "Fin de match serrée (Clutch Time ≤ 5 pts)")),
      h("label", { class: "notif-opt" }, chkClutchFavs, h("span", null, "Clutch Time : uniquement mes favoris")),
      h("label", { class: "notif-opt" }, chkEnd, h("span", null, "Résultat final des équipes favorites")),
      h("p", { class: "note", style: { margin: "8px 0 0", fontSize: "11px" } }, "Conseil : marque tes équipes préférées avec l'étoile ★ sur leur page."),
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
