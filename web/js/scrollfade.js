// Onglets et sélecteurs qui défilent horizontalement (téléphone) : un fondu sur le bord signale
// qu'il reste des choix cachés. Les classes can-scroll-left / can-scroll-right sont tenues à jour
// quand la page change, quand la fenêtre change de taille et quand on fait défiler la barre.

const SELECTOR = ".tabs, .segmented";

function update(el) {
  const max = el.scrollWidth - el.clientWidth;
  el.classList.toggle("can-scroll-left", max > 2 && el.scrollLeft > 2);
  el.classList.toggle("can-scroll-right", max > 2 && el.scrollLeft < max - 2);
}

// Chaque barre est suivie par un ResizeObserver : le navigateur prévient quand sa taille change,
// une fois la mise en page faite. Plus de relecture de toutes les barres à chaque modification de
// la page (ce qui forçait une remesure complète, très coûteuse sous Firefox).
const watched = new Set();
let ro = null;

function watch(node) {
  if (!(node instanceof Element)) return;
  const found = node.matches(SELECTOR) ? [node] : [];
  for (const el of node.querySelectorAll(SELECTOR)) found.push(el);
  for (const el of found) {
    if (watched.has(el)) continue;
    watched.add(el);
    ro.observe(el);
  }
}

function forget(node) {
  if (!(node instanceof Element)) return;
  for (const el of watched) {
    if (node === el || node.contains(el)) {
      watched.delete(el);
      ro.unobserve(el);
    }
  }
}

export function initScrollFade() {
  if (!("ResizeObserver" in window)) return;
  ro = new ResizeObserver((entries) => {
    for (const e of entries) update(e.target);
  });
  new MutationObserver((records) => {
    for (const r of records) {
      if (watched.size) r.removedNodes.forEach(forget);
      r.addedNodes.forEach(watch);
    }
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener(
    "scroll",
    (e) => {
      if (e.target instanceof Element && e.target.matches(SELECTOR)) update(e.target);
    },
    { capture: true, passive: true }
  );
  document.fonts?.ready.then(() => watched.forEach(update));
  watch(document.body);
}
