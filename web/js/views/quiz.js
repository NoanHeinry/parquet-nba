// « Qui est-ce ? » : deviner un joueur NBA d'après sa silhouette en pied.
//
//   #/jeu          accueil du jeu : défi du jour, modes, réglages, historique, album
//   #/jeu/defi     défi du jour (5 joueurs, les mêmes pour tout le monde)
//   #/jeu/partie   partie de 10 joueurs
//   #/jeu/serie    jusqu'à la première erreur
//   #/jeu/chrono   contre-la-montre de 60 secondes
//
// La logique (tirage, indices, points, progression) est dans ../quiz.js.

import { h } from "../dom.js";
import * as f from "../format.js";
import { errorState, headshot, loading, teamLogo } from "../components.js";
import { playerIndex } from "../search.js";
import { poster } from "../poster.js";
import { reducedMotion } from "../scroll.js";
import { showToast } from "../notifications.js";
import { team, teamColor, teams } from "../teams.js";
import * as Q from "../quiz.js";

const KEYS = ["1", "2", "3", "4"];

// ---------------------------------------------------------------- outils

let measure = null;
function textWidth(text) {
  measure = measure || document.createElement("canvas").getContext("2d");
  measure.font = '400 100px "Anton", "Oswald", sans-serif';
  return measure.measureText(String(text).toUpperCase()).width || 1;
}

// Le nom prend toute la largeur disponible, dans une limite de hauteur.
function fitName(el, box, cap) {
  const w = box.clientWidth || 600;
  el.style.fontSize = `${Math.floor(Math.max(34, Math.min(cap, (w / textWidth(el.textContent)) * 100 * 0.98)))}px`;
}

function silhouetteColor(canvas) {
  return getComputedStyle(canvas).color || "#f2f2f2";
}

// Silhouette : la photo détourée est dessinée puis entièrement recouverte d'une couleur unie,
// seule la forme reste. (Le canevas n'est jamais relu, la photo peut venir d'un autre site.)
function paintSilhouette(canvas, img) {
  // Dessin à la taille affichée (écrans haute densité compris) pour des contours nets.
  const ratio = img.naturalWidth / img.naturalHeight;
  const shown = canvas.clientHeight * Math.min(2, window.devicePixelRatio || 1);
  const hgt = Math.round(Math.max(img.naturalHeight, Math.min(1600, shown || 0)));
  const w = Math.round(hgt * ratio);
  canvas.width = w;
  canvas.height = hgt;
  const c = canvas.getContext("2d");
  c.imageSmoothingQuality = "high";
  c.clearRect(0, 0, w, hgt);
  c.globalCompositeOperation = "source-over";
  c.drawImage(img, 0, 0, w, hgt);
  c.globalCompositeOperation = "source-in";
  c.fillStyle = silhouetteColor(canvas);
  c.fillRect(0, 0, w, hgt);
  c.globalCompositeOperation = "source-over";
}

function frameFor(picture) {
  const canvas = h("canvas", { class: "qz-sil", role: "img", "aria-label": "Silhouette du joueur à deviner" });
  const photo = h("img", { class: "qz-photo", src: picture.url, alt: "", decoding: "async", referrerpolicy: "no-referrer" });
  const frame = h("div", { class: `qz-frame is-${picture.kind}` }, canvas, photo);
  // Le canevas doit être dans la page pour connaître sa couleur (thème clair ou sombre).
  return { frame, canvas, photo, paint: () => paintSilhouette(canvas, picture.img) };
}

async function share(text) {
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  if (coarse && navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    // Page ouverte sans connexion sécurisée (téléphone sur le Wi-Fi) : ancienne méthode.
    const area = h("textarea", { style: { position: "fixed", opacity: "0" } }, text);
    document.body.append(area);
    area.select();
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
  }
  showToast(ok ? { title: "Résultat copié", body: "Colle-le où tu veux pour défier tes amis." } : { title: "Copie impossible", body: text });
}

function countdown(el) {
  const ms = Q.msToParisMidnight();
  const hrs = Math.floor(ms / 3600000);
  const min = Math.floor((ms % 3600000) / 60000);
  el.textContent = `Nouveau défi dans ${hrs ? `${hrs} h ` : ""}${String(min).padStart(hrs ? 2 : 1, "0")} min`;
}

function markBoxes(rounds, total = rounds.length) {
  const cells = [];
  for (let i = 0; i < total; i++) {
    const r = rounds[i];
    const cls = !r ? "is-empty" : !r.correct ? "is-miss" : r.hintsUsed ? "is-help" : "is-hit";
    const label = !r ? "pas joué" : !r.correct ? "raté" : r.hintsUsed ? "trouvé avec indice" : "trouvé";
    cells.push(h("span", { class: `qz-mark ${cls}`, title: label }));
  }
  return h("span", { class: "qz-marks", role: "img", "aria-label": rounds.map((r) => (r.correct ? "trouvé" : "raté")).join(", ") || "aucun" }, cells);
}

async function loadActive(ctx, body) {
  body.replaceChildren(loading("Préparation du jeu…"));
  try {
    const players = await playerIndex();
    if (!ctx.active) return null;
    const active = Q.activePlayers(players);
    if (active.length < 8) throw new Error("Pas assez de joueurs en activité dans l'index.");
    return { players, active, byId: new Map(players.map((p) => [p.id, p])) };
  } catch (err) {
    if (ctx.active) body.replaceChildren(errorState(err, () => location.reload()));
    return null;
  }
}

// ---------------------------------------------------------------- accueil du jeu

function segmented(label, options, value, onChange) {
  const group = h("div", { class: "qz-seg", role: "radiogroup", "aria-label": label });
  const draw = (current) => {
    group.replaceChildren(
      ...options.map((o) =>
        h(
          "button",
          {
            type: "button",
            role: "radio",
            class: "qz-seg-btn",
            "aria-checked": String(o.value === current),
            onclick: () => {
              draw(o.value);
              onChange(o.value);
            },
          },
          h("b", null, o.label),
          o.sub ? h("small", null, o.sub) : null
        )
      )
    );
  };
  draw(value);
  return h("div", { class: "qz-setting" }, h("span", { class: "qz-setting-label" }, label), group);
}

function decorSilhouette(ctx, active, top) {
  const stars = active.slice(0, 40);
  if (!stars.length) return;
  const deck = new Q.Deck({ active: stars, level: "facile", mode: "partie" });
  deck.next().then((round) => {
    if (!round || !ctx.active) return;
    const { frame, paint } = frameFor(round.picture);
    frame.classList.add("is-decor");
    top.update({ visual: frame, visualKind: "quiz" });
    requestAnimationFrame(paint);
  });
}

export async function renderHome(ctx) {
  const store = Q.load();
  const top = poster(ctx, {
    kicker: "Le jeu de Parquet",
    title: "Qui est-ce\u00a0?",
    ghost: "?",
    meta: "Une silhouette, un joueur NBA. À toi de le reconnaître.",
  });
  const body = h("div", { class: "qz-home" });
  ctx.outlet.append(top.el, body);
  const data = await loadActive(ctx, body);
  if (!data) return;
  const { active, byId } = data;
  const activeIds = new Set(active.map((p) => p.id));
  const found = Object.keys(store.found).map(Number).filter((id) => activeIds.has(id));

  top.update({
    stats: [
      { label: "Joueurs trouvés", v: found.length },
      { label: "Réussite", v: store.rounds ? `${Math.round((store.correct / store.rounds) * 100)} %` : "–" },
      { label: "Défis d'affilée", v: Q.dailyStreak() },
      { label: "Parties", v: store.games },
    ],
  });
  decorSilhouette(ctx, active, top);

  // Défi du jour
  const today = Q.parisDate();
  const done = store.daily[today];
  const clock = h("p", { class: "qz-countdown" });
  countdown(clock);
  ctx.every(30000, () => countdown(clock));
  const todayLabel = new Date(`${today}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const daily = h(
    "section",
    { class: `qz-daily${done ? " is-done" : ""}`, "aria-labelledby": "qz-daily-title" },
    h(
      "div",
      { class: "qz-daily-copy" },
      h("p", { class: "qz-eyebrow" }, todayLabel),
      h("h2", { id: "qz-daily-title" }, "Défi du jour"),
      h("p", null, Q.MODES.defi.sub, "."),
      clock
    ),
    done
      ? h(
          "div",
          { class: "qz-daily-result" },
          markBoxes(done.rounds, Q.MODES.defi.rounds),
          h("p", { class: "qz-daily-score" }, h("b", { class: "num" }, `${done.rounds.filter((r) => r.correct).length}/${done.rounds.length}`), h("span", { class: "num" }, `${done.score} pts`)),
          h(
            "div",
            { class: "qz-row" },
            h("button", { type: "button", class: "btn primary", onclick: () => share(Q.shareText({ mode: "defi", date: today, rounds: done.rounds, score: done.score })) }, "Partager"),
            h("a", { class: "btn", href: "#/jeu/defi" }, "Revoir")
          )
        )
      : h("div", { class: "qz-daily-result" }, markBoxes([], Q.MODES.defi.rounds), h("a", { class: "btn primary qz-cta", href: "#/jeu/defi" }, "Jouer le défi"))
  );

  // Réglages et modes
  const prefs = { ...store.prefs };
  const records = new Map();
  const savePrefs = () => Q.update((s) => (s.prefs = { ...prefs }));
  const modes = ["partie", "serie", "chrono"].map((mode) => {
    const rec = h("b", { class: "qz-mode-rec num" });
    records.set(mode, rec);
    return h(
      "a",
      { class: `qz-mode is-${mode}`, href: `#/jeu/${mode}` },
      h("span", { class: "qz-mode-name" }, Q.MODES[mode].label),
      h("span", { class: "qz-mode-sub" }, Q.MODES[mode].sub),
      h("span", { class: "qz-mode-record" }, h("small", null, "Record"), rec),
      h("span", { class: "qz-mode-go", "aria-hidden": "true" }, "Jouer →")
    );
  });
  const drawRecords = () => {
    for (const [mode, el] of records) {
      const v = Q.best(mode, prefs.level);
      el.textContent = v === null ? "–" : mode === "partie" ? `${v} pts` : String(v);
    }
  };
  drawRecords();

  const settings = h(
    "div",
    { class: "qz-settings" },
    segmented(
      "Niveau",
      Object.entries(Q.LEVELS).map(([value, l]) => ({ value, label: l.label, sub: l.sub })),
      prefs.level,
      (v) => {
        prefs.level = v;
        savePrefs();
        drawRecords();
      }
    ),
    segmented(
      "Réponses",
      [
        { value: "choix", label: "4 choix", sub: "Le bon nom parmi quatre" },
        { value: "saisie", label: "Saisie libre", sub: "Tu tapes le nom, 3 essais" },
      ],
      prefs.answer,
      (v) => {
        prefs.answer = v;
        savePrefs();
      }
    )
  );

  // Historique des défis (deux semaines)
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = Q.shiftDay(today, -i);
    const r = store.daily[d];
    const label = new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
    days.push(
      h(
        "div",
        { class: `qz-day${r ? "" : " is-empty"}${d === today ? " is-today" : ""}` },
        h("small", null, label),
        r ? markBoxes(r.rounds, Q.MODES.defi.rounds) : markBoxes([], Q.MODES.defi.rounds),
        h("span", { class: "num" }, r ? `${r.score}` : "–")
      )
    );
  }

  // Album : joueurs trouvés, équipe par équipe
  const perTeam = new Map();
  for (const p of active) {
    const e = perTeam.get(p.teamId) || { total: 0, found: 0 };
    e.total++;
    if (store.found[p.id]) e.found++;
    perTeam.set(p.teamId, e);
  }
  const teamCells = teams()
    .filter((t) => perTeam.has(t.id))
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map((t) => {
      const e = perTeam.get(t.id);
      return h(
        "div",
        { class: `qz-team${e.found === e.total ? " is-full" : ""}`, title: `${t.fullName} : ${e.found} sur ${e.total}`, style: { "--k": (e.found / e.total).toFixed(3) } },
        teamLogo(t.id, 34),
        h("span", { class: "num" }, `${e.found}/${e.total}`),
        h("i", { "aria-hidden": "true" })
      );
    });
  const recentFound = found.sort((a, b) => store.found[b] - store.found[a]);
  const faces = h("div", { class: "qz-faces" });
  const drawFaces = (all) => {
    faces.replaceChildren(
      ...recentFound.slice(0, all ? recentFound.length : 36).map((id) => {
        const p = byId.get(id);
        return h("a", { class: "qz-face", href: `#/joueur/${id}`, title: p ? `${p.first} ${p.last}` : "" }, headshot(id, { alt: p ? `${p.first} ${p.last}` : "" }));
      })
    );
  };
  drawFaces(false);
  const more =
    recentFound.length > 36
      ? h("button", { type: "button", class: "btn", onclick: (e) => (drawFaces(true), e.currentTarget.remove()) }, `Voir les ${recentFound.length} joueurs`)
      : null;
  const progress = active.length ? found.length / active.length : 0;

  body.replaceChildren(
    daily,
    h("section", { class: "qz-block", "aria-labelledby": "qz-modes-title" }, h("h2", { class: "qz-h2", id: "qz-modes-title" }, "Jouer"), settings, h("div", { class: "qz-modes" }, modes)),
    h(
      "section",
      { class: "qz-block", "aria-labelledby": "qz-hist-title" },
      h("h2", { class: "qz-h2", id: "qz-hist-title" }, "Mes défis", h("span", { class: "count" }, `${Q.dailyStreak()} d'affilée`)),
      h("div", { class: "qz-days" }, days)
    ),
    h(
      "section",
      { class: "qz-block", "aria-labelledby": "qz-album-title" },
      h("h2", { class: "qz-h2", id: "qz-album-title" }, "Album", h("span", { class: "count" }, `${found.length} joueurs trouvés sur ${active.length}`)),
      h("div", { class: "qz-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(active.length), "aria-valuenow": String(found.length) }, h("i", { style: { "--k": progress.toFixed(4) } })),
      h("div", { class: "qz-teams" }, teamCells),
      recentFound.length
        ? h("div", null, h("h3", { class: "qz-h3" }, "Derniers trouvés"), faces, more)
        : h("p", { class: "note" }, "Chaque joueur reconnu rejoint ton album. Il est vide pour l'instant : à toi de jouer !")
    ),
    h("p", { class: "note qz-note" }, "Ta progression est gardée dans ce navigateur. Les photos sont celles de la séance photo officielle de début de saison de la NBA.")
  );
}

// ---------------------------------------------------------------- partie

export async function renderPlay(ctx) {
  const mode = ctx.params[0];
  if (!Q.MODES[mode]) {
    location.hash = "#/jeu";
    return;
  }
  document.body.classList.add("is-quiz");
  ctx.onCleanup(() => document.body.classList.remove("is-quiz"));
  const holder = h("div", { class: "qz-holder" });
  ctx.outlet.append(holder);
  const data = await loadActive(ctx, holder);
  if (!data) return;
  const store = Q.load();
  const today = Q.parisDate();

  if (mode === "defi" && store.daily[today]) {
    const done = store.daily[today];
    holder.replaceChildren();
    showResults(ctx, holder, data, { mode, level: "normal", rounds: done.rounds, score: done.score, date: today, replay: true });
    return;
  }

  const level = mode === "defi" ? "normal" : store.prefs.level;
  const answerMode = mode === "chrono" || mode === "defi" ? "choix" : store.prefs.answer;
  const deck = new Q.Deck({
    active: data.active,
    level,
    mode,
    seed: mode === "defi" ? `parquet-defi-${today}` : null,
    avoid: store.recent,
  });
  holder.replaceChildren();
  playSession(ctx, holder, data, { mode, level, answerMode, deck, today });
}

function playSession(ctx, holder, data, { mode, level, answerMode, deck, today }) {
  const total = Q.MODES[mode].rounds;
  const S = { index: 0, rounds: [], score: 0, streak: 0, state: "loading", round: null, hintsUsed: 0, tries: 0, t0: 0, endAt: 0, over: false };
  const motion = !reducedMotion();

  // --- structure
  const kicker = h("span", { class: "qz-kicker" });
  const scoreEl = h("b", { class: "num" }, "0");
  const scoreBox = h("span", { class: "qz-score" }, h("small", null, mode === "partie" || mode === "defi" ? "Score" : "Trouvés"), scoreEl);
  const streakEl = h("span", { class: "qz-streak", hidden: true });
  const clockEl = h("span", { class: "qz-clock num", hidden: mode !== "chrono" });
  const first = h("span", { class: "qz-first" });
  const name = h("span", { class: "qz-name" }, "Qui est-ce\u00a0?");
  const title = h("h1", { class: "qz-title" }, first, name);
  const verdict = h("div", { class: "qz-verdict", "aria-live": "polite" });
  const hintList = h("ol", { class: "qz-hints" });
  const answerBox = h("div", { class: "qz-answer" });
  const hintBtn = h("button", { type: "button", class: "qz-act qz-hint-btn" });
  const skipBtn = h("button", { type: "button", class: "qz-act qz-skip" }, "Je passe");
  const nextBtn = h("button", { type: "button", class: "qz-act qz-next", hidden: true });
  const actions = h("div", { class: "qz-actions" }, hintBtn, skipBtn, nextBtn);
  const copy = h("div", { class: "qz-copy" }, h("div", { class: "qz-bar" }, kicker, scoreBox, streakEl, clockEl), title, verdict, hintList, answerBox, actions);
  const figure = h("div", { class: "qz-figure" }, h("div", { class: "qz-halo", "aria-hidden": "true" }), h("div", { class: "qz-floor", "aria-hidden": "true" }));
  const speed = h("div", { class: "qz-speed", "aria-hidden": "true", hidden: mode !== "partie" && mode !== "defi" }, h("i"));
  const chronoBar = h("div", { class: "qz-chrono", "aria-hidden": "true", hidden: mode !== "chrono" }, h("i"));
  const arena = h(
    "section",
    { class: `qz-arena is-${mode}`, "aria-label": "Qui est-ce\u00a0?" },
    h("div", { class: "stage-band back", "aria-hidden": "true" }),
    h("div", { class: "stage-band back thin", "aria-hidden": "true" }),
    h("span", { class: "qz-ghost", "aria-hidden": "true" }, "?"),
    figure,
    copy,
    speed,
    chronoBar
  );
  holder.replaceChildren(arena);
  if (mode === "chrono") hintBtn.hidden = true;

  const lastFit = { w: 0 };
  const fit = () => fitName(name, copy, window.innerWidth < 700 ? (S.state === "revealed" ? 84 : 64) : 168);
  const ro = new ResizeObserver(() => {
    if (copy.clientWidth === lastFit.w) return;
    lastFit.w = copy.clientWidth;
    fit();
  });
  ro.observe(copy);
  document.fonts?.load('100px "Anton"').then(fit).catch(() => {});
  ctx.onCleanup(() => ro.disconnect());

  // --- barres de temps (une seule transition CSS, rien n'est recalculé à chaque image)
  const bar = (el, from, seconds) => {
    const i = el.firstChild;
    i.style.transition = "none";
    i.style.transform = `scaleX(${from})`;
    void i.offsetWidth;
    if (seconds > 0) {
      i.style.transition = `transform ${seconds}s linear`;
      i.style.transform = "scaleX(0)";
    }
  };
  const freezeSpeed = () => {
    const elapsed = (performance.now() - S.t0) / 1000;
    bar(speed, Math.max(0, 1 - Math.max(0, elapsed - 2) / (Q.SPEED_WINDOW - 2)), 0);
  };

  let clockTimer = null;
  const tickClock = () => {
    const left = Math.max(0, S.endAt - performance.now());
    clockEl.textContent = `${Math.ceil(left / 1000)} s`;
    clockEl.classList.toggle("is-low", left < 10000);
    if (left <= 0 && !S.over) finish();
  };
  ctx.onCleanup(() => clearInterval(clockTimer));

  const drawTop = () => {
    // Pendant la révélation, on reste sur le numéro du joueur qu'on vient de voir.
    const n = S.state === "revealed" || S.state === "over" ? S.index : S.index + 1;
    kicker.textContent =
      mode === "defi" ? `Défi du jour · ${n}/${total}` : mode === "partie" ? `Partie · ${Q.LEVELS[level].label} · ${n}/${total}` : mode === "serie" ? `Série · ${Q.LEVELS[level].label}` : `Contre-la-montre · ${Q.LEVELS[level].label}`;
    streakEl.hidden = S.streak < 2;
    streakEl.textContent = `${S.streak} de suite`;
    hintBtn.textContent = S.hintsUsed >= 4 ? "Plus d'indice" : mode === "serie" ? "Indice" : `Indice (−${Q.HINT_COST})`;
    hintBtn.disabled = S.state !== "asking" || S.hintsUsed >= 4;
  };

  // Le score monte depuis sa valeur précédente.
  const setScore = (value) => {
    const from = Number(scoreEl.textContent) || 0;
    if (!motion || value <= from) {
      scoreEl.textContent = String(value);
      return;
    }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 600);
      scoreEl.textContent = String(Math.round(from + (value - from) * (1 - (1 - k) ** 3)));
      if (k < 1 && scoreEl.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // --- réponses
  let choiceButtons = [];
  const buildChoices = (round) => {
    choiceButtons = round.choices.map((p, i) =>
      h(
        "button",
        { type: "button", class: "qz-choice", style: { "--i": i }, dataset: { id: p.id }, onclick: () => answer(p.id) },
        h("kbd", { "aria-hidden": "true" }, KEYS[i]),
        h("span", null, `${p.first} ${p.last}`)
      )
    );
    answerBox.replaceChildren(h("div", { class: "qz-choices" }, choiceButtons));
  };

  let input = null;
  const buildTyping = () => {
    const list = h("ul", { class: "qz-suggest", role: "listbox", id: "qz-suggest", hidden: true });
    const triesEl = h("span", { class: "qz-tries" });
    input = h("input", {
      type: "text",
      class: "qz-input",
      placeholder: "Nom du joueur",
      autocomplete: "off",
      autocapitalize: "words",
      spellcheck: "false",
      "aria-label": "Nom du joueur",
      "aria-autocomplete": "list",
      "aria-controls": "qz-suggest",
      "aria-expanded": "false",
    });
    let items = [];
    let sel = -1;
    const drawTries = () => (triesEl.textContent = `${Q.TYPE_TRIES - S.tries} essai${Q.TYPE_TRIES - S.tries > 1 ? "s" : ""}`);
    const drawList = () => {
      list.replaceChildren(
        ...items.map((p, i) =>
          h(
            "li",
            { role: "option", "aria-selected": String(i === sel), class: i === sel ? "is-sel" : "", onmousedown: (e) => (e.preventDefault(), pick(p)) },
            `${p.first} ${p.last}`
          )
        )
      );
      list.hidden = !items.length;
      input.setAttribute("aria-expanded", String(!list.hidden));
    };
    const pick = (p) => {
      input.value = "";
      items = [];
      sel = -1;
      drawList();
      if (p.id === S.round.player.id) return answer(p.id);
      S.tries++;
      input.classList.remove("is-shake");
      void input.offsetWidth;
      input.classList.add("is-shake");
      drawTries();
      if (S.tries >= Q.TYPE_TRIES) return answer(p.id);
      verdict.replaceChildren(h("p", { class: "qz-miss-line" }, `Ce n'est pas ${p.first} ${p.last}.`));
      if (S.hintsUsed < 4) giveHint(true);
    };
    input.addEventListener("input", () => {
      items = Q.suggest(data.active, input.value);
      sel = items.length ? 0 : -1;
      drawList();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!items.length) return;
        e.preventDefault();
        sel = (sel + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
        drawList();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (items[sel]) pick(items[sel]);
      } else if (e.key === "Escape") {
        items = [];
        drawList();
      }
    });
    drawTries();
    answerBox.replaceChildren(h("div", { class: "qz-type" }, input, list, triesEl));
    if (window.matchMedia?.("(pointer: fine)").matches) input.focus({ preventScroll: true });
  };

  // --- indices
  const giveHint = (free = false) => {
    if (S.state !== "asking" || S.hintsUsed >= 4) return;
    const hint = S.round.hints[S.hintsUsed];
    S.hintsUsed++;
    if (free) S.freeHints = (S.freeHints || 0) + 1;
    hintList.append(
      h(
        "li",
        { class: `qz-hint is-${hint.key}` },
        h("b", null, hint.label),
        hint.teamId ? teamLogo(hint.teamId, 26) : null,
        h("span", null, hint.text)
      )
    );
    if (hint.teamId) arena.style.setProperty("--team", teamColor(hint.teamId));
    drawTop();
  };

  // --- déroulé
  let current = null;
  const showRound = (round) => {
    S.round = round;
    S.hintsUsed = 0;
    S.freeHints = 0;
    S.tries = 0;
    S.state = "asking";
    arena.classList.remove("is-revealed", "is-right", "is-wrong");
    arena.style.setProperty("--team", "var(--accent)");
    first.textContent = "";
    name.textContent = "Qui est-ce\u00a0?";
    fit();
    verdict.replaceChildren();
    hintList.replaceChildren();
    nextBtn.hidden = true;
    skipBtn.hidden = false;
    // Nouvelle silhouette : l'ancienne sort, la nouvelle monte.
    const old = current;
    current = frameFor(round.picture);
    // L'ancienne silhouette sort d'abord, la nouvelle monte juste après : jamais l'une sur l'autre.
    if (old) current.frame.classList.add("is-after");
    figure.append(current.frame);
    current.paint();
    if (old) {
      old.frame.classList.add("is-leaving");
      setTimeout(() => old.frame.remove(), motion ? 300 : 0);
    }
    if (answerMode === "saisie") buildTyping();
    else buildChoices(round);
    drawTop();
    S.t0 = performance.now();
    if (!speed.hidden) bar(speed, 1, Q.SPEED_WINDOW);
  };

  const answer = (id) => {
    if (S.state !== "asking") return;
    S.state = "revealed";
    const p = S.round.player;
    const correct = id === p.id;
    const ms = performance.now() - S.t0;
    if (!speed.hidden) freezeSpeed();
    const points = Q.roundPoints({ correct, hintsUsed: S.hintsUsed, ms, mode });
    const result = { id: p.id, correct, hintsUsed: S.hintsUsed, points, ms: Math.round(ms), kind: S.round.picture.kind };
    S.rounds.push(result);
    S.score += points;
    S.streak = correct ? S.streak + 1 : 0;
    Q.recordRound(result);

    if (mode === "chrono" && !correct) {
      S.endAt -= Q.CHRONO_PENALTY * 1000;
      bar(chronoBar, Math.max(0, (S.endAt - performance.now()) / (Q.CHRONO_SECONDS * 1000)), Math.max(0, (S.endAt - performance.now()) / 1000));
    }

    // Révélation : la photo en couleur remplace la silhouette, le nom s'affiche en grand.
    arena.classList.add("is-revealed", correct ? "is-right" : "is-wrong");
    arena.style.setProperty("--team", teamColor(p.teamId));
    first.textContent = p.first;
    name.textContent = p.last;
    fit();
    for (const b of choiceButtons) {
      const bid = Number(b.dataset.id);
      b.disabled = true;
      b.classList.toggle("is-right", bid === p.id);
      b.classList.toggle("is-wrong", bid === id && !correct);
      b.classList.toggle("is-out", bid !== p.id && bid !== id);
    }
    if (input) input.disabled = true;
    const t = team(p.teamId);
    const bonus = correct && (mode === "partie" || mode === "defi") ? points - Math.max(10, Q.BASE_POINTS - S.hintsUsed * Q.HINT_COST) : 0;
    verdict.replaceChildren(
      h(
        "div",
        { class: "qz-verdict-in" },
        h("b", { class: "qz-points num" }, correct ? (mode === "partie" || mode === "defi" ? `+${points}` : "Trouvé !") : id === null ? "Passé" : "Raté"),
        h(
          "span",
          null,
          correct
            ? [S.hintsUsed ? `${S.hintsUsed} indice${S.hintsUsed > 1 ? "s" : ""}` : "Sans indice", bonus > 0 ? `, bonus vitesse +${bonus}` : ""].join("")
            : `C'était ${p.first} ${p.last}${t ? `, ${t.fullName}` : ""}.`
        )
      )
    );
    setScore(mode === "partie" || mode === "defi" ? S.score : S.rounds.filter((r) => r.correct).length);
    S.index++;
    const ended = (Number.isFinite(total) && S.index >= total) || (mode === "serie" && !correct);
    skipBtn.hidden = true;
    drawTop();
    if (mode === "chrono") {
      setTimeout(() => !S.over && ctx.active && next(), correct ? 650 : 1100);
      return;
    }
    nextBtn.hidden = false;
    nextBtn.textContent = ended ? "Voir le bilan" : "Joueur suivant →";
    nextBtn.focus({ preventScroll: true });
  };

  const finish = () => {
    if (S.over) return;
    S.over = true;
    S.state = "over";
    clearInterval(clockTimer);
    const value = mode === "partie" ? S.score : S.rounds.filter((r) => r.correct).length;
    const isRecord = Q.recordGame({ mode, level, value, date: today, rounds: S.rounds, score: S.score });
    holder.replaceChildren();
    window.scrollTo(0, 0);
    showResults(ctx, holder, data, { mode, level, rounds: S.rounds, score: S.score, date: today, isRecord });
  };

  const next = async () => {
    // Un seul passage au joueur suivant par manche (clic, touche Entrée, enchaînement auto).
    if (S.over || S.state !== "revealed") return;
    const ended = (Number.isFinite(total) && S.index >= total) || (mode === "serie" && S.rounds.length && !S.rounds.at(-1).correct);
    if (ended) return finish();
    S.state = "loading";
    nextBtn.disabled = true;
    const round = await deck.next();
    nextBtn.disabled = false;
    if (!ctx.active || S.over) return;
    if (!round) {
      holder.replaceChildren(errorState(new Error("Impossible de charger les photos des joueurs. Vérifie ta connexion à Internet."), () => location.reload()));
      return;
    }
    showRound(round);
  };

  hintBtn.addEventListener("click", () => giveHint());
  skipBtn.addEventListener("click", () => answer(null));
  nextBtn.addEventListener("click", () => next());

  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement) return;
    if (S.state === "asking" && answerMode === "choix") {
      const i = KEYS.indexOf(e.key);
      if (i >= 0 && choiceButtons[i]) {
        e.preventDefault();
        choiceButtons[i].click();
        return;
      }
    }
    if (S.state === "asking" && (e.key === "i" || e.key === "h") && !hintBtn.hidden) {
      e.preventDefault();
      giveHint();
    } else if (S.state === "revealed" && !nextBtn.hidden && (e.key === "Enter" || e.key === " " || e.key === "ArrowRight")) {
      e.preventDefault();
      next();
    }
  };
  document.addEventListener("keydown", onKey);
  ctx.onCleanup(() => document.removeEventListener("keydown", onKey));

  // Premier joueur
  kicker.textContent = "Préparation…";
  hintBtn.disabled = true;
  answerBox.replaceChildren(h("p", { class: "qz-wait" }, "Chargement des silhouettes…"));
  deck.next().then((round) => {
    if (!ctx.active) return;
    if (!round) {
      holder.replaceChildren(errorState(new Error("Impossible de charger les photos des joueurs. Vérifie ta connexion à Internet."), () => location.reload()));
      return;
    }
    if (mode === "chrono") {
      S.endAt = performance.now() + Q.CHRONO_SECONDS * 1000;
      bar(chronoBar, 1, Q.CHRONO_SECONDS);
      clockTimer = setInterval(tickClock, 200);
      tickClock();
    }
    showRound(round);
  });
}

// ---------------------------------------------------------------- bilan

function showResults(ctx, holder, data, { mode, level, rounds, score, date, isRecord = false, replay = false }) {
  const ok = rounds.filter((r) => r.correct).length;
  const label =
    mode === "defi"
      ? `Défi du ${new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`
      : `${Q.MODES[mode].label} · ${Q.LEVELS[level].label}`;
  const headline = mode === "partie" || mode === "defi" ? `${score} pts` : `${ok} trouvé${ok > 1 ? "s" : ""}`;
  const verdictText =
    mode === "serie"
      ? ok
        ? `${ok} bonne${ok > 1 ? "s" : ""} réponse${ok > 1 ? "s" : ""} d'affilée.`
        : "Raté dès le premier joueur. On se refait une série ?"
      : mode === "chrono"
        ? `${ok} joueur${ok > 1 ? "s" : ""} reconnu${ok > 1 ? "s" : ""} en ${Q.CHRONO_SECONDS} secondes, sur ${rounds.length} proposé${rounds.length > 1 ? "s" : ""}.`
        : `${ok} joueur${ok > 1 ? "s" : ""} trouvé${ok > 1 ? "s" : ""} sur ${rounds.length}.`;
  const bestValue = Q.best(mode, level);
  const text = Q.shareText({ mode, date, rounds, score, level });
  const actions = [
    h("button", { type: "button", class: "btn primary", onclick: () => share(text) }, "Partager"),
    mode !== "defi" ? h("a", { class: "btn", href: `#/jeu/${mode}`, onclick: (e) => (e.preventDefault(), rerun(mode)) }, "Rejouer") : null,
    h("a", { class: "btn", href: "#/jeu" }, "Retour au jeu"),
  ];
  const top = poster(ctx, {
    kicker: label,
    title: headline,
    ghost: mode === "partie" || mode === "defi" ? `${ok}/${rounds.length}` : String(ok),
    meta: h(
      "span",
      { class: "qz-res-meta" },
      verdictText,
      isRecord ? h("b", { class: "qz-record" }, "Nouveau record !") : bestValue !== null && mode !== "defi" ? ` Record : ${mode === "partie" ? `${bestValue} pts` : bestValue}.` : ""
    ),
    actions,
  });
  const clock = h("p", { class: "qz-countdown" });
  if (mode === "defi") {
    countdown(clock);
    ctx.every(30000, () => countdown(clock));
  }
  const cards = rounds.map((r, i) => {
    const p = data.byId.get(r.id);
    const t = p ? team(p.teamId) : null;
    return h(
      "a",
      { class: `qz-card ${r.correct ? "is-hit" : "is-miss"}`, href: `#/joueur/${r.id}`, style: { "--i": Math.min(i, 12), "--team": p ? teamColor(p.teamId) : "var(--accent)" } },
      h("span", { class: "qz-card-pic" }, headshot(r.id, { alt: "" })),
      h(
        "span",
        { class: "qz-card-copy" },
        h("b", null, p ? `${p.first} ${p.last}` : `Joueur ${r.id}`),
        h("small", null, t ? t.fullName : ""),
        h(
          "small",
          { class: "qz-card-res" },
          r.correct ? "Trouvé" : "Raté",
          r.correct && r.hintsUsed ? `, ${r.hintsUsed} indice${r.hintsUsed > 1 ? "s" : ""}` : "",
          r.ms && r.correct ? `, ${f.num(r.ms / 1000)} s` : ""
        )
      ),
      mode === "partie" || mode === "defi" ? h("span", { class: "qz-card-pts num" }, r.correct ? `+${r.points}` : "0") : null
    );
  });
  holder.append(
    top.el,
    h(
      "div",
      { class: "qz-results" },
      mode === "defi" || mode === "partie" ? h("div", { class: "qz-res-marks" }, markBoxes(rounds, rounds.length), mode === "defi" ? clock : null) : null,
      replay ? h("p", { class: "note" }, "Tu as déjà joué le défi d'aujourd'hui. Reviens demain pour un nouveau défi.") : null,
      rounds.length ? h("div", { class: "qz-cards" }, cards) : h("p", { class: "note" }, "Aucun joueur n'a eu le temps de passer.")
    )
  );

  function rerun(m) {
    // Même adresse : on relance la partie sans passer par l'accueil du jeu.
    holder.replaceChildren();
    const store = Q.load();
    const lvl = store.prefs.level;
    const deck = new Q.Deck({ active: data.active, level: lvl, mode: m, avoid: store.recent });
    window.scrollTo(0, 0);
    playSession(ctx, holder, data, { mode: m, level: lvl, answerMode: m === "chrono" ? "choix" : store.prefs.answer, deck, today: Q.parisDate() });
  }
}

// ---------------------------------------------------------------- encart de l'accueil

// Rappel du défi du jour en bas de l'accueil. La silhouette n'est préparée qu'en arrivant
// sur l'encart, pour ne rien charger de plus à l'ouverture du site.
export function createQuizTeaser(ctx) {
  const today = Q.parisDate();
  const done = Q.load().daily[today];
  const visual = h("div", { class: "qzt-visual", "aria-hidden": "true" }, h("span", { class: "qzt-q" }, "?"));
  const el = h(
    "a",
    { class: `qz-teaser${done ? " is-done" : ""}`, href: done ? "#/jeu" : "#/jeu/defi" },
    h(
      "div",
      { class: "qzt-copy" },
      h("p", { class: "home-kicker" }, "Le jeu de Parquet"),
      h("h2", { class: "qzt-title" }, "Qui est-ce ?"),
      h("p", { class: "qzt-text" }, done ? "Défi du jour terminé. Une série, un contre-la-montre ?" : "Le défi du jour t'attend : 5 silhouettes de joueurs NBA à reconnaître."),
      done ? markBoxes(done.rounds, Q.MODES.defi.rounds) : null,
      h("span", { class: "qzt-cta" }, done ? "Rejouer →" : "Jouer le défi →")
    ),
    visual
  );
  let shown = false;
  const show = async () => {
    if (shown) return;
    shown = true;
    try {
      const players = await playerIndex();
      if (!ctx.active) return;
      const stars = Q.activePlayers(players).slice(0, 60);
      if (!stars.length) return;
      const round = await new Q.Deck({ active: stars, level: "facile", mode: "partie" }).next();
      if (!round || !ctx.active) return;
      const { frame, paint } = frameFor(round.picture);
      frame.classList.add("is-decor");
      visual.append(frame);
      paint();
    } catch {
      /* l'encart reste sans silhouette */
    }
  };
  return { el, show };
}
