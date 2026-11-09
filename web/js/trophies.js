// Icônes des trophées, dessinées pour Parquet (aucune reproduction des vrais trophées de la
// NBA, qui lui appartiennent) : une silhouette simple et reconnaissable par récompense.
// Trait en currentColor, une touche pleine en couleur d'accent (classe « acc »).

const SVG_NS = "http://www.w3.org/2000/svg";

const GLYPHS = {
  // Champion : coupe à deux anses sur un socle.
  champion: `
    <path class="acc" d="M7.5 3.5h9v4.2a4.5 4.5 0 0 1-9 0z"/>
    <path d="M7.5 5.5H5a2.6 2.6 0 0 0 3.1 4.4M16.5 5.5H19a2.6 2.6 0 0 1-3.1 4.4M12 12.2v3.6M9 20.5h6l-.8-3.2h-4.4z"/>`,
  // MVP : étoile sur un piédestal.
  mvp: `
    <path class="acc" d="M12 2.8l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>
    <path d="M10 16.6h4l.6 2.4H9.4zM7.5 21h9"/>`,
  // MVP des Finales : ballon sur une colonne.
  fmvp: `
    <circle class="acc" cx="12" cy="7.5" r="4.6"/>
    <path d="M7.4 7.5h9.2M12 2.9v9.2M8.6 4.4c1.6 1.8 1.6 4.4 0 6.2M15.4 4.4c-1.6 1.8-1.6 4.4 0 6.2M10.2 13.2h3.6l.8 5.4H9.4zM7.5 21h9"/>`,
  // Rookie de l'année : médaille et son ruban.
  roy: `
    <path d="M8.2 2.8l2.6 6.4M15.8 2.8l-2.6 6.4M8.2 2.8h7.6"/>
    <circle class="acc" cx="12" cy="14.6" r="5.6"/>
    <path class="cut" d="M12 11.4l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z"/>`,
  // Défenseur de l'année : bouclier.
  dpoy: `
    <path class="acc" d="M12 2.8l7.2 2.9v5.2c0 4.6-3 8.3-7.2 10.3-4.2-2-7.2-5.7-7.2-10.3V5.7z"/>
    <path class="cut" d="M12 6.4v10.8M7.9 9.6h8.2"/>`,
  // Sixième homme : pastille numérotée 6.
  smoy: `
    <rect class="acc" x="4.2" y="4.2" width="15.6" height="15.6" rx="3.4"/>
    <path class="cut" d="M14.2 7.6c-2.6-.6-5 1.2-5 4.6v1.2M9.2 13.4a2.8 2.8 0 1 0 5.6 0 2.8 2.8 0 1 0-5.6 0"/>`,
  // Meilleure progression : flèche qui monte au-dessus de barres.
  mip: `
    <path d="M4 21h16M7 21v-3.5M12 21v-6M17 21v-8.5"/>
    <path class="acc-line" d="M4.5 11.5l4.6-4.6 3.2 3.2 6.2-6.2M14.6 3.6h4.2v4.2"/>`,
};

export const TROPHY_KINDS = Object.keys(GLYPHS);

export function trophyIcon(kind, size = 20) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `trophy-ico is-${kind}`);
  svg.innerHTML = GLYPHS[kind] || GLYPHS.champion; // dessins fixes, écrits ci-dessus
  return svg;
}
