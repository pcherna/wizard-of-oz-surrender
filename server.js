// Local server for the projector page (/) and the greeter phone page (/greeter).
// Zero dependencies. Run with `npm start`.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as queue from './lib/queue.js';
import { loadConfig } from './lib/config.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_FILE = path.join(ROOT, 'config.json');
let config = loadConfig(CONFIG_FILE);
const PORT = Number(process.env.PORT) || config.port;
const STATE_FILE = process.env.STATE_FILE || path.join(ROOT, 'state.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};
const PAGES = { '/': 'index.html', '/greeter': 'greeter.html' };

// ---------- State and persistence ----------

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return queue.createState(config.delaySeconds);
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!Array.isArray(saved.entries) || !Number.isFinite(saved.delaySeconds)) throw new Error('bad shape');
    return saved;
  } catch (err) {
    const aside = `${STATE_FILE}.corrupt-${Date.now()}`;
    fs.renameSync(STATE_FILE, aside);
    console.warn(`Could not read ${STATE_FILE} (${err.message}). Moved it to ${aside} and started fresh.`);
    return queue.createState(config.delaySeconds);
  }
}

function saveState() {
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

const state = loadState();
const isOneshot = () => config.mode === 'oneshot';
const slot = () => queue.slotMs(config.timing);

function publicState(now = Date.now()) {
  return {
    serverNow: now,
    codeVersion,
    mode: config.mode,
    slotMs: slot(),
    stopFadeMs: queue.STOP_FADE_MS,
    prefix: config.prefix,
    timing: config.timing,
    rotationSize: config.rotationSize,
    presetNames: config.presetNames,
    delaySeconds: state.delaySeconds,
    entries: [...state.entries].sort((a, b) => a.createdAt - b.createdAt),
    rotation: queue.rotation(state, config, now),
  };
}

// ---------- Server-Sent Events ----------

const clients = new Set();
let liveTimer = null;

function broadcast() {
  const payload = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) res.write(payload);
}

// One timer for the next pending name. When it fires, the rotation changes, so broadcast.
function scheduleNextLive() {
  clearTimeout(liveTimer);
  const next = queue.nextLiveAt(state, Date.now());
  if (next === null) return;
  liveTimer = setTimeout(() => {
    broadcast();
    scheduleNextLive();
  }, next - Date.now() + 10);
}

function changed() {
  saveState();
  broadcast();
  scheduleNextLive();
}

function openEventStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`retry: 2000\ndata: ${JSON.stringify(publicState())}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

// ---------- Live config reload ----------

// Polls the file's timestamp, which also catches editors that save by replacing the file.
// An invalid file is ignored, and the running config stays in place.
function reloadConfig() {
  let next;
  try {
    next = loadConfig(CONFIG_FILE);
  } catch (err) {
    console.warn(`config.json not applied: ${err.message}`);
    return;
  }
  const previous = config;
  config = next;
  if (next.port !== previous.port) console.warn(`config.json: the port change to ${next.port} needs a server restart.`);
  // A delay edited in the file wins over one set from the phone. At startup, the saved delay wins.
  if (next.delaySeconds !== previous.delaySeconds) queue.setDelay(state, next.delaySeconds);
  // Entering one-shot mode, or a new slot length, re-packs the names still waiting.
  if (isOneshot() && (previous.mode !== next.mode || queue.slotMs(previous.timing) !== slot())) {
    queue.reschedule(state, slot(), Date.now());
  }
  if (previous.mode !== next.mode) console.log(`Mode is now ${next.mode}.`);
  console.log('config.json reloaded.');
  changed();
}

fs.watchFile(CONFIG_FILE, { interval: 500 }, (curr, prev) => {
  if (curr.mtimeMs !== prev.mtimeMs) reloadConfig();
});

// ---------- Hot reload ----------

// `npm start` runs node --watch, which restarts the server when its code changes. Each start
// gets a new codeVersion, and so does each edit under public/. A page reloads when it changes.
let codeVersion = Date.now();
let publicTimer = null;
fs.watch(PUBLIC_DIR, { recursive: true }, (event, file) => {
  if (!file || path.basename(file).startsWith('.') || file.endsWith('~')) return; // editor temp files
  clearTimeout(publicTimer);
  publicTimer = setTimeout(() => { // one save can fire several events
    codeVersion = Date.now();
    console.log(`public/${file} changed. Reloading the open pages.`);
    broadcast();
  }, 200);
});

// Keeps idle connections open through proxies and Wi-Fi power saving.
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25_000).unref();

// ---------- HTTP helpers ----------

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10_000) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const relative = PAGES[pathname] ?? decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- Routes ----------

async function handleApi(req, res, pathname) {
  const now = Date.now();

  if (req.method === 'GET' && pathname === '/api/state') return sendJson(res, 200, publicState(now));

  if (req.method === 'POST' && pathname === '/api/names') {
    const { name } = await readJson(req);
    const entry = isOneshot() ? queue.enqueueName(state, name, slot(), now) : queue.addName(state, name, now);
    if (!entry) return sendJson(res, 400, { error: 'name is empty' });
    changed();
    return sendJson(res, 201, entry);
  }

  if (req.method === 'POST' && pathname === '/api/delay') {
    if (!queue.setDelay(state, (await readJson(req)).seconds)) return sendJson(res, 400, { error: 'invalid seconds' });
    changed();
    return sendJson(res, 200, { delaySeconds: state.delaySeconds });
  }

  const match = pathname.match(/^\/api\/names\/([^/]+)(\/now)?$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    let ok = false;
    if (req.method === 'POST' && match[2]) {
      if (isOneshot()) return sendJson(res, 409, { error: 'send now is not used in one-shot mode' });
      ok = queue.sendNow(state, id, now);
    } else if (req.method === 'DELETE' && !match[2]) {
      ok = isOneshot() ? queue.removeOneshot(state, id, slot(), now) : queue.removeName(state, id);
    } else return sendJson(res, 405, { error: 'method not allowed' });
    if (!ok) return sendJson(res, 404, { error: match[2] ? 'no such pending name' : 'no such name' });
    changed();
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname === '/events') return openEventStream(req, res);
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
    sendJson(res, 405, { error: 'method not allowed' });
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
});

if (isOneshot()) {
  queue.reschedule(state, slot(), Date.now());
  saveState();
}

server.listen(PORT, () => {
  scheduleNextLive();
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    .map((a) => a.address);
  console.log('Surrender Dorothy is running.\n');
  console.log(`  Projector: http://localhost:${PORT}/`);
  for (const ip of addresses) console.log(`  Greeter:   http://${ip}:${PORT}/greeter`);
  if (addresses.length === 0) console.log('  Greeter:   no Wi-Fi address found. Is the laptop on the network?');
  const settings = isOneshot() ? 'one-shot mode' : `rotation mode, delay ${state.delaySeconds}s, rotation of ${config.rotationSize}`;
  console.log(`\n  ${settings}, state in ${STATE_FILE}`);
});
