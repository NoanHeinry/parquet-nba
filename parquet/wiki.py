"""Biographies et histoires de franchises tirées de Wikipédia (texte sous licence CC BY-SA).

Pour retrouver le bon article d'un joueur sans ambiguïté, on passe par Wikidata :
la propriété P3647 y contient l'identifiant NBA.com du joueur.
"""

from __future__ import annotations

import re
from urllib.parse import quote

from .net import SourceError, wiki_json

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
MAX_CHARS = 3200


def _api(lang: str) -> str:
    return f"https://{lang}.wikipedia.org/w/api.php"


def _clean(text: str) -> list[str]:
    text = re.sub(r"\(\s*[;,]?\s*\)", "", text)  # parenthèses vidées par l'extraction (prononciation…)
    text = re.sub(r"\(\s*;\s*", "(", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r" ([,.])", r"\1", text)
    paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
    out, total = [], 0
    for p in paragraphs:
        if total and total + len(p) > MAX_CHARS:
            break
        out.append(p)
        total += len(p)
    return out


def _extract(lang: str, title: str) -> dict | None:
    data = wiki_json(
        _api(lang),
        {
            "action": "query",
            "prop": "extracts",
            "exintro": 1,
            "explaintext": 1,
            "redirects": 1,
            "titles": title,
            "format": "json",
            "formatversion": 2,
        },
    )
    pages = ((data or {}).get("query") or {}).get("pages") or []
    if not pages or pages[0].get("missing"):
        return None
    page = pages[0]
    paragraphs = _clean(page.get("extract") or "")
    if not paragraphs:
        return None
    real_title = page.get("title") or title
    return {
        "lang": lang,
        "title": real_title,
        "url": f"https://{lang}.wikipedia.org/wiki/{quote(real_title.replace(' ', '_'))}",
        "paragraphs": paragraphs,
    }


def _wikidata_titles(nba_id: int) -> dict[str, str]:
    found = wiki_json(
        WIKIDATA_API,
        {"action": "query", "list": "search", "srsearch": f"haswbstatement:P3647={nba_id}", "format": "json"},
    )
    hits = ((found or {}).get("query") or {}).get("search") or []
    if not hits:
        return {}
    qid = hits[0].get("title")
    entity = wiki_json(
        WIKIDATA_API,
        {"action": "wbgetentities", "ids": qid, "props": "sitelinks", "sitefilter": "frwiki|enwiki", "format": "json"},
    )
    links = (((entity or {}).get("entities") or {}).get(qid) or {}).get("sitelinks") or {}
    return {key[:2]: value.get("title") for key, value in links.items() if value.get("title")}


def _search_fr(name: str) -> str | None:
    data = wiki_json(
        _api("fr"),
        {"action": "query", "list": "search", "srsearch": f"{name} basket-ball", "srlimit": 5, "format": "json"},
    )
    for hit in ((data or {}).get("query") or {}).get("search") or []:
        snippet = re.sub(r"<[^>]+>", "", hit.get("snippet") or "").lower()
        title = hit.get("title") or ""
        if "basket" in snippet and name.split()[-1].lower() in title.lower():
            return title
    return None


def player_extract(nba_id: int, name: str) -> dict | None:
    titles: dict[str, str] = {}
    try:
        titles = _wikidata_titles(nba_id)
    except SourceError:
        titles = {}
    for lang in ("fr", "en"):
        if titles.get(lang):
            result = _extract(lang, titles[lang])
            if result:
                return result
    if name:
        title = _search_fr(name)
        if title:
            return _extract("fr", title)
    return None


def team_extract(title_fr: str) -> dict | None:
    return _extract("fr", title_fr)
