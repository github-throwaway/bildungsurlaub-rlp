# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "requests",
#     "beautifulsoup4",
# ]
# ///
"""Scraper für die AWV-RLP Bildungsurlaub-Suche.

Holt alle anerkannten Bildungsveranstaltungen (Rheinland-Pfalz, andere
Bundesländer, Ausland), geocodiert die Veranstaltungsorte über Nominatim
und schreibt das Ergebnis nach docs/data/events.json.

Ausführen mit:  uv run scraper/scrape.py
"""

import json
import re
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://awv.rlp.de/suche/"
REGIONS = {
    "601": "rlp",
    "602": "bundesland",
    "603": "ausland",
}
USER_AGENT = "bildungsurlaub-rlp-frontend/1.0 (privates Open-Data-Projekt)"

ROOT = Path(__file__).resolve().parent.parent
GEOCACHE_PATH = Path(__file__).resolve().parent / "geocache.json"
OUTPUT_PATH = ROOT / "docs" / "data" / "events.json"

DATE_RE = re.compile(r"(\d{2})\.(\d{2})\.(\d{4})")

# Reine Online-Veranstaltungen haben keinen geocodierbaren Ort
NON_PLACES = {"online", "live-online", "webinar", "digital"}

# Quell-Ländernamen -> ISO-3166-1-alpha-2. Die Geokodierung wird damit
# aufs Land beschränkt (countrycodes), sonst landet z. B. das fehlerhaft
# erfasste "Koppenhagen, Dänemark" beim gleichnamigen Weiler in Hessen.
LAND_TO_CC = {
    "Deutschland": "de", "Spanien": "es", "Italien": "it", "Frankreich": "fr",
    "U.K.": "gb", "Polen": "pl", "Österreich": "at", "Ireland": "ie",
    "Malta": "mt", "Niederlande": "nl", "Portugal": "pt", "U.S.A.": "us",
    "South Africa": "za", "Griechenland": "gr", "Canada": "ca", "Schweden": "se",
    "Costa Rica": "cr", "Schweiz": "ch", "Mexico": "mx", "Norwegen": "no",
    "Kolumbien": "co", "Tschech.Republik": "cz", "Japan": "jp", "Belgien": "be",
    "Thailand": "th", "Jordanien": "jo", "Australien": "au", "Marokko": "ma",
    "VR China": "cn", "Sri Lanka": "lk", "Albanien": "al", "Dänemark": "dk",
    "Türkei": "tr", "Panama": "pa", "Peru": "pe", "Kroatien": "hr",
    "Ecuador": "ec", "Indonesien": "id", "Litauen": "lt", "Guatemala": "gt",
    "Brasilien": "br", "Ukraine": "ua", "Estland": "ee", "Vietnam": "vn",
    "Ägypten": "eg", "Indien": "in", "Guadeloupe": "gp", "Zypern": "cy",
    "Georgien": "ge", "Cuba": "cu", "Argentinien": "ar", "Tanzania": "tz",
    "Lettland": "lv", "Russland": "ru", "Südkorea": "kr", "Oman": "om",
    "Island": "is", "Ungarn": "hu", "Bulgarien": "bg", "Luxembourg": "lu",
    "New Zealand": "nz", "Verein.Arab.Emirate": "ae", "Bhutan": "bt",
    "Rumänien": "ro", "Chile": "cl", "Uruguay": "uy", "Dominikan.Republik": "do",
    "Barbados": "bb", "Namibia": "na", "Uganda": "ug", "Armenien": "am",
    "Aserbaidschan": "az", "Libanon": "lb", "Bosnien-Herzegowina": "ba",
    "Cabo Verde": "cv", "Kenia": "ke", "Singapore": "sg", "Nicaragua": "ni",
    "Nepal": "np", "Ruanda": "rw", "El Salvador": "sv",
}

# Offizielle Unterkategorien aus dem id_stichwort-Dropdown der Suchmaske.
# Pro Kategorie eine eigene Suchanfrage -> Events werden damit getaggt.
GROUPS = {
    "bw": "Berufliche Weiterbildung",
    "gp": "Gesellschaftspolitische Weiterbildung",
    "ea": "Ehrenamtliche Tätigkeiten",
}
CATEGORIES = {
    "12": ("bw", "Gewerblich-technischer Bereich / Handwerk"),
    "13": ("bw", "Kaufmännisch-betriebswirtschaftlicher Bereich"),
    "49": ("bw", "Recht / Steuern"),
    "14": ("bw", "Erziehung / Soziales / Pädagogik"),
    "15": ("bw", "Medizin / Pflege"),
    "48": ("bw", "Gesundheit / Gesundheitsvorsorge"),
    "16": ("bw", "Mathematisch-naturwissenschaftlicher Bereich"),
    "17": ("bw", "IT / Digitalisierung"),
    "50": ("bw", "Umwelt / Ökologie"),
    "18": ("bw", "Deutsch als Fremdsprache / Integration"),
    "51": ("bw", "Ausbildereignung / Fachhochschulreife"),
    "24": ("bw", "Schlüsselqualifikationen"),
    "25": ("bw", "Sonstiges (beruflich)"),
    "19": ("bw", "Fremdsprache Englisch"),
    "20": ("bw", "Fremdsprache Französisch"),
    "21": ("bw", "Fremdsprache Italienisch"),
    "22": ("bw", "Fremdsprache Spanisch"),
    "23": ("bw", "Sonstige Fremdsprachen"),
    "26": ("gp", "Deutschland"),
    "27": ("gp", "Europa"),
    "31": ("gp", "Regionales"),
    "30": ("gp", "Internationales"),
    "52": ("gp", "Digitalisierung (gesellschaftlich)"),
    "33": ("gp", "Wirtschaft"),
    "34": ("gp", "Soziales / Gesundheit / Pflege"),
    "35": ("gp", "Arbeitswelt"),
    "36": ("gp", "Umwelt"),
    "37": ("gp", "Bildung / Kultur"),
    "38": ("gp", "Gesellschaft"),
    "39": ("gp", "Recht / Gleichstellung"),
    "47": ("gp", "Geschichte"),
    "28": ("gp", "Dritte Welt / Eine Welt"),
    "41": ("gp", "Migration / Integration"),
    "46": ("gp", "Sonstiges (gesellschaftspolitisch)"),
    "53": ("ea", "Betreuung hilfebedürftiger Menschen"),
    "54": ("ea", "Arbeit mit Kindern, Jugendlichen, Senioren"),
    "55": ("ea", "Mitgestaltung des Sozialraums"),
    "56": ("ea", "Heimatpflege / allgemeine Weiterbildung"),
    "57": ("ea", "Sport (insb. Übungsleiter)"),
    "58": ("ea", "Tier-, Natur- und Umweltschutz"),
    "59": ("ea", "Kirchen / Weltanschauungsgemeinschaften"),
    "60": ("ea", "Vereinsmanagement"),
    "61": ("ea", "Öffentliche Ehrenämter"),
}


def fetch_search(land_id: str = "", id_stichwort: str = "") -> str:
    params = {
        "id_stichwort": id_stichwort,
        "date": "",
        "organizer": "",
        "topic": "",
        "land_id": land_id,
        "ort": "",
        "veranstaltungsdauer": "",
        "akz": "",
        "submit": "1",
    }
    resp = requests.get(
        BASE_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=120
    )
    resp.raise_for_status()
    return resp.text


def event_key(e: dict) -> tuple:
    return (e["kz"], e["start"], e["ort"], e["title"])


def iso_date(match: re.Match) -> str:
    d, m, y = match.groups()
    return f"{y}-{m}-{d}"


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def parse_termin(text: str) -> dict:
    """'08.09.2025 bis 12.09.2025 (Achtung! Typenanerkennung ... bis 07.09.2027)'"""
    dates = list(DATE_RE.finditer(text))
    result = {"start": None, "end": None, "typ_bis": None}
    if dates:
        result["start"] = iso_date(dates[0])
    if len(dates) > 1:
        result["end"] = iso_date(dates[1])
    if "Typenanerkennung" in text and len(dates) > 2:
        result["typ_bis"] = iso_date(dates[-1])
    # Quelldaten-Tippfehler (Ende vor Start, Jahrhundert-Dreher wie "2109"):
    # Enddatum verwerfen, Frontend fällt dann aufs Startdatum zurück
    if result["start"] and result["end"]:
        if result["end"] < result["start"] or int(result["end"][:4]) > int(result["start"][:4]) + 6:
            result["end"] = None
    return result


def parse_organizer(row) -> dict:
    cols = row.select("div.columns")
    # cols[0] = Label "Veranstalter:", cols[1] = Name/Adresse, cols[2] = Kontakt
    org = {"name": "", "address": "", "tel": "", "web": "", "mail": ""}
    if len(cols) > 1:
        # Quelle trennt Name und Adresse durch ein doppeltes <br>; der Name selbst
        # kann über mehrere Quellzeilen umgebrochen sein. <br> in echte Umbrüche
        # wandeln und am ersten Leerzeilen-Block (Name | Adresse) auftrennen.
        for br in cols[1].find_all("br"):
            br.replace_with("\n")
        blocks = re.split(r"\n\s*\n", cols[1].get_text().strip())
        if blocks:
            org["name"] = clean(blocks[0])
            addr_lines = [clean(t) for t in "\n".join(blocks[1:]).split("\n")]
            org["address"] = ", ".join(t for t in addr_lines if t)
    if len(cols) > 2:
        contact = cols[2]
        text = contact.get_text(" ")
        tel = re.search(r"Telefon:\s*([\d\s/()\-+.]+)", text)
        if tel:
            org["tel"] = clean(tel.group(1))
        web = contact.select_one('a[href^="http"]')
        if web:
            org["web"] = web["href"]
        mail = contact.select_one('a[href^="mailto:"]')
        if mail:
            org["mail"] = mail["href"].removeprefix("mailto:")
    return org


def parse_events(html: str, region: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    events = []
    for h3 in soup.select("h3.eventtitle"):
        event = {
            "title": clean(h3.get_text()),
            "ort": "",
            "land": "",
            "region": region,
            "start": None,
            "end": None,
            "typ_bis": None,
            "tage": None,
            "thema": "",
            "kz": "",
            "org": None,
        }
        row = h3.parent
        while True:
            row = row.find_next_sibling("div")
            if row is None or row.select_one("hr.hr") or row.select_one("h3.eventtitle"):
                break
            labels = [clean(b.get_text()).rstrip(":") for b in row.select("b")]
            if "Veranstalter" in labels:
                event["org"] = parse_organizer(row)
                continue
            # Label/Wert-Paare: 4-col Label, 8-col Wert, ggf. zwei Paare pro Row (Ort+Land)
            cols = row.select("div.columns")
            i = 0
            while i + 1 < len(cols):
                label = clean(cols[i].get_text()).rstrip(":")
                value_el = cols[i + 1]
                value = clean(value_el.get_text())
                if label == "Ort":
                    event["ort"] = value
                elif label == "Land":
                    event["land"] = value
                elif label == "Termin":
                    event.update(parse_termin(value))
                elif label == "Anerkannte Freistellungstage":
                    m = re.search(r"\d+", value)
                    event["tage"] = int(m.group()) if m else None
                elif label == "Themenbereich":
                    event["thema"] = value
                elif label == "Anerkennungskennziffer":
                    event["kz"] = " ".join(
                        clean(s.get_text()) for s in value_el.select("span.kz")
                    ) or value
                i += 2
        if not event["land"] and region != "ausland":
            event["land"] = "Deutschland"
        events.append(event)
    return events


def dedupe(events: list[dict]) -> list[dict]:
    seen = set()
    result = []
    for e in events:
        key = event_key(e)
        if key in seen:
            continue
        seen.add(key)
        result.append(e)
    return result


def tag_categories(events: list[dict]) -> None:
    """Taggt Events mit den offiziellen Unterkategorien, indem die Suche
    einmal pro id_stichwort abgefragt und über event_key zugeordnet wird."""
    index = {event_key(e): e for e in events}
    for e in events:
        e["cats"] = []
    for cat_id in CATEGORIES:
        html = fetch_search(id_stichwort=cat_id)
        tagged = parse_events(html, region="")
        hits = 0
        for t in tagged:
            match = index.get(event_key(t))
            if match is not None:
                match["cats"].append(cat_id)
                hits += 1
        print(f"  Kategorie {cat_id} ({CATEGORIES[cat_id][1]}): {hits} Events")
    untagged = sum(1 for e in events if not e["cats"])
    print(f"Ohne Kategorie: {untagged}/{len(events)} Events")


def geocode_places(events: list[dict]) -> dict:
    cache = {}
    if GEOCACHE_PATH.exists():
        cache = json.loads(GEOCACHE_PATH.read_text())

    pairs = sorted({(e["ort"], e["land"]) for e in events if e["ort"]})
    todo = [p for p in pairs if f"{p[0]}|{p[1]}" not in cache]
    print(f"Geocoding: {len(pairs)} Orte gesamt, {len(todo)} neu")

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    for n, (ort, land) in enumerate(todo, 1):
        key = f"{ort}|{land}"
        coords = None
        if ort.strip().lower() in NON_PLACES:
            cache[key] = None
            continue
        # Suche aufs Land beschränken (countrycodes). Findet sich der Ort
        # nicht im angegebenen Land (z. B. Tippfehler), bleibt der Pin leer –
        # besser kein Pin als ein Pin im falschen Land. Nur ohne bekanntes
        # Land wird unbeschränkt gesucht.
        cc = LAND_TO_CC.get(land)
        params = {"q": ort, "format": "jsonv2", "limit": 1, "accept-language": "de"}
        if cc:
            params["countrycodes"] = cc
        elif land:
            params["q"] = f"{ort}, {land}"
        try:
            resp = session.get(
                "https://nominatim.openstreetmap.org/search",
                params=params, timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as exc:
            print(f"  Fehler bei {key!r}: {exc}", file=sys.stderr)
            data = []
        time.sleep(1.1)  # Nominatim-Limit: max. 1 Request/Sekunde
        if data:
            coords = [round(float(data[0]["lat"]), 5), round(float(data[0]["lon"]), 5)]
        cache[key] = coords
        print(f"  [{n}/{len(todo)}] {key} -> {coords}")
        if n % 25 == 0:
            GEOCACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=1))

    GEOCACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
    return {f"{o}|{l}": cache.get(f"{o}|{l}") for o, l in pairs}


def main() -> None:
    all_events = []
    for land_id, region in REGIONS.items():
        print(f"Lade Region {region} (land_id={land_id}) ...")
        html = fetch_search(land_id=land_id)
        events = parse_events(html, region)
        print(f"  {len(events)} Events geparst")
        all_events.extend(events)

    all_events = dedupe(all_events)
    print(f"{len(all_events)} Events nach Deduplizierung")

    print("Tagge offizielle Unterkategorien ...")
    tag_categories(all_events)

    # Veranstalter deduplizieren
    organizers = []
    org_index: dict[str, int] = {}
    for e in all_events:
        org = e["org"] or {}
        key = json.dumps(org, sort_keys=True)
        if key not in org_index:
            org_index[key] = len(organizers)
            organizers.append(org)
        e["org"] = org_index[key]

    places = geocode_places(all_events)
    resolved = sum(1 for v in places.values() if v)
    print(f"Geocoding-Quote: {resolved}/{len(places)} Orte aufgelöst")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "source": BASE_URL,
                "groups": GROUPS,
                "categories": {
                    cid: {"group": g, "name": name}
                    for cid, (g, name) in CATEGORIES.items()
                },
                "organizers": organizers,
                "places": places,
                "events": all_events,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    size_mb = OUTPUT_PATH.stat().st_size / 1024 / 1024
    print(f"Geschrieben: {OUTPUT_PATH} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
