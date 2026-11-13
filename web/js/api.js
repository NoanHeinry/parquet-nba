// Appels au serveur local Parquet (qui lui-même interroge NBA.com et Wikipédia).

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError("Le serveur Parquet ne répond plus. Relance l'application (lancer.bat ou lancer.command).");
  }
  let body = null;
  try {
    body = await res.json();
  } catch (err) {
    // Page quittée pendant la lecture de la réponse : ce n'est pas une erreur à afficher.
    if (signal?.aborted || err?.name === "AbortError") throw new DOMException("Lecture interrompue", "AbortError");
    throw new ApiError(`Réponse illisible du serveur local (code ${res.status}).`, res.status);
  }
  // Parquet protégé par un code d'accès (hébergement) : le rechargement affiche la page du code.
  if (res.status === 401 && body?.access) location.reload();
  if (!res.ok) throw new ApiError(body?.error || `Erreur ${res.status}`, res.status);
  return body; // { data, meta }
}

// Petit cache mémoire pour les données lourdes et stables (index des joueurs, équipes).
const memo = new Map();
export function once(key, loader) {
  if (!memo.has(key)) {
    const p = loader().catch((err) => {
      memo.delete(key);
      throw err;
    });
    memo.set(key, p);
  }
  return memo.get(key);
}

export function forget(key) {
  memo.delete(key);
}

// État du serveur (version, saison, mode démonstration), chargé une fois.
export function appStatus() {
  return once("status", async () => (await api("/status")).data);
}
