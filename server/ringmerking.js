// Klient mot www.ringmerking.no/cr (klassisk ASP, ingen API).
// Hentar HTML-sider og gjer dei om til JSON.
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export const BASE = 'https://www.ringmerking.no/cr/';
const UA = 'RingApp-prototype/0.1';

// ---------- HTTP ----------

/** Enkel cookie-jar per brukarøkt (ASP-sesjonen lever i ein cookie). */
export class Jar {
  constructor() { this.cookies = new Map(); }
  store(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
}

/** Kodar skjemaverdiar som windows-1252, slik den gamle sida forventar. */
function formEncode(fields) {
  const enc = (s) => [...iconv.encode(String(s ?? ''), 'win1252')]
    .map((b) => (/[A-Za-z0-9_.~-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : '%' + b.toString(16).toUpperCase().padStart(2, '0')))
    .join('');
  return Object.entries(fields).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
}

export async function fetchPage(path, { jar, method = 'GET', form, query } = {}) {
  const url = new URL(path, BASE);
  if (query) url.search = formEncode(query);
  const headers = { 'User-Agent': UA };
  if (jar?.cookies.size) headers.Cookie = jar.header();
  let body;
  if (form) {
    body = formEncode(form);
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const res = await fetch(url, { method: form ? 'POST' : method, headers, body, redirect: 'manual' });
  jar?.store(res);
  // Følg redirect manuelt så cookies blir med
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    return fetchPage(new URL(res.headers.get('location'), url).href, { jar });
  }
  if (!res.ok) throw new Error(`ringmerking.no svarte ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return iconv.decode(buf, 'win1252');
}

// ---------- Hjelpefunksjonar ----------

/** Fjernar taggar og dekodar HTML-entitetar (&#248; -> ø). */
const htmlText = (html) => cheerio.load(`<p>${html ?? ''}</p>`)('p').text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

const clean = (s) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/** 58°01'54"N 007°14'28"E -> { lat, lon } */
export function parseDms(text) {
  const m = clean(text).match(/(\d+)°(\d+)'(\d+)"([NS])\s*(\d+)°(\d+)'(\d+)"([EW])/);
  if (!m) return null;
  const dec = (d, mi, s, h) => (+d + mi / 60 + s / 3600) * (h === 'S' || h === 'W' ? -1 : 1);
  return { lat: +dec(m[1], m[2], m[3], m[4]).toFixed(5), lon: +dec(m[5], m[6], m[7], m[8]).toFixed(5) };
}

/** Hentar body=[...] frå boxover-tooltip-attributt. */
function tipBody(title) {
  const m = (title ?? '').match(/(?:^|\s)body=\[(.*)\]\s*$/s);
  return m ? m[1] : '';
}
function tipHeader(title) {
  const m = (title ?? '').match(/(?:^|\s)header=\[([^\]]*)\]/);
  return m ? clean(cheerio.load(m[1]).text()) : '';
}

/** "11.07 2007" -> "2007-07-11" */
function isoDate(s) {
  const m = clean(s).match(/(\d{2})\.(\d{2})\s+(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// ---------- Søk ----------

/**
 * Søk etter ring (metallnummer, fargekode, full kode eller referanse).
 * @returns {{status:'ok'|'noaccess'|'none', birds:Array}}
 */
export async function search(q, jar) {
  const html = await fetchPage('default.asp', { jar, query: { CRside: 'WATCH', CRuside: 'MAIN', CRSOK: q } });
  return parseSearch(html);
}

export function parseSearch(html) {
  const text = clean(cheerio.load(html).text());
  if (/du har ikke rettigheter til å vise dem/i.test(text)) return { status: 'noaccess', birds: [] };
  if (/Ingen passende data funnet/i.test(text)) return { status: 'none', birds: [] };

  // Kvar fugl startar med <span class = blue><b>Prosjektnamn</b></span> (n)
  const marker = /<span class\s*=\s*blue><b>/gi;
  const starts = [...html.matchAll(marker)].map((m) => m.index);
  const birds = starts.map((start, i) => {
    // Ta med PDF-lenkjene som står rett før blokka
    const prev = i === 0 ? Math.max(0, start - 3000) : starts[i - 1];
    const chunk = html.slice(start, starts[i + 1] ?? html.length);
    const pre = html.slice(prev, start);
    return parseBird(chunk, pre);
  });
  return { status: birds.length ? 'ok' : 'none', birds };
}

function parseBird(chunk, pre) {
  // Hovudet (prosjekt, kode, art) står før første <tr> i blokka
  const head = chunk.slice(0, chunk.search(/<tr>/i) >= 0 ? chunk.search(/<tr>/i) : chunk.length);
  const headText = clean(cheerio.load(head).text());
  const $ = cheerio.load(`<table>${chunk.slice(head.length)}</table>`);

  const project = clean(cheerio.load(head.match(/<b>([\s\S]*?)<\/b>/)?.[1] ?? '').text());
  const count = +(headText.match(/\((\d+)\)/)?.[1] ?? 0);
  const codeM = head.match(/Siste CR-Kode<\/b>\s*([^:<]*):\s*([^<]*)<i>([^<]*)<\/i>/i);
  const ringNo = headText.match(/Ringnummer\s+(\S+)/)?.[1] ?? null;
  const centre = clean(cheerio.load(head.match(/Ringmerkingssentral<\/b>([\s\S]*?)<b>/i)?.[1] ?? '').text());
  const artM = head.match(/<b>Art<\/b>([^<]*?)<i>([^<]*)<\/i>/i);
  const mapQ = head.match(/viskart2x\.asp[\s\S]*?\?(CRCrNr=[^']*)'/)?.[1]?.replace(/&amp;/g, '&');
  const gjko = pre.match(/GJKO=([a-f0-9]+)/)?.[1] ?? null;

  const events = [];
  $('tr').each((_, tr) => {
    const det = $(tr).find('input[id^="DET"]').first();
    if (!det.length) return;
    const tds = $(tr).children('td');
    const dateTd = tds.eq(1);
    const observers = tipBody(dateTd.find('img[alt="Observatører"]').attr('title'))
      .split(/<br\s*\/?>/i).map((s) => clean(cheerio.load(s).text())).filter(Boolean);
    const age = clean(cheerio.load(tipBody(dateTd.find('img[alt="pull"], img[title*="Alder"]').attr('title'))).text()) || null;
    const ringImg = dateTd.find('img[title*="crring.asp"]').attr('title');
    const coordsText = clean(tds.eq(3).text());
    const dirTitle = tds.eq(6).find('input[id^="COM"]').attr('title');
    const num = (s) => (/^-?\d+$/.test(clean(s)) ? +clean(s) : null);
    events.push({
      id: det.attr('value'),
      kind: tipHeader(det.attr('title')), // Merkedata / Godkjente funndata / ...
      marking: tipHeader(det.attr('title')) === 'Merkedata',
      date: isoDate(dateTd.text()),
      observers,
      age,
      ringEvent: ringImg ? tipHeader(ringImg) : null, // "Fargemerke påsatt" o.l.
      dead: dateTd.find('img[src*="dead"]').length > 0,
      place: clean(tds.eq(2).text()),
      coords: coordsText,
      ...(parseDms(coordsText) ?? {}),
      days: num(tds.eq(4).text()),
      distanceKm: num(tds.eq(5).text()),
      direction: dirTitle ? +(tipHeader(dirTitle).match(/(\d+)/)?.[1] ?? NaN) : null,
      photos: [],
    });
  });

  // Bilete ligg i ei eiga rad rett etter hendinga dei høyrer til
  let last = null;
  $('tr').each((_, tr) => {
    const id = $(tr).find('input[id^="DET"]').first().attr('value');
    if (id) { last = events.find((e) => e.id === id); return; }
    $(tr).find('a[href^="visbilde.asp"]').each((_, a) => {
      const bid = $(a).attr('href').match(/BID=(\d+)/)?.[1];
      if (bid && last && !last.photos.includes(bid)) last.photos.push(bid);
    });
  });

  return {
    project,
    count,
    ringType: htmlText(codeM?.[1]) || null,
    code: htmlText(codeM?.[2]) || null,
    fullCode: htmlText(codeM?.[3]) || null,
    centre: centre || null,
    ringNo,
    species: htmlText(artM?.[1]) || null,
    sciName: htmlText(artM?.[2]) || null,
    mapQuery: mapQ ?? null,
    pdfKey: gjko,
    events,
  };
}

// ---------- Detalj for éi hending ----------

export async function eventDetail(id, jar) {
  const html = await fetchPage('kode/skrivmfdetalj.asp', { jar, query: { q: id, sid: Math.random() } });
  const $ = cheerio.load(html);
  const fields = [];
  $('tr').each((_, tr) => {
    const label = clean($(tr).children('td').first().find('b').text());
    if (!label) return;
    const td = $(tr).children('td').eq(1);
    td.find('a, script').remove();
    const value = (td.html() ?? '').split(/<br\s*\/?>/i).map((s) => clean(cheerio.load(s).text())).filter(Boolean).join('\n');
    fields.push({ label, value });
  });
  return { id, fields };
}

// ---------- Prosjekt og ringtypar ----------

export async function projects(jar) {
  const html = await fetchPage('default.asp', { jar, query: { CRside: 'RAPPORTERE', CRuSide: 'FORENKLET' } });
  return parseProjects(html);
}

export function parseProjects(html) {
  const $ = cheerio.load(html);
  const list = [];
  let cur = null;
  // Berre dei inste radene (sida brukar nøsta tabellar til layout)
  $('tr').filter((_, tr) => $(tr).find('tr').length === 0).each((_, tr) => {
    const anchor = $(tr).find('a[name^="#ProID"]');
    if (anchor.length) {
      cur = { id: anchor.attr('name').replace('#ProID', ''), name: clean(anchor.text()), description: '', logo: null, ringTypes: [] };
      list.push(cur);
      return;
    }
    if (!cur) return;
    const tds = $(tr).children('td');
    const img = tds.eq(0).find('img').attr('src');
    if (img?.startsWith('pics/pro')) {
      cur.logo = BASE + img;
      cur.description = clean(tds.eq(1).text());
    } else if (img) {
      cur.ringTypes.push({ image: BASE + img, description: clean(tds.eq(1).text()) });
    }
  });
  return list.filter((p) => p.name);
}

// ---------- Innlogging ----------

/** Loggar inn med same skjema som nettsida. Returnerer namn om det lukkast. */
export async function login(email, password, jar) {
  await fetchPage('default.asp', { jar }); // få ASP-sesjonscookie først
  const html = await fetchPage('default.asp', {
    jar,
    form: { CRSide: 'WATCH', CRuSide: 'MAIN', LoggInn: 'JA', LiEpost: email, LiPassord: password, RememberMe: 'JA' },
  });
  return parseLoginState(html);
}

export function parseLoginState(html) {
  const $ = cheerio.load(html);
  const stillForm = $('input[name="LiPassord"]').length > 0;
  const text = clean($.text());
  const loggedIn = !stillForm || /Logg (av|ut)/i.test(text);
  return { loggedIn, hint: loggedIn ? null : 'Feil e-post eller passord?' };
}
