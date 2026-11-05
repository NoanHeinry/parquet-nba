// Vidéos : lecteur YouTube léger, extraits des moments décisifs, résumé officiel sur NBA.com.

import { h, s } from "./dom.js";
import { headshot } from "./components.js";

function playIcon() {
  return s(
    "svg",
    { viewBox: "0 0 68 48", "aria-hidden": "true" },
    s("path", { d: "M66.5 7.7A8.5 8.5 0 0 0 60.5 1.7C55.2.3 34 .3 34 .3s-21.2 0-26.5 1.4A8.5 8.5 0 0 0 1.5 7.7C.1 13 .1 24 .1 24s0 11 1.4 16.3a8.5 8.5 0 0 0 6 6C12.8 47.7 34 47.7 34 47.7s21.2 0 26.5-1.4a8.5 8.5 0 0 0 6-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3z", fill: "#e33" }),
    s("path", { d: "M45 24 27 14v20z", fill: "#fff" })
  );
}

// Lecteur YouTube « léger » : une image et un bouton, le vrai lecteur ne se charge qu'au clic
// (rien n'est envoyé à YouTube tant qu'on ne lance pas la vidéo).
export function youtubePlayer({ videoId, title, url, embeddable = true }) {
  const thumb = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  const link = url || `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  if (!embeddable) {
    return h(
      "a",
      { class: "yt-lite", href: link, target: "_blank", rel: "noopener", "aria-label": `Regarder « ${title} » sur YouTube` },
      h("img", { src: thumb, alt: "", loading: "lazy" }),
      h("span", { class: "yt-play" }, playIcon()),
      h("span", { class: "yt-note" }, "Lecture sur YouTube")
    );
  }
  const btn = h(
    "button",
    { type: "button", class: "yt-lite", "aria-label": `Lire la vidéo « ${title} »` },
    h("img", { src: thumb, alt: "", loading: "lazy" }),
    h("span", { class: "yt-play" }, playIcon())
  );
  btn.addEventListener("click", () => {
    const frame = h("iframe", {
      class: "yt-frame",
      src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`,
      title,
      allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
      allowfullscreen: "",
      referrerpolicy: "strict-origin-when-cross-origin",
    });
    btn.replaceWith(frame);
  });
  return btn;
}

export function youtubeBlock(video) {
  return h(
    "figure",
    { class: "yt-block" },
    youtubePlayer(video),
    h(
      "figcaption",
      null,
      h("span", null, video.title),
      h("a", { class: "link", href: video.url, target: "_blank", rel: "noopener" }, "Ouvrir sur YouTube")
    )
  );
}

// Extrait d'un moment décisif : une vidéo de quelques secondes servie par NBA.com.
export function momentCard(m) {
  const media = m.video
    ? h("video", { class: "moment-video", src: m.video, poster: m.poster || null, controls: "", preload: "none", playsinline: "" })
    : h("div", { class: "moment-video empty" }, m.playerId ? headshot(m.playerId, { alt: "" }) : null, h("span", null, "Vidéo indisponible"));
  return h(
    "article",
    { class: "moment" },
    media,
    h(
      "div",
      { class: "moment-body" },
      h("span", { class: "moment-k" }, `${m.rank ? `#${m.rank} · ` : ""}${m.category || "Moment clé"}${m.seconds ? ` · ${m.seconds} s` : ""}`),
      h("strong", { lang: "en" }, m.title),
      m.summary ? h("p", { lang: "en" }, m.summary) : null
    )
  );
}

export function nbaRecapCard(recap) {
  return h(
    "a",
    { class: "nba-recap", href: recap.url, target: "_blank", rel: "noopener" },
    recap.image ? h("img", { src: recap.image, alt: "", loading: "lazy" }) : h("span", { class: "nba-recap-ph" }, playIcon()),
    h(
      "span",
      { class: "nba-recap-body" },
      h("span", { class: "k" }, `Résumé officiel${recap.duration ? ` · ${recap.duration}` : ""}`),
      h("strong", { lang: "en" }, recap.title),
      recap.excerpt ? h("span", { class: "s", lang: "en" }, recap.excerpt) : null,
      h("span", { class: "go" }, "Regarder sur NBA.com ↗")
    )
  );
}
