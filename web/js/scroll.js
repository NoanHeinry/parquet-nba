// Défilement de l'accueil : défilement doux à la molette, sommaire numéroté sur le côté
// (01. 02. 03.), apparition des sections et effets liés à la position dans la page.
//
// Tout s'arrête avec la page (ctx.onCleanup). Quand les animations sont réduites (bouton
// « Animations » de Parquet, ou réglage du système par défaut), le défilement reste celui du
// navigateur et rien n'est animé.

import { h } from "./dom.js";

// Animations réduites : réglage « Animations » de Parquet, ou celui du système par défaut
// (posé sur <html data-motion> au chargement, voir index.html et app.js).
export const reducedMotion = () => document.documentElement.dataset.motion === "reduce";

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

// Boucle d'animation de la page : à chaque image, la position et la vitesse de défilement
// (lissée, en pixels par seconde) sont transmises aux effets abonnés.
export function motion(ctx) {
  const subs = new Set();
  const api = { add: (fn) => subs.add(fn), vel: 0 };
  if (reducedMotion()) {
    // Pas d'animation : chaque effet est calculé une fois, puis à chaque défilement.
    const once = () => {
      for (const fn of subs) fn({ y: window.scrollY, vel: 0, dt: 0 });
    };
    window.addEventListener("scroll", once, { passive: true });
    requestAnimationFrame(once);
    ctx.onCleanup(() => window.removeEventListener("scroll", once));
    return api;
  }
  let raf = 0;
  let lastY = window.scrollY;
  let lastT = performance.now();
  const frame = (t) => {
    const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    const y = window.scrollY;
    const raw = dt ? (y - lastY) / dt : 0;
    lastY = y;
    api.vel += (raw - api.vel) * 0.12;
    if (Math.abs(api.vel) < 0.5) api.vel = 0;
    for (const fn of subs) fn({ y, vel: api.vel, dt });
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  ctx.onCleanup(() => cancelAnimationFrame(raf));
  return api;
}

// Entrée progressive dans l'écran : --enter passe de 0 (le haut de l'élément arrive en bas de
// l'écran) à 1 (il atteint le milieu), pour des décalages qui suivent le défilement.
export function enterFx(m, elements) {
  const last = new Map();
  m.add(() => {
    const vh = window.innerHeight;
    for (const el of elements) {
      if (!el.isConnected || el.hidden) continue;
      const top = el.getBoundingClientRect().top;
      const q = Math.max(0, Math.min(1, (vh - top) / (vh * 0.55))).toFixed(3);
      if (last.get(el) !== q) {
        last.set(el, q);
        el.style.setProperty("--enter", q);
      }
    }
  });
}

// Bandeau qui défile tout seul, accélère avec le défilement de la page et change de sens
// quand on remonte. Le contenu est répété deux fois pour boucler sans raccord visible.
export function marquee(ctx, m, el) {
  const track = el.querySelector(".ticker-track");
  let x = 0;
  let dir = 1;
  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(el);
  ctx.onCleanup(() => io.disconnect());
  if (reducedMotion()) return;
  m.add(({ vel, dt }) => {
    if (!visible || !dt) return;
    if (Math.abs(vel) > 40) dir = vel > 0 ? 1 : -1;
    const loop = track.scrollWidth / 2;
    if (!loop) return;
    x = (x + (46 * dir + vel * 0.32) * dt) % loop;
    if (x < 0) x += loop;
    const skew = Math.max(-9, Math.min(9, -vel / 260));
    track.style.transform = `translate3d(${(-x).toFixed(1)}px, 0, 0) skewX(${skew.toFixed(2)}deg)`;
  });
}

// Effet de profondeur à la souris : --mx et --my (de -1 à 1) suivent le pointeur en douceur ;
// la feuille de style décale chaque plan d'une quantité différente.
export function pointerDepth(ctx, el) {
  if (reducedMotion() || !matchMedia("(pointer: fine)").matches) return;
  let tx = 0;
  let ty = 0;
  let mx = 0;
  let my = 0;
  let raf = 0;
  const step = () => {
    mx += (tx - mx) * 0.08;
    my += (ty - my) * 0.08;
    el.style.setProperty("--mx", mx.toFixed(3));
    el.style.setProperty("--my", my.toFixed(3));
    raf = Math.abs(tx - mx) + Math.abs(ty - my) > 0.002 ? requestAnimationFrame(step) : 0;
  };
  const aim = (x, y) => {
    tx = x;
    ty = y;
    if (!raf) raf = requestAnimationFrame(step);
  };
  el.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    aim(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
  });
  el.addEventListener("pointerleave", () => aim(0, 0));
  ctx.onCleanup(() => cancelAnimationFrame(raf));
}
