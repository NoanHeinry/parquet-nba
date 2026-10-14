// Navigation par ancre (#/...) : chaque page reçoit un contexte qui s'arrête proprement
// quand on change de page (requêtes annulées, actualisations automatiques stoppées).

const routes = [];
let current = null;

export function route(pattern, handler, nav = null) {
  routes.push({ re: new RegExp(`^${pattern}$`), handler, nav });
}

function makeContext(outlet, params) {
  const controller = new AbortController();
  const cleanups = [];
  const timers = new Set();
  return {
    outlet,
    params,
    signal: controller.signal,
    get active() {
      return !controller.signal.aborted;
    },
    onCleanup(fn) {
      cleanups.push(fn);
    },
    // Rappel périodique suspendu quand l'onglet est caché.
    every(ms, fn) {
      let id = null;
      const tick = async () => {
        id = null;
        if (controller.signal.aborted) return;
        if (!document.hidden) {
          try {
            await fn();
          } catch {
            /* l'erreur est déjà affichée par la page */
          }
        }
        if (!controller.signal.aborted) id = setTimeout(tick, typeof ms === "function" ? ms() : ms);
      };
      id = setTimeout(tick, typeof ms === "function" ? ms() : ms);
      timers.add(() => id && clearTimeout(id));
    },
    destroy() {
      controller.abort();
      for (const stop of timers) stop();
      for (const fn of cleanups) {
        try {
          fn();
        } catch {
          /* rien */
        }
      }
    },
  };
}

async function render(outlet) {
  const path = location.hash.replace(/^#/, "") || "/";
  const match = routes.map((r) => ({ r, m: path.match(r.re) })).find((x) => x.m) || null;
  if (current) current.destroy();
  document.getElementById("tooltip").hidden = true;
  const params = match ? match.m.slice(1).map(decodeURIComponent) : [];
  current = makeContext(outlet, params);
  for (const a of document.querySelectorAll(".mainnav a")) {
    if (match && a.dataset.nav === match.r.nav) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  outlet.replaceChildren();
  window.scrollTo(0, 0);
  if (!match) {
    location.hash = "#/";
    return;
  }
  try {
    await match.r.handler(current);
  } catch (err) {
    if (err?.name !== "AbortError") console.error(err);
  }
}

export function start(outlet) {
  window.addEventListener("hashchange", () => render(outlet));
  render(outlet);
}
