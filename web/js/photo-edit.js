// « Changer la photo » d'un joueur : l'image choisie est réduite dans le navigateur (1200 pixels
// au plus), envoyée au serveur Parquet et remplace la photo officielle partout dans l'appli.

import { h } from "./dom.js";
import { hasCustomPhoto, setCustomPhotos } from "./teams.js";
import { showToast } from "./notifications.js";

const MAX_SIDE = 1200;

async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = (type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));
  // WebP si le navigateur sait le produire, sinon JPEG.
  const webp = await blob("image/webp", 0.88);
  return webp && webp.type === "image/webp" ? webp : blob("image/jpeg", 0.88);
}

async function send(path, body) {
  const res = await fetch(path, { method: "POST", headers: body ? { "Content-Type": body.type } : {}, body: body || null });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
  setCustomPhotos(json.data?.photos);
}

// Relance l'affichage de la page en cours pour montrer la nouvelle photo.
const refresh = () => window.dispatchEvent(new HashChangeEvent("hashchange"));

export function photoButtons(playerId) {
  const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: true });
  const change = h("button", { type: "button", class: "btn photo-btn" }, hasCustomPhoto(playerId) ? "Changer la photo" : "Choisir une photo");
  change.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    change.disabled = true;
    change.textContent = "Envoi…";
    try {
      await send(`/api/photos/${playerId}`, await shrink(file));
      showToast({ title: "Photo enregistrée", body: "Elle remplace la photo officielle partout dans Parquet." });
      refresh();
    } catch (err) {
      showToast({ title: "Photo non enregistrée", body: err.message || "Image illisible." });
      change.disabled = false;
      change.textContent = hasCustomPhoto(playerId) ? "Changer la photo" : "Choisir une photo";
    }
  });
  const out = [change, input];
  if (hasCustomPhoto(playerId)) {
    const reset = h("button", { type: "button", class: "btn photo-reset-btn" }, "Photo d'origine");
    reset.addEventListener("click", async () => {
      reset.disabled = true;
      try {
        await send(`/api/photos/${playerId}/supprimer`);
        refresh();
      } catch (err) {
        showToast({ title: "Impossible", body: err.message });
        reset.disabled = false;
      }
    });
    out.push(reset);
  }
  return out;
}
