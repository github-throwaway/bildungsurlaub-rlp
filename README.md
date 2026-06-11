# Bildungsurlaub-Finder RLP

Alternatives Frontend für die [Bildungsurlaub-Suche des Landes Rheinland-Pfalz](https://awv.rlp.de/suche/) — mit Karte, Volltextsuche und flexiblen Filtern statt Endlos-Liste.

**Features**

- 🧠 **Entdecken** (Standard-Ansicht): die Themen-Hierarchie — 8 Gruppen (Sprachen gebündelt, Gesundheit, Beruf, …) → offizielle Kategorien der AWV-Suche → per Titel-Keywords verfeinerte Unterthemen (Yoga, KI, Resilienz, …) — in **fünf umschaltbaren Darstellungen**: 🫧 zoombare Bubbles (Standard), 🟦 Treemap mit Drill-down, ☀️ Sunburst, 🌳 aufklappbarer Baum mit Querverbindungen, 🗂️ Kachel-Browser. Klick öffnet die Veranstaltungen und übernimmt die Auswahl als Filter in Karte/Liste; die gewählte Darstellung wird gemerkt
- 🗺️ Interaktive Karte (Leaflet + OpenStreetMap) mit Marker-Clustering aller ~6500 anerkannten Veranstaltungen
- 🔍 Volltextsuche über Titel, Ort und Veranstalter
- 🎛️ Filter: Region (RLP / anderes Bundesland / Ausland), Land, alle 43 offiziellen Kategorien (thematisch gruppiert), Veranstalter, Zeitraum, Dauer
- 🔁 Berücksichtigt Typenanerkennungen (wiederholbare Veranstaltungen)
- 🔗 Filter landen in der URL → Ansichten sind teilbar
- 📱 Responsive (mobil: Karte/Liste als Tabs)

## Aufbau

```
scraper/scrape.py     # holt + parst die Daten von awv.rlp.de, taggt die offiziellen
                      # Unterkategorien (1 Anfrage pro id_stichwort), geocodiert via Nominatim
scraper/geocache.json # Geocoding-Cache (nur neue Orte werden angefragt)
docs/                 # statisches Frontend (GitHub-Pages-Root)
docs/taxonomy.js      # Themen-Gruppen + Keyword-Unterthemen
docs/explore.js       # die 5 Visualisierungen der Entdecken-Ansicht
docs/data/events.json # generierte Daten
```

Kein Build-Step, kein Backend — `docs/` ist direkt deploybar.

## Daten aktualisieren

```sh
uv run scraper/scrape.py
```

Dauert dank Geocoding-Cache normalerweise nur Sekunden; beim allerersten Lauf ~25 Minuten (Nominatim-Rate-Limit: 1 Anfrage/Sekunde). Der GitHub-Actions-Workflow [update-data.yml](.github/workflows/update-data.yml) macht das automatisch jeden Montag.

## Lokal testen

```sh
python3 -m http.server 8742 --directory docs
# → http://localhost:8742
```

## Hosting (GitHub Pages)

Repo-Einstellungen → **Pages** → Source: *Deploy from a branch* → Branch `main`, Ordner `/docs`.

## Datenquelle

Alle Daten stammen von der öffentlichen Suche der Aufsichts- und Dienstleistungsdirektion (awv.rlp.de). Ohne Gewähr — verbindliche Auskünfte gibt nur der jeweilige Veranstalter bzw. die ADD.
