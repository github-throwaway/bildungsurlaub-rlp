/* Bildungsurlaub-Finder RLP – Frontend-Logik */
"use strict";

const PAGE_SIZE = 60;
let DATA = null;          // { organizers, places, events, generated }
let filtered = [];        // aktuell gefilterte Events
let shown = 0;            // Anzahl gerenderter Cards
let map, cluster;
let markersByPlace = {};  // "Ort|Land" -> Marker

const $ = (sel) => document.querySelector(sel);

const FLAGS = {
  "Deutschland": "🇩🇪", "Frankreich": "🇫🇷", "Niederlande": "🇳🇱", "Italien": "🇮🇹",
  "Spanien": "🇪🇸", "Österreich": "🇦🇹", "Schweiz": "🇨🇭", "Großbritannien": "🇬🇧",
  "England": "🇬🇧", "Irland": "🇮🇪", "Portugal": "🇵🇹", "Griechenland": "🇬🇷",
  "Polen": "🇵🇱", "Tschechien": "🇨🇿", "Belgien": "🇧🇪", "Luxemburg": "🇱🇺",
  "Dänemark": "🇩🇰", "Schweden": "🇸🇪", "Norwegen": "🇳🇴", "Finnland": "🇫🇮",
  "Malta": "🇲🇹", "Kroatien": "🇭🇷", "Ungarn": "🇭🇺", "Türkei": "🇹🇷",
  "USA": "🇺🇸", "Kanada": "🇨🇦", "Israel": "🇮🇱", "Marokko": "🇲🇦",
  "Vereinigtes Königreich": "🇬🇧", "Niederlande/Holland": "🇳🇱",
};
const flag = (land) => FLAGS[land] || "🌍";

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

  initMap();
  buildFilterOptions();
  restoreFromURL();
  bindEvents();
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
}

function buildFilterOptions() {
  const lands = new Map(), themen = new Map(), orgs = new Map();
  for (const e of DATA.events) {
    if (e.land) lands.set(e.land, (lands.get(e.land) || 0) + 1);
    if (e.thema) themen.set(e.thema, (themen.get(e.thema) || 0) + 1);
    const org = DATA.organizers[e.org];
    if (org && org.name) orgs.set(org.name, (orgs.get(org.name) || 0) + 1);
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
  fill($("#f-thema"), themen);
  fill($("#f-org"), orgs);
}

/* ---------- Filter-Zustand ---------- */

function getState() {
  return {
    text: $("#f-text").value.trim().toLowerCase(),
    region: $("#f-region .chip.active")?.dataset.value || "",
    land: $("#f-land").value,
    thema: $("#f-thema").value,
    org: $("#f-org").value,
    von: $("#f-von").value,
    bis: $("#f-bis").value,
    tmin: +$("#f-tage-min").value,
    tmax: +$("#f-tage-max").value,
    typ: $("#f-typ").checked,
    bbox: $("#f-bbox").checked,
    sort: $("#sort").value,
  };
}

function restoreFromURL() {
  const p = new URLSearchParams(location.search);
  if (p.get("q")) $("#f-text").value = p.get("q");
  if (p.get("land")) $("#f-land").value = p.get("land");
  if (p.get("thema")) $("#f-thema").value = p.get("thema");
  if (p.get("org")) $("#f-org").value = p.get("org");
  $("#f-von").value = p.get("von") || todayISO();
  if (p.get("bis")) $("#f-bis").value = p.get("bis");
  if (p.get("tmin")) $("#f-tage-min").value = p.get("tmin");
  if (p.get("tmax")) $("#f-tage-max").value = p.get("tmax");
  if (p.get("typ") === "0") $("#f-typ").checked = false;
  if (p.get("sort")) $("#sort").value = p.get("sort");
  const region = p.get("region") || "";
  for (const chip of document.querySelectorAll("#f-region .chip")) {
    chip.classList.toggle("active", chip.dataset.value === region);
  }
}

function syncURL(s) {
  const p = new URLSearchParams();
  if (s.text) p.set("q", s.text);
  if (s.region) p.set("region", s.region);
  if (s.land) p.set("land", s.land);
  if (s.thema) p.set("thema", s.thema);
  if (s.org) p.set("org", s.org);
  if (s.von && s.von !== todayISO()) p.set("von", s.von);
  if (s.bis) p.set("bis", s.bis);
  if (s.tmin > 1) p.set("tmin", s.tmin);
  if (s.tmax < 15) p.set("tmax", s.tmax);
  if (!s.typ) p.set("typ", "0");
  if (s.sort !== "start") p.set("sort", s.sort);
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

/* ---------- Filtern + Sortieren ---------- */

function matches(e, s, bounds) {
  if (s.region && e.region !== s.region) return false;
  if (s.land && e.land !== s.land) return false;
  if (s.thema && e.thema !== s.thema) return false;
  if (s.org && (DATA.organizers[e.org]?.name || "") !== s.org) return false;
  if (e.tage != null && (e.tage < s.tmin || e.tage > s.tmax)) return false;

  // Zeitraum: Termin überlappt [von, bis] ODER Typenanerkennung erlaubt
  // Wiederholungen bis typ_bis (Folgetermine beim Veranstalter erfragen).
  if (s.von) {
    const endsAfter = (e.end || e.start || "") >= s.von;
    const repeatable = s.typ && e.typ_bis && e.typ_bis >= s.von;
    if (!endsAfter && !repeatable) return false;
  } else if (!s.typ && e.typ_bis) {
    // typ deaktiviert + kein "von": nichts auszuschließen
  }
  if (s.bis && (e.start || "") > s.bis) {
    // Startet nach dem Zeitfenster – nur ok, wenn wiederholbar und Fenster vor typ_bis liegt
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

function applyFilters() {
  const s = getState();
  const bounds = s.bbox ? map.getBounds() : null;
  filtered = DATA.events.filter((e) => matches(e, s, bounds));

  const cmp = {
    start: (a, b) => (a.start || "9999").localeCompare(b.start || "9999"),
    tage: (a, b) => (b.tage || 0) - (a.tage || 0),
    ort: (a, b) => a.ort.localeCompare(b.ort, "de"),
    title: (a, b) => a.title.localeCompare(b.title, "de"),
  }[s.sort];
  filtered.sort(cmp);

  $("#count").textContent = `${filtered.length} Treffer`;
  $("#dauer-out").textContent =
    s.tmin === 1 && s.tmax === 15 ? "alle" : `${s.tmin}–${s.tmax === 15 ? "15+" : s.tmax} Tage`;

  syncURL(s);
  renderList(true);
  renderMarkers();
}

/* ---------- Liste ---------- */

function cardHTML(e, idx) {
  const org = DATA.organizers[e.org] || {};
  const typ = e.typ_bis
    ? `<span class="badge badge--typ" title="Typenanerkennung: Veranstalter darf bis ${fmtDate(e.typ_bis)} beliebig oft wiederholen – Folgetermine direkt erfragen">🔁 wiederholbar bis ${fmtDate(e.typ_bis)}</span>`
    : "";
  const links = [
    org.web ? `<a href="${org.web}" target="_blank" rel="noopener">Website</a>` : "",
    org.mail ? `<a href="mailto:${org.mail}">E-Mail</a>` : "",
    org.tel ? `<a href="tel:${org.tel.replace(/[^\d+]/g, "")}">${org.tel}</a>` : "",
  ].filter(Boolean).join(" ");
  return `<article class="card" data-idx="${idx}" data-place="${e.ort}|${e.land}">
    <h3>${e.title}</h3>
    <div class="meta">
      <span class="badge badge--ort">${flag(e.land)} ${e.ort}${e.land && e.land !== "Deutschland" ? ", " + e.land : ""}</span>
      <span class="badge badge--datum">📅 ${fmtDate(e.start)} – ${fmtDate(e.end)} · ${e.tage ?? "?"} Tage</span>
      ${e.thema ? `<span class="badge badge--thema">${e.thema}</span>` : ""}
      ${typ}
    </div>
    <div class="org"><strong>${org.name || "Unbekannter Veranstalter"}</strong><br>${links}
      <span style="float:right;color:#9aa3af" title="Anerkennungskennziffer">${e.kz}</span></div>
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
      <div class="pmeta">${fmtDate(e.start)} – ${fmtDate(e.end)} · ${e.tage ?? "?"} Tage · ${DATA.organizers[e.org]?.name || ""}</div>
    </div>`).join("");
  const more = events.length > 15 ? `<div class="pmeta">… und ${events.length - 15} weitere (siehe Liste)</div>` : "";
  return head + items + more;
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

  for (const id of ["#f-land", "#f-thema", "#f-org", "#f-von", "#f-bis", "#f-typ", "#f-bbox", "#sort"]) {
    $(id).addEventListener("change", applyFilters);
  }

  // Dauer-Slider: min darf max nicht überholen
  $("#f-tage-min").addEventListener("input", () => {
    if (+$("#f-tage-min").value > +$("#f-tage-max").value) $("#f-tage-max").value = $("#f-tage-min").value;
    applyFilters();
  });
  $("#f-tage-max").addEventListener("input", () => {
    if (+$("#f-tage-max").value < +$("#f-tage-min").value) $("#f-tage-min").value = $("#f-tage-max").value;
    applyFilters();
  });

  $("#reset").addEventListener("click", () => {
    $("#f-text").value = "";
    $("#f-land").value = "";
    $("#f-thema").value = "";
    $("#f-org").value = "";
    $("#f-von").value = todayISO();
    $("#f-bis").value = "";
    $("#f-tage-min").value = 1;
    $("#f-tage-max").value = 15;
    $("#f-typ").checked = true;
    $("#f-bbox").checked = false;
    $("#sort").value = "start";
    document.querySelectorAll("#f-region .chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.value === ""));
    applyFilters();
  });

  $("#more").addEventListener("click", () => renderList(false));

  // Card-Klick -> Karte zum Ort
  $("#list").addEventListener("click", (ev) => {
    const card = ev.target.closest(".card");
    if (!card || ev.target.closest("a")) return;
    const marker = markersByPlace[card.dataset.place];
    if (!marker) return;
    document.querySelectorAll(".card.highlight").forEach((c) => c.classList.remove("highlight"));
    card.classList.add("highlight");
    if (document.body.dataset.view === "list") switchView("map");
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 9));
    cluster.zoomToShowLayer(marker, () => marker.openPopup());
  });

  // Popup-Link -> Card in Liste anspringen
  document.addEventListener("click", (ev) => {
    const link = ev.target.closest("[data-goto]");
    if (!link) return;
    ev.preventDefault();
    const idx = link.dataset.goto;
    if (document.body.dataset.view === "map") switchView("list");
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

  $("#tab-map").addEventListener("click", () => switchView("map"));
  $("#tab-list").addEventListener("click", () => switchView("list"));
  if (window.matchMedia("(max-width: 820px)").matches) switchView("map");
}

function switchView(view) {
  document.body.dataset.view = view;
  $("#tab-map").classList.toggle("active", view === "map");
  $("#tab-list").classList.toggle("active", view === "list");
  if (view === "map") setTimeout(() => map.invalidateSize(), 50);
}

init().catch((err) => {
  document.body.insertAdjacentHTML("beforeend",
    `<div style="position:fixed;inset:auto 20px 20px;background:#fee;padding:14px;border-radius:8px">
      Daten konnten nicht geladen werden: ${err}</div>`);
  console.error(err);
});
