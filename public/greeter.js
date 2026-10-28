// Greeter phone page: pick or type a guest's name, watch the queue, tune the delay.
// In one-shot mode the delay is unused: names play in turn, and shown names can be replayed.
// Up next lists the newest name on top, so the next to play sits just above "On the sky now".

const $ = (id) => document.getElementById(id);
const input = $('nameInput');
const addButton = $('addButton');

let state = null;
let clockOffset = 0; // serverNow - local now, so countdowns survive a wrong phone clock
let codeVersion = null; // the server's code version when this page loaded

const serverNow = () => Date.now() + clockOffset;

// ---------- API ----------

async function api(method, url, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return await res.json();
  } catch (err) {
    toast(`Failed: ${err.message}`, true);
    return null;
  }
}

async function addName(name) {
  const entry = await api('POST', '/api/names', { name });
  if (entry) toast(`Added ${entry.name}`);
}

// ---------- Rendering ----------

function renderPresets() {
  const filter = input.value.trim().toLocaleLowerCase();
  const all = [...state.presetNames].sort((a, b) => a.localeCompare(b));
  const matches = filter ? all.filter((n) => n.toLocaleLowerCase().startsWith(filter)) : all;
  const grid = $('presets');
  grid.replaceChildren(...matches.map((name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.addEventListener('click', () => {
      addName(name);
      input.value = '';
      renderPresets();
      updateAddButton();
    });
    return b;
  }));
  if (matches.length === 0) {
    const p = document.createElement('div');
    p.className = 'empty';
    p.textContent = filter ? 'Not on the list. Tap Add to use the typed name.' : 'No quick-pick names in config.json.';
    grid.append(p);
  }
  $('presetCount').textContent = filter ? `${matches.length} of ${all.length}` : String(all.length);
}

function button(className, label, onClick) {
  const b = document.createElement('button');
  b.className = className;
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function row(entry, { countdown = false, now = false, remove = false, replay = false }) {
  const li = document.createElement('li');
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = entry.name;
  li.append(name);
  const path = `/api/names/${encodeURIComponent(entry.id)}`;
  if (countdown) {
    const count = document.createElement('span');
    count.className = 'count';
    count.dataset.liveAt = entry.liveAt;
    li.append(count);
  }
  if (now) li.append(button('now', 'Now', () => api('POST', `${path}/now`)));
  if (replay) li.append(button('replay', 'Replay', () => addName(entry.name)));
  if (remove) {
    const b = button('remove', '×', () => api('DELETE', path));
    b.setAttribute('aria-label', `Remove ${entry.name}`);
    li.append(b);
  }
  return li;
}

const SHOWN_LIMIT = 5;
const byLiveAt = (a, b) => a.liveAt - b.liveAt || a.createdAt - b.createdAt;

// Keeps the first entry for each name in a newest-first list, so a replayed name
// replaces its older row instead of pushing a different name off the list.
function newestPerName(entries) {
  const seen = new Set();
  return entries.filter((e) => {
    const key = e.name.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Sorts entries into the three lists the page shows. The rules differ by mode.
function groups(now) {
  if (state.mode === 'oneshot') {
    const status = (e) => (e.liveAt > now ? 'queued' : e.liveAt + state.slotMs > now ? 'playing' : 'shown');
    return {
      pending: state.entries.filter((e) => status(e) === 'queued').sort(byLiveAt).reverse(), // newest on top
      live: state.entries.filter((e) => status(e) === 'playing'),
      shown: newestPerName(state.entries.filter((e) => status(e) === 'shown').sort(byLiveAt).reverse())
        .slice(0, SHOWN_LIMIT),
    };
  }
  return {
    pending: state.entries.filter((e) => e.liveAt > now).sort(byLiveAt),
    live: state.entries.filter((e) => e.liveAt <= now).sort(byLiveAt).slice(-state.rotationSize).reverse(),
    shown: [],
  };
}

function fill(list, entries, options, emptyText) {
  list.replaceChildren(...entries.map((e) => row(e, options)));
  if (!entries.length) list.innerHTML = `<div class="empty">${emptyText}</div>`;
}

let renderedKey = '';

// Rebuilds the lists when a server update arrives (`force`) or when a name changes list.
// Otherwise only the countdowns tick, so a button is never replaced under a finger.
function renderQueue(force = false) {
  const g = groups(serverNow());
  const key = state.mode + [g.pending, g.live, g.shown].map((l) => l.map((e) => e.id).join(',')).join('|');
  if (force || key !== renderedKey) {
    renderedKey = key;
    const oneshot = state.mode === 'oneshot';
    $('pendingTitle').textContent = oneshot ? 'Up next' : 'Waiting';
    if (oneshot) {
      fill($('pending'), g.pending, { countdown: true, remove: true }, 'Nobody in line.');
      fill($('live'), g.live, { remove: true }, 'Clear sky. The next name plays at once.');
      fill($('shown'), g.shown, { replay: true }, 'Nothing shown yet.');
    } else {
      fill($('pending'), g.pending, { countdown: true, now: true, remove: true }, 'Nobody waiting.');
      fill($('live'), g.live, { remove: true }, 'No guests yet. The sky shows the idle names.');
    }
    $('shownSection').hidden = !oneshot;
    $('delaySection').hidden = oneshot;
    $('delayValue').textContent = `${state.delaySeconds}s`;
  }
  updateCountdowns();
}

function updateCountdowns() {
  for (const el of document.querySelectorAll('.count')) {
    const seconds = Math.ceil((Number(el.dataset.liveAt) - serverNow()) / 1000);
    el.textContent = `${Math.max(0, seconds)}s`;
  }
}

function updateAddButton() {
  addButton.disabled = input.value.trim() === '';
}

let toastTimer;
function toast(text, isError = false) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

// ---------- Events ----------

input.addEventListener('input', () => {
  updateAddButton();
  if (state) renderPresets();
});

$('addForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = input.value.trim();
  if (!name) return;
  addName(name);
  input.value = '';
  updateAddButton();
  renderPresets();
});

function stepDelay(delta) {
  if (state) api('POST', '/api/delay', { seconds: Math.max(0, state.delaySeconds + delta) });
}
$('delayDown').addEventListener('click', () => stepDelay(-15));
$('delayUp').addEventListener('click', () => stepDelay(15));

// Sends the slider value at most every 100 ms while dragging, so the projector follows the finger.
// Server updates don't move the slider during a drag, so it never jumps back under the finger.
const brightness = $('brightness');
let draggingBrightness = false;
let brightnessTimer = null;
let brightnessSent = Promise.resolve(); // one request at a time, so the last value always lands last
function sendBrightness() {
  brightnessTimer = null;
  const percent = Number(brightness.value);
  brightnessSent = brightnessSent.then(() => api('POST', '/api/brightness', { percent }));
}
brightness.addEventListener('input', () => {
  draggingBrightness = true;
  $('brightnessValue').textContent = `${brightness.value}%`;
  brightnessTimer ??= setTimeout(sendBrightness, 100);
});
brightness.addEventListener('change', () => {
  draggingBrightness = false;
  clearTimeout(brightnessTimer);
  sendBrightness();
});

function renderBrightness() {
  if (draggingBrightness) return;
  brightness.value = state.brightness;
  $('brightnessValue').textContent = `${state.brightness}%`;
}

setInterval(() => {
  if (state) renderQueue();
}, 1000);

// ---------- Live updates ----------

const events = new EventSource('/events');
events.onopen = () => {
  $('status').textContent = 'Connected';
  $('status').classList.add('ok');
};
events.onerror = () => {
  $('status').textContent = 'Reconnecting';
  $('status').classList.remove('ok');
};
events.onmessage = (event) => {
  const next = JSON.parse(event.data);
  codeVersion ??= next.codeVersion;
  if (next.codeVersion !== codeVersion) return location.reload(); // the app code changed
  const previousPresets = state && JSON.stringify(state.presetNames);
  state = next;
  clockOffset = state.serverNow - Date.now();
  document.querySelector('.title h1').textContent = `${state.prefix} …`;
  if (JSON.stringify(state.presetNames) !== previousPresets) renderPresets();
  renderQueue(true);
  renderBrightness();
};
