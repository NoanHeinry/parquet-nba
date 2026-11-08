// Onglets et sélecteurs qui défilent horizontalement (téléphone) : un fondu sur le bord signale
// qu'il reste des choix cachés. Les classes can-scroll-left / can-scroll-right sont tenues à jour
// quand la page change, quand la fenêtre change de taille et quand on fait défiler la barre.

const SELECTOR = ".tabs, .segmented";

function update(el) {
  const max = el.scrollWidth - el.clientWidth;
  el.classList.toggle("can-scroll-left", max > 2 && el.scrollLeft > 2);
  el.classList.toggle("can-scroll-right", max > 2 && el.scrollLeft < max - 2);
}

function updateAll() {
  for (const el of document.querySelectorAll(SELECTOR)) update(el);
}

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    updateAll();
  });
}

export function initScrollFade() {
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", schedule, { passive: true });
  document.addEventListener(
    "scroll",
    (e) => {
      if (e.target instanceof Element && e.target.matches(SELECTOR)) update(e.target);
    },
    { capture: true, passive: true }
  );
  document.fonts?.ready.then(schedule);
  schedule();
}
