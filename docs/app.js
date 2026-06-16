/* Bildungsurlaub-Finder RLP – Frontend-Logik */
"use strict";

const PAGE_SIZE = 60;
let DATA = null;          // { groups, categories, organizers, places, events }
let filtered = [];        // aktuell gefilterte Events (inkl. Auswahl + Merkliste)
let mmEvents = [];        // Basis der Entdecken-Ansicht (ohne Themen-Auswahl)
let shown = 0;            // Anzahl gerenderter Cards
let map, cluster;
let markersByPlace = {};  // "Ort|Land" -> Marker
let sel = null;           // Themen-Auswahl: {type:"group"|"cat"|"bucket"|"rest", gid?, cid?, bid?, label}
let onlyFavs = false;     // Merkliste-Filter aktiv
let placeFilter = null;   // "Ort|Land" – nur Veranstaltungen dieses Ortes
const FAVS = new Set(JSON.parse(localStorage.getItem("favs") || "[]"));
const CAT_SHOWN_BUCKETS = {}; // cid -> Set(bid) mit >=3 Events (für „Sonstige"-Filter)

const $ = (sel) => document.querySelector(sel);
const eventId = (e) => `${e.kz}|${e.start}|${e.ort}`;
const awvLink = (kz) =>
  `https://awv.rlp.de/suche/?id_stichwort=&date=&organizer=&topic=&land_id=&ort=&veranstaltungsdauer=&akz=${encodeURIComponent(kz)}&submit=1`;

// Flagge aus dem ISO-Ländercode (siehe LAND_CC in taxonomy.js)
const flag = (land) => flagEmoji(LAND_CC[land]);

const fmtDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

/* ---------- Initialisierung ---------- */

async function init() {
  const resp = await fetch("data/events.json");
  DATA = await resp.json();
  $("#data-date").textContent = `· Stand: ${fmtDate(DATA.generated.slice(0, 10))}`;

  for (const e of DATA.events) {
    e.cats = e.cats || [];
    e.buckets = bucketize(e);
  }
  computeCatBuckets();

  initMap();
  buildFilterOptions();
  restoreFromURL();
  bindEvents();
  bindVizSwitcher();
  updateFavCount();
  switchView(new URLSearchParams(location.search).get("view") || "mm");
  applyFilters();
}

function initMap() {
  map = L.map("map", { worldCopyJump: true }).setView([50.5, 8.0], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 });
  map.addLayer(cluster);
  map.on("moveend", () => { if ($("#f-bbox").checked) applyFilters(); });

  // „Mein Standort"-Control
  const locate = L.control({ position: "topleft" });
  locate.onAdd = () => {
    const div = L.DomUtil.create("div", "leaflet-bar locate-ctrl");
    div.innerHTML = '<a href="#" title="Meinen Standort anzeigen" role="button">📍</a>';
    L.DomEvent.on(div, "click", (e) => {
      L.DomEvent.stop(e);
      div.classList.add("locating");
      map.locate({ setView: true, maxZoom: 11, enableHighAccuracy: true });
    });
    return div;
  };
  locate.addTo(map);

  let meMarker = null;
  map.on("locationfound", (e) => {
    document.querySelector(".locate-ctrl")?.classList.remove("locating");
    if (meMarker) map.removeLayer(meMarker);
    meMarker = L.layerGroup([
      L.circle(e.latlng, { radius: e.accuracy, color: "#2563eb", weight: 1, fillOpacity: 0.1 }),
      L.circleMarker(e.latlng, { radius: 7, color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 })
        .bindPopup("Dein Standort"),
    ]).addTo(map);
  });
  map.on("locationerror", () => {
    document.querySelector(".locate-ctrl")?.classList.remove("locating");
    alert("Standort konnte nicht ermittelt werden. Bitte Standortzugriff im Browser erlauben.");
  });
}

function buildFilterOptions() {
  const lands = new Map(), orgs = new Map(), catCounts = new Map();
  for (const e of DATA.events) {
    if (e.land) lands.set(e.land, (lands.get(e.land) || 0) + 1);
    const org = DATA.organizers[e.org];
    if (org && org.name) orgs.set(org.name, (orgs.get(org.name) || 0) + 1);
    for (const c of e.cats) catCounts.set(c, (catCounts.get(c) || 0) + 1);
  }
  const fill = (sel, entries) => {
    for (const [name, count] of [...entries].sort((a, b) => a[0].localeCompare(b[0], "de"))) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = `${name} (${count})`;
      sel.appendChild(opt);
    }
  };
  fill($("#f-land"), lands);
  fill($("#f-org"), orgs);

  // Kategorie-Dropdown: alle offiziellen Unterkategorien, thematisch gruppiert
  // (gruppiert nach denselben Themen-Gruppen wie die Entdecken-Ansicht)
  const catSel = $("#f-cat");
  for (const ginfo of Object.values(CAT_GROUPS)) {
    const og = document.createElement("optgroup");
    og.label = `${ginfo.icon} ${ginfo.name}`;
    for (const cid of ginfo.cats) {
      const count = catCounts.get(cid);
      if (!count) continue;
      const opt = document.createElement("option");
      opt.value = cid;
      opt.textContent = `${catDisplayName(DATA.categories[cid].name)} (${count})`;
      og.appendChild(opt);
    }
    if (og.children.length) catSel.appendChild(og);
  }
}

// Pro Kategorie die Unterthemen mit >=3 Events – damit lässt sich der
// „Sonstige"-Rest einer Kategorie exakt reproduzieren (für den Filter).
function computeCatBuckets() {
  const counts = {};
  for (const e of DATA.events) {
    for (const c of e.cats) {
      const m = (counts[c] ??= {});
      for (const b of e.buckets) m[b] = (m[b] || 0) + 1;
    }
  }
  for (const cid in counts) {
    CAT_SHOWN_BUCKETS[cid] = new Set(
      Object.entries(counts[cid]).filter(([, n]) => n >= 3).map(([b]) => b)
    );
  }
}

/* ---------- Filter-Zustand ---------- */

function getState() {
  const dauer = $("#f-dauer").value;
  const [tmin, tmax] = dauer ? dauer.split("-").map(Number) : [null, null];
  return {
    text: $("#f-text").value.trim().toLowerCase(),
    region: $("#f-region .chip.active")?.dataset.value || "",
    land: $("#f-land").value,
    org: $("#f-org").value,
    von: $("#f-von").value,
    bis: $("#f-bis").value,
    tmin, tmax,
    typ: $("#f-typ").checked,
    bbox: $("#f-bbox").checked,
    sort: $("#sort").value,
  };
}

function restoreFromURL() {
  const p = new URLSearchParams(location.search);
  if (p.get("q")) $("#f-text").value = p.get("q");
  if (p.get("land")) $("#f-land").value = p.get("land");
  if (p.get("org")) $("#f-org").value = p.get("org");
  $("#f-von").value = p.get("von") || todayISO();
  if (p.get("bis")) $("#f-bis").value = p.get("bis");
  if (p.get("dauer")) $("#f-dauer").value = p.get("dauer");
  if (p.get("typ") === "0") $("#f-typ").checked = false;
  if (p.get("sort")) $("#sort").value = p.get("sort");
  if (p.get("fav")) onlyFavs = true;
  if (p.get("ort")) placeFilter = p.get("ort");
  const region = p.get("region") || "";
  for (const chip of document.querySelectorAll("#f-region .chip")) {
    chip.classList.toggle("active", chip.dataset.value === region);
  }
  // Themen-Auswahl wiederherstellen
  const grp = p.get("grp"), cat = p.get("cat"), bucket = p.get("bucket");
  if (grp && CAT_GROUPS[grp]) {
    sel = { type: "group", gid: grp, label: `${CAT_GROUPS[grp].icon} ${CAT_GROUPS[grp].name}` };
  } else if (cat && DATA.categories[cat]) {
    if (bucket && BUCKET_BY_ID[bucket]) {
      sel = { type: "bucket", cid: cat, bid: bucket, label: BUCKET_BY_ID[bucket].name };
    } else if (p.get("rest")) {
      sel = { type: "rest", cid: cat, label: `${catDisplayName(DATA.categories[cat].name)} · Sonstige` };
    } else {
      sel = { type: "cat", cid: cat, label: catDisplayName(DATA.categories[cat].name) };
    }
  }
  if (sel && sel.type !== "group") $("#f-cat").value = sel.cid;
}

function syncURL(s) {
  const p = new URLSearchParams();
  if (s.text) p.set("q", s.text);
  if (s.region) p.set("region", s.region);
  if (s.land) p.set("land", s.land);
  if (s.org) p.set("org", s.org);
  if (s.von && s.von !== todayISO()) p.set("von", s.von);
  if (s.bis) p.set("bis", s.bis);
  if ($("#f-dauer").value) p.set("dauer", $("#f-dauer").value);
  if (!s.typ) p.set("typ", "0");
  if (s.sort !== "start") p.set("sort", s.sort);
  if (onlyFavs) p.set("fav", "1");
  if (placeFilter) p.set("ort", placeFilter);
  if (sel) {
    if (sel.type === "group") p.set("grp", sel.gid);
    else { p.set("cat", sel.cid); if (sel.type === "bucket") p.set("bucket", sel.bid); if (sel.type === "rest") p.set("rest", "1"); }
  }
  if (vizMode && vizMode !== VIZ_DEFAULT) p.set("viz", vizMode);
  const view = document.body.dataset.view;
  if (view && view !== "mm") p.set("view", view);
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

/* ---------- Filtern + Sortieren ---------- */

function matchesBase(e, s, bounds) {
  if (placeFilter && `${e.ort}|${e.land}` !== placeFilter) return false;
  if (s.region && e.region !== s.region) return false;
  if (s.land && e.land !== s.land) return false;
  if (s.org && (DATA.organizers[e.org]?.name || "") !== s.org) return false;
  if (s.tmin != null && e.tage != null && (e.tage < s.tmin || e.tage > s.tmax)) return false;

  // Zeitraum: Termin überlappt [von, bis] ODER Typenanerkennung erlaubt
  // Wiederholungen bis typ_bis (Folgetermine beim Veranstalter erfragen).
  if (s.von) {
    const endsAfter = (e.end || e.start || "") >= s.von;
    const repeatable = s.typ && e.typ_bis && e.typ_bis >= s.von;
    if (!endsAfter && !repeatable) return false;
  }
  if (s.bis && (e.start || "") > s.bis) {
    if (!(s.typ && e.typ_bis && (!s.von || s.von <= e.typ_bis))) return false;
  }

  if (s.bbox) {
    const coords = DATA.places[`${e.ort}|${e.land}`];
    if (!coords || !bounds.contains(coords)) return false;
  }

  if (s.text) {
    const org = DATA.organizers[e.org];
    const hay = `${e.title} ${e.ort} ${e.land} ${org?.name || ""}`.toLowerCase();
    for (const word of s.text.split(/\s+/)) {
      if (!hay.includes(word)) return false;
    }
  }
  return true;
}

// Themen-Auswahl (Gruppe / Kategorie / Unterthema / „Sonstige")
function selMatch(e) {
  if (!sel) return true;
  switch (sel.type) {
    case "group":  return e.cats.some((c) => GROUP_OF_CAT[c] === sel.gid);
    case "cat":    return e.cats.includes(sel.cid);
    case "bucket": return e.cats.includes(sel.cid) && e.buckets.includes(sel.bid);
    case "rest":   return e.cats.includes(sel.cid) &&
                          !e.buckets.some((b) => CAT_SHOWN_BUCKETS[sel.cid]?.has(b));
  }
  return true;
}

function applyFilters() {
  const s = getState();
  const bounds = s.bbox ? map.getBounds() : null;
  mmEvents = DATA.events.filter((e) => matchesBase(e, s, bounds));
  filtered = mmEvents.filter((e) => {
    if (!selMatch(e)) return false;
    if (onlyFavs && !FAVS.has(eventId(e))) return false;
    return true;
  });

  // Konkrete kommende Termine zuerst, danach wiederholbare Veranstaltungen
  // mit vergangenem Termin (sortiert nach Ende der Typenanerkennung)
  const today = todayISO();
  const dateKey = (e) =>
    (e.start || "") >= today ? `0${e.start}` : `1${e.typ_bis || e.start || "9999"}`;
  const cmp = {
    start: (a, b) => dateKey(a).localeCompare(dateKey(b)),
    tage: (a, b) => (b.tage || 0) - (a.tage || 0),
    ort: (a, b) => a.ort.localeCompare(b.ort, "de"),
    title: (a, b) => a.title.localeCompare(b.title, "de"),
  }[s.sort];
  filtered.sort(cmp);

  $("#count").textContent = `${filtered.length} Treffer`;
  $("#f-fav").classList.toggle("active", onlyFavs);

  // Chip zeigt nur Auswahlen, die das Kategorie-Dropdown nicht selbst abbildet
  const chip = $("#active-cat");
  const showChip = sel && sel.type !== "cat";
  chip.hidden = !showChip;
  if (showChip) chip.textContent = `🧠 ${sel.label} ✕`;

  const pchip = $("#active-place");
  pchip.hidden = !placeFilter;
  if (placeFilter) pchip.textContent = `📍 ${placeFilter.split("|")[0]} ✕`;

  syncURL(s);
  renderList(true);
  renderMarkers();
  if (document.body.dataset.view === "mm") renderMindmap();
  if (document.body.dataset.view === "swipe") startSwipe();
}

function setSelection(newSel) {
  sel = newSel;
  $("#f-cat").value = sel && sel.type !== "group" ? sel.cid : "";
  applyFilters();
}

function clearSel() {
  setSelection(null);
}

function setPlaceFilter(key) {
  placeFilter = key;
  if (document.body.dataset.view === "mm") switchView("list");
  applyFilters();
}

/* ---------- Merkliste (Favoriten) ---------- */

function toggleFav(id) {
  if (FAVS.has(id)) FAVS.delete(id); else FAVS.add(id);
  localStorage.setItem("favs", JSON.stringify([...FAVS]));
  syncFavButtons();
  updateFavCount();
  if (onlyFavs) applyFilters();
}

function syncFavButtons() {
  for (const b of document.querySelectorAll(".fav-btn")) {
    const on = FAVS.has(b.dataset.fav);
    b.classList.toggle("on", on);
    b.textContent = on ? "★" : "☆";
  }
}

function updateFavCount() {
  $("#f-fav-count").textContent = FAVS.size;
}

/* ---------- Liste ---------- */

function cardHTML(e, idx) {
  const org = DATA.organizers[e.org] || {};
  const id = eventId(e);
  const faved = FAVS.has(id);
  const typ = e.typ_bis
    ? `<span class="badge badge--typ" title="Typenanerkennung: Veranstalter darf bis ${fmtDate(e.typ_bis)} beliebig oft wiederholen – Folgetermine direkt erfragen">🔁 wiederholbar bis ${fmtDate(e.typ_bis)}</span>`
    : "";
  const links = [
    org.web ? `<a href="${org.web}" target="_blank" rel="noopener">Website</a>` : "",
    org.mail ? `<a href="mailto:${org.mail}">E-Mail</a>` : "",
    org.tel ? `<a href="tel:${org.tel.replace(/[^\d+]/g, "")}">${org.tel}</a>` : "",
    `<a href="${awvLink(e.kz)}" target="_blank" rel="noopener" class="awv-link" title="Originaleintrag auf awv.rlp.de öffnen">AWV-Eintrag ↗</a>`,
  ].filter(Boolean).join(" ");
  return `<article class="card" data-idx="${idx}" data-place="${e.ort}|${e.land}">
    <div class="card-head">
      <h3>${e.title}</h3>
      <button class="fav-btn ${faved ? "on" : ""}" data-fav="${id}" title="Zur Merkliste hinzufügen" aria-label="Merken">${faved ? "★" : "☆"}</button>
    </div>
    <div class="meta">
      <button class="badge badge--ort place-filter" data-place="${e.ort}|${e.land}" title="Nur Veranstaltungen an diesem Ort zeigen">${flag(e.land)} ${e.ort}${e.land && e.land !== "Deutschland" ? ", " + e.land : ""}</button>
      <span class="badge badge--datum">📅 ${fmtDate(e.start)}${e.end ? " – " + fmtDate(e.end) : ""} · ${e.tage ?? "?"} Tage</span>
      ${e.thema ? `<span class="badge badge--thema">${e.thema}</span>` : ""}
      ${typ}
    </div>
    <div class="org">
      <div><strong>${org.name || "Unbekannter Veranstalter"}</strong><br>${links}</div>
      <span class="kz" title="Anerkennungskennziffer">${e.kz}</span>
    </div>
  </article>`;
}

function renderList(reset) {
  const list = $("#list");
  if (reset) { list.innerHTML = ""; shown = 0; }
  if (!filtered.length) {
    list.innerHTML = '<div class="empty">Keine Veranstaltungen gefunden.<br>Filter lockern oder zurücksetzen.</div>';
    $("#more").hidden = true;
    return;
  }
  const next = filtered.slice(shown, shown + PAGE_SIZE);
  const html = next.map((e) => cardHTML(e, DATA.events.indexOf(e))).join("");
  list.insertAdjacentHTML("beforeend", html);
  shown += next.length;
  $("#more").hidden = shown >= filtered.length;
  $("#more").textContent = `Mehr anzeigen (${filtered.length - shown} weitere)`;
}

/* ---------- Karte ---------- */

function renderMarkers() {
  cluster.clearLayers();
  markersByPlace = {};
  const byPlace = new Map();
  for (const e of filtered) {
    const key = `${e.ort}|${e.land}`;
    if (!DATA.places[key]) continue;
    if (!byPlace.has(key)) byPlace.set(key, []);
    byPlace.get(key).push(e);
  }
  for (const [key, events] of byPlace) {
    const [ort, land] = key.split("|");
    const marker = L.marker(DATA.places[key], {
      title: `${ort} (${events.length})`,
    });
    marker.bindPopup(() => popupHTML(ort, land, events), { maxWidth: 320 });
    markersByPlace[key] = marker;
    cluster.addLayer(marker);
  }
}

function popupHTML(ort, land, events) {
  const head = `<div class="popup-place">${flag(land)} ${ort} · ${events.length} Veranstaltung${events.length > 1 ? "en" : ""}</div>`;
  const items = events.slice(0, 15).map((e) => `
    <div class="popup-event">
      <a href="#" data-goto="${DATA.events.indexOf(e)}">${e.title}</a>
      <div class="pmeta">${fmtDate(e.start)}${e.end ? " – " + fmtDate(e.end) : ""} · ${e.tage ?? "?"} Tage · ${DATA.organizers[e.org]?.name || ""}</div>
    </div>`).join("");
  const more = events.length > 15 ? `<div class="pmeta">… und ${events.length - 15} weitere (siehe Liste)</div>` : "";
  return head + items + more;
}

/* ---------- Seitenpanel der Entdecken-Ansicht ----------
   (Die Visualisierungen selbst liegen in explore.js) */

let panelNode = null;

function showPanel(d) {
  panelNode = d;
  const icon = { cat: CAT_GROUPS[d.gid]?.icon, group: d.icon, bucket: "🔎", rest: "📚" }[d.kind] || "📋";
  $("#mm-panel-title").textContent = `${icon} ${d.name} (${d.events.length})`;
  const today = todayISO();
  const dateKey = (e) => ((e.start || "") >= today ? `0${e.start}` : `1${e.typ_bis || "9999"}`);
  const evs = [...d.events].sort((a, b) => dateKey(a).localeCompare(dateKey(b)));
  const max = 50;
  let html = evs.slice(0, max).map((e) => cardHTML(e, DATA.events.indexOf(e))).join("");
  if (evs.length > max) html += `<div class="empty">… ${evs.length - max} weitere – „In Liste öffnen" zeigt alle.</div>`;
  $("#mm-panel-list").innerHTML = html;
  $("#mm-panel-list").scrollTop = 0;
  $("#mm-panel").hidden = false;
}

function hidePanel() {
  $("#mm-panel").hidden = true;
  panelNode = null;
  vizClearSelection();
}

function selFromNode(d) {
  switch (d.kind) {
    case "group":  return { type: "group", gid: d.gid, label: `${d.icon} ${d.name}` };
    case "cat":    return { type: "cat", cid: d.cid, label: d.name };
    case "bucket": return { type: "bucket", cid: d.cid, bid: d.bid, label: d.name };
    case "rest":   return { type: "rest", cid: d.cid, label: `${catDisplayName(DATA.categories[d.cid].name)} · Sonstige` };
  }
  return null;
}

function applyPanelSelection(view) {
  if (!panelNode) return;
  setSelection(selFromNode(panelNode));
  switchView(view);
}

/* ---------- Interaktion ---------- */

function bindEvents() {
  let t;
  $("#f-text").addEventListener("input", () => { clearTimeout(t); t = setTimeout(applyFilters, 250); });

  for (const chip of document.querySelectorAll("#f-region .chip")) {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#f-region .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      applyFilters();
    });
  }

  for (const id of ["#f-land", "#f-org", "#f-von", "#f-bis", "#f-dauer", "#f-typ", "#f-bbox", "#sort"]) {
    $(id).addEventListener("change", applyFilters);
  }

  // Kategorie-Dropdown ist eine Themen-Auswahl wie die Entdecken-Ansicht
  $("#f-cat").addEventListener("change", () => {
    const v = $("#f-cat").value;
    setSelection(v ? { type: "cat", cid: v, label: catDisplayName(DATA.categories[v].name) } : null);
  });

  $("#filter-toggle").addEventListener("click", () => {
    const open = document.body.classList.toggle("show-filters");
    $("#filter-toggle").setAttribute("aria-expanded", open);
  });

  $("#f-fav").addEventListener("click", () => {
    onlyFavs = !onlyFavs;
    // Aus der Entdecken-Ansicht zur Liste/Karte wechseln, damit die Merkliste sichtbar wird
    if (onlyFavs && document.body.dataset.view === "mm") switchView("map");
    applyFilters();
  });

  // Stern (Merken) – delegiert, funktioniert in Liste und Panel
  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".fav-btn");
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    toggleFav(btn.dataset.fav);
  });

  // Orts-Badge anklicken -> Liste auf diesen Ort filtern (Liste + Panel)
  document.addEventListener("click", (ev) => {
    const pb = ev.target.closest(".place-filter");
    if (!pb) return;
    ev.preventDefault();
    ev.stopPropagation();
    setPlaceFilter(pb.dataset.place);
  });

  $("#active-place").addEventListener("click", () => {
    placeFilter = null;
    applyFilters();
  });

  $("#reset").addEventListener("click", () => {
    $("#f-text").value = "";
    $("#f-land").value = "";
    $("#f-cat").value = "";
    $("#f-org").value = "";
    $("#f-von").value = todayISO();
    $("#f-bis").value = "";
    $("#f-dauer").value = "";
    $("#f-typ").checked = true;
    $("#f-bbox").checked = false;
    $("#sort").value = "start";
    document.querySelectorAll("#f-region .chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.value === ""));
    sel = null;
    onlyFavs = false;
    placeFilter = null;
    applyFilters();
  });

  $("#active-cat").addEventListener("click", clearSel);
  $("#more").addEventListener("click", () => renderList(false));

  // Card-Klick -> Karte zum Ort
  $("#list").addEventListener("click", (ev) => {
    const card = ev.target.closest(".card");
    if (!card || ev.target.closest("a") || ev.target.closest(".fav-btn") || ev.target.closest(".place-filter")) return;
    const marker = markersByPlace[card.dataset.place];
    if (!marker) return;
    document.querySelectorAll(".card.highlight").forEach((c) => c.classList.remove("highlight"));
    card.classList.add("highlight");
    switchView("map");
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 9));
    cluster.zoomToShowLayer(marker, () => marker.openPopup());
  });

  // Popup-Link -> Card in Liste anspringen
  document.addEventListener("click", (ev) => {
    const link = ev.target.closest("[data-goto]");
    if (!link) return;
    ev.preventDefault();
    const idx = link.dataset.goto;
    if (document.body.dataset.view === "map" && window.matchMedia("(max-width: 820px)").matches) {
      switchView("list");
    }
    let card = document.querySelector(`.card[data-idx="${idx}"]`);
    while (!card && shown < filtered.length) {  // ggf. nachladen
      renderList(false);
      card = document.querySelector(`.card[data-idx="${idx}"]`);
    }
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      document.querySelectorAll(".card.highlight").forEach((c) => c.classList.remove("highlight"));
      card.classList.add("highlight");
    }
  });

  $("#tab-mm").addEventListener("click", () => switchView("mm"));
  $("#tab-swipe").addEventListener("click", () => switchView("swipe"));
  $("#tab-map").addEventListener("click", () => switchView("map"));
  $("#tab-list").addEventListener("click", () => switchView("list"));

  // Zufall/Swipe-Ansicht
  $("#sw-skip").addEventListener("click", () => swipeButton(false));
  $("#sw-like").addEventListener("click", () => swipeButton(true));
  $("#sw-info").addEventListener("click", swipeShowOnMap);
  $("#mm-panel-close").addEventListener("click", hidePanel);
  $("#mm-to-list").addEventListener("click", () => applyPanelSelection("list"));
  $("#mm-to-map").addEventListener("click", () => applyPanelSelection("map"));
  window.addEventListener("resize", () => {
    if (document.body.dataset.view === "mm") renderMindmap();
  });
}

function switchView(view) {
  document.body.dataset.view = view;
  $("#tab-mm").classList.toggle("active", view === "mm");
  $("#tab-swipe").classList.toggle("active", view === "swipe");
  $("#tab-map").classList.toggle("active", view === "map");
  $("#tab-list").classList.toggle("active", view === "list");
  const p = new URLSearchParams(location.search);
  if (view === "mm") p.delete("view"); else p.set("view", view);
  history.replaceState(null, "", p.toString() ? `?${p}` : location.pathname);
  if (view === "map") setTimeout(() => map.invalidateSize(), 50);
  if (view === "mm") setTimeout(renderMindmap, 0);
  if (view === "swipe") startSwipe();
}

init().catch((err) => {
  document.body.insertAdjacentHTML("beforeend",
    `<div style="position:fixed;inset:auto 20px 20px;background:#fee;padding:14px;border-radius:8px">
      Daten konnten nicht geladen werden: ${err}</div>`);
  console.error(err);
});
