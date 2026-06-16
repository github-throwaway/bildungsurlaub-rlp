/* „Zufall"-Ansicht: Veranstaltungen einzeln im Tinder-/TikTok-Stil
   durchwischen. Nach rechts/★ = merken, nach links/✕ = weiter.
   Quelle ist die aktuell gefilterte Treffermenge in zufälliger Reihenfolge. */
"use strict";

let swipeQueue = [];
let swipePos = 0;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startSwipe() {
  swipeQueue = shuffle(filtered);
  swipePos = 0;
  renderSwipeDeck();
}

function swipeCardEl(e, isTop) {
  const org = DATA.organizers[e.org] || {};
  const el = document.createElement("article");
  el.className = "swipe-card" + (isTop ? " top" : "");
  el.innerHTML = `
    <div class="sw-badges">
      <span class="badge badge--ort">${flag(e.land)} ${e.ort}${e.land && e.land !== "Deutschland" ? ", " + e.land : ""}</span>
      <span class="badge badge--datum">📅 ${fmtDate(e.start)}${e.end ? " – " + fmtDate(e.end) : ""} · ${e.tage ?? "?"} Tage</span>
      ${e.thema ? `<span class="badge badge--thema">${e.thema}</span>` : ""}
      ${e.typ_bis ? `<span class="badge badge--typ">🔁 wiederholbar</span>` : ""}
    </div>
    <h2>${e.title}</h2>
    <div class="sw-org"><strong>${org.name || "Unbekannter Veranstalter"}</strong></div>
    <div class="sw-links">
      ${org.web ? `<a href="${org.web}" target="_blank" rel="noopener">Website</a>` : ""}
      ${org.mail ? `<a href="mailto:${org.mail}">E-Mail</a>` : ""}
      <a href="${awvLink(e.kz)}" target="_blank" rel="noopener">AWV-Eintrag ↗</a>
    </div>
    <div class="sw-stamp sw-stamp--like">★ Merken</div>
    <div class="sw-stamp sw-stamp--nope">✕ Weiter</div>`;
  return el;
}

function renderSwipeDeck() {
  const deck = $("#swipe-deck");
  const empty = $("#swipe-empty");
  const actions = $("#swipe-actions");
  deck.innerHTML = "";

  if (swipePos >= swipeQueue.length) {
    actions.style.visibility = "hidden";
    $("#swipe-progress").textContent = "";
    empty.hidden = false;
    empty.innerHTML = swipeQueue.length
      ? `Alles durchgesehen! 🎉<br><button id="sw-restart" class="more-btn">Neu mischen</button>`
      : "Keine Veranstaltungen – bitte Filter lockern.";
    $("#sw-restart")?.addEventListener("click", startSwipe);
    return;
  }

  empty.hidden = true;
  actions.style.visibility = "visible";
  $("#swipe-progress").textContent = `${swipePos + 1} / ${swipeQueue.length}`;

  const next = swipeQueue[swipePos + 1];
  if (next) deck.appendChild(swipeCardEl(next, false));
  const top = swipeCardEl(swipeQueue[swipePos], true);
  deck.appendChild(top);
  attachSwipeDrag(top);
}

function swipeAdvance(liked) {
  const e = swipeQueue[swipePos];
  if (liked && e) {
    const id = eventId(e);
    if (!FAVS.has(id)) toggleFav(id);
  }
  swipePos++;
  setTimeout(renderSwipeDeck, 200);
}

function swipeFlyOut(card, dir) {
  card.style.transition = "transform .25s ease, opacity .25s ease";
  card.style.transform = `translate(${dir * 600}px, -40px) rotate(${dir * 28}deg)`;
  card.style.opacity = "0";
}

function swipeButton(liked) {
  const top = document.querySelector(".swipe-card.top");
  if (top) swipeFlyOut(top, liked ? 1 : -1);
  swipeAdvance(liked);
}

function swipeShowOnMap() {
  const e = swipeQueue[swipePos];
  if (!e) return;
  const c = DATA.places[`${e.ort}|${e.land}`];
  switchView("map");
  if (c) setTimeout(() => map.setView(c, 11), 70);
}

function attachSwipeDrag(card) {
  let startX = 0, startY = 0, dx = 0, dy = 0, dragging = false;
  card.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest("a")) return; // Links nicht abfangen
    dragging = true; startX = ev.clientX; startY = ev.clientY;
    card.setPointerCapture(ev.pointerId);
    card.style.transition = "none";
  });
  card.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    dx = ev.clientX - startX; dy = ev.clientY - startY;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    card.classList.toggle("like", dx > 40);
    card.classList.toggle("nope", dx < -40);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    if (dx > 110) { swipeFlyOut(card, 1); swipeAdvance(true); }
    else if (dx < -110) { swipeFlyOut(card, -1); swipeAdvance(false); }
    else {
      card.style.transition = "transform .25s ease";
      card.style.transform = "";
      card.classList.remove("like", "nope");
    }
    dx = 0; dy = 0;
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}
