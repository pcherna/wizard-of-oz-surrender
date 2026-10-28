// Greeter phone page: pick or type a guest's name, watch the queue, tune the delay.

const $ = (id) => document.getElementById(id);
const input = $('nameInput');
const addButton = $('addButton');

let state = null;
let clockOffset = 0; // serverNow - local now, so countdowns survive a wrong phone clock

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

function row(entry, { countdown }) {
  const li = document.createElement('li');
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = entry.name;
  li.append(name);
  if (countdown) {
    const count = document.createElement('span');
    count.className = 'count';
    count.dataset.liveAt = entry.liveAt;
    li.append(count);
    const now = document.createElement('button');
    now.className = 'now';
    now.type = 'button';
    now.textContent = 'Now';
    now.addEventListener('click', () => api('POST', `/api/names/${encodeURIComponent(entry.id)}/now`));
    li.append(now);
  }
  const remove = document.createElement('button');
  remove.className = 'remove';
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove ${entry.name}`);
  remove.textContent = '×';
  remove.addEventListener('click', () => api('DELETE', `/api/names/${encodeURIComponent(entry.id)}`));
  li.append(remove);
  return li;
}

// Rebuilds the pending and live lists. Called on each server update and when a name goes live.
function renderQueue() {
  const now = serverNow();
  const pending = state.entries.filter((e) => e.liveAt > now).sort((a, b) => a.liveAt - b.liveAt);
  const live = state.entries
    .filter((e) => e.liveAt <= now)
    .sort((a, b) => a.liveAt - b.liveAt || a.createdAt - b.createdAt)
    .slice(-state.rotationSize)
    .reverse();

  $('pending').replaceChildren(...pending.map((e) => row(e, { countdown: true })));
  if (!pending.length) $('pending').innerHTML = '<div class="empty">Nobody waiting.</div>';

  $('live').replaceChildren(...live.map((e) => row(e, { countdown: false })));
  if (!live.length) $('live').innerHTML = '<div class="empty">No guests yet. The sky shows the idle names.</div>';

  $('delayValue').textContent = `${state.delaySeconds}s`;
  updateCountdowns();
}

// Ticks every second. Returns true when a pending name has crossed into live.
function updateCountdowns() {
  let crossed = false;
  for (const el of document.querySelectorAll('.count')) {
    const seconds = Math.ceil((Number(el.dataset.liveAt) - serverNow()) / 1000);
    if (seconds <= 0) crossed = true;
    el.textContent = `${Math.max(0, seconds)}s`;
  }
  return crossed;
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

setInterval(() => {
  if (state && updateCountdowns()) renderQueue();
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
  const first = state === null;
  state = JSON.parse(event.data);
  clockOffset = state.serverNow - Date.now();
  document.querySelector('.title h1').textContent = `${state.prefix} …`;
  if (first) renderPresets();
  renderQueue();
};
