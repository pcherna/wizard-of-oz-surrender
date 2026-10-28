// Local server for the projector page (/) and the greeter phone page (/greeter).
// Zero dependencies. Run with `npm start`.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as queue from './lib/queue.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
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

function publicState(now = Date.now()) {
  return {
    serverNow: now,
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
    const entry = queue.addName(state, (await readJson(req)).name, now);
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
    if (req.method === 'POST' && match[2]) ok = queue.sendNow(state, id, now);
    else if (req.method === 'DELETE' && !match[2]) ok = queue.removeName(state, id);
    else return sendJson(res, 405, { error: 'method not allowed' });
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
  console.log(`\n  Delay ${state.delaySeconds}s, rotation of ${config.rotationSize}, state in ${STATE_FILE}`);
});
