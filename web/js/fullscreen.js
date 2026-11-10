// Vidéos en plein écran sur téléphone : passage automatique en paysage.
//
// Le bouton « plein écran » d'une vidéo (YouTube intégrée, extrait d'une action, mur de matchs)
// met l'élément en plein écran ; le téléphone, lui, restait en portrait avec une petite image au
// milieu. Dès qu'une vidéo passe en plein écran, l'écran est verrouillé en paysage (dans le
// sens où l'on tient le téléphone) ; à la sortie, on rend la main à la rotation habituelle.
//
// Android (Chrome, Firefox, Samsung Internet) le permet. Sur iPhone, Safari ne sait pas
// verrouiller l'orientation, mais son lecteur plein écran tourne déjà avec le téléphone.

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function holdsVideo(el) {
  if (!el) return false;
  if (el.tagName === "VIDEO" || el.tagName === "IFRAME") return true;
  return Boolean(el.querySelector?.("video, iframe"));
}

// Téléphone ou petite tablette tactile : sur un ordinateur, rien à faire.
function isHandheld() {
  const touch = window.matchMedia?.("(pointer: coarse)").matches;
  const small = Math.min(screen.width || 0, screen.height || 0) < 820;
  return Boolean(touch && small);
}

export function initVideoLandscape() {
  const orientation = screen.orientation;
  if (!orientation || typeof orientation.lock !== "function") return;
  let locked = false;
  const onChange = () => {
    const el = fullscreenElement();
    if (el && holdsVideo(el) && isHandheld()) {
      orientation
        .lock("landscape")
        .then(() => {
          locked = true;
        })
        .catch(() => {
          /* refusé (navigateur ou réglage du téléphone) : on reste comme avant */
        });
    } else if (!el && locked) {
      locked = false;
      try {
        orientation.unlock();
      } catch {
        /* rien à rendre */
      }
    }
  };
  document.addEventListener("fullscreenchange", onChange);
  document.addEventListener("webkitfullscreenchange", onChange);
}
