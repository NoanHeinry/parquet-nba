// Création d'éléments sans innerHTML : les textes venant des données sont toujours
// insérés comme du texte, jamais comme du HTML.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  setProps(el, props);
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  setProps(el, props, true);
  append(el, children);
  return el;
}

function setProps(el, props, isSvg = false) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") {
      if (isSvg) el.setAttribute("class", value);
      else el.className = value;
    } else if (key === "style" && typeof value === "object") {
      for (const [prop, v] of Object.entries(value)) {
        if (v === null || v === undefined) continue;
        if (prop.startsWith("--")) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    } else if (key === "dataset") {
      Object.assign(el.dataset, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "text") {
      el.textContent = value;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}
