// Liten API-server: gjer ringmerking.no om til JSON og serverer mobilappen.
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rm from './ringmerking.js';

const app = express();
const PORT = process.env.PORT || 3000;
const root = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: '1mb' }));

// --- Økter: éin cookie-jar mot ringmerking.no per app-brukar (berre i minnet) ---
const sessions = new Map();
function session(req, res) {
  const sid = req.headers.cookie?.match(/ringapp_sid=([a-f0-9]+)/)?.[1];
  if (sid && sessions.has(sid)) return sessions.get(sid);
  const id = crypto.randomBytes(16).toString('hex');
  const s = { id, jar: new rm.Jar(), user: null };
  sessions.set(id, s);
  res.setHeader('Set-Cookie', `ringapp_sid=${id}; Path=/; HttpOnly; SameSite=Lax`);
  return s;
}

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res, session(req, res)));
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: e.message });
  }
};

// --- Enkel cache så vi ikkje hamrar på den gamle serveren ---
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, until: Date.now() + ttlMs });
  return value;
}

app.get('/api/search', wrap(async (req, _res, s) => {
  const q = String(req.query.q ?? '').trim().toUpperCase();
  if (!q) return { status: 'none', birds: [] };
  // Innlogga brukarar kan sjå meir, så dei får ikkje delt cache
  return s.user ? rm.search(q, s.jar) : cached(`s:${q}`, 5 * 60e3, () => rm.search(q, s.jar));
}));

app.get('/api/event/:id', wrap((req, _res, s) => {
  if (!/^\d+$/.test(req.params.id)) throw new Error('Ugyldig id');
  return rm.eventDetail(req.params.id, s.jar);
}));

app.get('/api/projects', wrap(() => cached('projects', 6 * 3600e3, () => rm.projects())));

app.get('/api/me', wrap((_req, _res, s) => ({ user: s.user })));

app.post('/api/login', wrap(async (req, _res, s) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) throw new Error('Manglar e-post eller passord');
  s.jar = new rm.Jar();
  const r = await rm.login(email, password, s.jar);
  s.user = r.loggedIn ? { email } : null;
  return r;
}));

app.post('/api/logout', wrap((_req, _res, s) => {
  s.jar = new rm.Jar();
  s.user = null;
  return { ok: true };
}));

// Innsending er ikkje kopla på enno: skjemaet bak innlogging er ikkje kartlagt.
app.post('/api/report', (_req, res) => {
  res.status(501).json({ error: 'Innsending til ringmerking.no er ikkje kopla på enno.' });
});

// --- Bilete frå ringmerking.no (fargeringteikning, foto) ---
const imgAllowed = /^(pics\/crring\.asp\?FK=[^&]+&rotation=[NRL]|visbilde\.asp\?BID=\d+&maxw=\d+&MaxH=\d+(&VisF=ON&XIF=ON)?|pics\/[a-z0-9_]+\.(png|gif|jpg))$/i;
app.get('/img', async (req, res) => {
  const p = String(req.query.p ?? '');
  if (!imgAllowed.test(p)) return res.status(400).end();
  try {
    const r = await fetch(rm.BASE + p, { headers: { 'User-Agent': 'RingApp-prototype/0.1' } });
    if (!r.ok) return res.status(r.status).end();
    res.setHeader('Content-Type', r.headers.get('content-type') ?? 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
});

app.use('/vendor/leaflet', express.static(path.join(root, '..', 'node_modules', 'leaflet', 'dist')));
app.use(express.static(path.join(root, '..', 'public')));

app.listen(PORT, () => console.log(`RingApp på http://localhost:${PORT}`));
