// Moteur du jeu « Qui est-ce ? » : choix des joueurs, silhouettes, indices, points, défi du jour
// et progression gardée dans le navigateur. Aucune manipulation de la page ici (voir views/quiz.js).

import * as f from "./format.js";
import { officialHeadshotUrl as headshotUrl, silhouetteUrl, team } from "./teams.js";
import { normalize } from "./search.js";

// ---------------------------------------------------------------- réglages

export const LEVELS = {
  facile: { label: "Facile", sub: "Les 100 meilleurs marqueurs", size: 100 },
  normal: { label: "Normal", sub: "Les 260 joueurs les plus utilisés", size: 260 },
  expert: { label: "Expert", sub: "Toute la ligue", size: Infinity },
};

export const MODES = {
  defi: { label: "Défi du jour", rounds: 5, sub: "5 silhouettes, les mêmes pour tout le monde, une seule tentative" },
  partie: { label: "Partie", rounds: 10, sub: "10 joueurs, des points à chaque bonne réponse" },
  serie: { label: "Série", rounds: Infinity, sub: "Jusqu'à la première erreur" },
  chrono: { label: "Contre-la-montre", rounds: Infinity, sub: "60 secondes, le plus de joueurs possible" },
};

export const CHRONO_SECONDS = 60;
export const CHRONO_PENALTY = 3;
export const HINT_COST = 20;
export const BASE_POINTS = 100;
export const SPEED_BONUS = 50;
export const SPEED_WINDOW = 12; // secondes : le bonus de vitesse fond de 2 à 12 s
export const TYPE_TRIES = 3;

// ---------------------------------------------------------------- hasard

// Graine texte -> générateur reproductible (le même défi pour tout le monde le même jour).
export function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rand = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Date du jour à Paris (AAAA-MM-JJ) : le défi change à minuit, heure française.
export function parisDate(d = new Date()) {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function msToParisMidnight(d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, Number(p.value)])
  );
  const elapsed = (parts.hour * 3600 + parts.minute * 60 + parts.second) * 1000;
  return 24 * 3600 * 1000 - elapsed;
}

// ---------------------------------------------------------------- joueurs

const posGroup = (pos) => (pos || "").charAt(0) || "?";

export function inches(height) {
  const m = /^(\d+)-(\d+)$/.exec(height || "");
  return m ? Number(m[1]) * 12 + Number(m[2]) : null;
}

// Les joueurs en activité, du plus marquant au moins marquant.
export function activePlayers(players) {
  return players.filter((p) => p.active && p.teamId && team(p.teamId)).sort((a, b) => (b.pts || 0) - (a.pts || 0) || a.id - b.id);
}

export function poolFor(active, level) {
  const size = LEVELS[level]?.size ?? LEVELS.normal.size;
  return Number.isFinite(size) ? active.slice(0, size) : active.slice();
}

// Trois autres noms plausibles : même poste et gabarit proche quand c'est possible.
// rank(p) remplace le hasard pour le défi du jour : le tirage ne dépend alors ni de l'ordre
// ni de la composition exacte de la liste, qui peut varier un peu d'un appareil à l'autre.
export function distractors(answer, pool, rand = Math.random, n = 3, rank = null) {
  const group = posGroup(answer.pos);
  const size = inches(answer.height);
  const others = pool.filter((p) => p.id !== answer.id);
  const close = others.filter((p) => posGroup(p.pos) === group && (size === null || inches(p.height) === null || Math.abs(inches(p.height) - size) <= 3));
  const picked = [];
  const mix = (list) => (rank ? list.slice().sort((a, b) => rank(a) - rank(b)) : shuffle(list, rand));
  for (const source of [mix(close), mix(others)]) {
    for (const p of source) {
      if (picked.length >= n) break;
      if (!picked.some((x) => x.id === p.id || x.last === p.last)) picked.push(p);
    }
  }
  return picked;
}

// Indices, du plus vague au plus parlant.
export function hints(p) {
  const out = [];
  const body = [f.position(p.pos), p.height ? f.heightM(p.height) : "", p.weight ? f.weightKg(p.weight) : ""].filter(Boolean).join(", ");
  out.push({ key: "gabarit", label: "Gabarit", text: body || "Gabarit inconnu" });
  const draft = p.draftYear ? `drafté en ${p.draftYear}${p.draftNumber ? ` (${p.draftNumber === 1 ? "1er" : `${p.draftNumber}e`} choix)` : ""}` : "non drafté";
  const from = [p.country ? f.country(p.country) : "", p.college ? `formé à ${p.college}` : ""].filter(Boolean).join(", ");
  const career = p.from ? `en NBA depuis ${p.from}` : "";
  out.push({ key: "parcours", label: "Parcours", text: [from, draft, career].filter(Boolean).join(" ; ") });
  const avg = p.pts !== null && p.pts !== undefined ? `${f.num(p.pts)} pts, ${f.num(p.reb)} reb, ${f.num(p.ast)} pd${p.statsTf === "Career" ? " en carrière" : " cette saison"}` : "";
  out.push({ key: "chiffres", label: "Ses chiffres", text: [p.jersey ? `maillot n° ${p.jersey}` : "", avg].filter(Boolean).join(" ; ") || "Pas de statistiques" });
  const t = team(p.teamId);
  out.push({ key: "equipe", label: "Son équipe", text: t ? t.fullName : "Équipe inconnue", teamId: p.teamId });
  return out;
}

export function roundPoints({ correct, hintsUsed = 0, ms = 0, mode = "partie" }) {
  if (!correct) return 0;
  if (mode === "chrono" || mode === "serie") return 1;
  const s = ms / 1000;
  const speed = Math.round(SPEED_BONUS * Math.max(0, Math.min(1, (SPEED_WINDOW - Math.max(2, s)) / (SPEED_WINDOW - 2))));
  return Math.max(10, BASE_POINTS - hintsUsed * HINT_COST) + speed;
}

export function maxPoints(rounds) {
  return rounds * (BASE_POINTS + SPEED_BONUS);
}

// Recherche pour la saisie libre : nom complet, nom ou prénom, sans accents.
export function suggest(active, query, limit = 6) {
  const q = normalize(query);
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const scored = [];
  for (const p of active) {
    const key = p.key || normalize(`${p.first} ${p.last}`);
    if (!words.every((w) => key.includes(w))) continue;
    let score = 0;
    if (normalize(p.last).startsWith(words.at(-1))) score += 4;
    if (key.startsWith(q)) score += 3;
    score += Math.min(3, (p.pts || 0) / 8);
    scored.push([score, p]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].last.localeCompare(b[1].last));
  return scored.slice(0, limit).map(([, p]) => p);
}

// ---------------------------------------------------------------- images

const images = new Map();

function loadImage(url, timeout = 9000) {
  if (!images.has(url)) {
    images.set(
      url,
      new Promise((resolve) => {
        const img = new Image();
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        const timer = setTimeout(() => resolve(null), timeout);
        img.onload = () => {
          clearTimeout(timer);
          resolve(img.naturalWidth ? img : null);
        };
        img.onerror = () => {
          clearTimeout(timer);
          resolve(null);
        };
        img.src = url;
      })
    );
  }
  return images.get(url);
}

// Photos « silos » manquantes, retenues quelques jours pour ne pas les redemander à chaque partie.
let bustOnly = false;
let missStreak = 0;

async function pictureFor(p, allowBust) {
  const store = load();
  const known = new Set(store.noSilo.ids);
  if (!bustOnly && !known.has(p.id)) {
    const img = await loadImage(silhouetteUrl(p.id));
    if (img) {
      missStreak = 0;
      return { kind: "full", img, url: silhouetteUrl(p.id) };
    }
    missStreak++;
    update((s) => {
      if (!s.noSilo.ids.includes(p.id)) s.noSilo.ids.push(p.id);
      s.noSilo.ids = s.noSilo.ids.slice(-800);
    });
    // Aucune photo en pied ne répond (réseau qui bloque ce serveur, mode démo) : on passe
    // aux portraits pour tout le reste de la session.
    if (missStreak >= 12) bustOnly = true;
  }
  if (!allowBust && !bustOnly) return null;
  const img = await loadImage(headshotUrl(p.id, "big"));
  return img ? { kind: "bust", img, url: headshotUrl(p.id, "big") } : null;
}

// Paquet de manches : tire les joueurs, vérifie qu'on a leur photo, prépare les choix et
// garde toujours une ou deux manches d'avance pour enchaîner sans attendre.
export class Deck {
  constructor({ active, level = "normal", mode = "partie", seed = null, avoid = [] }) {
    this.active = active;
    this.level = mode === "defi" ? "normal" : level;
    this.mode = mode;
    this.pool = poolFor(active, this.level);
    this.seed = seed;
    this.rand = seed ? rng(seed) : Math.random;
    // Défi : chaque joueur reçoit un rang tiré de la graine du jour et de son identifiant.
    const ranks = new Map();
    this.rank = seed ? (p) => (ranks.has(p.id) ? ranks.get(p.id) : ranks.set(p.id, rng(`${seed}:${p.id}`)()).get(p.id)) : null;
    const order = seed ? [...this.pool].sort((a, b) => this.rank(a) - this.rank(b)) : shuffle(this.pool);
    const recent = new Set(avoid);
    // Les joueurs vus récemment passent en fin de paquet (sauf pour le défi, identique pour tous).
    this.order = seed ? order : [...order.filter((p) => !recent.has(p.id)), ...order.filter((p) => recent.has(p.id))];
    this.cursor = 0;
    this.found = false;
    this.queue = [];
    this.tail = Promise.resolve();
    this.allowBust = this.level === "expert";
  }

  async build() {
    while (this.cursor < this.order.length) {
      const p = this.order[this.cursor++];
      const pic = await pictureFor(p, this.allowBust);
      if (!pic) continue;
      this.found = true;
      const rand = this.seed ? rng(`${this.seed}:choix:${p.id}`) : Math.random;
      const others = distractors(p, this.pool.length >= 8 ? this.pool : this.active, rand, 3, this.rank);
      const choices = shuffle([p, ...others], rand);
      return { player: p, picture: pic, choices, hints: hints(p) };
    }
    // Paquet épuisé : on recommence un tour (série très longue). Si aucun joueur n'avait de photo
    // (hors ligne, photos bloquées), on s'arrête : un nouveau tour ne trouverait rien non plus, et les
    // échecs déjà en mémoire répondraient tout de suite, en boucle, ce qui figerait la page.
    if (!this.order.length || !this.found) return null;
    this.found = false;
    this.cursor = 0;
    this.order = shuffle(this.order, this.rand);
    return this.build();
  }

  // Les manches sont préparées l'une après l'autre (jamais en parallèle) : le tirage reste
  // le même pour tout le monde au défi du jour, et on garde deux manches d'avance.
  next() {
    const fill = () => {
      while (this.queue.length < 3) {
        this.tail = this.tail.then(() => this.build().catch(() => null));
        this.queue.push(this.tail);
      }
    };
    fill();
    const round = this.queue.shift();
    fill();
    return round;
  }
}

// ---------------------------------------------------------------- partage

export function marks(rounds) {
  return rounds.map((r) => (!r.correct ? "⬛" : r.hintsUsed ? "🟨" : "🟧")).join("");
}

export function shareText({ mode, date, rounds, score, level }) {
  const ok = rounds.filter((r) => r.correct).length;
  const when = date ? new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) : "";
  if (mode === "defi") return `Parquet · Qui est-ce ? · Défi du ${when}\n${marks(rounds)}  ${ok}/${rounds.length} · ${score} pts`;
  if (mode === "chrono") return `Parquet · Qui est-ce ? · Contre-la-montre (${LEVELS[level].label})\n${ok} joueurs trouvés en ${CHRONO_SECONDS} s`;
  if (mode === "serie") return `Parquet · Qui est-ce ? · Série (${LEVELS[level].label})\n${ok} bonne${ok > 1 ? "s" : ""} réponse${ok > 1 ? "s" : ""} d'affilée`;
  return `Parquet · Qui est-ce ? · Partie (${LEVELS[level].label})\n${marks(rounds)}  ${ok}/${rounds.length} · ${score} pts`;
}

// ---------------------------------------------------------------- progression

const KEY = "parquet-quiz";

function blank() {
  return {
    v: 1,
    prefs: { level: "normal", answer: "choix" },
    rounds: 0,
    correct: 0,
    games: 0,
    best: {},
    daily: {},
    recent: [],
    found: {},
    noSilo: { ids: [], at: Date.now() },
  };
}

let memory = null;

export function load() {
  if (memory) return memory;
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    data = null;
  }
  memory = { ...blank(), ...(data && data.v === 1 ? data : {}) };
  memory.prefs = { ...blank().prefs, ...memory.prefs };
  // Les photos manquantes sont redemandées au bout de dix jours (la NBA en ajoute en cours de saison).
  if (!memory.noSilo || Date.now() - (memory.noSilo.at || 0) > 10 * 24 * 3600 * 1000) memory.noSilo = { ids: [], at: Date.now() };
  return memory;
}

export function update(fn) {
  const s = load();
  fn(s);
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* navigation privée ou stockage plein : la progression reste en mémoire */
  }
  return s;
}

export function bestKey(mode, level) {
  return mode === "defi" ? "defi" : `${mode}:${level}`;
}

export function best(mode, level) {
  return load().best[bestKey(mode, level)] ?? null;
}

// Fin de manche : statistiques, album, joueurs récents.
export function recordRound(round) {
  update((s) => {
    s.rounds++;
    if (round.correct) {
      s.correct++;
      if (!s.found[round.id]) s.found[round.id] = Date.now();
    }
    s.recent = [round.id, ...s.recent.filter((id) => id !== round.id)].slice(0, 60);
  });
}

// Fin de partie : record éventuel et, pour le défi, résultat du jour.
export function recordGame({ mode, level, value, date, rounds, score }) {
  let isRecord = false;
  update((s) => {
    s.games++;
    const k = bestKey(mode, level);
    if (mode !== "defi" && (s.best[k] === undefined || value > s.best[k])) {
      isRecord = value > 0;
      s.best[k] = value;
    }
    if (mode === "defi") {
      s.daily[date] = { score, rounds: rounds.map((r) => ({ id: r.id, correct: r.correct, hintsUsed: r.hintsUsed, points: r.points })) };
      const days = Object.keys(s.daily).sort().slice(-90);
      s.daily = Object.fromEntries(days.map((d) => [d, s.daily[d]]));
      const scores = Object.values(s.daily).map((d) => d.score);
      s.best.defi = Math.max(...scores);
    }
  });
  return isRecord;
}

// Défis consécutifs réussis jusqu'à aujourd'hui (ou hier si celui du jour n'est pas encore joué).
export function dailyStreak(today = parisDate()) {
  const daily = load().daily;
  let day = daily[today] ? today : shiftDay(today, -1);
  let n = 0;
  while (daily[day]) {
    n++;
    day = shiftDay(day, -1);
  }
  return n;
}

function shiftDay(iso, delta) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export { shiftDay };
