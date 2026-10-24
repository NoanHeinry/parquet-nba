import { s } from "./dom.js";

export function iconScale(size = 20) {
  return s(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      class: "svg-icon icon-scale",
    },
    s("line", { x1: "12", y1: "3", x2: "12", y2: "21" }),
    s("polyline", { points: "4 7 12 5 20 7" }),
    s("path", { d: "M4 7l-2 5h4l-2-5z" }),
    s("path", { d: "M20 7l-2 5h4l-2-5z" }),
    s("path", { d: "M9 21h6" })
  );
}

export function iconTrophy(size = 20) {
  return s(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      class: "svg-icon icon-trophy",
    },
    s("path", { d: "M6 9H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2" }),
    s("path", { d: "M18 9h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2" }),
    s("path", { d: "M4 3h16v6a8 8 0 0 1-16 0V3z" }),
    s("path", { d: "M12 17v4" }),
    s("path", { d: "M8 21h8" })
  );
}

export function iconEye(size = 16) {
  return s(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      class: "svg-icon icon-eye",
    },
    s("path", { d: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" }),
    s("circle", { cx: "12", cy: "12", r: "3" })
  );
}

export function iconStar(filled = true, size = 14) {
  return s(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: filled ? "currentColor" : "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      class: "svg-icon icon-star",
    },
    s("polygon", {
      points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2",
    })
  );
}

export function iconBasketball(size = 20) {
  return s(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      class: "svg-icon icon-basketball",
    },
    s("circle", { cx: "12", cy: "12", r: "10" }),
    s("line", { x1: "2", y1: "12", x2: "22", y2: "12" }),
    s("line", { x1: "12", y1: "2", x2: "12", y2: "22" }),
    s("path", { d: "M4.93 4.93a10 10 0 0 1 14.14 0" }),
    s("path", { d: "M4.93 19.07a10 10 0 0 0 14.14 0" })
  );
}

export function iconLightning(size = 20) {
  return s(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "currentColor",
      stroke: "currentColor",
      "stroke-width": "1",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      class: "svg-icon icon-lightning",
    },
    s("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" })
  );
}

export function iconFlag(size = 20) {
  return s(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      class: "svg-icon icon-flag",
    },
    s("path", { d: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" }),
    s("line", { x1: "4", y1: "22", x2: "4", y2: "15" })
  );
}

export function iconAlertCircle(size = 16) {
  return s(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      class: "svg-icon icon-alert",
    },
    s("circle", { cx: "12", cy: "12", r: "10" }),
    s("line", { x1: "12", y1: "8", x2: "12", y2: "12" }),
    s("line", { x1: "12", y1: "16", x2: "12.01", y2: "16" })
  );
}

export function iconInfo(size = 16) {
  return s(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      class: "svg-icon icon-info",
    },
    s("circle", { cx: "12", cy: "12", r: "10" }),
    s("line", { x1: "12", y1: "16", x2: "12", y2: "12" }),
    s("line", { x1: "12", y1: "8", x2: "12.01", y2: "8" })
  );
}
