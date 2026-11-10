// Choix de la date des matchs : une bande des 7 jours autour de la date affichée et un calendrier
// du mois, avec pour chaque jour le nombre de matchs et un point orange quand une équipe favorite
// joue. Remplace le champ de date du navigateur (peu lisible, surtout sur téléphone).

import { api, once } from "./api.js";
import { h } from "./dom.js";
import { favorites } from "./components.js";

const DAY_MS = 86400000;
const toDate = (iso) => new Date(`${iso}T12:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => toIso(new Date(toDate(iso).getTime() + n * DAY_MS));
const FMT = {
  month: new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }),
  wd: new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "UTC" }),
  long: new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
};
const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

export function loadCalendar() {
  return once("calendar", () => api("/calendar").then(({ data }) => data));
}

const hrefFor = (iso, today) => (iso === today ? "#/" : `#/matchs/${iso}`);

function dayInfo(cal, iso, favs) {
  const games = cal?.days?.[iso] || [];
  return { n: games.length, fav: games.some(([a, b]) => favs.has(a) || favs.has(b)) };
}

function countLabel(n) {
  return n ? `${n} match${n > 1 ? "s" : ""}` : "aucun match";
}

// Bande des 7 jours (3 avant, 3 après la date affichée).
function strip(date, today, cal, favs) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(date, i - 3));
  return h(
    "nav",
    { class: "day-strip", "aria-label": "Jours proches" },
    days.map((iso) => {
      const { n, fav } = dayInfo(cal, iso, favs);
      const d = toDate(iso);
      return h(
        "a",
        {
          class: ["ds-day", iso === date ? "is-current" : "", iso === today ? "is-today" : "", cal && !n ? "is-empty" : ""].filter(Boolean).join(" "),
          href: hrefFor(iso, today),
          "aria-current": iso === date ? "date" : null,
          "aria-label": `${FMT.long.format(d)}${cal ? `, ${countLabel(n)}` : ""}${fav ? ", une de tes équipes joue" : ""}`,
        },
        h("small", null, FMT.wd.format(d).replace(".", "")),
        h("b", { class: "num" }, String(d.getUTCDate())),
        h("span", { class: "ds-n" }, cal ? (n ? String(n) : "–") : "", fav ? h("i", { class: "ds-fav" }) : null)
      );
    })
  );
}

// Grille d'un mois, semaines du lundi au dimanche.
function monthGrid(month, date, today, cal, favs, onPick) {
  const first = toDate(`${month}-01`);
  const offset = (first.getUTCDay() + 6) % 7; // lundi = 0
  const start = toIso(new Date(first.getTime() - offset * DAY_MS));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  // On retire la dernière semaine si elle est entièrement dans le mois suivant.
  const weeks = cells.slice(35).every((iso) => !iso.startsWith(month)) ? cells.slice(0, 35) : cells;
  return h(
    "div",
    { class: "dp-grid", role: "grid" },
    WEEKDAYS.map((w) => h("span", { class: "dp-wd", "aria-hidden": "true" }, w)),
    weeks.map((iso) => {
      const { n, fav } = dayInfo(cal, iso, favs);
      const out = !iso.startsWith(month);
      const a = h(
        "a",
        {
          class: ["dp-day", out ? "is-out" : "", iso === date ? "is-current" : "", iso === today ? "is-today" : "", n ? "has-games" : ""].filter(Boolean).join(" "),
          href: hrefFor(iso, today),
          "aria-label": `${FMT.long.format(toDate(iso))}, ${countLabel(n)}${fav ? ", une de tes équipes joue" : ""}`,
        },
        h("b", { class: "num" }, String(toDate(iso).getUTCDate())),
        h("span", { class: "dp-n" }, n ? String(n) : ""),
        fav ? h("i", { class: "ds-fav" }) : null
      );
      a.addEventListener("click", () => onPick());
      return a;
    })
  );
}

// Renvoie { strip, button } : la bande et le bouton qui ouvre le calendrier du mois.
export function dayPicker({ date, today }) {
  const favs = favorites();
  const stripBox = h("div", { class: "day-strip-box" }, strip(date, today, null, favs));
  const button = h("button", { type: "button", class: "btn dp-btn", "aria-haspopup": "dialog", "aria-expanded": "false" }, "Calendrier");
  const pop = h("div", { class: "dp-pop", role: "dialog", "aria-label": "Choisir un jour", hidden: true });
  const wrap = h("div", { class: "dp-wrap" }, button, pop);
  let cal = null;
  let month = date.slice(0, 7);

  const close = () => {
    pop.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", onKey);
  };
  const outside = (e) => {
    if (!wrap.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      close();
      button.focus();
    }
  };
  const shift = (n) => {
    const d = toDate(`${month}-01`);
    d.setUTCMonth(d.getUTCMonth() + n);
    month = toIso(d).slice(0, 7);
    drawPop();
  };
  const drawPop = () => {
    const prev = h("button", { type: "button", class: "btn square", "aria-label": "Mois précédent" }, "‹");
    const next = h("button", { type: "button", class: "btn square", "aria-label": "Mois suivant" }, "›");
    prev.addEventListener("click", () => shift(-1));
    next.addEventListener("click", () => shift(1));
    const title = FMT.month.format(toDate(`${month}-01`));
    pop.replaceChildren(
      h("div", { class: "dp-head" }, prev, h("b", null, title.charAt(0).toUpperCase() + title.slice(1)), next),
      monthGrid(month, date, today, cal, favs, close),
      h(
        "div",
        { class: "dp-foot" },
        h("a", { class: "btn", href: "#/" }, "Aujourd'hui"),
        h("span", { class: "dp-legend" }, h("span", { class: "dp-n" }, "8"), " matchs", favs.size ? [h("i", { class: "ds-fav" }), " tes équipes"] : null)
      )
    );
  };
  button.addEventListener("click", () => {
    if (!pop.hidden) return close();
    month = date.slice(0, 7);
    drawPop();
    pop.hidden = false;
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", onKey);
    pop.querySelector(".dp-day.is-current, .dp-day.is-today")?.focus({ preventScroll: true });
  });

  loadCalendar()
    .then((data) => {
      cal = data;
      stripBox.replaceChildren(strip(date, today, cal, favs));
      if (!pop.hidden) drawPop();
    })
    .catch(() => {
      /* sans calendrier : la bande garde les jours, sans le nombre de matchs */
    });

  return { strip: stripBox, button: wrap };
}
