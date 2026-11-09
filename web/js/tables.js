// Tableaux lisibles partout.
//
// - Écran trop étroit (téléphone, fenêtre réduite) : les colonnes les moins importantes sont
//   masquées jusqu'à ce que le tableau tienne en largeur ; un bouton les fait toutes revenir
//   (choix retenu pour tous les tableaux).
// - Tableau qui tient en largeur : la ligne d'en-tête reste visible en haut de l'écran quand on
//   descend dans la page.
// - Tableau plus large que l'écran (toutes les colonnes demandées) : défilement de côté, la
//   colonne du nom reste épinglée à gauche ; s'il est long, il défile dans son propre cadre pour
//   garder l'en-tête visible.
//
// Importance d'une colonne : attribut data-prio de son en-tête (0 = toujours visible, 1 =
// essentielle, 2 = utile, 3 = détail). Sans attribut : la première colonne et la colonne du nom
// sont toujours visibles, les autres sont masquées de la droite vers la gauche.

import { h } from "./dom.js";

const KEY = "parquet-colonnes";
const LONG = 12; // au-delà, un tableau plus large que l'écran défile dans son propre cadre

function allColumns() {
  try {
    return localStorage.getItem(KEY) === "toutes";
  } catch {
    return false;
  }
}

function setAllColumns(on) {
  try {
    if (on) localStorage.setItem(KEY, "toutes");
    else localStorage.removeItem(KEY);
  } catch {
    /* le choix vaudra pour cette page seulement */
  }
  for (const wrap of document.querySelectorAll(".table-wrap[data-enhanced]")) layout(wrap, true);
}

function headCells(table) {
  return table.tHead?.rows[0] ? [...table.tHead.rows[0].cells] : [];
}

// Classes des cellules : colonnes masquées (c-off) et colonne du nom (c-key).
function applyCells(st) {
  const n = st.heads.length;
  for (const row of st.table.rows) {
    if (row.cells.length !== n) continue; // lignes de groupe sur toute la largeur
    for (let i = 0; i < n; i++) {
      const cell = row.cells[i];
      cell.classList.toggle("c-off", st.hidden.has(i));
      cell.classList.toggle("c-key", i === st.key);
    }
  }
}

function priorities(st) {
  return st.heads.map((th, i) => {
    if (th.dataset.prio !== undefined) return Number(th.dataset.prio);
    return i === 0 || i === st.key ? 0 : 2;
  });
}

function layout(wrap, force = false) {
  const st = wrap._tbl;
  if (!st || !wrap.isConnected) return;
  const width = wrap.clientWidth;
  if (!width) return; // tableau caché
  if (!force && width === st.width) {
    // Même largeur : on ne refait le calcul que si le contenu a changé de taille.
    const over = st.table.offsetWidth > width + 1;
    if (over === st.over) return;
  }
  st.width = width;
  const { table, bar, btn } = st;
  st.hidden = new Set();
  applyCells(st);
  let over = table.offsetWidth - width;
  if (over > 1 && st.compact && !allColumns()) {
    const prio = priorities(st);
    const order = st.heads
      .map((th, i) => ({ i, prio: prio[i], w: th.offsetWidth }))
      .filter((c) => c.prio > 0)
      .sort((a, b) => b.prio - a.prio || b.i - a.i);
    let k = 0;
    while (over > 1 && k < order.length) {
      // On masque d'un coup ce qui devrait suffire, puis on vérifie.
      let gain = 0;
      while (k < order.length && gain < over) {
        st.hidden.add(order[k].i);
        gain += order[k].w;
        k++;
      }
      applyCells(st);
      over = table.offsetWidth - width;
    }
  }
  st.over = over > 1;
  const rows = table.tBodies[0]?.rows.length || 0;
  wrap.classList.toggle("is-compact", st.hidden.size > 0);
  wrap.classList.toggle("is-overflow", st.over);
  wrap.classList.toggle("is-scroll", st.over && rows > LONG);
  const hidden = st.hidden.size;
  bar.hidden = !(hidden || (st.compact && st.over && allColumns()));
  btn.textContent = hidden ? `Afficher ${hidden === 1 ? "l'autre colonne" : `les ${hidden} autres colonnes`}` : "Revenir aux colonnes essentielles";
  btn.setAttribute("aria-expanded", hidden ? "false" : "true");
}

// Rend un tableau (dans son .table-wrap) lisible ; à appeler une fois, à la création.
export function enhanceTable(wrap, { compact = true } = {}) {
  const table = wrap?.querySelector("table");
  if (!table || wrap._tbl) return wrap;
  wrap.dataset.enhanced = "1";
  const heads = headCells(table);
  let key = heads.findIndex((th) => th.classList.contains("sticky"));
  if (key < 0) key = heads.findIndex((th) => th.classList.contains("l"));
  if (key < 0) key = 0;
  const btn = h("button", { type: "button", class: "tbl-toggle" });
  const bar = h("div", { class: "tbl-bar", hidden: true }, btn);
  btn.addEventListener("click", () => setAllColumns(!allColumns()));
  wrap.prepend(bar);
  if ((table.tBodies[0]?.rows.length || 0) > 6) table.classList.add("is-striped");
  const st = { table, heads, key, bar, btn, compact, hidden: new Set(), width: -1, over: false };
  wrap._tbl = st;
  applyCells(st);
  if ("ResizeObserver" in window) {
    // Un observateur par tableau : il disparaît avec lui quand la page change.
    const ro = new ResizeObserver(() => layout(wrap));
    ro.observe(wrap);
    ro.observe(table);
  }
  return wrap;
}

// Après un nouveau tri (lignes recréées) : mêmes colonnes masquées, sans tout recalculer.
export function refreshTable(wrap) {
  const st = wrap?._tbl;
  if (st) applyCells(st);
}
