// État des sources de données : utile quand quelque chose ne s'affiche pas.

import { api } from "../api.js";
import { h } from "../dom.js";
import * as f from "../format.js";
import { errorState, loading } from "../components.js";

export async function render(ctx) {
  const box = h("div");
  ctx.outlet.append(
    h(
      "div",
      { class: "page-head" },
      h("div", null, h("h1", { class: "page-title" }, "État des sources"), h("p", { class: "page-sub" }, "Parquet interroge NBA.com et Wikipédia depuis ton ordinateur. Ce test vérifie que chaque source répond."))
    ),
    box
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
