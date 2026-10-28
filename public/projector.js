// Projector scene: a blue sky with drifting clouds, and the witch skywriting
// "<prefix> <name>" in smoke. Names arrive from the server over Server-Sent Events.
// Rotation mode cycles names without pause. One-shot mode plays each name once in its
// server-scheduled slot and shows only clouds in between. Removing that name on the phone
// stops it: the writing stops and the smoke fades off fast.

const canvas = document.getElementById('sky');
const ctx = canvas.getContext('2d');

const FONT = '"Dancing Script"';
const TARGET_PUFFS = 2600;   // smoke particles per name; sampling step adapts to hit this
const LEAD_IN = 0.1;         // share of the write phase the witch spends flying in
const TURN = 0.14;           // share of the write phase spent swooping down to the second line
const WITCH_UNITS = 165;     // length of the witch drawing in its own units

let W = 0;
let H = 0;
let skyGradient = null;
let skyImage = null;
let clouds = [];

let prefix = 'Surrender';
let timing = { writeMs: 7000, holdMs: 4000, dissipateMs: 4000 };
let mode = 'rotation';
let rotation = null;
let lastName = null;
let lastIndex = -1;
let entries = [];
let clockOffset = 0;     // serverNow - local now, so slots line up with the phone's countdowns
let lastPlayedId = null; // one-shot: the slot outlasts the animation, so don't replay it
let stopFadeMs = 1000;
let codeVersion = null; // the server's code version when this page loaded

let cycle = null;
let trail = [];

const rand = (min, max) => min + Math.random() * (max - min);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ---------- Sprites ----------

function makePuffSprite() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(20, 20, 24, 1)');
  grad.addColorStop(0.35, 'rgba(20, 20, 24, 0.75)');
  grad.addColorStop(0.7, 'rgba(24, 24, 28, 0.25)');
  grad.addColorStop(1, 'rgba(28, 28, 32, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

// A cumulus cloud: overlapping soft white blobs, tallest in the middle, with a grey-blue underside.
function makeCloudSprite() {
  const w = 512;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const blobs = Math.round(rand(26, 40));
  for (let i = 0; i < blobs; i++) {
    const u = rand(0.12, 0.88);
    const centered = 1 - Math.abs(u - 0.5) * 2;
    const bx = u * w;
    const by = h * 0.62 - rand(0, h * 0.32) * centered;
    const r = (28 + rand(0, 52)) * (0.55 + 0.45 * centered);
    const grad = g.createRadialGradient(bx, by - r * 0.3, r * 0.1, bx, by, r);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.6, 'rgba(246, 249, 253, 0.6)');
    grad.addColorStop(1, 'rgba(232, 238, 247, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(bx, by, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-atop';
  const shade = g.createLinearGradient(0, h * 0.35, 0, h * 0.85);
  shade.addColorStop(0, 'rgba(150, 168, 196, 0)');
  shade.addColorStop(1, 'rgba(140, 158, 190, 0.55)');
  g.fillStyle = shade;
  g.fillRect(0, 0, w, h);
  return c;
}

const puffSprite = makePuffSprite();
const cloudSprites = Array.from({ length: 6 }, makeCloudSprite);

// ---------- Sky ----------

const CLOUD_LAYERS = [
  { count: 6, scale: 0.55, speed: 5, alpha: 0.65, yMin: 0.55, yMax: 0.9 },
  { count: 5, scale: 0.95, speed: 9, alpha: 0.85, yMin: 0.1, yMax: 0.8 },
  { count: 3, scale: 1.5, speed: 15, alpha: 0.95, yMin: 0.0, yMax: 0.85 },
];

function layoutClouds() {
  const unit = W / 1600;
  clouds = CLOUD_LAYERS.flatMap((layer) =>
    Array.from({ length: layer.count }, () => {
      const scale = layer.scale * unit * rand(0.8, 1.2);
      return {
        sprite: cloudSprites[Math.floor(Math.random() * cloudSprites.length)],
        w: 512 * scale,
        h: 256 * scale,
        x: rand(-512 * scale, W),
        y: rand(layer.yMin, layer.yMax) * H - 128 * scale,
        speed: layer.speed * unit * rand(0.8, 1.2),
        alpha: layer.alpha,
      };
    }));
}

function drawSky(now, dt) {
  if (skyImage) {
    const scale = Math.max(W / skyImage.width, H / skyImage.height) * 1.08;
    const iw = skyImage.width * scale;
    const ih = skyImage.height * scale;
    const extra = iw - W;
    ctx.drawImage(skyImage, -extra / 2 + Math.sin(now / 30000) * (extra / 2), (H - ih) / 2, iw, ih);
    return;
  }
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, W, H);
  for (const c of clouds) {
    c.x += c.speed * dt;
    if (c.x > W) c.x = -c.w;
    ctx.globalAlpha = c.alpha;
    ctx.drawImage(c.sprite, c.x, c.y, c.w, c.h);
  }
  ctx.globalAlpha = 1;
}

// ---------- Text to smoke targets ----------

// Renders one line of text alone and returns its alpha mask.
function renderLine(g, text, size, baseline) {
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  g.font = `700 ${size}px ${FONT}`;
  g.fillText(text, W / 2, baseline);
  const { width, data } = g.getImageData(0, 0, g.canvas.width, g.canvas.height);
  return (x, y) => data[(y * width + x) * 4 + 3] > 128;
}

function samplePoints(filled, step, width, height) {
  const points = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const jx = x + rand(-0.3, 0.3) * step;
      const jy = y + rand(-0.3, 0.3) * step;
      const px = Math.round(jx);
      const py = Math.round(jy);
      if (px < 0 || py < 0 || px >= width || py >= height || !filled(px, py)) continue;
      points.push({
        hx: jx, hy: jy, born: null,
        p1: rand(0, Math.PI * 2), p2: rand(0, Math.PI * 2), f: rand(0.6, 1.4),
        sizeMul: rand(0.8, 1.3), alpha: rand(0.22, 0.34),
        delay: rand(0, 0.35), wind: rand(0.5, 1.5), rise: rand(-0.3, 1),
      });
    }
  }
  return points;
}

// Two lines: the prefix written left to right, then the name written right to left.
// `id` is the entry being played in one-shot mode, so the cycle can be stopped. Null in rotation mode.
function buildCycle(name, startAt, id = null) {
  const off = document.createElement('canvas');
  off.width = Math.ceil(W);
  off.height = Math.ceil(H);
  const g = off.getContext('2d', { willReadFrequently: true });
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff';

  // Each line fills at most 85 % of the width. A long name shrinks without shrinking the prefix.
  const maxSize = H * 0.22;
  const fit = (text) => {
    g.font = `700 ${maxSize}px ${FONT}`;
    return Math.min(maxSize, (maxSize * W * 0.85) / g.measureText(text).width);
  };
  const texts = [prefix, name];
  const sizes = texts.map(fit);
  const gap = Math.max(...sizes) * 1.1;
  const blockHeight = 0.75 * sizes[0] + gap + 0.3 * sizes[1];
  const baseline1 = H * 0.42 - blockHeight / 2 + 0.75 * sizes[0];
  const baselines = [baseline1, baseline1 + gap];

  const masks = texts.map((text, i) => renderLine(g, text, sizes[i], baselines[i]));
  let count = 0;
  for (const filled of masks) {
    for (let y = 0; y < off.height; y += 2) {
      for (let x = 0; x < off.width; x += 2) if (filled(x, y)) count++;
    }
  }
  const step = Math.max(2, Math.sqrt((count * 4) / TARGET_PUFFS));

  const lines = masks.map((filled, i) => {
    const dir = i === 0 ? 1 : -1;
    const points = samplePoints(filled, step, off.width, off.height).sort((a, b) => dir * (a.hx - b.hx));
    const xs = points.map((p) => p.hx);
    return {
      dir, points, revealed: 0,
      left: Math.min(...xs), right: Math.max(...xs),
      midY: baselines[i] - sizes[i] * 0.35,
    };
  });

  const witchScale = (sizes[0] * 0.54) / WITCH_UNITS;
  return {
    name, startAt, id, step, lines,
    stoppedAt: null,
    timing, // fixed for this cycle, so a config reload never jumps the witch mid-flight
    points: lines.flatMap((l) => l.points),
    r0: step * 2.2,
    witch: {
      x: -WITCH_UNITS * witchScale, y: lines[0].midY, targetY: lines[0].midY,
      tilt: 0, facing: 1, scale: witchScale,
    },
  };
}

// ---------- Rotation ----------

function nextName() {
  const list = rotation;
  let i;
  if (list[lastIndex] === lastName) i = lastIndex + 1;
  else {
    const found = list.indexOf(lastName);
    i = found >= 0 ? found + 1 : 0;
  }
  i %= list.length;
  lastIndex = i;
  lastName = list[i];
  return list[i];
}

function startNextCycle(now) {
  if (mode === 'oneshot') {
    // Join the name whose slot covers this moment. After a page reload, that may be mid-flight.
    const t = Date.now() + clockOffset;
    const length = timing.writeMs + timing.holdMs + timing.dissipateMs;
    const due = entries.find((e) => e.id !== lastPlayedId && e.liveAt <= t && t < e.liveAt + length);
    cycle = due ? buildCycle(due.name, now - (t - due.liveAt), due.id) : null;
    if (due) lastPlayedId = due.id;
    return;
  }
  cycle = rotation && rotation.length ? buildCycle(nextName(), now) : null;
}

// ---------- Witch ----------

function drawWitch(w, now) {
  const flap = Math.sin(now * 0.012) * 4;
  ctx.save();
  ctx.translate(w.x, w.y);
  ctx.rotate(w.tilt);
  ctx.scale(w.facing * w.scale, w.scale);
  ctx.fillStyle = ctx.strokeStyle = '#0b0b0d';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Bristles, with loose strands at the tail where the smoke comes out.
  ctx.beginPath();
  ctx.moveTo(2, -9);
  ctx.quadraticCurveTo(22, -6, 42, -3);
  ctx.lineTo(42, 3);
  ctx.quadraticCurveTo(22, 7, 2, 10);
  ctx.quadraticCurveTo(-3, 0, 2, -9);
  ctx.fill();
  ctx.lineWidth = 1.3;
  for (let k = -5; k <= 5; k++) {
    ctx.beginPath();
    ctx.moveTo(30, k * 0.8);
    ctx.lineTo(-4, k * 2.6 + Math.sin(now * 0.02 + k) * 1.5);
    ctx.stroke();
  }

  // Stick.
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(38, 0);
  ctx.lineTo(162, -10);
  ctx.stroke();

  // Body and cape streaming behind.
  ctx.beginPath();
  ctx.moveTo(102, -46);
  ctx.quadraticCurveTo(114, -40, 118, -16);
  ctx.lineTo(130, -6);
  ctx.lineTo(133, 10);
  ctx.lineTo(124, 11);
  ctx.lineTo(118, -1);
  ctx.lineTo(96, -2);
  ctx.quadraticCurveTo(80, 4 + flap, 62, 4 + flap * 1.6);
  ctx.quadraticCurveTo(70, -8 + flap, 60, -14 + flap * 1.3);
  ctx.quadraticCurveTo(84, -22, 96, -44);
  ctx.closePath();
  ctx.fill();

  // Arm reaching to the stick.
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(108, -38);
  ctx.quadraticCurveTo(124, -26, 138, -12);
  ctx.stroke();

  // Head, nose and chin.
  ctx.beginPath();
  ctx.arc(106, -54, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(112, -58);
  ctx.lineTo(122, -52);
  ctx.lineTo(112, -51);
  ctx.moveTo(108, -48);
  ctx.lineTo(114, -42);
  ctx.lineTo(104, -46);
  ctx.fill();

  // Hair trailing back.
  ctx.lineWidth = 2;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.moveTo(100, -56 + k * 3);
    ctx.quadraticCurveTo(92, -50 + k * 3 + flap * 0.5, 86, -46 + k * 4 + flap);
    ctx.stroke();
  }

  // Hat: brim and a cone bent backwards.
  ctx.beginPath();
  ctx.ellipse(105, -61, 16, 3.2, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(96, -62);
  ctx.quadraticCurveTo(98, -84, 82, -100 + flap * 0.3);
  ctx.quadraticCurveTo(104, -88, 115, -63);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// ---------- Smoke ----------

function spawnTrail(x, y, dt, r0, facing) {
  const n = Math.round(dt * 70);
  for (let k = 0; k < n; k++) {
    trail.push({
      x: x + rand(-3, 3), y: y + rand(-4, 4),
      vx: -facing * rand(5, 25), vy: rand(-12, 6),
      age: 0, life: rand(0.9, 1.6), r: r0 * rand(1, 1.6), alpha: rand(0.12, 0.22),
    });
  }
}

function drawTrail(dt, fade = 1) {
  trail = trail.filter((p) => (p.age += dt) < p.life);
  for (const p of trail) {
    const t = p.age / p.life;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const r = p.r * (1 + t * 2);
    ctx.globalAlpha = p.alpha * (1 - t) * Math.min(1, p.age * 8) * fade;
    ctx.drawImage(puffSprite, p.x - r, p.y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
}

// Where the broom tail is at `e` ms into the cycle. The flight has five legs:
// fly in, write line 1 rightwards, swoop out and down while turning, write line 2 leftwards, fly off.
// `y` is null while writing, because the witch then follows the strokes.
function penAt(c, e) {
  const [l1, l2] = c.lines;
  const { writeMs } = c.timing;
  const leadMs = writeMs * LEAD_IN;
  const turnMs = writeMs * TURN;
  const inkMs = writeMs - leadMs - turnMs;
  const w1 = l1.right - l1.left;
  const w2 = l2.right - l2.left;
  const line1Ms = (inkMs * w1) / (w1 + w2);
  const line2Ms = inkMs - line1Ms;
  const witchLength = WITCH_UNITS * c.witch.scale;
  const lerp = (a, b, u) => a + (b - a) * u;

  let t = e;
  if (t < leadMs) return { leg: 0, x: lerp(-witchLength, l1.left, t / leadMs), y: l1.midY, facing: 1 };
  t -= leadMs;
  if (t < line1Ms) return { leg: 1, x: lerp(l1.left, l1.right, t / line1Ms), y: null, facing: 1 };
  t -= line1Ms;
  if (t < turnMs) {
    // Swing out past the end of both lines, then come back in at the lower line's right edge.
    const u = t / turnMs;
    const bulge = Math.max(witchLength * 0.8, Math.abs(l1.right - l2.right) * 0.5);
    const x = lerp(l1.right, l2.right, u) + bulge * Math.sin(Math.PI * u);
    const y = lerp(l1.midY, l2.midY, (1 - Math.cos(Math.PI * u)) / 2);
    return { leg: 2, x, y, facing: u < 0.5 ? 1 : -1 };
  }
  t -= turnMs;
  if (t < line2Ms) return { leg: 3, x: lerp(l2.right, l2.left, t / line2Ms), y: null, facing: -1 };
  t -= line2Ms;
  return { leg: 4, x: l2.left - t * (w2 / line2Ms), y: l2.midY - (t / 1000) * c.step * 12, facing: -1 };
}

// Reveals each line's points up to the pen, or all of them once its leg is over.
function reveal(c, pen, now) {
  c.lines.forEach((line, i) => {
    const leg = i === 0 ? 1 : 3;
    if (pen.leg < leg) return;
    const reached = (p) => pen.leg > leg || (line.dir > 0 ? p.hx <= pen.x : p.hx >= pen.x);
    while (line.revealed < line.points.length && reached(line.points[line.revealed])) {
      line.points[line.revealed++].born = now;
    }
  });
}

function drawCycle(now, dt) {
  const c = cycle;
  const { writeMs, holdMs, dissipateMs } = c.timing;
  const e = now - c.startAt;
  const w = c.witch;
  const witchLength = WITCH_UNITS * w.scale;

  // A stopped name writes no more strokes, and everything fades out over `stopFadeMs`.
  const stopped = c.stoppedAt !== null;
  const stop = stopped ? clamp01((now - c.stoppedAt) / stopFadeMs) : 0;

  const pen = penAt(c, e);
  if (!stopped) reveal(c, pen, now);

  // While writing, the witch tracks the height of the strokes just written, smoothed.
  if (pen.y !== null) w.targetY = pen.y;
  else {
    const line = c.lines[pen.leg === 1 ? 0 : 1];
    const recent = [];
    for (let k = line.revealed - 1; k >= 0 && Math.abs(line.points[k].hx - pen.x) < c.step * 3; k--) {
      recent.push(line.points[k].hy);
    }
    if (recent.length) w.targetY = recent.reduce((a, b) => a + b, 0) / recent.length;
  }
  const prevY = w.y;
  w.y += (w.targetY - w.y) * (1 - Math.exp(-dt * 7));
  w.y += Math.sin(now * 0.004) * 0.4;
  w.x = pen.x;
  // Turning around: `facing` eases through zero, so she flips like a card instead of snapping.
  w.facing += (pen.facing - w.facing) * (1 - Math.exp(-dt * 6));
  const vy = (w.y - prevY) / Math.max(dt, 0.001);
  const tiltTarget = Math.max(-0.35, Math.min(0.35, vy * 0.002)) * Math.sign(pen.facing);
  w.tilt += (tiltTarget - w.tilt) * (1 - Math.exp(-dt * 5));

  const witchVisible = pen.x < W + witchLength && pen.x > -witchLength - 20;
  if (witchVisible && !stopped && e >= writeMs * LEAD_IN * 0.5) spawnTrail(pen.x, w.y, dt, c.r0, pen.facing);

  const d = clamp01((e - writeMs - holdMs) / dissipateMs);
  for (const p of c.points) {
    if (p.born === null) continue;
    const age = (now - p.born) / 1000;
    const grow = Math.min(1, age / 0.5);
    const amp = Math.min(6, 1 + age * 0.8) * (c.step / 5);
    let x = p.hx + Math.sin(now * 0.0011 * p.f + p.p1) * amp;
    let y = p.hy + Math.cos(now * 0.0009 * p.f + p.p2) * amp;
    let r = c.r0 * p.sizeMul * (0.4 + 0.6 * grow) * (1 + age * 0.04);
    let a = p.alpha * grow;
    if (d > 0) {
      const local = clamp01((d - p.delay) / 0.65);
      x += local * local * W * 0.06 * p.wind;
      y -= local * local * H * 0.05 * p.rise;
      r *= 1 + local * 1.8;
      a *= Math.pow(1 - local, 1.6);
    }
    if (stop > 0) {
      r *= 1 + stop * 0.6;
      a *= Math.pow(1 - stop, 1.5);
    }
    if (a <= 0.003) continue;
    ctx.globalAlpha = a;
    ctx.drawImage(puffSprite, x - r, y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;

  drawTrail(dt, 1 - stop);
  if (witchVisible) {
    ctx.globalAlpha = 1 - stop;
    drawWitch(c.witch, now);
    ctx.globalAlpha = 1;
  }

  return stopped ? stop < 1 : e < writeMs + holdMs + dissipateMs;
}

// ---------- Frame loop ----------

let lastFrame = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  drawSky(now, dt);
  if (!cycle) startNextCycle(now);
  if (cycle && !drawCycle(now, dt)) {
    trail = [];
    startNextCycle(now);
  }
  requestAnimationFrame(frame);
}

// ---------- Setup ----------

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  skyGradient = ctx.createLinearGradient(0, 0, 0, H);
  skyGradient.addColorStop(0, '#1b56a8');
  skyGradient.addColorStop(0.55, '#3d86d6');
  skyGradient.addColorStop(1, '#9cc6ef');
  layoutClouds();
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resize();
    // Rebuild the current name for the new screen size, at the same point in its flight.
    if (cycle) cycle = { ...buildCycle(cycle.name, cycle.startAt, cycle.id), stoppedAt: cycle.stoppedAt };
    trail = [];
  }, 200);
});

document.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  document.getElementById('hint').classList.add('gone');
});
setTimeout(() => document.getElementById('hint').classList.add('gone'), 8000);

let cursorTimer;
document.addEventListener('mousemove', () => {
  document.body.classList.remove('idle-cursor');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add('idle-cursor'), 2000);
});

async function keepAwake() {
  try {
    if (document.visibilityState === 'visible') await navigator.wakeLock?.request('screen');
  } catch { /* not supported or refused: rely on OS power settings */ }
}
document.addEventListener('visibilitychange', keepAwake);

function connect() {
  const offline = document.getElementById('offline');
  const events = new EventSource('/events');
  events.onopen = () => offline.classList.remove('show');
  events.onerror = () => offline.classList.add('show');
  events.onmessage = (event) => {
    const state = JSON.parse(event.data);
    codeVersion ??= state.codeVersion;
    if (state.codeVersion !== codeVersion) return location.reload(); // the app code changed
    clockOffset = state.serverNow - Date.now();
    mode = state.mode;
    prefix = state.prefix;
    timing = state.timing;
    rotation = state.rotation;
    entries = state.entries;
    stopFadeMs = state.stopFadeMs;
    // One-shot: the name on the sky was removed on the phone, so stop it.
    if (cycle?.id && cycle.stoppedAt === null && !entries.some((e) => e.id === cycle.id)) {
      cycle.stoppedAt = performance.now();
    }
  };
}

async function loadSkyImage() {
  try {
    const res = await fetch('sky.jpg', { method: 'HEAD' });
    if (!res.ok) return;
    const img = new Image();
    img.src = 'sky.jpg';
    await img.decode();
    skyImage = img;
  } catch { /* no photo: keep the procedural sky */ }
}

resize();
keepAwake();
loadSkyImage();
document.fonts.load(`700 64px ${FONT}`).finally(() => {
  connect();
  requestAnimationFrame(frame);
});
