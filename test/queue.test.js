import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, normalizeName, addName, removeName, sendNow, setDelay, rotation, nextLiveAt,
} from '../lib/queue.js';

const config = { rotationSize: 3, idleNames: ['Dorothy', 'Peter'] };

test('normalizeName trims, collapses spaces, caps length and capitalizes', () => {
  assert.equal(normalizeName('  robert  '), 'Robert');
  assert.equal(normalizeName('mary   jane'), 'Mary jane');
  assert.equal(normalizeName('   '), null);
  assert.equal(normalizeName(undefined), null);
  assert.equal(normalizeName('x'.repeat(40)).length, 30);
});

test('a new name stays pending until the delay passes', () => {
  const state = createState(60);
  addName(state, 'Robert', 1000);
  assert.deepEqual(rotation(state, config, 1000), ['Dorothy', 'Peter']);
  assert.deepEqual(rotation(state, config, 60_999), ['Dorothy', 'Peter']);
  assert.deepEqual(rotation(state, config, 61_000), ['Robert']);
});

test('one live guest replaces the idle list', () => {
  const state = createState(0);
  addName(state, 'Zack', 0);
  assert.deepEqual(rotation(state, config, 0), ['Zack']);
});

test('rotation holds the newest N live names, oldest first', () => {
  const state = createState(0);
  ['A', 'B', 'C', 'D'].forEach((n, i) => addName(state, n, i * 10));
  assert.deepEqual(rotation(state, config, 100), ['B', 'C', 'D']);
});

test('send now makes a pending name live immediately', () => {
  const state = createState(60);
  const e = addName(state, 'Rebecca', 0);
  assert.equal(sendNow(state, e.id, 5000), true);
  assert.deepEqual(rotation(state, config, 5000), ['Rebecca']);
  assert.equal(sendNow(state, e.id, 6000), false, 'already live');
  assert.equal(sendNow(state, 'missing', 6000), false);
});

test('send now orders the name by its new live time', () => {
  const state = createState(60);
  const early = addName(state, 'Early', 0);
  const late = addName(state, 'Late', 1000);
  sendNow(state, late.id, 2000);
  sendNow(state, early.id, 3000);
  assert.deepEqual(rotation(state, config, 3000), ['Late', 'Early']);
});

test('remove works for pending and live names', () => {
  const state = createState(60);
  const pending = addName(state, 'Pending', 0);
  const live = addName(state, 'Live', 0);
  sendNow(state, live.id, 0);
  assert.equal(removeName(state, live.id), true);
  assert.deepEqual(rotation(state, config, 0), ['Dorothy', 'Peter']);
  assert.equal(removeName(state, pending.id), true);
  assert.equal(state.entries.length, 0);
  assert.equal(removeName(state, pending.id), false);
});

test('a delay change applies only to names added afterwards', () => {
  const state = createState(60);
  const before = addName(state, 'Before', 0);
  setDelay(state, 10);
  const after = addName(state, 'After', 0);
  assert.equal(before.liveAt, 60_000);
  assert.equal(after.liveAt, 10_000);
});

test('setDelay clamps and rejects garbage', () => {
  const state = createState(60);
  setDelay(state, -5);
  assert.equal(state.delaySeconds, 0);
  setDelay(state, 9999);
  assert.equal(state.delaySeconds, 600);
  assert.equal(setDelay(state, 'abc'), false);
  assert.equal(state.delaySeconds, 600);
});

test('nextLiveAt returns the earliest pending time', () => {
  const state = createState(60);
  assert.equal(nextLiveAt(state, 0), null);
  addName(state, 'A', 5000);
  addName(state, 'B', 1000);
  assert.equal(nextLiveAt(state, 0), 61_000);
  assert.equal(nextLiveAt(state, 70_000), null);
});
