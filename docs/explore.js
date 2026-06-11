/* Entdecken-Ansicht: fünf umschaltbare Visualisierungen derselben
   Themen-Hierarchie (Gruppen -> offizielle Kategorien -> Keyword-
   Unterthemen). Gemeinsames Seitenpanel und Filterübernahme in app.js. */
"use strict";

let vizMode = null; // "pack" | "treemap" | "sunburst" | "tree" | "tiles"
const VIZ_DEFAULT = "pack";
const VIZ_HINTS = {
  pack: "Blase anklicken = hineinzoomen und Veranstaltungen ansehen · Klick auf den Hintergrund = herauszoomen",
  treemap: "Kachel anklicken = eine Ebene tiefer · Pfad oben = zurück · Blasse Kacheln sind Unterthemen mit Veranstaltungen",
  sunburst: "Segment anklicken = hineinzoomen und Veranstaltungen ansehen · Klick auf die Mitte = zurück",
  tree: "Thema anklicken = aufklappen · Unterthema anklicken = Veranstaltungen ansehen · gestrichelte Linien = thematische Überschneidung",
  tiles: "Karte anklicken = eine Ebene tiefer bzw. Veranstaltungen ansehen · Pfad oben = zurück",
};

let vizSelected = null;   // Id des ausgewählten Knotens (Panel offen)
let vizPath = [];         // Drill-Pfad (Ids) für Treemap + Kacheln
let svgModeReady = null;  // welcher Modus die SVG gerade besitzt

/* ---------- gemeinsame Hierarchie ---------- */

function buildExploreTree() {
  const catEvents = {};
  for (const e of mmEvents) for (const c of e.cats) (catEvents[c] ??= []).push(e);

  const groups = [];
  for (const [gid, ginfo] of Object.entries(CAT_GROUPS)) {
    const catNodes = [];
    const groupSet = new Set();
    for (const cid of ginfo.cats) {
      const evs = catEvents[cid] || [];
      if (!evs.length) continue;
      for (const e of evs) groupSet.add(e);

      const perBucket = {};
      for (const e of evs) for (const b of e.buckets) (perBucket[b] ??= []).push(e);
      const bucketNodes = Object.entries(perBucket)
        .filter(([, bevs]) => bevs.length >= 3)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([bid, bevs]) => ({
          id: `b:${cid}:${bid}`, kind: "bucket", bid, cid, gid,
          name: BUCKET_BY_ID[bid].name, events: bevs,
        }));
      let children = null;
      if (bucketNodes.length) {
        const inBucket = new Set();
        for (const b of bucketNodes) for (const e of b.events) inBucket.add(e);
        const rest = evs.filter((e) => !inBucket.has(e));
        children = rest.length >= 3
          ? [...bucketNodes, { id: `r:${cid}`, kind: "rest", cid, gid, name: "Weitere", events: rest }]
          : bucketNodes;
      }
      catNodes.push({
        id: `c:${cid}`, kind: "cat", cid, gid,
        name: DATA.categories[cid].name, events: evs, children,
      });
    }
    if (!catNodes.length) continue;
    catNodes.sort((a, b) => b.events.length - a.events.length);
    groups.push({
      id: `grp:${gid}`, kind: "group", gid, icon: ginfo.icon,
      name: ginfo.name, events: [...groupSet], children: catNodes,
    });
  }
  return { id: "root", kind: "root", name: "Alle Themen", events: mmEvents, children: groups };
}

function nodeColor(d) {
  return CAT_GROUPS[d.gid]?.color || "#64748b";
}
const KIND_OPACITY = { group: 0.9, cat: 0.62, bucket: 0.4, rest: 0.28 };

function vizLabel(d) {
  return d.kind === "group" ? `${d.icon} ${d.name}` : d.name;
}

/* ---------- Umschalter / Dispatcher ---------- */

function bindVizSwitcher() {
  vizMode = new URLSearchParams(location.search).get("viz")
    || localStorage.getItem("viz") || VIZ_DEFAULT;
  if (!VIZ_HINTS[vizMode]) vizMode = VIZ_DEFAULT;
  for (const btn of document.querySelectorAll("#mm-switch button")) {
    btn.classList.toggle("active", btn.dataset.viz === vizMode);
    btn.addEventListener("click", () => setVizMode(btn.dataset.viz));
  }
}

function setVizMode(mode) {
  vizMode = mode;
  localStorage.setItem("viz", mode);
  for (const btn of document.querySelectorAll("#mm-switch button")) {
    btn.classList.toggle("active", btn.dataset.viz === mode);
  }
  const p = new URLSearchParams(location.search);
  if (mode === VIZ_DEFAULT) p.delete("viz"); else p.set("viz", mode);
  history.replaceState(null, "", p.toString() ? `?${p}` : location.pathname);
  hidePanel();
  renderMindmap();
}

function renderMindmap() {
  const view = $("#mindmap-view");
  if (!view.getBoundingClientRect().width) return;
  view.dataset.viz = vizMode;
  $("#mm-hint").textContent = VIZ_HINTS[vizMode];
  $("#mm-tiles").hidden = vizMode !== "tiles";
  $("#mindmap").style.display = vizMode === "tiles" ? "none" : "block";
  $("#mm-breadcrumb").hidden = !(vizMode === "treemap" || vizMode === "tiles");

  if (svgModeReady !== vizMode) {
    const svg = d3.select("#mindmap");
    svg.on(".zoom", null).on("click", null);
    svg.selectAll("*").remove();
    TREE.inited = false;
    svgModeReady = vizMode;
  }
  ({ pack: renderPackViz, treemap: renderTreemapViz, sunburst: renderSunburstViz,
     tree: renderTreeViz, tiles: renderTilesViz })[vizMode]();
}

function vizClearSelection() {
  vizSelected = null;
  d3.select("#mindmap").selectAll(".selected").classed("selected", false);
  document.querySelectorAll("#mm-tiles .tile.selected").forEach((t) => t.classList.remove("selected"));
}

function vizSelect(d) {
  vizSelected = d.id;
  showPanel(d);
}

/* ---------- Drill-Pfad (Treemap + Kacheln) ---------- */

function resolvePath(root) {
  const chain = [root];
  for (const id of vizPath) {
    const next = (chain.at(-1).children || []).find((c) => c.id === id);
    if (!next) break;
    chain.push(next);
  }
  vizPath = chain.slice(1).map((n) => n.id);
  return chain;
}

function renderBreadcrumb(chain) {
  const bc = $("#mm-breadcrumb");
  bc.innerHTML = chain.map((n, i) =>
    `<button data-i="${i}" ${i === chain.length - 1 ? 'class="current"' : ""}>${vizLabel(n)}</button>`
  ).join('<span class="bc-sep">›</span>');
  const current = chain.at(-1);
  if (current.kind !== "root") {
    bc.insertAdjacentHTML("beforeend",
      `<button class="bc-view">📋 ${current.events.length} ansehen</button>`);
  }
  bc.querySelectorAll("button[data-i]").forEach((btn) => {
    btn.addEventListener("click", () => {
      vizPath = vizPath.slice(0, +btn.dataset.i);
      renderMindmap();
    });
  });
  bc.querySelector(".bc-view")?.addEventListener("click", () => vizSelect(current));
}

/* ====================================================================
   1) Zoombare Bubbles (Circle Packing)
==================================================================== */

function renderPackViz() {
  const rect = $("#mindmap-view").getBoundingClientRect();
  const size = Math.min(rect.width, rect.height) - 16;
  const svg = d3.select("#mindmap");
  svg.selectAll("*").remove();
  svg.attr("viewBox", [-rect.width / 2, -rect.height / 2, rect.width, rect.height]);

  const root = d3.hierarchy(buildExploreTree())
    .sum((d) => (d.children?.length ? 0 : Math.max(1, d.events.length)))
    .sort((a, b) => b.value - a.value);
  d3.pack().size([size, size]).padding(4)(root);

  let focus = root;
  let view;

  const g = svg.append("g");
  const node = g.selectAll("circle")
    .data(root.descendants().slice(1))
    .join("circle")
    .attr("class", "pack-circle")
    .attr("fill", (d) => nodeColor(d.data))
    .attr("fill-opacity", (d) => KIND_OPACITY[d.data.kind] ?? 0.5)
    .classed("selected", (d) => d.data.id === vizSelected)
    .on("click", (ev, d) => {
      ev.stopPropagation();
      if (d.data.kind !== "group") vizSelect(d.data);
      else hidePanel();
      node.classed("selected", (n) => n.data.id === vizSelected);
      const target = d.children ? d : d.parent;
      if (target !== focus) zoom(target);
    });
  node.append("title").text((d) => `${vizLabel(d.data)} (${d.data.events.length})`);

  const label = g.selectAll("text")
    .data(root.descendants().slice(1))
    .join("text")
    .attr("class", "pack-label")
    .attr("text-anchor", "middle")
    .style("display", (d) => (d.parent === focus ? "block" : "none"))
    .each(function (d) {
      const tx = d3.select(this);
      tx.append("tspan").attr("x", 0).attr("dy", 0).text(vizLabel(d.data));
      tx.append("tspan").attr("class", "mm-count").attr("x", 0).attr("dy", "1.25em")
        .text(d.data.events.length);
    });

  svg.on("click", () => { if (focus !== root) zoom(focus.parent || root); });

  zoomTo([root.x, root.y, root.r * 2]);

  function zoomTo(v) {
    const k = size / v[2];
    view = v;
    node.attr("transform", (d) => `translate(${(d.x - v[0]) * k},${(d.y - v[1]) * k})`)
      .attr("r", (d) => d.r * k);
    label.attr("transform", (d) => `translate(${(d.x - v[0]) * k},${(d.y - v[1]) * k})`)
      .attr("font-size", (d) => Math.max(10, Math.min(15, d.r * k * 0.22)));
  }

  function zoom(target) {
    focus = target;
    const t = svg.transition().duration(420)
      .tween("zoom", () => {
        const i = d3.interpolateZoom(view, [focus.x, focus.y, focus.r * 2.1]);
        return (x) => zoomTo(i(x));
      });
    label
      .filter(function (d) { return d.parent === focus || this.style.display === "block"; })
      .transition(t)
      .style("fill-opacity", (d) => (d.parent === focus ? 1 : 0))
      .on("start", function (d) { if (d.parent === focus) this.style.display = "block"; })
      .on("end", function (d) { if (d.parent !== focus) this.style.display = "none"; });
  }
}

/* ====================================================================
   2) Treemap mit Drill-down
==================================================================== */

function renderTreemapViz() {
  const rect = $("#mindmap-view").getBoundingClientRect();
  const svg = d3.select("#mindmap");
  svg.selectAll("*").remove();
  const top = 84, pad = 8;
  const w = rect.width - pad * 2, h = rect.height - top - 30;
  svg.attr("viewBox", [0, 0, rect.width, rect.height]);

  const chain = resolvePath(buildExploreTree());
  renderBreadcrumb(chain);
  const current = chain.at(-1);

  const root = d3.hierarchy({ children: current.children || [] }, (d) => (d === current || !d.id ? d.children : null))
    .sum((d) => (d.id ? Math.max(1, d.events.length) : 0));
  d3.treemap().size([w, h]).padding(3)(root);

  const g = svg.append("g").attr("transform", `translate(${pad},${top})`);
  const cell = g.selectAll("g")
    .data(root.leaves().filter((d) => d.data.id))
    .join("g")
    .attr("class", "tm-cell")
    .attr("transform", (d) => `translate(${d.x0},${d.y0})`)
    .classed("selected", (d) => d.data.id === vizSelected)
    .on("click", (ev, d) => {
      if (d.data.children?.length) {
        vizPath.push(d.data.id);
        renderMindmap();
      } else {
        vizSelect(d.data);
        g.selectAll(".tm-cell").classed("selected", (n) => n.data.id === vizSelected);
      }
    });

  cell.append("rect")
    .attr("width", (d) => d.x1 - d.x0)
    .attr("height", (d) => d.y1 - d.y0)
    .attr("rx", 6)
    .attr("fill", (d) => nodeColor(d.data))
    .attr("fill-opacity", (d) => KIND_OPACITY[d.data.kind] ?? 0.5);

  cell.append("title").text((d) => `${vizLabel(d.data)} (${d.data.events.length})`);

  cell.filter((d) => d.x1 - d.x0 > 70 && d.y1 - d.y0 > 30)
    .append("text").attr("class", "tm-label")
    .attr("x", 8).attr("y", 18)
    .each(function (d) {
      const tx = d3.select(this);
      const maxChars = Math.floor((d.x1 - d.x0 - 14) / 7);
      const name = vizLabel(d.data);
      tx.append("tspan").text(name.length > maxChars ? name.slice(0, maxChars - 1) + "…" : name);
      tx.append("tspan").attr("class", "mm-count").attr("x", 8).attr("dy", "1.3em")
        .text(`${d.data.events.length}${d.data.children?.length ? " ›" : ""}`);
    });
}

/* ====================================================================
   3) Zoombarer Sunburst
==================================================================== */

function renderSunburstViz() {
  const rect = $("#mindmap-view").getBoundingClientRect();
  const size = Math.min(rect.width, rect.height) - 20;
  const radius = size / 8;
  const svg = d3.select("#mindmap");
  svg.selectAll("*").remove();
  svg.attr("viewBox", [-rect.width / 2, -rect.height / 2, rect.width, rect.height]);

  const hierarchy = d3.hierarchy(buildExploreTree())
    .sum((d) => (d.children?.length ? 0 : Math.max(1, d.events.length)))
    .sort((a, b) => b.value - a.value);
  const root = d3.partition().size([2 * Math.PI, hierarchy.height + 1])(hierarchy);
  root.each((d) => (d.current = d));

  const arc = d3.arc()
    .startAngle((d) => d.x0).endAngle((d) => d.x1)
    .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.004))
    .padRadius(radius * 1.5)
    .innerRadius((d) => d.y0 * radius)
    .outerRadius((d) => Math.max(d.y0 * radius, d.y1 * radius - 1.5));

  const g = svg.append("g");
  const path = g.selectAll("path")
    .data(root.descendants().slice(1))
    .join("path")
    .attr("class", "sb-arc")
    .attr("fill", (d) => nodeColor(d.data))
    .attr("fill-opacity", (d) => (arcVisible(d.current) ? (KIND_OPACITY[d.data.kind] ?? 0.5) : 0))
    .attr("pointer-events", (d) => (arcVisible(d.current) ? "auto" : "none"))
    .attr("d", (d) => arc(d.current))
    .classed("selected", (d) => d.data.id === vizSelected)
    .on("click", clicked);
  path.append("title").text((d) => `${vizLabel(d.data)} (${d.data.events.length})`);

  const label = g.selectAll("text")
    .data(root.descendants().slice(1))
    .join("text")
    .attr("class", "sb-label")
    .attr("dy", "0.35em")
    .attr("fill-opacity", (d) => +labelVisible(d.current))
    .attr("transform", (d) => labelTransform(d.current))
    .text((d) => {
      const n = vizLabel(d.data);
      return n.length > 22 ? n.slice(0, 21) + "…" : n;
    });

  let parent = root;
  const center = g.append("circle")
    .datum(root)
    .attr("r", radius)
    .attr("fill", "none")
    .attr("pointer-events", "all")
    .style("cursor", "pointer")
    .on("click", clicked);
  const centerLabel = g.append("text")
    .attr("class", "sb-center")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .text("Alle Themen");

  function clicked(ev, p) {
    if (p.data.id) {
      if (p.data.kind !== "group") {
        vizSelect(p.data);
        path.classed("selected", (n) => n.data.id === vizSelected);
      }
      if (!p.children) return; // Blatt: nur Panel, kein Zoom
    }
    parent = p.parent || root;
    center.datum(parent);
    centerLabel.text(p.data.id ? vizLabel(p.data) : "Alle Themen");

    root.each((d) => (d.target = {
      x0: Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
      x1: Math.max(0, Math.min(1, (d.x1 - p.x0) / (p.x1 - p.x0))) * 2 * Math.PI,
      y0: Math.max(0, d.y0 - p.depth),
      y1: Math.max(0, d.y1 - p.depth),
    }));

    const t = g.transition().duration(420);
    path.transition(t)
      .tween("data", (d) => {
        const i = d3.interpolate(d.current, d.target);
        return (x) => (d.current = i(x));
      })
      .attr("fill-opacity", (d) => (arcVisible(d.target) ? (KIND_OPACITY[d.data.kind] ?? 0.5) : 0))
      .attr("pointer-events", (d) => (arcVisible(d.target) ? "auto" : "none"))
      .attrTween("d", (d) => () => arc(d.current));
    label.transition(t)
      .attr("fill-opacity", (d) => +labelVisible(d.target))
      .attrTween("transform", (d) => () => labelTransform(d.current));
  }

  function arcVisible(d) { return d.y1 <= 4 && d.y0 >= 1 && d.x1 > d.x0; }
  function labelVisible(d) {
    return d.y1 <= 4 && d.y0 >= 1 && (d.y1 - d.y0) * (d.x1 - d.x0) > 0.04;
  }
  function labelTransform(d) {
    const x = ((d.x0 + d.x1) / 2) * 180 / Math.PI;
    const y = ((d.y0 + d.y1) / 2) * radius;
    return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
  }
}

/* ====================================================================
   4) Aufklappbarer Baum (bisherige Mindmap)
==================================================================== */

const MM_COL = 270;
const MM_ROW = 30;
const TREE = { inited: false, g: null, zoom: null, expanded: new Set(), centered: false };

function initTreeViz() {
  const svg = d3.select("#mindmap");
  TREE.g = svg.append("g");
  TREE.g.append("g").attr("class", "mm-cross");
  TREE.g.append("g").attr("class", "mm-links");
  TREE.g.append("g").attr("class", "mm-nodes");
  TREE.zoom = d3.zoom().scaleExtent([0.35, 2.5])
    .on("zoom", (ev) => TREE.g.attr("transform", ev.transform));
  svg.call(TREE.zoom);
  TREE.inited = true;
  TREE.centered = false;
}

function pruneForTree(node) {
  const copy = { ...node, name: vizLabel(node), kids: node.children || [] };
  copy.children = (node.kind === "root" || TREE.expanded.has(node.id)) && node.children
    ? node.children.map(pruneForTree)
    : null;
  return copy;
}

function treeRadius(d) {
  const n = d.events.length;
  if (d.kind === "group") return 9;
  if (d.kind === "cat") return Math.min(13, 4.5 + Math.sqrt(n) * 0.27);
  return Math.min(9, 3.5 + Math.sqrt(n) * 0.22);
}

function renderTreeViz() {
  if (!TREE.inited) initTreeViz();
  const svg = d3.select("#mindmap");
  const rect = $("#mindmap-view").getBoundingClientRect();
  svg.attr("viewBox", [0, 0, rect.width, rect.height]);

  const root = d3.hierarchy(pruneForTree(buildExploreTree()));
  d3.tree().nodeSize([MM_ROW, MM_COL])(root);
  const nodes = root.descendants().filter((d) => d.depth > 0);
  const links = root.links().filter((l) => l.source.depth > 0);
  for (const n of nodes) {
    n.px = (n.depth - 1) * MM_COL + 30;
    n.py = n.x;
  }

  if (!TREE.centered) {
    svg.call(TREE.zoom.transform, d3.zoomIdentity.translate(24, rect.height / 2));
    TREE.centered = true;
  }

  const t = d3.transition().duration(250);

  TREE.g.select(".mm-links").selectAll("path")
    .data(links, (l) => l.target.data.id)
    .join(
      (enter) => enter.append("path").attr("class", "mm-link").attr("opacity", 0)
        .attr("d", (l) => treeLinkPath(l.source, l.target)),
      (update) => update,
      (exit) => exit.remove()
    )
    .transition(t)
    .attr("opacity", 1)
    .attr("d", (l) => treeLinkPath(l.source, l.target));

  // Querverbindungen: gleiches Unterthema unter verschiedenen Kategorien
  const byBid = {};
  for (const n of nodes) if (n.data.kind === "bucket") (byBid[n.data.bid] ??= []).push(n);
  const cross = [];
  for (const group of Object.values(byBid)) {
    group.sort((a, b) => a.py - b.py);
    for (let i = 0; i < group.length - 1; i++) cross.push([group[i], group[i + 1]]);
  }
  TREE.g.select(".mm-cross").selectAll("path")
    .data(cross, (c) => `${c[0].data.id}|${c[1].data.id}`)
    .join("path")
    .attr("class", "mm-link--cross")
    .attr("d", (c) => {
      const bow = Math.max(c[0].px, c[1].px) + 170;
      return `M${c[0].px},${c[0].py} C${bow},${c[0].py} ${bow},${c[1].py} ${c[1].px},${c[1].py}`;
    });

  const nodeSel = TREE.g.select(".mm-nodes").selectAll("g.mm-node")
    .data(nodes, (n) => n.data.id)
    .join((enter) => {
      const g = enter.append("g").attr("class", "mm-node").attr("opacity", 0);
      g.append("circle");
      g.append("text").attr("class", "mm-label");
      g.append("title");
      return g;
    })
    .classed("selected", (n) => vizSelected === n.data.id)
    .on("click", (ev, d) => treeClick(d.data));

  nodeSel.transition(t)
    .attr("opacity", 1)
    .attr("transform", (n) => `translate(${n.px},${n.py})`);

  nodeSel.select("circle")
    .attr("r", (n) => treeRadius(n.data))
    .attr("fill", (n) => nodeColor(n.data))
    .attr("fill-opacity", (n) => (n.data.kind === "group" || n.data.kind === "cat" ? 1 : 0.55));

  nodeSel.select("title").text((n) => `${n.data.name} (${n.data.events.length})`);

  nodeSel.select("text.mm-label")
    .attr("x", (n) => treeRadius(n.data) + 7)
    .attr("dy", "0.32em")
    .attr("font-size", (n) => (n.data.kind === "group" ? 13.5 : n.data.kind === "cat" ? 12 : 11))
    .attr("font-weight", (n) => (n.data.kind === "group" ? 700 : n.data.kind === "cat" ? 600 : 400))
    .each(function (n) {
      const d = n.data;
      const tx = d3.select(this);
      tx.selectAll("tspan").remove();
      tx.text(null);
      tx.append("tspan").text(d.name.length > 34 ? d.name.slice(0, 33) + "…" : d.name);
      tx.append("tspan").attr("class", "mm-count").text(`  ${d.events.length}`);
      if (d.kids?.length) {
        tx.append("tspan").attr("class", "mm-chevron")
          .text(TREE.expanded.has(d.id) ? " ▾" : " ▸");
      }
    });
}

function treeLinkPath(s, tgt) {
  const mid = (s.px + tgt.px) / 2;
  return `M${s.px},${s.py} C${mid},${s.py} ${mid},${tgt.py} ${tgt.px},${tgt.py}`;
}

function treeClick(d) {
  if (d.kind === "group") {
    if (TREE.expanded.has(d.id)) {
      TREE.expanded.delete(d.id);
      for (const kid of d.kids) TREE.expanded.delete(kid.id);
      if (vizSelected?.startsWith("c:") || vizSelected?.startsWith("b:")) hidePanel();
    } else {
      TREE.expanded.add(d.id);
    }
    renderTreeViz();
    return;
  }
  if (d.kind === "cat") {
    if (vizSelected === d.id) {
      TREE.expanded.delete(d.id);
      hidePanel();
    } else {
      if (d.kids.length) TREE.expanded.add(d.id);
      vizSelect(d);
    }
    renderTreeViz();
    return;
  }
  vizSelect(d);
  renderTreeViz();
}

/* ====================================================================
   5) Kachel-Browser (ohne Chart)
==================================================================== */

function renderTilesViz() {
  const chain = resolvePath(buildExploreTree());
  renderBreadcrumb(chain);
  const current = chain.at(-1);
  const tiles = $("#mm-tiles");

  const children = current.children || [];
  tiles.innerHTML = children.map((c) => `
    <button class="tile ${c.id === vizSelected ? "selected" : ""}" data-id="${c.id}"
            style="--tile-color:${nodeColor(c)}">
      <span class="tile-icon">${c.kind === "group" ? c.icon : c.kind === "cat" ? CAT_GROUPS[c.gid].icon : "🔎"}</span>
      <span class="tile-name">${c.name}</span>
      <span class="tile-count">${c.events.length} Veranstaltung${c.events.length === 1 ? "" : "en"}${c.children?.length ? " ›" : ""}</span>
    </button>`).join("");

  tiles.querySelectorAll(".tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      const node = children.find((c) => c.id === tile.dataset.id);
      if (node.children?.length) {
        vizPath.push(node.id);
        renderMindmap();
      } else {
        vizSelect(node);
        tiles.querySelectorAll(".tile").forEach((t2) =>
          t2.classList.toggle("selected", t2.dataset.id === vizSelected));
      }
    });
  });
}
