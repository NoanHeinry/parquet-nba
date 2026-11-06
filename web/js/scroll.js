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

  // Section en cours : celle qui croise une ligne fictive à 40 % de la hauteur de l'écran.
  // L'observateur est géré par le navigateur : aucun calcul pendant le défilement.
  const visible = new Set();
  let lastActive = -1;
  const setActive = () => {
    let active = 0;
    items.forEach((it, i) => {
      if (visible.has(it.el)) active = i;
    });
    if (!visible.size) active = lastActive < 0 ? 0 : lastActive;
    if (active === lastActive) return;
    lastActive = active;
    buttons.forEach((b, i) => b.classList.toggle("is-active", i === active));
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target);
        else visible.delete(e.target);
      }
      setActive();
    },
    { rootMargin: "-40% 0px -59% 0px" }
  );
  for (const it of items) io.observe(it.el);

  // Trait de progression : seule la position de défilement est lue à chaque image ; la hauteur
  // de la page n'est remesurée que lorsqu'elle change.
  let max = 1;
  let raf = 0;
  let lastFill = "";
  const draw = () => {
    raf = 0;
    const v = `scaleY(${Math.min(1, window.scrollY / max).toFixed(3)})`;
    if (v !== lastFill) {
      lastFill = v;
      fill.style.transform = v;
    }
  };
  const queue = () => {
    if (!raf) raf = requestAnimationFrame(draw);
  };
  // Sections masquées (pas de résumé de la nuit, par exemple) : leur numéro disparaît.
  const refresh = () => {
    max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    items.forEach((it, i) => (buttons[i].hidden = it.el.hidden || !it.el.isConnected));
    queue();
  };
  const ro = new ResizeObserver(refresh);
  ro.observe(document.body);
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", refresh);
  refresh();
  ctx.onCleanup(() => {
    cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    window.removeEventListener("scroll", queue);
    window.removeEventListener("resize", refresh);
    nav.remove();
  });
  return { refresh };
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
