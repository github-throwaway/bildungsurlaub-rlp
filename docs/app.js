/* Bildungsurlaub-Finder RLP – Frontend-Logik */
"use strict";

const PAGE_SIZE = 60;
let DATA = null;          // { groups, categories, organizers, places, events }
let filtered = [];        // aktuell gefilterte Events (inkl. Kategorie-Auswahl)
let mmEvents = [];        // wie filtered, aber ohne Kategorie-Auswahl (Basis der Mindmap)
let shown = 0;            // Anzahl gerenderter Cards
let map, cluster;
let markersByPlace = {};  // "Ort|Land" -> Marker
let sel = { cat: null, bucket: null, label: "" }; // Auswahl aus der Mindmap

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

  for (const e of DATA.events) {
    e.cats = e.cats || [];
    e.buckets = bucketize(e);
  }

  initMap();
  buildFilterOptions();
  restoreFromURL();
  bindEvents();
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
  if (p.get("cat") && (DATA.categories[p.get("cat")] || p.get("cat") === "none")) {
    sel.cat = p.get("cat");
    sel.label = sel.cat === "none" ? GROUP_META.none.name : DATA.categories[sel.cat].name;
  }
  if (p.get("bucket") && BUCKET_BY_ID[p.get("bucket")]) {
    sel.bucket = p.get("bucket");
    sel.label = (sel.label ? sel.label + " · " : "") + BUCKET_BY_ID[sel.bucket].name;
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
  if (sel.cat) p.set("cat", sel.cat);
  if (sel.bucket) p.set("bucket", sel.bucket);
  const view = document.body.dataset.view;
  if (view && view !== "mm") p.set("view", view);
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

/* ---------- Filtern + Sortieren ---------- */

function matchesBase(e, s, bounds) {
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

function matchesSel(e) {
  if (sel.cat === "none" && e.cats.length) return false;
  if (sel.cat && sel.cat !== "none" && !e.cats.includes(sel.cat)) return false;
  if (sel.bucket && !e.buckets.includes(sel.bucket)) return false;
  return true;
}

function applyFilters() {
  const s = getState();
  const bounds = s.bbox ? map.getBounds() : null;
  mmEvents = DATA.events.filter((e) => matchesBase(e, s, bounds));
  filtered = sel.cat || sel.bucket ? mmEvents.filter(matchesSel) : mmEvents;

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
  $("#dauer-out").textContent =
    s.tmin === 1 && s.tmax === 15 ? "alle" : `${s.tmin}–${s.tmax === 15 ? "15+" : s.tmax} Tage`;

  const chip = $("#active-cat");
  chip.hidden = !(sel.cat || sel.bucket);
  if (!chip.hidden) chip.textContent = `🧠 ${sel.label} ✕`;

  syncURL(s);
  renderList(true);
  renderMarkers();
  if (document.body.dataset.view === "mm") renderMindmap();
}

function clearSel() {
  sel = { cat: null, bucket: null, label: "" };
  applyFilters();
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
      <span class="badge badge--datum">📅 ${fmtDate(e.start)}${e.end ? " – " + fmtDate(e.end) : ""} · ${e.tage ?? "?"} Tage</span>
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
      <div class="pmeta">${fmtDate(e.start)}${e.end ? " – " + fmtDate(e.end) : ""} · ${e.tage ?? "?"} Tage · ${DATA.organizers[e.org]?.name || ""}</div>
    </div>`).join("");
  const more = events.length > 15 ? `<div class="pmeta">… und ${events.length - 15} weitere (siehe Liste)</div>` : "";
  return head + items + more;
}

/* ---------- Mindmap ---------- */

const mm = {
  inited: false,
  svg: null, g: null, sim: null,
  linkSel: null, nodeSel: null,
  expandedGroups: new Set(["bw", "gp"]),
  expandedCats: new Set(),
  selectedNode: null,
  pos: new Map(), // id -> {x,y} bleibt über Rebuilds erhalten
};

function initMindmap() {
  mm.svg = d3.select("#mindmap");
  mm.g = mm.svg.append("g");
  mm.g.append("g").attr("class", "mm-links");
  mm.g.append("g").attr("class", "mm-nodes");
  mm.svg.call(
    d3.zoom().scaleExtent([0.3, 2.5]).on("zoom", (ev) => mm.g.attr("transform", ev.transform))
  );
  mm.sim = d3.forceSimulation()
    .force("link", d3.forceLink().id((d) => d.id).distance((l) => l.dist).strength((l) => l.cross ? 0.05 : 0.6))
    .force("charge", d3.forceManyBody().strength(-320))
    .force("collide", d3.forceCollide().radius((d) => d.r + 26))
    .force("x", d3.forceX(0).strength(0.04))
    .force("y", d3.forceY(0).strength(0.05))
    .on("tick", mmTick);
  mm.inited = true;
}

function mmGraph() {
  const total = mmEvents.length;
  const nodes = [], links = [];
  const byId = {};
  const add = (n) => { nodes.push(n); byId[n.id] = n; return n; };

  add({ id: "root", kind: "root", label: "Bildungsurlaub", count: total, r: 36, color: "#1c2430" });

  // Gruppen (Ebene 1)
  const groupEvents = {};
  for (const g of Object.keys(GROUP_META)) groupEvents[g] = [];
  for (const e of mmEvents) {
    if (!e.cats.length) { groupEvents.none.push(e); continue; }
    const gs = new Set(e.cats.map((c) => DATA.categories[c]?.group).filter(Boolean));
    for (const g of gs) groupEvents[g].push(e);
  }
  for (const [gid, meta] of Object.entries(GROUP_META)) {
    const evs = groupEvents[gid];
    if (!evs.length) continue;
    add({
      id: `g:${gid}`, kind: "group", gid, label: `${meta.icon} ${meta.name}`,
      count: evs.length, r: 16 + Math.sqrt(evs.length) * 0.35, color: meta.color,
      expanded: mm.expandedGroups.has(gid),
    });
    links.push({ source: "root", target: `g:${gid}`, dist: 150 });
  }

  // Unterkategorien (Ebene 2, offizielle Taxonomie)
  const catEvents = {};
  for (const e of mmEvents) for (const c of e.cats) (catEvents[c] ??= []).push(e);
  const visibleCats = [];
  for (const [cid, info] of Object.entries(DATA.categories)) {
    if (!mm.expandedGroups.has(info.group)) continue;
    const evs = catEvents[cid] || [];
    if (!evs.length) continue;
    visibleCats.push(cid);
    add({
      id: `c:${cid}`, kind: "cat", cid, gid: info.group, label: info.name,
      count: evs.length, r: 7 + Math.sqrt(evs.length) * 0.6,
      color: GROUP_META[info.group].color, events: evs,
      expanded: mm.expandedCats.has(cid),
    });
    links.push({ source: `g:${info.group}`, target: `c:${cid}`, dist: 95 });
  }
  if (mm.expandedGroups.has("none") && groupEvents.none.length) {
    add({
      id: "c:none", kind: "cat", cid: "none", gid: "none", label: "Unkategorisiert",
      count: groupEvents.none.length, r: 7 + Math.sqrt(groupEvents.none.length) * 0.6,
      color: GROUP_META.none.color, events: groupEvents.none,
    });
    links.push({ source: "g:none", target: "c:none", dist: 95 });
  }

  // Verfeinerung (Ebene 3, eigene Keyword-Buckets) – geteilte Knoten
  for (const cid of visibleCats) {
    if (!mm.expandedCats.has(cid)) continue;
    const evs = catEvents[cid] || [];
    const perBucket = {};
    for (const e of evs) for (const b of e.buckets) (perBucket[b] ??= []).push(e);
    for (const [bid, bevs] of Object.entries(perBucket)) {
      if (bevs.length < 3) continue;
      let node = byId[`b:${bid}`];
      if (!node) {
        node = add({
          id: `b:${bid}`, kind: "bucket", bid, label: BUCKET_BY_ID[bid].name,
          count: 0, r: 0, color: "#7c8aa0", events: [],
        });
      }
      const known = new Set(node.events);
      for (const e of bevs) if (!known.has(e)) node.events.push(e);
      node.count = node.events.length;
      node.r = 5 + Math.sqrt(node.count) * 0.7;
      links.push({ source: `c:${cid}`, target: `b:${bid}`, dist: 70 });
    }
  }

  // Querverbindungen zwischen Kategorien mit vielen gemeinsamen Events
  for (let i = 0; i < visibleCats.length; i++) {
    for (let j = i + 1; j < visibleCats.length; j++) {
      const a = new Set(catEvents[visibleCats[i]]);
      let shared = 0;
      for (const e of catEvents[visibleCats[j]]) if (a.has(e)) shared++;
      if (shared >= 25) {
        links.push({
          source: `c:${visibleCats[i]}`, target: `c:${visibleCats[j]}`,
          dist: 160, cross: true,
        });
      }
    }
  }
  return { nodes, links };
}

function renderMindmap() {
  if (!mm.inited) initMindmap();
  const { width, height } = $("#mindmap-view").getBoundingClientRect();
  if (!width) return;
  mm.svg.attr("viewBox", [-width / 2, -height / 2, width, height]);

  const { nodes, links } = mmGraph();
  for (const n of nodes) {
    const p = mm.pos.get(n.id);
    if (p) Object.assign(n, p);
    if (n.id === "root") { n.fx = 0; n.fy = 0; }
  }

  const linkSel = mm.g.select(".mm-links").selectAll("line")
    .data(links, (l) => `${l.source.id || l.source}|${l.target.id || l.target}`)
    .join("line")
    .attr("class", (l) => "mm-link" + (l.cross ? " mm-link--cross" : ""))
    .attr("stroke-width", (l) => (l.cross ? 1.5 : 1.2));

  const nodeSel = mm.g.select(".mm-nodes").selectAll("g.mm-node")
    .data(nodes, (n) => n.id)
    .join(
      (enter) => {
        const g = enter.append("g").attr("class", "mm-node");
        g.append("circle");
        g.append("text").attr("class", "mm-label").attr("text-anchor", "middle");
        g.append("text").attr("class", "mm-count").attr("text-anchor", "middle");
        return g;
      }
    )
    .classed("selected", (n) => mm.selectedNode === n.id)
    .call(d3.drag()
      .on("start", (ev, d) => { if (!ev.active) mm.sim.alphaTarget(0.2).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on("end", (ev, d) => { if (!ev.active) mm.sim.alphaTarget(0); if (d.id !== "root") { d.fx = null; d.fy = null; } }))
    .on("click", (ev, d) => mmClick(d));

  nodeSel.select("circle")
    .attr("r", (n) => n.r)
    .attr("fill", (n) => n.color)
    .attr("fill-opacity", (n) => (n.kind === "bucket" ? 0.85 : 1));
  nodeSel.select(".mm-label")
    .attr("dy", (n) => n.r + 13)
    .attr("font-size", (n) => (n.kind === "root" ? 15 : n.kind === "group" ? 13 : 11))
    .attr("font-weight", (n) => (n.kind === "bucket" ? 400 : 700))
    .text((n) => (n.label.length > 30 ? n.label.slice(0, 29) + "…" : n.label));
  nodeSel.select(".mm-count")
    .attr("dy", (n) => n.r + 25)
    .attr("font-size", 10)
    .text((n) => `${n.count}${n.kind !== "bucket" && n.kind !== "root" ? (n.expanded ? " ▾" : " ▸") : ""}`);

  mm.linkSel = linkSel;
  mm.nodeSel = nodeSel;
  mm.sim.nodes(nodes);
  mm.sim.force("link").links(links);
  mm.sim.alpha(0.7).restart();
}

function mmTick() {
  if (!mm.linkSel) return;
  mm.linkSel
    .attr("x1", (l) => l.source.x).attr("y1", (l) => l.source.y)
    .attr("x2", (l) => l.target.x).attr("y2", (l) => l.target.y);
  mm.nodeSel.attr("transform", (n) => {
    mm.pos.set(n.id, { x: n.x, y: n.y });
    return `translate(${n.x},${n.y})`;
  });
}

function mmClick(node) {
  if (node.kind === "root") return;
  if (node.kind === "group") {
    if (mm.expandedGroups.has(node.gid)) {
      mm.expandedGroups.delete(node.gid);
      for (const cid of [...mm.expandedCats]) {
        if (DATA.categories[cid]?.group === node.gid) mm.expandedCats.delete(cid);
      }
    } else {
      mm.expandedGroups.add(node.gid);
    }
    renderMindmap();
    return;
  }
  if (node.kind === "cat") {
    if (mm.selectedNode === node.id && mm.expandedCats.has(node.cid)) {
      mm.expandedCats.delete(node.cid);
      mm.selectedNode = null;
      hidePanel();
    } else {
      mm.expandedCats.add(node.cid);
      mm.selectedNode = node.id;
      showPanel(node);
    }
    renderMindmap();
    return;
  }
  // bucket
  mm.selectedNode = node.id;
  showPanel(node);
  renderMindmap();
}

let panelNode = null;

function showPanel(node) {
  panelNode = node;
  const icon = node.kind === "cat" ? GROUP_META[node.gid]?.icon || "" : "🔎";
  $("#mm-panel-title").textContent = `${icon} ${node.label} (${node.count})`;
  const today = todayISO();
  const dateKey = (e) => ((e.start || "") >= today ? `0${e.start}` : `1${e.typ_bis || "9999"}`);
  const evs = [...node.events].sort((a, b) => dateKey(a).localeCompare(dateKey(b)));
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
  if (mm.selectedNode) { mm.selectedNode = null; if (mm.nodeSel) mm.nodeSel.classed("selected", false); }
}

function applyPanelSelection(view) {
  if (!panelNode) return;
  if (panelNode.kind === "cat") sel = { cat: panelNode.cid, bucket: null, label: panelNode.label };
  else sel = { cat: null, bucket: panelNode.bid, label: panelNode.label };
  switchView(view);
  applyFilters();
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
    sel = { cat: null, bucket: null, label: "" };
    applyFilters();
  });

  $("#active-cat").addEventListener("click", clearSel);
  $("#more").addEventListener("click", () => renderList(false));

  // Card-Klick -> Karte zum Ort
  $("#list").addEventListener("click", (ev) => {
    const card = ev.target.closest(".card");
    if (!card || ev.target.closest("a")) return;
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
  $("#tab-map").addEventListener("click", () => switchView("map"));
  $("#tab-list").addEventListener("click", () => switchView("list"));
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
  $("#tab-map").classList.toggle("active", view === "map");
  $("#tab-list").classList.toggle("active", view === "list");
  const p = new URLSearchParams(location.search);
  if (view === "mm") p.delete("view"); else p.set("view", view);
  history.replaceState(null, "", p.toString() ? `?${p}` : location.pathname);
  if (view === "map") setTimeout(() => map.invalidateSize(), 50);
  if (view === "mm") setTimeout(renderMindmap, 0);
}

init().catch((err) => {
  document.body.insertAdjacentHTML("beforeend",
    `<div style="position:fixed;inset:auto 20px 20px;background:#fee;padding:14px;border-radius:8px">
      Daten konnten nicht geladen werden: ${err}</div>`);
  console.error(err);
});
