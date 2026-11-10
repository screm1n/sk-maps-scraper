// Maps Scraper — "Painel" (dashboard) mode for the local gosom/google-maps-scraper REST API.
// Same API/data as the map mode (app.js); a job can be opened directly with /painel#job=<id>,
// otherwise the most recent finished search opens automatically.
(() => {
  "use strict";

  const API = "/api/v1/jobs";
  const POLL_MS = 4000;
  const JOINER = { pt: "em", en: "in", es: "en" };   // "dentista em Barra Funda"
  const STATUS = { ok: "Concluída", working: "Rodando", pending: "Na fila", failed: "Falhou" };
  const MINUTES = { 1: 2, 5: 4, 10: 7, 20: 15 };
  const ICON = {
    del: '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>',
    open: '<svg viewBox="0 0 24 24"><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>',
  };
  const PIN = (color) => `<svg viewBox="0 0 27 43"><path fill="${color}" stroke="#fff" stroke-width="1.5" d="M13.5 1C6.6 1 1 6.6 1 13.5 1 23 13.5 42 13.5 42S26 23 26 13.5C26 6.6 20.4 1 13.5 1z"/><circle cx="13.5" cy="13.5" r="4.5" fill="#fff" fill-opacity=".9"/></svg>`;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => (+n || 0).toLocaleString("pt-BR");

  // Jobs come back with Go-style capitalized keys; accept either.
  const norm = (j) => {
    const d = j.Data || j.data || {};
    return {
      id: j.ID || j.id, name: j.Name || j.name, date: j.Date || j.date,
      status: (j.Status || j.status || "").toLowerCase(), keywords: d.keywords || [],
      depth: d.depth, email: d.email, lang: d.lang,
      lat: +d.lat || 0, lon: +d.lon || 0, radius: +d.radius || 0,
    };
  };

  const state = { jobs: [], stats: {}, prevStatus: {}, current: null, rows: [], visible: [], geo: null, submitting: false, depth: 5, booted: false };

  // ───────────────────────── utils ─────────────────────────
  function toast(msg, ms = 4000) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
  }
  function store(k, v) { try { localStorage.setItem("ms:" + k, JSON.stringify(v)); } catch {} }
  function load(k, d) { try { const v = localStorage.getItem("ms:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } }

  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "agora";
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
    return new Date(iso).toLocaleDateString("pt-BR");
  }

  // RFC 4180 CSV parser (quoted fields, embedded commas/newlines).
  function parseCSV(text) {
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
      else if (c !== "\r") f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    const [head, ...body] = rows;
    if (!head) return [];
    head[0] = head[0].replace(/^﻿/, "");
    return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
  }

  function toCSV(headers, rows, sep) {
    const cell = (v) => { v = String(v ?? ""); return /[";,\n\r\t]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    return [headers, ...rows].map((r) => r.map(cell).join(sep)).join("\r\n");
  }

  function saveFile(name, content, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "busca";
  const digits = (s) => String(s || "").replace(/\D/g, "");
  const emailsOf = (r) => String(r.emails || "").split(/[\s,;]+/).filter((e) => e.includes("@"));

  // Brazilian mobile (DDD + 9xxxxxxxx), or a number with a foreign code → WhatsApp Web chat.
  function whatsapp(phone) {
    let d = digits(phone);
    if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
    if (d.length === 11 && d[2] === "9") return `https://web.whatsapp.com/send/?phone=55${d}`;
    // Abroad ("+1 305...", "+351 9..."): can't tell mobile from landline here, so offer it.
    const intl = digits(phone);
    return /^\s*\+/.test(String(phone)) && !intl.startsWith("55") && intl.length >= 9 && intl.length <= 15
      ? `https://web.whatsapp.com/send/?phone=${intl}` : null;
  }

  // Great-circle distance in meters.
  function distance(lat1, lon1, lat2, lon2) {
    const R = 6371000, rad = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  // Google Maps has no hard radius in normal mode, so we zoom the search viewport to fit the circle
  // and filter results outside it afterwards (same as app.js).
  const zoomFor = (meters, lat) => Math.max(11, Math.min(17, Math.round(Math.log2((156543 * Math.cos((lat * Math.PI) / 180) * 1000) / (2 * meters)))));
  const radiusMeters = () => (+$("#radius").value || 5) * 1000;

  // ───────────────────────── maps ─────────────────────────
  const hasMap = typeof L !== "undefined";
  const tiles = () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, className: "map-tiles", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
  const pinIcon = (color, hl) => L.divIcon({ className: "pin-icon" + (hl ? " hl" : ""), html: PIN(color), iconSize: [25, 40], iconAnchor: [12.5, 39], popupAnchor: [0, -36] });
  const circleStyle = { color: "#1a73e8", weight: 2, opacity: .6, fillColor: "#1a73e8", fillOpacity: .07, interactive: false };

  let geoMap, geoMarker, geoCircle, map, markerLayer;

  const markers = {};

  function showGeoPreview(g) {
    const box = $("#geo-map");
    if (!hasMap || !g) { box.hidden = true; return; }
    box.hidden = false;
    if (!geoMap) {
      geoMap = L.map(box, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false });
      tiles().addTo(geoMap);
    }
    geoMap.invalidateSize();
    geoMap.setView([g.lat, g.lon], 13, { animate: false });   // a view must exist before adding the circle
    if (geoMarker) geoMarker.remove();
    if (geoCircle) geoCircle.remove();
    geoMarker = L.marker([g.lat, g.lon], { icon: pinIcon("#1a73e8") }).addTo(geoMap);
    geoCircle = L.circle([g.lat, g.lon], { ...circleStyle, radius: radiusMeters(), opacity: .8, fillOpacity: .1 }).addTo(geoMap);
    geoMap.fitBounds(geoCircle.getBounds(), { padding: [10, 10] });
  }

  function ensureResultsMap() {
    if (!hasMap) return false;
    if (!map) {
      map = L.map("map").setView([-23.55, -46.63], 12);
      tiles().addTo(map);
      markerLayer = L.layerGroup().addTo(map);
    }
    map.invalidateSize();
    return true;
  }

  function plotRows(rows) {
    if (!ensureResultsMap()) return;
    markerLayer.clearLayers();
    for (const k in markers) delete markers[k];
    const job = currentJob();
    if (job.lat && job.radius) L.circle([job.lat, job.lon], { ...circleStyle, radius: job.radius }).addTo(markerLayer);
    const pts = [];
    rows.forEach((r, i) => {
      const lat = +r.latitude, lon = +r.longitude;
      if (!lat || !lon) return;
      markers[i] = L.marker([lat, lon], { icon: pinIcon("#ea4335"), riseOnHover: true })
        .bindPopup(`<b>${esc(r.title)}</b><br>${esc(r.category)}${r.phone ? `<br>${esc(r.phone)}` : ""}`)
        .on("click", () => highlight(i, true))
        .addTo(markerLayer);
      pts.push([lat, lon]);
    });
    if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
  }

  function highlight(i, scrollRow) {
    $$("#results-table tbody tr.hl").forEach((tr) => tr.classList.remove("hl"));
    Object.entries(markers).forEach(([k, m]) => m.setIcon(pinIcon("#ea4335", +k === i)));
    const tr = $(`#results-table tbody tr[data-i="${i}"]`);
    if (tr) { tr.classList.add("hl"); if (scrollRow) tr.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }

  // ───────────────────────── health + jobs ─────────────────────────
  const currentJob = () => state.jobs.find((j) => j.id === state.current) || {};

  function setHealth(ok) {
    const h = $("#health");
    h.className = "health " + (ok ? "ok" : "down");
    h.lastElementChild.textContent = ok ? "Scraper online" : "Offline: abra o Docker Desktop";
  }

  async function refreshJobs() {
    try {
      const r = await fetch(API, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const list = (await r.json()) || [];
      setHealth(true);
      state.jobs = list.map(norm).sort((a, b) => new Date(b.date) - new Date(a.date));
      for (const j of state.jobs) {
        const prev = state.prevStatus[j.id];
        if (j.status === "ok" && !state.stats[j.id]) loadStats(j);
        if (prev && prev !== j.status && j.status === "ok") notifyDone(j);
        if (prev && prev !== j.status && j.status === "failed") toast(`A busca “${j.name}” falhou.`);
        state.prevStatus[j.id] = j.status;
      }
      renderJobs(); renderKPIs();
      if (!state.booted) { state.booted = true; openInitial(); }
    } catch {
      setHealth(false);
      if (!state.jobs.length) $("#jobs").innerHTML = `<li class="empty">Não consegui falar com o scraper.<br>Confira se o Docker Desktop está aberto.</li>`;
    }
  }

  // #job=<id> if present, otherwise the most recent finished search — results show up without a click.
  function openInitial() {
    const m = location.hash.match(/job=([\w-]+)/);
    const job = (m && state.jobs.find((j) => j.id === m[1] && j.status === "ok")) || state.jobs.find((j) => j.status === "ok");
    if (job) openResults(job, { scroll: false, announce: false });
  }

  const rowsCache = {};
  async function fetchRows(id) {
    if (rowsCache[id]) return rowsCache[id];
    const r = await fetch(`${API}/${id}/download`, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    return (rowsCache[id] = parseCSV(await r.text()));
  }

  async function loadStats(j) {
    state.stats[j.id] = { loading: true };
    try {
      const rows = await fetchRows(j.id);
      state.stats[j.id] = { n: rows.length, phone: rows.filter((r) => r.phone).length, email: rows.filter((r) => emailsOf(r).length).length, withEmail: !!j.email };
    } catch { state.stats[j.id] = { error: true }; }
    renderJobs(); renderKPIs();
  }

  async function notifyDone(j) {
    try { toast(`Busca “${j.name}” concluída: ${(await fetchRows(j.id)).length} empresas.`, 6000); }
    catch { toast(`Busca “${j.name}” concluída.`); }
  }

  function renderKPIs() {
    const done = state.jobs.filter((j) => j.status === "ok");
    const s = done.map((j) => state.stats[j.id]).filter((x) => x && x.n != null);
    const sum = (k) => s.reduce((a, x) => a + x[k], 0);
    const places = sum("n"), phone = sum("phone");
    const emailJobs = s.filter((x) => x.withEmail);
    const emailBase = emailJobs.reduce((a, x) => a + x.n, 0), email = emailJobs.reduce((a, x) => a + x.email, 0);
    const busy = state.jobs.filter((j) => j.status === "working" || j.status === "pending").length;
    $("#kpi-jobs").textContent = fmt(state.jobs.length);
    $("#kpi-jobs-hint").textContent = busy ? `${busy} em andamento` : `${done.length} concluídas`;
    $("#kpi-places").textContent = fmt(places);
    $("#kpi-phone").textContent = fmt(phone);
    $("#kpi-phone-hint").textContent = places ? `${Math.round((phone / places) * 100)}% das empresas` : " ";
    $("#kpi-email").textContent = fmt(email);
    $("#kpi-email-hint").textContent = emailBase ? `${Math.round((email / emailBase) * 100)}% nas buscas com e-mail` : "só em buscas com e-mail ligado";
    const badge = $("#nav-badge"); badge.hidden = !busy; badge.textContent = busy;
  }

  function renderJobs() {
    const box = $("#jobs");
    const running = state.jobs.filter((j) => j.status === "working").length;
    const queued = state.jobs.filter((j) => j.status === "pending").length;
    $("#queue-info").textContent = running || queued ? `${running} rodando · ${queued} na fila` : "";
    if (!state.jobs.length) {
      box.innerHTML = `<li class="empty">Nenhuma busca ainda. Crie a primeira ao lado.</li>`;
      renderJobs._last = null;
      return;
    }
    const html = state.jobs.map((j) => {
      const st = state.stats[j.id];
      const done = j.status === "ok";
      const count = done && st && st.n != null
        ? `<div class="job-count"><b>${fmt(st.n)}</b><span>empresas</span></div>`
        : `<div class="job-count"></div>`;
      const del = j.status === "working"
        ? `<button class="icon-btn danger" data-act="delete" title="Parar esta busca e apagá-la" aria-label="Parar">${ICON.stop}</button>`
        : `<button class="icon-btn danger" data-act="delete" title="Apagar esta busca" aria-label="Apagar">${ICON.del}</button>`;
      return `<li class="job ${esc(j.status)} ${state.current === j.id ? "active" : ""}" data-id="${esc(j.id)}" ${done ? 'tabindex="0" role="button" title="Ver resultados"' : ""}>
        <div>
          <div class="job-title">${esc(j.name || j.keywords.join(", "))}</div>
          <div class="job-meta">
            <span class="status ${esc(j.status)}"><i class="dot ${esc(j.status)}"></i>${esc(STATUS[j.status] || j.status)}</span>
            <span>${esc(ago(j.date))}</span>
            ${j.email ? "<span>com e-mails</span>" : ""}
          </div>
        </div>
        ${count}
        <div class="job-actions">${del}${done ? `<span class="icon-btn" aria-hidden="true">${ICON.open}</span>` : ""}</div>
        ${j.status === "working" ? '<div class="progress" title="Coletando no Google Maps…"></div>' : ""}
      </li>`;
    }).join("");
    // Only touch the DOM when something changed, so polling doesn't eat clicks/hover.
    if (html !== renderJobs._last) { box.innerHTML = html; renderJobs._last = html; }
  }


  // ───────────────────────── WhatsApp with the lead's message ─────────────────────────
  // Same templates and rules as the Leads queue (opener, few reviews, has a site...). The tab
  // is opened right on the click (popup blockers) and reused, so WhatsApp Web stays in one tab.
  document.addEventListener("click", async (e) => {
    const a = e.target.closest("a[data-wa]");
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    const r = state.visible[+a.dataset.wa];
    const aba = window.open("", "whatsapp");
    let url = a.href;
    try {
      const resp = await fetch("/leads-api/mensagem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linha: r }) });
      const m = resp.ok ? await resp.json() : null;
      if (m?.link) url = m.link;
      else if (m?.corpo) url = a.href + "&text=" + encodeURIComponent(m.corpo);
    } catch {}
    if (aba) aba.location.href = url; else window.open(url, "whatsapp");
  }, true);

  async function deleteJob(job) {
    const parar = job.status === "working" || job.status === "pending";
    if (!parar && !confirm(`Apagar a busca “${job.name}”? Os resultados somem daqui (arquivos já baixados continuam no seu computador).`)) return;
    // Gone from the list right away; the server makes sure it stays gone.
    state.jobs = state.jobs.filter((j) => j.id !== job.id);
    renderJobs();
    const r = await fetch(`${API}/${encodeURIComponent(job.id)}`, { method: "DELETE" }).catch(() => null);
    if (!r || !r.ok) { toast("O servidor não respondeu. Tente de novo."); return refreshJobs(); }
    delete rowsCache[job.id]; delete state.stats[job.id];
    if (state.current === job.id) closeResults();
    toast(parar ? "Busca parada." : "Busca apagada.");
    refreshJobs();
  }


  $("#jobs").addEventListener("click", (e) => {
    const li = e.target.closest(".job");
    const job = li && state.jobs.find((j) => j.id === li.dataset.id);
    if (!job) return;
    // Mouse clicks on the button are handled on pointerdown (below); this is the keyboard path.
    if (e.target.closest("[data-act=delete]")) return e.detail === 0 ? deleteJob(job) : undefined;
    if (job.status === "ok") openResults(job, { scroll: true });
  });
  // The list is redrawn while searches run; a redraw between press and release would swallow
  // the click. Acting on press makes "stop" work on the first try, every time.
  $("#jobs").addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const btn = e.target.closest("[data-act=delete]");
    const li = btn && btn.closest(".job");
    const job = li && state.jobs.find((j) => j.id === li.dataset.id);
    if (!job) return;
    e.preventDefault();
    deleteJob(job);
  });
  $("#jobs").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const li = e.target.closest(".job.ok");
    const job = li && state.jobs.find((j) => j.id === li.dataset.id);
    if (job) openResults(job, { scroll: true });
  });

  // ───────────────────────── form controls ─────────────────────────
  function updateAmountHint() {
    const min = MINUTES[state.depth] || 5;
    $("#amount-hint").textContent = `Aproximado · leva ~${$("#email").checked ? min * 2 : min} min`;
  }
  $$(".seg button").forEach((b) => b.addEventListener("click", () => setDepth(+b.dataset.depth)));
  function setDepth(d) {
    state.depth = d;
    const btns = $$(".seg button");
    btns.forEach((b) => { const on = +b.dataset.depth === d; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
    $(".seg").style.setProperty("--idx", Math.max(0, btns.findIndex((b) => +b.dataset.depth === d)));   // slides the glass thumb
    updateAmountHint();
  }
  $("#email").addEventListener("change", updateAmountHint);

  function syncRadius() {
    const km = +$("#radius").value;
    $("#radius-val").textContent = `${km} km`;
    $("#radius").style.setProperty("--fill-pct", `${((km - 1) / 19) * 100}%`);
    $("#radius-hint").textContent = state.geo ? "Área em volta do local, no mapa acima." : "Digite o local para ver a área no mapa.";
    if (state.geo) showGeoPreview(state.geo);
  }
  $("#radius").addEventListener("input", syncRadius);

  // ───────────────────────── geocoding ─────────────────────────
  // Prefer Brazil first ("Barra Funda" alone would otherwise land on the town in RS), then worldwide.
  const geoCache = load("geo2", {});
  async function nominatim(place, extra) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&accept-language=pt-BR${extra}&q=${encodeURIComponent(place)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("geocode " + r.status);
    return (await r.json())[0];
  }
  async function geocode(place) {
    const key = place.trim().toLowerCase();
    if (!key) return null;
    if (geoCache[key]) return geoCache[key];
    const hit = (await nominatim(place, "&countrycodes=br")) || (await nominatim(place, ""));
    if (!hit) return null;
    const a = hit.address || {};
    const uf = (a["ISO3166-2-lvl4"] || "").split("-")[1];
    const label = [a.suburb || a.neighbourhood || a.city_district || a.quarter, a.city || a.town || a.village || a.municipality,
      a.country_code === "br" ? uf || a.state : [a.state, a.country].filter(Boolean).join(", ")]
      .filter(Boolean).join(", ") || hit.display_name.split(",").slice(0, 3).join(",");
    const g = { lat: (+hit.lat).toFixed(6), lon: (+hit.lon).toFixed(6), label };
    geoCache[key] = g; store("geo2", geoCache);
    return g;
  }

  let geoTimer;
  async function checkLocation() {
    const place = $("#location").value.trim();
    const hint = $("#geo-status");
    state.geo = null;
    if (!place) { hint.className = "geo-status"; hint.textContent = ""; showGeoPreview(null); syncRadius(); return null; }
    hint.className = "geo-status"; hint.textContent = "Localizando…";
    try {
      const g = await geocode(place);
      if ($("#location").value.trim() !== place) return null;   // user kept typing
      if (!g) {
        hint.className = "geo-status warn"; hint.textContent = "Não achei esse lugar no mapa. A busca usa o texto digitado.";
        showGeoPreview(null); syncRadius(); return null;
      }
      state.geo = g;
      hint.className = "geo-status ok";
      hint.textContent = "📍 " + g.label;
      syncRadius();
      return g;
    } catch {
      hint.className = "geo-status warn"; hint.textContent = "Sem acesso ao serviço de mapas. A busca usa o texto digitado.";
      return null;
    }
  }
  $("#location").addEventListener("input", () => { clearTimeout(geoTimer); geoTimer = setTimeout(checkLocation, 600); });
  $("#keyword").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("#location").value.trim()) { e.preventDefault(); $("#location").focus(); } });

  // ───────────────────────── submit ─────────────────────────
  function showError(msg) { const e = $("#form-error"); e.textContent = msg; e.hidden = !msg; }

  $("#search-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.submitting) return;                 // guards against double clicks
    showError("");
    const terms = $("#keyword").value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    const place = $("#location").value.trim();
    if (!terms.length) { $("#keyword").focus(); return showError("Diga o que você procura. Ex.: dentista."); }
    if (!place) { $("#location").focus(); return showError("Diga onde procurar. Ex.: Barra Funda, São Paulo."); }

    const lang = $("#lang").value, depth = state.depth, email = $("#email").checked;
    const keywords = terms.map((t) => `${t} ${JOINER[lang] || "em"} ${place}`);
    const dup = state.jobs.find((j) => (j.status === "pending" || j.status === "working") && j.keywords.join("|") === keywords.join("|"));
    if (dup && !confirm("Essa mesma busca já está rodando ou na fila. Criar outra igual?")) return;

    state.submitting = true;
    const btn = $("#submit"); btn.disabled = true; btn.querySelector(".btn-label").textContent = "Enviando…";
    try {
      const g = state.geo || await checkLocation();
      const autoSecs = Math.min(3600, Math.max(300, terms.length * (120 + depth * 40) * (email ? 2 : 1)));
      const maxMin = +$("#maxtime").value;
      const body = {
        name: `${terms.join(", ")} · ${place.split(",")[0].trim()}`,
        keywords, lang, depth, email,
        // lat/lon only bias the map viewport; the place is also in the keyword text,
        // so an un-geocodable place still works (the API just requires *some* coordinates).
        lat: g ? g.lat : "0", lon: g ? g.lon : "0",
        zoom: g ? zoomFor(radiusMeters(), +g.lat) : 14, radius: radiusMeters(),
        fast_mode: false, max_time: maxMin ? maxMin * 60 : autoSecs,
      };
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) {
        let msg = `O scraper recusou a busca (erro ${r.status}).`;
        try { const j = await r.json(); if (j.message) msg += ` ${j.message}`; } catch {}
        throw new Error(msg);
      }
      const busy = state.jobs.some((j) => j.status === "working" || j.status === "pending");
      toast(busy ? "Busca criada! Ela começa quando a atual terminar." : "Busca criada! Acompanhe em “Suas buscas”.", 5000);
      store("prefs", { lang, depth, radius: +$("#radius").value });
      $("#keyword").value = "";
      await refreshJobs();
      $("#sec-jobs").scrollIntoView({ block: "start" });
    } catch (err) {
      showError(err.message || "Não consegui criar a busca. O scraper está online?");
    } finally {
      state.submitting = false; btn.disabled = false;
      btn.querySelector(".btn-label").textContent = "Iniciar busca";
    }
  });

  // ───────────────────────── results ─────────────────────────
  async function openResults(job, { scroll = true, announce = true } = {}) {
    state.current = job.id; renderJobs._last = null; renderJobs();
    history.replaceState(null, "", `#job=${job.id}`);
    $("#open-in-map").href = `/#job=${job.id}`;
    $("#to-map").href = `/#job=${job.id}`;
    $("#results").hidden = false; $("#nav-results").hidden = false;
    $("#results-title").textContent = job.name || "Resultados";
    $("#results-sub").textContent = `${job.keywords.join(" / ")} · ${ago(job.date)}`;
    $("#mini-kpis").innerHTML = "";
    $("#results-table tbody").innerHTML = `<tr><td colspan="5" class="empty">Carregando…</td></tr>`;
    $("#raw-download").href = `${API}/${job.id}/download`;
    $("#raw-download").setAttribute("download", `${slug(job.name)}-completo.csv`);
    if (scroll) $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
    let rows;
    try { rows = await fetchRows(job.id); }
    catch { $("#results-table tbody").innerHTML = `<tr><td colspan="5" class="empty">Não consegui baixar os resultados dessa busca.</td></tr>`; return; }
    if (state.current !== job.id) return;          // user opened another one meanwhile
    state.rows = rows;

    const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    const counts = Object.fromEntries(cats.map((c) => [c, rows.filter((r) => r.category === c).length]));
    $("#cat-filter").innerHTML = `<option value="">Todas (${rows.length})</option>` + cats.map((c) => `<option value="${esc(c)}">${esc(c)} (${counts[c]})</option>`).join("");
    $("#filter").value = ""; $("#sort").value = "";
    $("#only-email").closest(".check").hidden = !job.email;
    $("#only-email").checked = false;

    // Only default the radius filter on when most results really are inside the circle: if the place was
    // geocoded elsewhere (e.g. "barra funda" → Barra Funda/RS), Google still searched the typed text.
    const hasArea = !!(job.lat && job.radius);
    const located = rows.filter((r) => +r.latitude);
    const share = hasArea && located.length ? located.filter((r) => distance(job.lat, job.lon, +r.latitude, +r.longitude) <= job.radius).length / located.length : 0;
    $("#in-radius-wrap").hidden = !hasArea;
    $("#in-radius").checked = hasArea && share >= 0.5;
    $("#in-radius-label").textContent = hasArea ? `dentro de ${Math.round(job.radius / 100) / 10} km` : "";
    if (hasArea && share < 0.5 && announce) toast("A maioria dos resultados ficou fora do raio (o local pode ter sido entendido diferente). Filtro de raio desligado.", 7000);

    const n = (f) => rows.filter(f).length;
    const rated = rows.filter((r) => +r.review_rating);
    const avg = rated.length ? rated.reduce((a, r) => a + +r.review_rating, 0) / rated.length : 0;
    const mini = [
      [fmt(rows.length), "empresas"],
      [fmt(n((r) => r.phone)), "com telefone"],
      [fmt(n((r) => whatsapp(r.phone))), "com WhatsApp"],
      [fmt(n((r) => r.website)), "com site"],
      ...(job.email ? [[fmt(n((r) => emailsOf(r).length)), "com e-mail"]] : []),
      [avg ? avg.toFixed(1).replace(".", ",") + " ★" : "—", "nota média"],
    ];
    $("#mini-kpis").innerHTML = mini.map(([v, l]) => `<div class="mini"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");
    renderResults();
  }

  function closeResults() {
    state.current = null; state.rows = []; state.visible = [];
    history.replaceState(null, "", location.pathname);
    $("#to-map").href = "/";
    $("#results").hidden = true; $("#nav-results").hidden = true;
    renderJobs._last = null; renderJobs();
  }
  $("#results-close").addEventListener("click", closeResults);

  function visibleRows() {
    const job = currentJob();
    const q = $("#filter").value.trim().toLowerCase();
    const cat = $("#cat-filter").value;
    const area = $("#in-radius").checked && job.lat && job.radius;
    const onlyPhone = $("#only-phone").checked, onlyEmail = $("#only-email").checked;
    let rows = state.rows.filter((r) =>
      (!area || !+r.latitude || distance(job.lat, job.lon, +r.latitude, +r.longitude) <= job.radius) &&
      (!cat || r.category === cat) && (!onlyPhone || r.phone) && (!onlyEmail || emailsOf(r).length) &&
      (!q || [r.title, r.category, r.address, r.phone, r.website, r.emails].join(" ").toLowerCase().includes(q)));
    if ($("#dedupe").checked) {
      const seen = new Set();
      rows = rows.filter((r) => {
        const k = digits(r.phone) || r.place_id || r.link || r.title + r.address;
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
    }
    const [key, dirS] = $("#sort").value.split(":");
    if (key) {
      const dir = +dirS;
      rows = [...rows].sort((a, b) => key === "title"
        ? String(a.title).localeCompare(String(b.title), "pt-BR") * dir
        : ((+a[key] || 0) - (+b[key] || 0) || (+a.review_count || 0) - (+b.review_count || 0)) * dir);
    }
    return rows;
  }

  function renderResults() {
    const rows = (state.visible = visibleRows());
    $("#export-count").textContent = `${fmt(rows.length)} de ${fmt(state.rows.length)} empresas`;
    $("#results-table tbody").innerHTML = rows.length ? rows.map((r, i) => {
      const wa = whatsapp(r.phone);
      const rating = +r.review_rating;
      const site = r.website ? r.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : "";
      return `<tr data-i="${i}">
        <td><div class="co-name">${esc(r.title)}</div><div class="co-cat">${esc(r.category)}</div></td>
        <td><div class="contact">
          ${r.phone ? `<span>${esc(r.phone)}</span>` : `<span class="none">sem telefone</span>`}
          ${wa ? `<a class="wa" href="${wa}" data-wa="${i}" target="_blank" rel="noopener">WhatsApp ↗</a>` : ""}
          ${emailsOf(r).map((m) => `<a href="mailto:${esc(m)}">${esc(m)}</a>`).join("")}
          ${site ? `<a href="${esc(r.website)}" target="_blank" rel="noopener">${esc(site.length > 34 ? site.slice(0, 34) + "…" : site)}</a>` : ""}
        </div></td>
        <td class="num">${rating ? `<span class="stars">★</span> ${rating.toFixed(1).replace(".", ",")}<span class="reviews">${fmt(r.review_count)}</span>` : "—"}</td>
        <td class="addr">${esc(r.address.replace(r.title + " - ", ""))}</td>
        <td class="row-actions">${r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">Maps ↗</a>` : ""}</td>
      </tr>`;
    }).join("") : `<tr><td colspan="5" class="empty">Nenhuma empresa com esses filtros.</td></tr>`;
    plotRows(rows);
  }

  ["#filter", "#cat-filter", "#sort", "#in-radius", "#dedupe", "#only-phone", "#only-email"].forEach((s) => $(s).addEventListener("input", renderResults));
  $("#results-table tbody").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const tr = e.target.closest("tr[data-i]");
    if (!tr) return;
    const i = +tr.dataset.i, m = markers[i];
    highlight(i, false);
    if (m) { map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.6 }); m.openPopup(); }
  });

  // ───────────────────────── export ─────────────────────────
  const EXPORT_HEAD = ["Nome", "Categoria", "Telefone", "WhatsApp", "E-mail", "Site", "Nota", "Avaliações", "Endereço", "Link Google Maps"];
  const exportRow = (r) => [
    r.title, r.category, r.phone, whatsapp(r.phone) || "", emailsOf(r).join(", "), r.website,
    +r.review_rating ? (+r.review_rating).toFixed(1).replace(".", ",") : "", r.review_count, r.address, r.link,
  ];

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-export]");
    if (!btn) return;
    const rows = state.visible.map(exportRow);
    const base = slug(currentJob().name || "resultados");
    const kind = btn.dataset.export;
    if (kind === "excel") {
      // Excel pt-BR expects ';' as separator; the BOM makes it read UTF-8 accents correctly.
      saveFile(`${base}.csv`, "﻿" + toCSV(EXPORT_HEAD, rows, ";"), "text/csv;charset=utf-8");
      toast(`${rows.length} empresas baixadas. Dê dois cliques no arquivo para abrir no Excel.`);
    } else if (kind === "sheets") {
      saveFile(`${base}-sheets.csv`, "﻿" + toCSV(EXPORT_HEAD, rows, ","), "text/csv;charset=utf-8");
      toast("Baixado. No Google Sheets: Arquivo → Importar → Upload.", 6000);
    } else if (kind === "copy") {
      const tsv = [EXPORT_HEAD, ...rows].map((r) => r.map((v) => String(v ?? "").replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
      try { await navigator.clipboard.writeText(tsv); toast(`${rows.length} linhas copiadas. Cole (Ctrl+V) no Sheets ou no Excel.`); }
      catch { toast("O navegador bloqueou a cópia. Use os botões de download."); }
    }
  });

  // ───────────────────────── sidebar nav ─────────────────────────
  const navFor = { "sec-overview": "#sec-overview", "sec-new": "#sec-new", "sec-jobs": "#sec-jobs", results: "#results" };
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!vis) return;
      $$(".nav-item").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === navFor[vis.target.id]));
    }, { rootMargin: "0px 0px -60% 0px" });
    ["#sec-overview", "#sec-new", "#sec-jobs", "#results"].forEach((s) => io.observe($(s)));
  }

  // ───────────────────────── keyboard ─────────────────────────
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); if (!$("#results").hidden) $("#filter").focus(); else $("#keyword").focus(); }
  });

  // ───────────────────────── boot ─────────────────────────
  const prefs = load("prefs", {});
  if (prefs.lang) $("#lang").value = prefs.lang;
  setDepth(prefs.depth || 5);
  if (prefs.radius) $("#radius").value = prefs.radius;
  syncRadius();
  refreshJobs();
  setInterval(refreshJobs, POLL_MS);
  setInterval(() => { renderJobs._last = null; renderJobs(); }, 30000);  // keep "há X min" fresh
})();
