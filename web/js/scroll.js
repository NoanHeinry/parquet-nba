// Défilement de l'accueil : sommaire numéroté sur le côté (01. 02. 03.), apparition des
// sections et compteurs. Le défilement lui-même reste celui du navigateur.
//
// Tout s'arrête avec la page (ctx.onCleanup). Quand les animations sont réduites (bouton
// « Animations » de Parquet, ou réglage du système par défaut), le défilement reste celui du
// navigateur et rien n'est animé.

import { h } from "./dom.js";

// Animations réduites : réglage « Animations » de Parquet, ou celui du système par défaut
// (posé sur <html data-motion> au chargement, voir index.html et app.js).
export const reducedMotion = () => document.documentElement.dataset.motion === "reduce";

// Défilement : celui du navigateur, qui est déjà fluide (et animé par la carte graphique).
// On ne garde qu'un « aller à » en douceur pour le sommaire de la page.
export function smoothWheel() {
  return {
    to(y) {
      window.scrollTo({ top: y, behavior: reducedMotion() ? "auto" : "smooth" });
    },
  };
}

// Sommaire de la page sur le bord droit : un numéro par section, la section en cours
// est mise en avant et le trait se remplit à mesure qu'on descend.
export function sectionIndex(ctx, items, scroller) {
  const fill = h("span", { class: "si-fill" });
  const buttons = items.map((it, i) => {
    const btn = h(
      "button",
      { type: "button", class: "si-item", "aria-label": `Aller à : ${it.label}` },
      h("span", { class: "si-num" }, `${String(i + 1).padStart(2, "0")}.`),
      h("span", { class: "si-label" }, it.label)
    );
    btn.addEventListener("click", () => {
      const top = it.el.getBoundingClientRect().top + window.scrollY;
      scroller.to(i === 0 ? 0 : top - 12);
    });
    return btn;
  });
  const nav = h("nav", { class: "section-index", "aria-label": "Sommaire de la page" }, h("span", { class: "si-track" }, fill), buttons);
  document.body.append(nav);

  let raf = 0;
  const sync = () => {
    raf = 0;
    const mid = window.innerHeight * 0.4;
    let active = 0;
    items.forEach((it, i) => {
      const hidden = it.el.hidden || !it.el.isConnected || it.el.offsetHeight === 0;
      buttons[i].hidden = hidden;
      if (!hidden && it.el.getBoundingClientRect().top <= mid) active = i;
    });
    buttons.forEach((b, i) => b.classList.toggle("is-active", i === active));
    nav.classList.toggle("on-stage", Boolean(items[active]?.dark));
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    fill.style.transform = `scaleY(${Math.min(1, window.scrollY / max)})`;
  };
  const queue = () => {
    if (!raf) raf = requestAnimationFrame(sync);
  };
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue);
  const ro = new ResizeObserver(queue);
  ro.observe(document.body);
  queue();
  ctx.onCleanup(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener("scroll", queue);
    window.removeEventListener("resize", queue);
    ro.disconnect();
    nav.remove();
  });
  return { refresh: queue };
}

// Un nombre qui défile de 0 à sa valeur (entiers seulement), après un éventuel délai.
export function countUp(el, value, delay = 0) {
  const n = Number(value);
  if (reducedMotion() || !Number.isInteger(n) || n <= 0) {
    el.textContent = String(value);
    return;
  }
  el.textContent = "0";
  const dur = Math.min(1300, 650 + n * 6);
  const t0 = performance.now() + delay;
  const tick = (t) => {
    if (!el.isConnected) return;
    const k = Math.max(0, Math.min(1, (t - t0) / dur));
    el.textContent = String(Math.round(n * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Les sections apparaissent quand on les atteint, une seule fois ; onIn(el) est appelé à ce
// moment-là (pour lancer un compteur, par exemple).
export function reveal(ctx, elements, onIn = null) {
  if (reducedMotion() || !("IntersectionObserver" in window)) {
    for (const el of elements) el.classList.add("is-in", "is-settled");
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        onIn?.(e.target);
        io.unobserve(e.target);
        // Les actualisations suivantes ne rejouent pas l'animation.
        setTimeout(() => e.target.classList.add("is-settled"), 1400);
      }
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0 }
  );
  for (const el of elements) {
    el.classList.add("reveal");
    io.observe(el);
  }
  ctx.onCleanup(() => io.disconnect());
}
