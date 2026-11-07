// État des sources de données : utile quand quelque chose ne s'affiche pas.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { errorState, loading } from "../components.js";
import { poster } from "../poster.js";

async function saveYoutubeKey(key) {
  const res = await fetch("/api/settings/youtube", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ key }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Erreur ${res.status}`);
  return body.data.youtube;
}

function youtubeSettings(ctx) {
  const box = h("section", { class: "settings-card", id: "youtube" });
  const draw = (state, message = "", ok = false) => {
    const input = h("input", { class: "input", type: "password", autocomplete: "off", spellcheck: "false", placeholder: "AIza…", "aria-label": "Clé de l'API YouTube" });
    const msg = h("p", { class: `form-msg${ok ? " ok" : ""}`, role: "status" }, message);
    const save = h("button", { class: "btn primary", type: "submit" }, "Enregistrer");
    const form = h("form", { class: "key-form" }, input, save);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      save.disabled = true;
      msg.textContent = "Vérification de la clé auprès de YouTube…";
      try {
        draw(await saveYoutubeKey(input.value.trim()), "Clé enregistrée : les résumés vidéo de tous les matchs sont maintenant retrouvés automatiquement.", true);
      } catch (err) {
        save.disabled = false;
        msg.className = "form-msg";
        msg.textContent = err.message;
      }
    });
    const remove = state.configured && state.source === "file" ? h("button", { class: "btn", type: "button" }, "Supprimer la clé") : null;
    remove?.addEventListener("click", async () => {
      try {
        draw(await saveYoutubeKey(""), "Clé supprimée.", true);
      } catch (err) {
        msg.textContent = err.message;
      }
    });
    box.replaceChildren(
      h("h2", { class: "section-title" }, "Résumés vidéo YouTube"),
      h(
        "p",
        null,
        "Parquet trouve tout seul le résumé officiel des matchs récents sur la chaîne YouTube de la NBA. Pour retrouver celui de n'importe quel match, même ancien, il lui faut une clé gratuite de l'API YouTube. Elle reste sur ton appareil, dans le dossier ",
        h("code", null, "data"),
        "."
      ),
      h(
        "p",
        { class: "key-state" },
        state.configured ? h("span", { class: "ok" }, "✓") : h("span", { class: "ko" }, "–"),
        state.configured
          ? state.source === "env"
            ? ` Clé fournie par la variable d'environnement PARQUET_YOUTUBE_KEY (${state.hint}).`
            : ` Clé enregistrée (${state.hint}).`
          : " Aucune clé : seules les vidéos des dernières heures sont trouvées."
      ),
      state.source === "env" ? null : h("div", { class: "key-row" }, form, remove),
      msg,
      h(
        "details",
        { class: "how" },
        h("summary", null, "Comment obtenir une clé (5 minutes, gratuit)"),
        h(
          "ol",
          null,
          h("li", null, "Ouvre la ", h("a", { class: "link", href: "https://console.cloud.google.com/projectcreate", target: "_blank", rel: "noopener" }, "console Google Cloud"), " avec ton compte Google et crée un projet (par exemple « Parquet »)."),
          h("li", null, "Active l'API ", h("a", { class: "link", href: "https://console.cloud.google.com/apis/library/youtube.googleapis.com", target: "_blank", rel: "noopener" }, "YouTube Data API v3"), " pour ce projet."),
          h("li", null, "Dans ", h("a", { class: "link", href: "https://console.cloud.google.com/apis/credentials", target: "_blank", rel: "noopener" }, "Identifiants"), ", choisis « Créer des identifiants », puis « Clé API », et copie la clé."),
          h("li", null, "Conseillé : modifie la clé et limite-la à « YouTube Data API v3 »."),
          h("li", null, "Colle la clé ci-dessus et enregistre. Parquet vérifie qu'elle fonctionne.")
        ),
        h("p", { class: "note" }, "Le quota gratuit permet une centaine de recherches par jour, largement assez : chaque vidéo trouvée est gardée en mémoire. Aucune carte bancaire n'est nécessaire.")
      )
    );
  };
  api("/settings", { signal: ctx.signal })
    .then(({ data }) => draw(data.youtube))
    .catch(() => box.remove());
  return box;
}

// ------------------------------------------------------------ vérification complète

const LEVEL = { ok: ["✓", "ok", "fonctionne"], warn: ["!", "warn", "format inattendu"], error: ["✕", "ko", "ne répond pas"] };

function copyText(text, button) {
  const done = (ok) => {
    button.textContent = ok ? "Rapport copié" : "Copie impossible";
    setTimeout(() => (button.textContent = "Copier le rapport"), 2500);
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    return;
  }
  const area = h("textarea", { style: { position: "fixed", opacity: "0" } }, text);
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  done(ok);
}

function reportText(data) {
  const lines = [`Parquet ${document.documentElement.dataset.version || ""} : vérification des sources (saison ${data.season}${data.demo ? ", mode démo" : ""})`];
  for (const c of data.checks) lines.push(`${LEVEL[c.level][0]} ${c.label} : ${c.message} (${c.ms} ms)`);
  lines.push(`${data.ok}/${data.total} sources normales. Navigateur : ${navigator.userAgent}`);
  return lines.join("\n");
}

function deepCheck(ctx) {
  const box = h("section", { class: "settings-card verify-card", id: "verification" });
  const start = h("button", { class: "btn primary", type: "button" }, "Lancer la vérification complète");
  const out = h("div", { class: "verify-out" });
  start.addEventListener("click", async () => {
    start.disabled = true;
    out.replaceChildren(loading("Vérification de chaque source… (une minute environ)"));
    let data;
    try {
      data = (await api("/verify", { signal: ctx.signal })).data;
    } catch (err) {
      start.disabled = false;
      if (err.name === "AbortError") return;
      out.replaceChildren(errorState(err));
      return;
    }
    start.disabled = false;
    start.textContent = "Relancer la vérification";
    const copy = h("button", { class: "btn", type: "button" }, "Copier le rapport");
    copy.addEventListener("click", () => copyText(reportText(data), copy));
    const bad = data.checks.filter((c) => c.level !== "ok");
    out.replaceChildren(
      h("p", { class: `verify-sum${bad.length ? " is-bad" : ""}` }, h("b", { class: "num" }, `${data.ok}/${data.total}`), bad.length ? " sources fonctionnent normalement." : " : tout fonctionne."),
      h(
        "div",
        { class: "verify-list" },
        data.checks.map((c) =>
          h(
            "div",
            { class: `verify-row is-${c.level}` },
            h("span", { class: `verify-icon ${LEVEL[c.level][1]}`, "aria-label": LEVEL[c.level][2] }, LEVEL[c.level][0]),
            h("div", null, h("b", null, c.label), h("small", null, c.pages), h("span", { class: "verify-msg" }, c.message)),
            h("span", { class: "note num" }, `${f.int(c.ms)} ms`)
          )
        )
      ),
      bad.length
        ? h("p", { class: "note" }, "« Format inattendu » : NBA.com répond, mais la réponse a changé de forme ; la page concernée peut rester vide. Copie le rapport et envoie-le pour qu'on corrige Parquet.")
        : null,
      h("div", { class: "qz-row" }, copy)
    );
  });
  box.append(
    h("h2", { class: "section-title" }, "Vérification complète"),
    h("p", null, "Interroge chaque source utilisée par une page de Parquet, sans passer par le cache, et vérifie que la réponse a bien la forme attendue. Utile quand une page reste vide après une mise à jour."),
    h("div", { class: "qz-row" }, start),
    out
  );
  return box;
}

// ------------------------------------------------------------ ce navigateur

function browserName() {
  const ua = navigator.userAgent;
  const m = /Firefox\/(\d+)/.exec(ua) || /Edg\/(\d+)/.exec(ua) || /Chrome\/(\d+)/.exec(ua) || /Version\/(\d+).*Safari/.exec(ua);
  const name = /Firefox/.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Navigateur";
  return m ? `${name} ${m[1]}` : name;
}

export function browserChecks() {
  const css = (q) => {
    try {
      return CSS.supports(q);
    } catch {
      return false;
    }
  };
  return [
    { label: "Mélange de couleurs (color-mix)", ok: css("color: color-mix(in oklab, red, blue)"), off: "couleurs d'équipe moins nuancées" },
    { label: "Hauteur d'écran mobile (svh)", ok: css("height: 100svh"), off: "pages plein écran un peu trop hautes sur téléphone" },
    { label: "Proportions des images (aspect-ratio)", ok: css("aspect-ratio: 1"), off: "photos mal cadrées" },
    { label: "Transitions de couleur d'équipe (@property)", ok: typeof CSS !== "undefined" && "registerProperty" in CSS, off: "les couleurs changent sans fondu" },
    { label: "Apparition au défilement", ok: css("animation-timeline: view()"), off: "les sections s'affichent directement, sans effet (normal sur Firefox et Safari)", optional: true },
    { label: "Copie dans le presse-papiers", ok: !!(navigator.clipboard && window.isSecureContext), off: "le partage du jeu passe par une méthode plus ancienne", optional: true },
    { label: "Notifications du système", ok: "Notification" in window && window.isSecureContext, off: "alertes affichées seulement dans la page", optional: true },
    { label: "Fonctionnement hors ligne", ok: "serviceWorker" in navigator && window.isSecureContext, off: "pas d'ouverture sans connexion", optional: true },
  ];
}

function browserCard() {
  const checks = browserChecks();
  const missing = checks.filter((c) => !c.ok && !c.optional);
  return h(
    "section",
    { class: "settings-card", id: "navigateur" },
    h("h2", { class: "section-title" }, `Ce navigateur : ${browserName()}`),
    h("p", null, missing.length ? "Quelques fonctions manquent : Parquet marche, avec un rendu un peu simplifié. Mettre le navigateur à jour suffit en général." : "Tout ce dont Parquet a besoin est pris en charge."),
    h(
      "div",
      { class: "verify-list" },
      checks.map((c) =>
        h(
          "div",
          { class: `verify-row is-${c.ok ? "ok" : c.optional ? "info" : "warn"}` },
          h("span", { class: `verify-icon ${c.ok ? "ok" : "warn"}` }, c.ok ? "✓" : "–"),
          h("div", null, h("b", null, c.label), c.ok ? null : h("span", { class: "verify-msg" }, c.off))
        )
      )
    )
  );
}

// Mises à jour automatiques du serveur (run.py --auto-maj) : version, dernière vérification, journal.
function ago(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min)) return "";
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} jours`;
}

const DEPLOY_KIND = {
  deployed: ["ok", "✓"],
  rollback: ["warn", "↺"],
  "ci-failed": ["warn", "✕"],
  blocked: ["warn", "!"],
  crash: ["warn", "!"],
  error: ["warn", "!"],
};

function deployCard(ctx) {
  const box = h("section", { class: "settings-card", id: "mises-a-jour" });
  box.append(h("h2", { class: "section-title" }, "Mises à jour automatiques"), loading("Lecture…"));
  api("/deploiement", { signal: ctx.signal })
    .then(({ data }) => {
      const events = data.events || [];
      const lines = data.active
        ? [
            h("p", null, `Activées : Parquet vérifie toutes les ${data.interval || 10} minutes s'il existe une nouvelle version, l'installe seulement si les tests GitHub sont tous passés, puis contrôle qu'elle démarre (sinon, retour automatique à la version précédente).`),
            h(
              "p",
              { class: "note" },
              `Version installée : ${data.version}${data.commit ? ` (${data.commit})` : ""}.`,
              data.checkedAt ? ` Dernière vérification ${ago(data.checkedAt)} : ${data.message || ""}` : " Première vérification une minute après le démarrage."
            ),
          ]
        : [h("p", null, "Désactivées sur ce serveur. Elles s'activent quand Parquet est lancé en serveur permanent : « parquet serveur » sur un téléphone, ou le service installé sur un Raspberry Pi.")];
      box.replaceChildren(
        ...[
        h("h2", { class: "section-title" }, "Mises à jour automatiques"),
        ...lines,
        events.length
          ? h(
              "div",
              { class: "verify-list" },
              events.slice(0, 6).map((e) => {
                const [level, icon] = DEPLOY_KIND[e.kind] || ["info", "·"];
                return h(
                  "div",
                  { class: `verify-row is-${level}` },
                  h("span", { class: `verify-icon ${level === "ok" ? "ok" : "warn"}` }, icon),
                  h("div", null, h("b", null, e.message), h("span", { class: "verify-msg" }, ago(e.at)))
                );
              })
            )
          : null
      ].filter(Boolean));
    })
    .catch((err) => {
      if (err.name !== "AbortError") box.replaceChildren(h("h2", { class: "section-title" }, "Mises à jour automatiques"), h("p", { class: "note" }, "Information indisponible."));
    });
  return box;
}

export async function render(ctx) {
  const box = h("div");
  ctx.outlet.append(
    poster(ctx, { kicker: "Diagnostic", lines: ["État des", "sources"], size: "slim" }).el,
    box,
    deepCheck(ctx),
    deployCard(ctx),
    browserCard(),
    youtubeSettings(ctx)
  );

  const run = async () => {
    box.replaceChildren(loading("Test en cours…"));
    let data;
    try {
      data = (await api("/diagnostic", { signal: ctx.signal })).data;
    } catch (err) {
      if (err.name === "AbortError") return;
      box.replaceChildren(errorState(err, run));
      return;
    }
    const failed = data.checks.filter((c) => !c.ok);
    box.replaceChildren(
      h(
        "div",
        { class: "checks" },
        data.checks.map((c) =>
          h(
            "div",
            { class: "check" },
            h("span", { class: c.ok ? "ok" : "ko", "aria-label": c.ok ? "fonctionne" : "en échec" }, c.ok ? "✓" : "✕"),
            h("div", null, h("div", { style: { fontWeight: 650 } }, c.label), c.ok ? null : h("div", { class: "msg" }, c.message)),
            h("span", { class: "note num" }, `${f.int(c.ms)} ms`)
          )
        )
      ),
      failed.length
        ? h(
            "div",
            { class: "banner warn", style: { marginTop: "18px", maxWidth: "760px" } },
            h(
              "div",
              null,
              h("p", { style: { margin: "0 0 6px" } }, "Une source ne répond pas. Pistes, dans l'ordre :"),
              h(
                "ul",
                { style: { margin: 0, paddingLeft: "18px" } },
                h("li", null, "vérifie que ton ordinateur est connecté à Internet ;"),
                h("li", null, "désactive un éventuel VPN, proxy ou bloqueur de publicité réseau (NBA.com bloque certains réseaux) ;"),
                h("li", null, "attends quelques minutes : NBA.com limite parfois les requêtes trop rapprochées.")
              )
            )
          )
        : h("p", { class: "note", style: { marginTop: "16px" } }, "Toutes les sources répondent."),
      h(
        "p",
        { class: "note", style: { marginTop: "18px" } },
        `Saison en cours : ${data.season}. Journée NBA : ${f.dayTitle(data.gameDay)}. Cache local : ${f.int(data.cache.entries)} éléments (${f.num(data.cache.bytes / 1e6, 1)} Mo).`
      ),
      h("button", { class: "btn", type: "button", onclick: run, style: { marginTop: "6px" } }, "Relancer le test")
    );
  };
  run();
}
