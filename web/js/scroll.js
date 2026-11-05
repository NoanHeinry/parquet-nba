// Défilement de l'accueil : défilement doux à la molette, sommaire numéroté sur le côté
// (01. 02. 03.), apparition des sections et effets liés à la position dans la page.
//
// Tout s'arrête avec la page (ctx.onCleanup). Si l'utilisateur a demandé à limiter les
// animations dans son système, le défilement reste celui du navigateur et rien n'est animé.

import { h } from "./dom.js";

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Défilement doux à la molette (souris ou pavé tactile). Le défilement reste celui de la page :
// on anime seulement la position, ce qui garde les éléments collants, l'ancre et le clavier.
export function smoothWheel(ctx) {
  const api = {
    to(y) {
      window.scrollTo({ top: y, behavior: reducedMotion() ? "auto" : "smooth" });
    },
  };
  if (reducedMotion() || !matchMedia("(pointer: fine)").matches) return api;

  let target = window.scrollY;
  let current = window.scrollY;
  let raf = 0;
  let animating = false;
  const max = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

  const step = () => {
    current += (target - current) * 0.11;
    if (Math.abs(target - current) < 0.4) {
      current = target;
      animating = false;
    }
    window.scrollTo(0, current);
    if (animating) raf = requestAnimationFrame(step);
  };
  const start = () => {
    if (animating) return;
    animating = true;
    raf = requestAnimationFrame(step);
  };

  // Une zone qui défile elle-même (liste de résultats, bandeau horizontal) garde la molette.
  const scrollsItself = (el, dy) => {
    for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (el.scrollHeight <= el.clientHeight + 1) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy !== "auto" && oy !== "scroll") continue;
      if (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
    }
    return false;
  };

  const onWheel = (e) => {
    if (e.ctrlKey || e.defaultPrevented || document.body.classList.contains("menu-open")) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (scrollsItself(e.target, e.deltaY)) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 36 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
    if (!animating) target = current = window.scrollY;
    target = Math.max(0, Math.min(max(), target + dy));
    start();
  };
  // Clavier, barre de défilement, ancre : on repart de la position réelle.
  const onScroll = () => {
    if (!animating) target = current = window.scrollY;
  };
  const stop = () => {
    animating = false;
    cancelAnimationFrame(raf);
  };

  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("keydown", stop);
  window.addEventListener("pointerdown", stop);
  ctx.onCleanup(() => {
    stop();
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("keydown", stop);
    window.removeEventListener("pointerdown", stop);
  });

  api.to = (y) => {
    if (!animating) current = window.scrollY;
    target = Math.max(0, Math.min(max(), y));
    start();
  };
  return api;
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

// Les sections apparaissent quand on les atteint, une seule fois.
export function reveal(ctx, elements) {
  if (reducedMotion() || !("IntersectionObserver" in window)) {
    for (const el of elements) el.classList.add("is-in", "is-settled");
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
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

// Progression (0 à 1) de la sortie d'un élément par le haut de l'écran, pour les effets
// de profondeur : la valeur est posée dans la variable CSS --out de l'élément.
export function exitProgress(ctx, el) {
  if (reducedMotion()) return;
  let raf = 0;
  const sync = () => {
    raf = 0;
    const height = el.offsetHeight || 1;
    const p = Math.min(1, Math.max(0, window.scrollY / height));
    el.style.setProperty("--out", p.toFixed(3));
  };
  const queue = () => {
    if (!raf) raf = requestAnimationFrame(sync);
  };
  window.addEventListener("scroll", queue, { passive: true });
  queue();
  ctx.onCleanup(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener("scroll", queue);
  });
}
