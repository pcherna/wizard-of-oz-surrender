// Pure queue logic. No I/O, no timers: callers pass `now` in milliseconds.

import { randomUUID } from 'node:crypto';

export const MAX_NAME_LENGTH = 30;
export const MAX_DELAY_SECONDS = 600;

export function createState(delaySeconds) {
  return { delaySeconds, entries: [] };
}

// Trims, collapses inner whitespace, caps length and capitalizes the first letter.
// Returns null for an empty name.
export function normalizeName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH).trim();
  if (!name) return null;
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}

export function addName(state, rawName, now) {
  const name = normalizeName(rawName);
  if (!name) return null;
  const entry = { id: randomUUID(), name, createdAt: now, liveAt: now + state.delaySeconds * 1000 };
  state.entries.push(entry);
  return entry;
}

export function removeName(state, id) {
  const before = state.entries.length;
  state.entries = state.entries.filter((e) => e.id !== id);
  return state.entries.length !== before;
}

export function sendNow(state, id, now) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry || entry.liveAt <= now) return false;
  entry.liveAt = now;
  return true;
}

// Applies to names added later. Names already pending keep their scheduled time.
export function setDelay(state, seconds) {
  const value = Math.round(Number(seconds));
  if (!Number.isFinite(value)) return false;
  state.delaySeconds = Math.min(MAX_DELAY_SECONDS, Math.max(0, value));
  return true;
}

export function isPending(entry, now) {
  return entry.liveAt > now;
}

// The newest `rotationSize` live names, oldest first. Falls back to the idle list.
export function rotation(state, { rotationSize, idleNames }, now) {
  const live = state.entries
    .filter((e) => !isPending(e, now))
    .sort((a, b) => a.liveAt - b.liveAt || a.createdAt - b.createdAt);
  if (live.length === 0) return [...idleNames];
  return live.slice(-rotationSize).map((e) => e.name);
}

// ---------- One-shot mode ----------
// Each name plays once in its own slot, starting at liveAt. Slots follow each other in entry order.

export const ONESHOT_GAP_MS = 1000; // clear sky between two names
export const STOP_FADE_MS = 1000;   // how long a stopped name takes to fade off the sky

export function slotMs({ writeMs, holdMs, dissipateMs }) {
  return writeMs + holdMs + dissipateMs + ONESHOT_GAP_MS;
}

export function oneshotStatus(entry, slot, now) {
  if (entry.liveAt > now) return 'queued';
  return entry.liveAt + slot > now ? 'playing' : 'shown';
}

// When the sky is free of a stopped name's fading smoke: skyClearAt, or now.
const clearFrom = (state, now) => Math.max(now, state.skyClearAt ?? 0);

// When the sky is next free: the end of the last booked slot, or now.
function queueEnd(state, slot, now) {
  return state.entries.reduce((end, e) => Math.max(end, e.liveAt + slot), clearFrom(state, now));
}

export function enqueueName(state, rawName, slot, now) {
  const name = normalizeName(rawName);
  if (!name) return null;
  const entry = { id: randomUUID(), name, createdAt: now, liveAt: queueEnd(state, slot, now) };
  state.entries.push(entry);
  return entry;
}

// Packs queued names into back-to-back slots after the one playing now, keeping their order.
// Used after a removal, a timing change or a switch into one-shot mode.
export function reschedule(state, slot, now) {
  const queued = state.entries.filter((e) => e.liveAt > now).sort((a, b) => a.liveAt - b.liveAt);
  let next = state.entries
    .filter((e) => e.liveAt <= now)
    .reduce((end, e) => Math.max(end, e.liveAt + slot), clearFrom(state, now));
  for (const e of queued) {
    e.liveAt = next;
    next += slot;
  }
}

// Removes a name in one-shot mode. Removing the name on the sky stops it: its smoke fades
// off fast, and the next name starts after the fade and the usual gap.
export function removeOneshot(state, id, slot, now) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return false;
  if (oneshotStatus(entry, slot, now) === 'playing') state.skyClearAt = now + STOP_FADE_MS + ONESHOT_GAP_MS;
  removeName(state, id);
  reschedule(state, slot, now);
  return true;
}

// The earliest future liveAt, or null when nothing is pending.
export function nextLiveAt(state, now) {
  const pending = state.entries.filter((e) => isPending(e, now)).map((e) => e.liveAt);
  return pending.length ? Math.min(...pending) : null;
}
