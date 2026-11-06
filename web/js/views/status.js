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

export async function render(ctx) {
  const box = h("div");
  ctx.outlet.append(
    poster(ctx, { kicker: "Diagnostic", lines: ["État des", "sources"], size: "slim" }).el,
    box,
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
