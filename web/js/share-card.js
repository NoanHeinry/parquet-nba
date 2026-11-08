// Visuel « résultat du match » au format Instagram (1080 × 1350), aux couleurs de Parquet.
// Dessiné dans le navigateur (canvas) à partir du box score : aucune image de la NBA, aucun logo
// d'équipe, aucune photo de joueur (droits). Mention « Source : NBA.com » en pied, comme le
// demandent les conditions d'utilisation de NBA.com pour publier leurs statistiques.

import { h } from "./dom.js";
import * as f from "./format.js";

const W = 1080;
const H = 1350;
const C = {
  bg: "#0f1113",
  panel: "#181b1f",
  line: "#2b3038",
  ink: "#f3f2ef",
  ink2: "#c4c6ca",
  muted: "#8d9299",
  accent: "#ff7a1a",
};

let logoPromise = null;
function loadLogo() {
  // Le logo vectoriel suit le thème dans la page (currentColor, var(--accent)) : on fige ses couleurs.
  logoPromise ??= fetch("img/logo.svg")
    .then((r) => r.text())
    .then((svg) => {
      const fixed = svg.replaceAll("var(--accent, #ff7a1a)", C.accent).replaceAll('color="#f3f2ef"', `color="${C.ink}"`);
      const url = URL.createObjectURL(new Blob([fixed], { type: "image/svg+xml" }));
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });
    })
    .catch(() => null);
  return logoPromise;
}

async function fontsReady() {
  const specs = ["400 200px Anton", "600 40px Oswald", "500 30px Oswald", "400 30px Barlow", "600 30px Barlow"];
  await Promise.all(specs.map((s) => document.fonts.load(s).catch(() => null)));
}

function text(ctx, value, x, y, { font, color = C.ink, align = "left", spacing = 0, base = "alphabetic" } = {}) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(value, x, y);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
}

function fitFont(ctx, value, weightFamily, size, maxWidth) {
  let s = size;
  ctx.font = `${weightFamily.replace("{s}", s)}`;
  while (ctx.measureText(value).width > maxWidth && s > 20) {
    s -= 2;
    ctx.font = `${weightFamily.replace("{s}", s)}`;
  }
  return ctx.font;
}

function sparkle(ctx, x, y, rx, ry, color) {
  const k = 0.12;
  ctx.beginPath();
  ctx.moveTo(x, y - ry);
  ctx.quadraticCurveTo(x + rx * k, y - ry * k, x + rx, y);
  ctx.quadraticCurveTo(x + rx * k, y + ry * k, x, y + ry);
  ctx.quadraticCurveTo(x - rx * k, y + ry * k, x - rx, y);
  ctx.quadraticCurveTo(x - rx * k, y - ry * k, x, y - ry);
  ctx.fillStyle = color;
  ctx.fill();
}

function topPlayer(side) {
  const players = (side?.players || []).filter((p) => p.played !== false);
  players.sort((a, b) => (b.pts || 0) - (a.pts || 0) || (b.reb || 0) + (b.ast || 0) - ((a.reb || 0) + (a.ast || 0)));
  return players[0] || null;
}

function statLine(p) {
  const parts = [`${p.pts || 0} PTS`, `${p.reb || 0} REB`, `${p.ast || 0} PD`];
  if ((p.stl || 0) >= 3) parts.push(`${p.stl} INT`);
  if ((p.blk || 0) >= 3) parts.push(`${p.blk} CTR`);
  return parts.join("  ·  ");
}

export async function drawResultCard(box) {
  const game = box.game;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const [logo] = await Promise.all([loadLogo(), fontsReady()]);

  // Fond : noir de l'appli, halo orange, rond central du terrain en filigrane.
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.86, H * 0.08, 0, W * 0.86, H * 0.08, W * 0.9);
  glow.addColorStop(0, "rgba(255,122,26,0.20)");
  glow.addColorStop(1, "rgba(255,122,26,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,122,26,0.10)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(W / 2, 640, 380, 0, Math.PI * 2);
  ctx.stroke();
  sparkle(ctx, W - 120, 210, 26, 60, "rgba(255,122,26,0.55)");
  sparkle(ctx, 62, 1205, 12, 28, "rgba(255,122,26,0.35)");

  // En-tête : logo, type de match et date.
  if (logo) {
    const lw = 330;
    const lh = (lw * logo.naturalHeight) / logo.naturalWidth || lw * 0.525;
    ctx.drawImage(logo, (W - lw) / 2, 48, lw, lh);
  } else {
    text(ctx, "PARQUET", W / 2, 140, { font: "400 90px Anton", align: "center" });
  }
  const kind = (f.gameLabel(game) || "Saison régulière").toUpperCase();
  const ot = (game.period || 0) > 4 ? `  ·  ${f.periodName(game.period).toUpperCase()}` : "";
  text(ctx, `RÉSULTAT  ·  ${kind}${ot}`, W / 2, 268, { font: "600 34px Oswald", color: C.accent, align: "center", spacing: 4 });
  const date = f.dateLong(game.etDate || (game.start || "").slice(0, 10));
  text(ctx, date ? date.charAt(0).toUpperCase() + date.slice(1) : "", W / 2, 316, { font: "400 32px Barlow", color: C.ink2, align: "center" });

  // Les deux équipes : sigle, nom, score. Le vainqueur en clair avec un trait orange.
  const away = game.away || {};
  const home = game.home || {};
  const winner = (away.score ?? 0) > (home.score ?? 0) ? "away" : "home";
  const rows = [
    ["away", away, 380],
    ["home", home, 640],
  ];
  for (const [key, side, top] of rows) {
    const win = key === winner;
    ctx.fillStyle = win ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.02)";
    ctx.fillRect(80, top, W - 160, 220);
    if (win) {
      ctx.fillStyle = C.accent;
      ctx.fillRect(80, top, 10, 220);
    }
    const color = win ? C.ink : C.muted;
    text(ctx, side.tri || "?", 130, top + 150, { font: "400 150px Anton", color, spacing: 2 });
    const name = `${side.city || ""} ${side.name || ""}`.trim().toUpperCase();
    text(ctx, name, 134, top + 196, { font: fitFont(ctx, name, "500 {s}px Oswald", 32, 520), color: win ? C.ink2 : C.muted, spacing: 2 });
    text(ctx, String(side.score ?? "–"), W - 130, top + 172, { font: "400 200px Anton", color, align: "right" });
  }

  // Quart-temps.
  const n = Math.max(4, away.periods?.length || 0, home.periods?.length || 0);
  const tableTop = 920;
  const colW = Math.min(118, (W - 380) / n);
  const x0 = W - 130 - colW * n;
  text(ctx, "PAR QUART-TEMPS", 130, tableTop, { font: "600 26px Oswald", color: C.muted, spacing: 3 });
  for (let p = 0; p < n; p++) {
    const cx = x0 + colW * p + colW / 2;
    text(ctx, p < 4 ? `Q${p + 1}` : f.periodName(p + 1).toUpperCase(), cx, tableTop, { font: "600 26px Oswald", color: C.muted, align: "center" });
    text(ctx, String(away.periods?.[p] ?? "–"), cx, tableTop + 48, { font: "600 34px Barlow", color: C.ink2, align: "center" });
    text(ctx, String(home.periods?.[p] ?? "–"), cx, tableTop + 92, { font: "600 34px Barlow", color: C.ink2, align: "center" });
  }
  text(ctx, away.tri || "", 130, tableTop + 48, { font: "500 32px Oswald", color: C.ink2 });
  text(ctx, home.tri || "", 130, tableTop + 92, { font: "500 32px Oswald", color: C.ink2 });

  // Meilleur marqueur de chaque équipe.
  const teams = box.teams || {};
  const best = [
    [away, topPlayer(teams.away)],
    [home, topPlayer(teams.home)],
  ].filter(([, p]) => p);
  let y = 1100;
  ctx.fillStyle = C.line;
  ctx.fillRect(130, y - 50, W - 260, 2);
  text(ctx, "MEILLEURS MARQUEURS", 130, y, { font: "600 26px Oswald", color: C.accent, spacing: 3 });
  for (const [side, p] of best) {
    y += 52;
    const who = `${p.name || p.nameI || ""}`;
    text(ctx, side.tri || "", 130, y, { font: "500 30px Oswald", color: C.muted });
    text(ctx, who, 215, y, { font: fitFont(ctx, who, "600 {s}px Barlow", 32, 420), color: C.ink });
    text(ctx, statLine(p), W - 130, y, { font: "600 30px Barlow", color: C.ink2, align: "right" });
  }

  // Pied : source (obligatoire), mention fan, adresse du site.
  text(ctx, "Source : NBA.com  ·  Compte fan, non affilié à la NBA", 130, H - 54, { font: "400 24px Barlow", color: C.muted });
  text(ctx, location.host || "Parquet", W - 130, H - 54, { font: "600 26px Oswald", color: C.accent, align: "right", spacing: 2 });
  return canvas;
}

function fileName(game) {
  const day = game.etDate || (game.start || "").slice(0, 10) || "match";
  return `parquet-${game.away?.tri || "ext"}-${game.home?.tri || "dom"}-${day}.png`;
}

// Fenêtre d'aperçu : partager (téléphone : Instagram, WhatsApp…) ou télécharger.
export async function openShareDialog(box) {
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    if (url) URL.revokeObjectURL(url);
  };
  const onKey = (e) => e.key === "Escape" && close();
  let url = null;
  const body = h("div", { class: "share-body" }, h("p", { class: "note" }, "Création du visuel…"));
  const overlay = h(
    "div",
    { class: "share-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Partager le résultat" },
    h(
      "div",
      { class: "share-dialog" },
      h("div", { class: "share-head" }, h("strong", null, "Partager le résultat"), h("button", { class: "toast-close", type: "button", "aria-label": "Fermer", onclick: close }, "✕")),
      body
    )
  );
  overlay.addEventListener("click", (e) => e.target === overlay && close());
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);

  const canvas = await drawResultCard(box);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  url = URL.createObjectURL(blob);
  const name = fileName(box.game);
  const file = new File([blob], name, { type: "image/png" });
  const canShare = navigator.canShare?.({ files: [file] });
  const msg = h("p", { class: "note share-msg", role: "status" }, "Format Instagram (1080 × 1350). Pas de logos d'équipes ni de photos : seulement les données, avec la source.");
  const share = canShare
    ? h(
        "button",
        {
          class: "btn primary",
          type: "button",
          onclick: async () => {
            try {
              await navigator.share({ files: [file], title: "Résultat", text: `${box.game.away?.tri} ${box.game.away?.score} – ${box.game.home?.score} ${box.game.home?.tri}` });
            } catch (err) {
              if (err?.name !== "AbortError") msg.textContent = "Partage impossible : télécharge l'image, puis publie-la depuis ta galerie.";
            }
          },
        },
        "Partager"
      )
    : null;
  body.replaceChildren(
    h("img", { class: "share-preview", src: url, alt: "Aperçu du visuel du résultat", width: W, height: H }),
    h("div", { class: "share-actions" }, share, h("a", { class: `btn${share ? "" : " primary"}`, href: url, download: name }, "Télécharger")),
    msg
  );
}
