// RingApp – mobilvennleg framside for fargeringavlesingar.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const api = async (path, opts = {}) => {
  const r = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Feil ${r.status}`);
  return data;
};
const imgUrl = (p) => `/img?p=${encodeURIComponent(p)}`;
const ringImg = (fullCode) => imgUrl(`pics/crring.asp?FK=${encodeURIComponent(fullCode)}&rotation=N`);
const photoUrl = (bid, w = 800) => imgUrl(`visbilde.asp?BID=${bid}&maxw=${w}&MaxH=${w}&VisF=ON&XIF=ON`);
const MINE_COLOR = '#2f6fd6'; // dine eigne avlesingar (blå), skil seg frå grøn/oransje/raud
const fmtDate =(iso) => (iso ? new Date(iso + 'T12:00').toLocaleDateString(['nn-NO', 'nb-NO', 'no'], { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2800);
}

// ---------- Lokal lagring ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full eller blokkert */ } },
};
const readings = () => store.get('readings', []);

// ---------- Kart ----------
const tiles = () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' });
function makeMap(el) {
  const m = L.map(el, { zoomControl: true, attributionControl: true }).setView([62, 10], 4);
  tiles().addTo(m);
  return m;
}

// ---------- Navigasjon ----------
const maps = {};
function show(view) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  if (view === 'new') initReadForm();
  if (view === 'mine') renderMine();
  if (view === 'projects') loadProjects();
  setTimeout(() => Object.values(maps).forEach((m) => m.invalidateSize()), 50);
  window.scrollTo(0, 0);
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

// ---------- Botnark ----------
function openSheet(html) {
  $('#sheetContent').innerHTML = html;
  $('#sheet').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; }
$('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });

// ---------- Søk ----------
// ---------- «Meg»: namn som skal markerast som eigne avlesingar ----------
// Observatørar står som «Etternavn, Fornavn», i detaljvisinga med «(nr/gruppe)» bak.
const normName = (s) => String(s ?? '').replace(/\(.*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
const myNames = () => store.get('myNames', []);
function setMyNames(list) {
  const seen = new Set();
  store.set('myNames', list.map((s) => s.replace(/\(.*$/, '').trim()).filter((s) => s && !seen.has(normName(s)) && seen.add(normName(s))));
}
const isMe = (name) => myNames().some((n) => normName(n) === normName(name));
const isMine = (e) => e.observers.some(isMe);

let lastBirds = [];
let lastStatus = null;
let lastQ = '';
async function doSearch(q) {
  q = q.trim().toUpperCase();
  if (!q) return;
  $('#q').value = q;
  const out = $('#results');
  out.innerHTML = '<div class="spinner">Søkjer …</div>';
  try {
    const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
    lastBirds = r.birds; lastStatus = r.status; lastQ = q;
    renderResults();
  } catch (e) {
    out.innerHTML = `<div class="card notice">Klarte ikkje å søkje: ${esc(e.message)}</div>`;
  }
}

function renderResults() {
  const out = $('#results'), q = lastQ;
  if (lastStatus === 'none') out.innerHTML = `<div class="card"><b>Ingen treff på ${esc(q)}.</b><p class="muted">Sjekk fargen på ringen og at koden er rett lesen (0/O, 1/I, 8/B).</p><button class="btn primary" data-new="${esc(q)}">Registrer avlesing likevel</button></div>`;
  else if (lastStatus === 'noaccess') out.innerHTML = `<div class="card notice"><b>Ringen ${esc(q)} finst i databasen.</b><p>Historikken blir synleg når du har rapportert ei avlesing av fuglen.</p><button class="btn primary" data-new="${esc(q)}">Registrer avlesing</button></div>`;
  else out.innerHTML = lastBirds.map(birdCard).join('');
  lastBirds.forEach((b, i) => drawBirdMap(`bmap${i}`, b));
}

function birdStats(b) {
  const ev = b.events;
  const maxDist = Math.max(0, ...ev.map((e) => e.distanceKm ?? 0));
  const first = ev[0]?.date, last = ev.at(-1)?.date;
  const years = first && last ? ((new Date(last) - new Date(first)) / 3.15576e10).toFixed(1) : '–';
  const mine = ev.filter(isMine);
  return { n: ev.length, maxDist, years, mine: mine.length, lastMine: mine.at(-1)?.date };
}

function birdCard(b, i) {
  const s = birdStats(b);
  const evs = [...b.events].reverse();
  return `<article class="card">
    <div class="bird-head">
      ${b.fullCode ? `<img class="ring" src="${ringImg(b.fullCode)}" alt="${esc(b.fullCode)}">` : ''}
      <div>
        <div class="code">${esc(b.code ?? b.ringNo)}</div>
        <div class="sp">${esc(b.species ?? '')}</div>
        <div class="muted small"><i>${esc(b.sciName ?? '')}</i></div>
      </div>
    </div>
    <div class="muted small">${esc(b.ringType ?? '')} · ${esc(b.fullCode ?? '')}<br>${esc(b.project)} · Ring ${esc(b.ringNo ?? '–')} (${esc(b.centre ?? '')})</div>
    <div class="stats">
      <div class="stat"><b>${s.n}</b><span>registreringar</span></div>
      <div class="stat"><b>${s.maxDist.toLocaleString('nn-NO')}</b><span>km lengst unna</span></div>
      <div class="stat"><b>${s.years}</b><span>år sporing</span></div>
    </div>
    ${s.mine ? `<div class="mine-note">⭐ Du har registrert denne fuglen <b>${s.mine} ${s.mine === 1 ? 'gong' : 'gonger'}</b>, sist ${fmtDate(s.lastMine)}.</div>` : ''}
    <div id="bmap${i}" class="map"></div>
    <div class="legend"><span><i class="dot mark"></i>Merka</span><span><i class="dot"></i>Andre</span><span><i class="dot mine"></i>Dine</span><span><i class="dot dead"></i>Død</span></div>
    <button class="btn primary big" data-new="${esc(b.code ?? '')}" data-species="${esc(b.species ?? '')}" data-bird="${i}">➕ Eg har sett denne fuglen</button>
    <h3 style="margin:16px 0 4px">Historikk</h3>
    <ul class="timeline">${evs.map((e) => `
      <li class="${e.marking ? 'mark' : ''} ${e.dead ? 'dead' : ''} ${isMine(e) ? 'mine' : ''}" data-ev="${esc(e.id)}">
        <div class="when">${fmtDate(e.date)}${e.marking ? ' · Merka' : ''}${e.dead ? ' · Død' : ''}${isMine(e) ? ' <span class="me-tag">Di avlesing</span>' : ''}</div>
        <div class="where">${esc(e.place)}</div>
        <div class="meta">${e.distanceKm != null ? `${e.distanceKm.toLocaleString('nn-NO')} km frå merkestad · ` : ''}${e.observers.map((o) => (isMe(o) ? `<b>${esc(o)}</b>` : esc(o))).join(', ')}${e.kind && !e.marking && e.kind !== 'Godkjente funndata' ? ` · ${esc(e.kind)}` : ''}</div>
        ${e.photos.length ? `<div class="thumbs">${e.photos.map((p) => `<img loading="lazy" src="${photoUrl(p, 200)}" alt="Foto">`).join('')}</div>` : ''}
      </li>`).join('')}
    </ul>
  </article>`;
}

function drawBirdMap(id, b) {
  const el = document.getElementById(id);
  if (!el) return;
  const pts = b.events.filter((e) => e.lat != null);
  if (!pts.length) { el.remove(); return; }
  const m = makeMap(el);
  const ll = pts.map((e) => [e.lat, e.lon]);
  L.polyline(ll, { color: '#1f5f4a', weight: 2, opacity: .6, dashArray: '4 6' }).addTo(m);
  pts.forEach((e, i) => {
    const mine = isMine(e);
    L.circleMarker([e.lat, e.lon], {
      radius: mine || i === pts.length - 1 ? 9 : 6,
      color: '#fff', weight: 2,
      fillColor: e.marking ? '#d48a00' : e.dead ? '#a3312b' : mine ? MINE_COLOR : '#1f5f4a', fillOpacity: 1,
    }).bindPopup(`<b>${fmtDate(e.date)}</b>${mine ? ' ⭐ Di avlesing' : ''}<br>${esc(e.place)}`).addTo(m);
  });
  m.fitBounds(L.latLngBounds(ll).pad(0.3), { maxZoom: 11 });
}

async function showEvent(id) {
  openSheet('<div class="spinner">Hentar …</div>');
  try {
    const d = await api(`/api/event/${id}`);
    const ev = lastBirds.flatMap((b) => b.events).find((e) => e.id === id);
    const obs = (d.fields.find((f) => f.label.startsWith('Observat'))?.value ?? '').split('\n').filter(Boolean);
    openSheet(`<h2>Registrering</h2>
      ${ev?.photos?.length ? `<div class="thumbs">${ev.photos.map((p) => `<img src="${photoUrl(p, 600)}" style="height:auto;width:100%" alt="Foto">`).join('')}</div>` : ''}
      ${obs.length ? `<div class="obs-list"><span class="muted small">Observatørar – trykk for å markere deg sjølv:</span>
        ${obs.map((o) => `<button type="button" class="obs ${isMe(o) ? 'on' : ''}" data-me="${esc(o.replace(/\s*\(.*$/, ''))}">${isMe(o) ? '⭐ ' : ''}${esc(o.replace(/\s*\(.*$/, ''))}<small>${isMe(o) ? 'Dette er meg' : 'Er dette deg?'}</small></button>`).join('')}</div>` : ''}
      <dl class="kv">${d.fields.filter((f) => f.value && !f.label.startsWith('Observat')).map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl>`);
    $$('#sheetContent [data-me]').forEach((b) => b.addEventListener('click', () => {
      const n = b.dataset.me;
      setMyNames(isMe(n) ? myNames().filter((x) => normName(x) !== normName(n)) : [...myNames(), n]);
      toast(isMe(n) ? `«${n}» er markert som deg` : `«${n}» er ikkje lenger markert`);
      renderResults();
      showEvent(id);
    }));
  } catch (e) { openSheet(`<p class="notice">${esc(e.message)}</p>`); }
}

function openMeSettings() {
  openSheet(`<h2>Namnet ditt</h2>
    <p class="muted small">Skriv namnet slik det står på ringmerking.no («Etternavn, Fornavn»), eitt per linje. Legg gjerne til dei du les av saman med. Avlesingar med desse namna blir markerte med ⭐.</p>
    <label class="field"><span>Namn</span><textarea id="myNamesInput" rows="4" placeholder="Nordmann, Ola">${esc(myNames().join('\n'))}</textarea></label>
    <button class="btn primary big" id="saveNames" type="button">Lagre</button>
    <p class="muted small">Tips: Du kan òg trykkje på ei registrering og velje «Er dette deg?» på namnet ditt.</p>`);
  $('#saveNames').addEventListener('click', () => {
    setMyNames($('#myNamesInput').value.split('\n'));
    closeSheet(); renderResults(); refreshMe();
    toast('Lagra');
  });
}

$('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); doSearch($('#q').value); });
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-try]');
  if (t) { e.preventDefault(); doSearch(t.dataset.try); }
  const n = e.target.closest('[data-new]');
  if (n) startReading({ code: n.dataset.new, species: n.dataset.species, bird: lastBirds[n.dataset.bird] });
  const ev = e.target.closest('[data-ev]');
  if (ev) showEvent(ev.dataset.ev);
});

// ---------- Prosjekt ----------
let projectsCache = null;
async function getProjects() {
  if (projectsCache) return projectsCache;
  projectsCache = store.get('projects', null);
  const fresh = api('/api/projects').then((p) => { projectsCache = p; store.set('projects', p); return p; });
  return projectsCache ?? fresh;
}
async function loadProjects() {
  const list = $('#projList');
  if (!list.dataset.done) list.innerHTML = '<div class="spinner">Hentar prosjekt …</div>';
  try {
    const p = await getProjects();
    list.dataset.done = 1;
    const f = $('#projFilter').value.trim().toLowerCase();
    list.innerHTML = p
      .filter((x) => !f || (x.name + x.description + x.ringTypes.map((r) => r.description).join()).toLowerCase().includes(f))
      .map((x) => `<details class="card proj">
        <summary>${x.logo ? `<img src="${imgUrl(x.logo.split('/cr/')[1])}" alt="">` : ''}<b>${esc(x.name.replace(/^Fargemerking av /, '').replace(/ i Norge$/, ''))}</b></summary>
        <p>${esc(x.description)}</p>
        ${x.ringTypes.map((r) => `<div class="rtype"><img src="${imgUrl(r.image.split('/cr/')[1])}" alt=""><span>${esc(r.description)}</span></div>`).join('')}
      </details>`).join('') || '<p class="muted">Ingen treff.</p>';
  } catch (e) { list.innerHTML = `<p class="notice">${esc(e.message)}</p>`; }
}
$('#projFilter').addEventListener('input', loadProjects);

async function pickRingType() {
  openSheet('<div class="spinner">Hentar ringtypar …</div>');
  const p = await getProjects();
  openSheet(`<h2>Vel ringtype</h2><input class="filter" id="rtFilter" placeholder="Søk: måke, svart, svane …">
    <div id="rtList">${p.map((x, pi) => `<div class="proj-group" data-text="${esc((x.name + ' ' + x.ringTypes.map((r) => r.description).join(' ')).toLowerCase())}">
      <h3 style="margin:14px 0 4px;font-size:1rem">${esc(x.name)}</h3>
      ${x.ringTypes.map((r, ri) => `<div class="rtype pick" data-p="${pi}" data-r="${ri}"><img src="${imgUrl(r.image.split('/cr/')[1])}" alt=""><span>${esc(r.description)}</span></div>`).join('')}
    </div>`).join('')}</div>`);
  $('#rtFilter').addEventListener('input', (e) => {
    const f = e.target.value.toLowerCase();
    $$('.proj-group').forEach((g) => (g.hidden = f && !g.dataset.text.includes(f)));
  });
  $('#rtList').addEventListener('click', (e) => {
    const r = e.target.closest('.pick');
    if (!r) return;
    const proj = p[r.dataset.p], rt = proj.ringTypes[r.dataset.r];
    setRingType(proj.name, rt);
    closeSheet();
  });
}
function setRingType(projectName, rt) {
  const f = $('#readForm');
  f.project.value = projectName;
  f.ringType.value = rt.description;
  $('#pickType').innerHTML = `<img src="${imgUrl(rt.image.split('/cr/')[1])}" alt=""><span>${esc(rt.description)}</span>`;
}
$('#pickType').addEventListener('click', pickRingType);

// ---------- Ny avlesing ----------
let readMap, readMarker;
function initReadForm() {
  const f = $('#readForm');
  if (!f.date.value) {
    const now = new Date();
    f.date.value = now.toISOString().slice(0, 10);
    f.time.value = now.toTimeString().slice(0, 5);
  }
  if (!readMap) {
    readMap = maps.read = makeMap($('#readMap'));
    readMap.on('click', (e) => setPos(e.latlng.lat, e.latlng.lng, null, 'Plassert manuelt'));
    const last = store.get('lastPos', null);
    if (last) readMap.setView([last.lat, last.lon], 11);
  }
  const sp = new Set([...readings().map((r) => r.species), ...lastBirds.map((b) => b.species)].filter(Boolean));
  $('#speciesList').innerHTML = [...sp].map((s) => `<option value="${esc(s)}">`).join('');
}

function setPos(lat, lon, acc, info) {
  const f = $('#readForm');
  f.lat.value = lat.toFixed(5); f.lon.value = lon.toFixed(5); f.acc.value = acc ?? '';
  if (readMarker) readMarker.setLatLng([lat, lon]);
  else readMarker = L.marker([lat, lon], { draggable: true }).addTo(readMap)
    .on('dragend', (e) => { const p = e.target.getLatLng(); setPos(p.lat, p.lng, null, 'Plassert manuelt'); });
  readMap.setView([lat, lon], Math.max(readMap.getZoom(), 13));
  $('#gpsInfo').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}${acc ? ` (±${Math.round(acc)} m)` : ''} · ${info}`;
  store.set('lastPos', { lat, lon });
}

$('#gpsBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('GPS er ikkje tilgjengeleg');
  $('#gpsInfo').textContent = 'Hentar posisjon …';
  navigator.geolocation.getCurrentPosition(
    (p) => setPos(p.coords.latitude, p.coords.longitude, p.coords.accuracy, 'GPS'),
    (e) => { $('#gpsInfo').textContent = 'Fekk ikkje posisjon: ' + e.message; },
    { enableHighAccuracy: true, timeout: 15000 },
  );
});

$$('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $$('button', seg).forEach((x) => x.classList.toggle('on', x === b));
}));

// Slå opp koden medan brukaren skriv, så dei ser med ein gong om fuglen er kjend
let knownTimer;
$('#readForm').code.addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/\s/g, '');
  clearTimeout(knownTimer);
  const q = e.target.value;
  const box = $('#known');
  if (q.length < 2) { box.hidden = true; return; }
  knownTimer = setTimeout(async () => {
    try {
      const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (e.target.value !== q) return;
      box.hidden = false;
      box.classList.toggle('warn', r.status === 'none');
      if (r.status === 'ok') {
        const b = r.birds[0]; const m = b.events.find((x) => x.marking) ?? b.events[0];
        box.innerHTML = `✅ <b>${esc(b.species)}</b> – merka ${fmtDate(m?.date)} i ${esc(m?.place?.split(',')[0])}. ${b.events.length} registreringar.${r.birds.length > 1 ? ` <b>${r.birds.length} fuglar har denne koden – sjekk ringfargen!</b>` : ''}`;
        const f = $('#readForm');
        if (!f.species.value && r.birds.length === 1) f.species.value = b.species ?? '';
      } else if (r.status === 'noaccess') box.innerHTML = '✅ Koden finst i databasen. Historikken blir synleg etter innsending.';
      else box.innerHTML = '⚠️ Fann ingen fugl med denne koden. Dobbeltsjekk avlesinga.';
    } catch { box.hidden = true; }
  }, 450);
});

function startReading({ code, species, bird }) {
  show('new');
  const f = $('#readForm');
  f.code.value = code || '';
  if (species) f.species.value = species;
  if (bird?.ringType) {
    getProjects().then((p) => {
      const proj = p.find((x) => x.name === bird.project);
      const rt = proj?.ringTypes.find((r) => r.description.toLowerCase().startsWith(bird.ringType.toLowerCase()));
      if (rt) setRingType(proj.name, rt);
    }).catch(() => {});
  }
  f.code.dispatchEvent(new Event('input'));
}

$('#readForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  if (!f.lat.value) return toast('Vel stad: bruk GPS eller trykk på kartet');
  const r = {
    id: crypto.randomUUID(),
    created: new Date().toISOString(),
    status: 'local',
    project: f.project.value, ringType: f.ringType.value,
    code: f.code.value.trim().toUpperCase(),
    date: f.date.value, time: f.time.value,
    lat: +f.lat.value, lon: +f.lon.value, accuracy: f.acc.value ? +f.acc.value : null,
    place: f.place.value.trim(),
    species: f.species.value.trim(),
    condition: $('.seg[data-name="condition"] .on').dataset.v,
    age: f.age.value, sex: f.sex.value, comment: f.comment.value.trim(),
  };
  store.set('readings', [r, ...readings()]);
  toast(`Lagra ${r.code} 👍`);
  f.code.value = ''; f.comment.value = ''; f.species.value = '';
  $('#known').hidden = true;
  show('mine');
});

// ---------- Mine avlesingar ----------
let mineMap, mineLayer;
function renderMine() {
  const list = readings();
  if (!mineMap) { mineMap = maps.mine = makeMap($('#mineMap')); mineLayer = L.layerGroup().addTo(mineMap); }
  mineLayer.clearLayers();
  list.forEach((r) => L.circleMarker([r.lat, r.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#1f5f4a', fillOpacity: 1 })
    .bindPopup(`<b>${esc(r.code)}</b> ${esc(r.species)}<br>${fmtDate(r.date)}`).addTo(mineLayer));
  if (list.length) mineMap.fitBounds(L.latLngBounds(list.map((r) => [r.lat, r.lon])).pad(0.3), { maxZoom: 12 });

  $('#mineList').innerHTML = list.length ? list.map((r) => `<div class="card reading">
      <div class="code">${esc(r.code)}</div>
      <div class="info"><b>${esc(r.species || 'Ukjend art')}</b><br><span class="muted">${fmtDate(r.date)} ${esc(r.time)} · ${esc(r.place || `${r.lat}, ${r.lon}`)}</span></div>
      <span class="badge ${r.status === 'sent' ? 'sent' : ''}">${r.status === 'sent' ? 'Sendt' : 'Ikkje sendt'}</span>
      <button class="del" data-del="${r.id}" aria-label="Slett">🗑</button>
    </div>`).join('') : '<p class="muted">Ingen avlesingar enno. Trykk «Avlesing» for å leggje inn den første.</p>';
}
$('#mineList').addEventListener('click', (e) => {
  const d = e.target.closest('[data-del]');
  if (d && confirm('Slette denne avlesinga?')) { store.set('readings', readings().filter((r) => r.id !== d.dataset.del)); renderMine(); }
});

$('#exportBtn').addEventListener('click', () => {
  const rows = readings();
  if (!rows.length) return toast('Ingenting å eksportere');
  const cols = ['code', 'ringType', 'project', 'species', 'date', 'time', 'lat', 'lon', 'accuracy', 'place', 'condition', 'age', 'sex', 'comment', 'status'];
  const csv = [cols.join(';'), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: `avlesingar-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
});

// ---------- Innlogging ----------
let me = null;
/** «Etternavn, Fornavn» -> { full: «Fornavn Etternavn», first: «Fornavn» } */
function displayName(raw) {
  const [last, first] = String(raw ?? '').split(',').map((s) => s.trim());
  if (!first) return { full: last, first: last };
  return { full: `${first} ${last}`, first: first.split(' ')[0] };
}
async function refreshMe() {
  try { me = (await api('/api/me')).user; } catch { me = null; }
  const name = myNames()[0];
  $('#userBtn').textContent = me ? (name ? displayName(name).first : me.email.split('@')[0]) : 'Logg inn';
}
$('#userBtn').addEventListener('click', () => {
  if (me) {
    const names = myNames();
    const title = names.length ? displayName(names[0]).full : 'Innlogga';
    openSheet(`<h2>${esc(title)}</h2><p class="muted small">Innlogga som ${esc(me.email)}</p>
      <div class="card" style="margin-top:12px"><b>⭐ Dine avlesingar</b>
        <p class="muted small">${names.length ? `Markerer avlesingar frå: ${esc(names.join(' · '))}` : 'Legg inn namnet ditt, så blir dine avlesingar markerte med eigen farge.'}</p>
        <button class="btn" id="meBtn" type="button">${names.length ? 'Endre namn' : 'Legg inn namn'}</button></div>
      <button class="btn" id="logoutBtn">Logg ut</button>`);
    $('#meBtn').onclick = openMeSettings;
    $('#logoutBtn').onclick = async () => { await api('/api/logout', { method: 'POST' }); await refreshMe(); closeSheet(); };
    return;
  }
  openSheet(`<h2>Logg inn på ringmerking.no</h2>
    <p class="muted small">Same brukar som på ringmerking.no. Som innlogga ser du historikken til fuglar du har rapportert.</p>
    <form id="loginForm">
      <label class="field"><span>E-post</span><input name="email" type="email" autocomplete="username" required></label>
      <label class="field"><span>Passord</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary big">Logg inn</button>
      <p id="loginMsg" class="muted"></p>
    </form>
    <button class="btn" id="meBtn" type="button">⭐ ${myNames().length ? 'Endre namnet ditt' : 'Legg inn namnet ditt'}</button>`);
  $('#meBtn').onclick = openMeSettings;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    $('#loginMsg').textContent = 'Loggar inn …';
    try {
      const r = await api('/api/login', { method: 'POST', body: JSON.stringify(fd) });
      if (r.loggedIn) {
        await refreshMe();
        if (myNames().length) { closeSheet(); toast(`Hei, ${displayName(myNames()[0]).first}!`); }
        else openMeSettings(); // spør om namn første gong, så det kan visast i staden for e-post
      }
      else $('#loginMsg').textContent = r.hint ?? 'Innlogging feila';
    } catch (err) { $('#loginMsg').textContent = err.message; }
  });
});

// ---------- Oppstart ----------
refreshMe();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
