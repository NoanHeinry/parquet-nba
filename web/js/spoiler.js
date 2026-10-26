// Mode anti-spoiler : état global et mémoire des scores révélés.
//
// Les scores révélés un par un sont retenus pendant la session (sessionStorage),
// pour survivre aux actualisations automatiques et aux changements de page.

const KEY = "parquet-revealed";
let revealed = new Set();
try {
  revealed = new Set(JSON.parse(sessionStorage.getItem(KEY) || "[]"));
} catch {
  revealed = new Set();
}

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...revealed]));
  } catch {
    /* mémoire de session indisponible : l'état reste en mémoire vive */
  }
}

export function isSpoilerFree() {
  return document.documentElement.dataset.spoiler === "1";
}

// Une donnée est masquée si le mode est actif et qu'elle n'a pas été révélée.
export function isHidden(key) {
  return isSpoilerFree() && !revealed.has(key);
}

export function isRevealed(key) {
  return revealed.has(key);
}

export function setRevealed(key, on) {
  if (on) revealed.add(key);
  else revealed.delete(key);
  save();
}

export function toggleRevealed(key) {
  setRevealed(key, !revealed.has(key));
  return revealed.has(key);
}

export function clearRevealed() {
  revealed.clear();
  save();
}

export const gameKey = (id) => `g:${id}`;
export const seriesKey = (id) => `s:${id}`;
