// Données fixes des équipes (logos, couleurs) et choix de couleurs lisibles.

import { api, once } from "./api.js";

let TEAMS = [];
let BY_ID = new Map();
let BY_TRI = new Map();

export function loadTeams() {
  return once("teams-meta", async () => {
    const { data } = await api("/teams?meta=1");
    TEAMS = data.teams;
    BY_ID = new Map(TEAMS.map((t) => [t.id, t]));
    BY_TRI = new Map(TEAMS.map((t) => [t.tri, t]));
    return TEAMS;
  });
}

export const teams = () => TEAMS;
export const team = (id) => BY_ID.get(Number(id)) || null;
export const teamByTri = (tri) => BY_TRI.get(tri) || null;

// NBA.com publie chaque logo en deux versions : pour fond clair (L) et pour fond sombre (D).
export const logoUrl = (id, variant = "L") => `https://cdn.nba.com/logos/nba/${id}/global/${variant}/logo.svg`;

export function isDarkTheme() {
  return getComputedStyle(document.documentElement).colorScheme.includes("dark");
}
export const headshotUrl = (id, size = "big") =>
  size === "small"
    ? `https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`
    : `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`;

// ------------------------------------------------------------ couleurs

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channel(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function oklab(hex) {
  const [r, g, b] = hexToRgb(hex).map(channel);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function colorDistance(a, b) {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

function surfaceColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#181b1f";
}

// Couleur d'une équipe assez contrastée pour être vue sur la surface courante (liserés, barres).
export function teamColor(id, against = surfaceColor()) {
  const t = team(id);
  if (!t) return "var(--line-strong)";
  for (const c of t.colors) if (contrast(c, against) >= 2.2) return c;
  return luminance(against) < 0.2 ? "#d9dee7" : "#3a4558";
}

// Deux couleurs d'équipe qu'on peut distinguer côte à côte.
export function teamPair(awayId, homeId) {
  const surface = surfaceColor();
  const away = teamColor(awayId, surface);
  let home = teamColor(homeId, surface);
  if (colorDistance(away, home) < 0.12) {
    const t = team(homeId);
    const alt = (t?.colors || []).find((c) => c !== home && contrast(c, surface) >= 2.2 && colorDistance(c, away) >= 0.12);
    home = alt || (luminance(surface) < 0.2 ? "#d9dee7" : "#3a4558");
  }
  return { away, home };
}

// Fond plein aux couleurs de l'équipe (bandeaux) et encre lisible dessus.
export function teamBand(id) {
  const t = team(id);
  const bg = t ? t.colors[0] : "#20242a";
  const ink = contrast(bg, "#ffffff") >= 3 ? "#ffffff" : "#0f1113";
  const accent = (t?.colors || []).slice(1).find((c) => contrast(c, bg) >= 2.5) || ink;
  return { bg, ink, accent };
}
