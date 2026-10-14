// Mise en forme à la française : nombres, dates, tailles, postes, pays.

const nf = new Map();
function numberFormat(digits) {
  if (!nf.has(digits)) {
    nf.set(digits, new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return nf.get(digits);
}

export function num(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return numberFormat(digits).format(value);
}

export function int(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return numberFormat(0).format(value);
}

export function pct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return numberFormat(digits).format(value * 100);
}

export function ratio(made, att) {
  if (att === null || att === undefined) return "–";
  return `${made ?? 0}/${att}`;
}

export function signed(value) {
  if (value === null || value === undefined) return "–";
  return value > 0 ? `+${value}` : String(value);
}

// ---------------------------------------------------------------- dates

const dtf = (opts) => new Intl.DateTimeFormat("fr-FR", opts);
const F = {
  dayLong: dtf({ weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
  dayLongYear: dtf({ weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
  dayShort: dtf({ weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
  dateShort: dtf({ day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
  dateLong: dtf({ day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
  time: dtf({ hour: "2-digit", minute: "2-digit" }),
  weekdayLocal: dtf({ weekday: "short" }),
  dayShortLocal: dtf({ weekday: "short", day: "numeric", month: "short" }),
};

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Une date « calendrier » (AAAA-MM-JJ) sans décalage de fuseau.
function calendar(iso) {
  return new Date(`${iso}T12:00:00Z`);
}

export function dayTitle(iso) {
  if (!iso) return "";
  const thisYear = new Date().getFullYear();
  const d = calendar(iso);
  return capitalize((d.getUTCFullYear() === thisYear ? F.dayLong : F.dayLongYear).format(d));
}

export function dayShort(iso) {
  return iso ? F.dayShort.format(calendar(iso)) : "";
}

export function dateShort(iso) {
  return iso ? F.dateShort.format(calendar(iso.slice(0, 10))) : "";
}

export function dateLong(iso) {
  return iso ? F.dateLong.format(calendar(iso.slice(0, 10))) : "";
}

export function localTime(isoUtc) {
  if (!isoUtc) return "";
  const d = new Date(isoUtc);
  return Number.isNaN(d.getTime()) ? "" : F.time.format(d).replace(":", " h ");
}

export function clockTime(isoUtc) {
  if (!isoUtc) return "";
  const d = new Date(isoUtc);
  return Number.isNaN(d.getTime()) ? "" : F.time.format(d);
}

export function localDayShort(isoUtc) {
  if (!isoUtc) return "";
  const d = new Date(isoUtc);
  return Number.isNaN(d.getTime()) ? "" : F.dayShortLocal.format(d);
}

export function localWeekday(isoUtc) {
  if (!isoUtc) return "";
  return F.weekdayLocal.format(new Date(isoUtc));
}

export function sameLocalDay(isoUtc, etDate) {
  if (!isoUtc) return true;
  const d = new Date(isoUtc);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return local === etDate;
}

export function updatedAt(epochSeconds) {
  if (!epochSeconds) return "";
  return F.time.format(new Date(epochSeconds * 1000));
}

export function age(birthIso, at = new Date()) {
  if (!birthIso) return null;
  const b = new Date(`${birthIso.slice(0, 10)}T12:00:00Z`);
  let years = at.getUTCFullYear() - b.getUTCFullYear();
  const m = at.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < b.getUTCDate())) years -= 1;
  return years;
}

export function shiftDay(iso, delta) {
  const d = calendar(iso);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------- mesures et postes

export function heightM(value) {
  const m = /^(\d+)-(\d+)$/.exec(String(value || "").trim());
  if (!m) return "–";
  const cm = (Number(m[1]) * 12 + Number(m[2])) * 2.54;
  return `${num(cm / 100, 2)} m`;
}

export function weightKg(value) {
  const lbs = Number(value);
  if (!lbs) return "–";
  return `${Math.round(lbs * 0.453592)} kg`;
}

const POSITIONS = {
  G: "Arrière",
  F: "Ailier",
  C: "Pivot",
  "G-F": "Arrière-ailier",
  "F-G": "Ailier-arrière",
  "F-C": "Ailier-pivot",
  "C-F": "Pivot-ailier",
  PG: "Meneur",
  SG: "Arrière",
  SF: "Ailier",
  PF: "Ailier fort",
  Guard: "Arrière",
  Forward: "Ailier",
  Center: "Pivot",
  "Guard-Forward": "Arrière-ailier",
  "Forward-Guard": "Ailier-arrière",
  "Forward-Center": "Ailier-pivot",
  "Center-Forward": "Pivot-ailier",
};

export function position(value) {
  if (!value) return "";
  return POSITIONS[value] || value;
}

const COUNTRIES = {
  USA: "États-Unis", France: "France", Canada: "Canada", Serbia: "Serbie", Greece: "Grèce", Slovenia: "Slovénie",
  Germany: "Allemagne", Spain: "Espagne", Australia: "Australie", Cameroon: "Cameroun", Nigeria: "Nigeria",
  Turkey: "Turquie", Türkiye: "Turquie", Lithuania: "Lituanie", Croatia: "Croatie", Latvia: "Lettonie", Italy: "Italie",
  Japan: "Japon", China: "Chine", Bahamas: "Bahamas", "Dominican Republic": "République dominicaine",
  Argentina: "Argentine", Brazil: "Brésil", Montenegro: "Monténégro", "Bosnia and Herzegovina": "Bosnie-Herzégovine",
  Senegal: "Sénégal", "DRC": "RD Congo", "Democratic Republic of the Congo": "RD Congo", Congo: "Congo",
  Switzerland: "Suisse", Israel: "Israël", Georgia: "Géorgie", Ukraine: "Ukraine", Russia: "Russie",
  Finland: "Finlande", Sweden: "Suède", Denmark: "Danemark", Netherlands: "Pays-Bas", Belgium: "Belgique",
  Austria: "Autriche", "Czech Republic": "Tchéquie", Czechia: "Tchéquie", Poland: "Pologne",
  "United Kingdom": "Royaume-Uni", "Great Britain": "Royaume-Uni", England: "Angleterre", Scotland: "Écosse",
  "New Zealand": "Nouvelle-Zélande", "South Sudan": "Soudan du Sud", Sudan: "Soudan", Mali: "Mali",
  Guinea: "Guinée", "Puerto Rico": "Porto Rico", Jamaica: "Jamaïque", Haiti: "Haïti", Mexico: "Mexique",
  Venezuela: "Venezuela", Portugal: "Portugal", Egypt: "Égypte", Angola: "Angola", Gabon: "Gabon",
  "Cote d'Ivoire": "Côte d'Ivoire", "Ivory Coast": "Côte d'Ivoire", Lebanon: "Liban", Iran: "Iran",
  Philippines: "Philippines", "South Korea": "Corée du Sud", Taiwan: "Taïwan", "Bosnia": "Bosnie-Herzégovine",
  Macedonia: "Macédoine du Nord", "North Macedonia": "Macédoine du Nord", Hungary: "Hongrie", Romania: "Roumanie",
  Bulgaria: "Bulgarie", Belarus: "Biélorussie", Estonia: "Estonie", Iceland: "Islande", Norway: "Norvège",
  Ireland: "Irlande", Panama: "Panama", Colombia: "Colombie", Uruguay: "Uruguay", Chile: "Chili",
  "Trinidad and Tobago": "Trinité-et-Tobago", "U.S. Virgin Islands": "Îles Vierges américaines",
  "Saint Lucia": "Sainte-Lucie", Ghana: "Ghana", Tanzania: "Tanzanie", "Cape Verde": "Cap-Vert",
  Cabo_Verde: "Cap-Vert", "Republic of the Congo": "Congo", Tunisia: "Tunisie", Morocco: "Maroc",
  Algeria: "Algérie", Ethiopia: "Éthiopie", Kenya: "Kenya", Uganda: "Ouganda", Somalia: "Somalie",
  Jordan: "Jordanie", Qatar: "Qatar", India: "Inde", Indonesia: "Indonésie",
};

export function country(value) {
  if (!value) return "";
  return COUNTRIES[value] || value;
}

// ------------------------------------------------------------- matchs

const LABELS = {
  Preseason: "Présaison",
  "Emirates NBA Cup": "NBA Cup",
  "NBA Cup": "NBA Cup",
  "NBA Paris Game": "Match à Paris",
  "NBA Mexico City Game": "Match à Mexico",
  "NBA Manchester Game": "Match à Manchester",
  "NBA London Game": "Match à Londres",
  "NBA Berlin Game": "Match à Berlin",
  "AWS NBA Rivals Week": "Semaine des rivalités",
  "NBA Pioneers Classic": "Pioneers Classic",
  "SoFi Play-In Tournament": "Play-in",
  "Play-In Tournament": "Play-in",
  "NBA Finals": "Finales NBA",
  "East First Round": "Playoffs, 1er tour",
  "West First Round": "Playoffs, 1er tour",
  "East Conf. Semifinals": "Demi-finale de conférence",
  "West Conf. Semifinals": "Demi-finale de conférence",
  "East Conf. Finals": "Finale de conférence",
  "West Conf. Finals": "Finale de conférence",
};

export function gameLabel(game) {
  const raw = (game?.label || "").trim();
  if (raw && LABELS[raw]) return LABELS[raw];
  if (raw) return raw;
  return { pre: "Présaison", playoffs: "Playoffs", playin: "Play-in", cup: "NBA Cup", allstar: "All-Star Game" }[game?.kind] || "";
}

export function periodName(period, short = true) {
  if (!period) return "";
  if (period <= 4) return short ? `Q${period}` : `${period}${period === 1 ? "er" : "e"} quart-temps`;
  const n = period - 4;
  if (short) return n === 1 ? "Prol." : `Prol. ${n}`;
  return n === 1 ? "Prolongation" : `${n}e prolongation`;
}

export function gameStatus(game) {
  if (!game) return { text: "", live: false };
  const raw = (game.statusText || "").toLowerCase();
  if (game.postponed) return { text: "Reporté", live: false };
  if (game.status === 3) {
    return { text: (game.period || 4) > 4 ? `Terminé après ${periodName(game.period, false).toLowerCase()}` : "Terminé", live: false };
  }
  if (game.status === 2) {
    if (raw.includes("half")) return { text: "Mi-temps", live: true };
    if (raw.startsWith("end") || (game.clock === "0.0" && game.period)) {
      return { text: `Fin du ${periodName(game.period)}`, live: true };
    }
    const clock = game.clock && game.clock !== "0.0" ? ` ${game.clock}` : "";
    return { text: `${periodName(game.period)}${clock}`, live: true };
  }
  if (raw.includes("tbd")) return { text: "Horaire à confirmer", live: false };
  return { text: game.start ? `${clockTime(game.start)}` : "À venir", live: false };
}

export function gameProgress(game) {
  // Fraction écoulée de chaque période (4 quarts-temps + éventuelles prolongations).
  const periods = Math.max(4, game.period || 0);
  const out = [];
  const clockSeconds = (() => {
    const c = game.clock || "";
    if (c.includes(":")) {
      const [m, sec] = c.split(":");
      return Number(m) * 60 + Number(sec);
    }
    return c ? Number(c) : null;
  })();
  for (let p = 1; p <= periods; p++) {
    const length = p <= 4 ? 720 : 300;
    let filled = 0;
    if (game.status === 3 || p < game.period) filled = 1;
    else if (p === game.period) filled = clockSeconds === null ? 0.02 : Math.min(1, Math.max(0, 1 - clockSeconds / length));
    out.push({ ot: p > 4, filled });
  }
  return out;
}

export function plural(n, one, many) {
  return `${int(n)} ${n > 1 ? many : one}`;
}
