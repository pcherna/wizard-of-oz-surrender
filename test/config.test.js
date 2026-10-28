import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateConfig } from '../lib/config.js';

const shipped = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const withChange = (change) => ({ ...structuredClone(shipped), ...change });

test('the shipped config.json is valid', () => {
  assert.doesNotThrow(() => validateConfig(shipped));
});

test('an empty preset list is allowed', () => {
  assert.doesNotThrow(() => validateConfig(withChange({ presetNames: [] })));
});

test('mode defaults to rotation and accepts oneshot', () => {
  const noMode = structuredClone(shipped);
  delete noMode.mode;
  assert.equal(validateConfig(noMode).mode, 'rotation');
  assert.equal(validateConfig(withChange({ mode: 'oneshot' })).mode, 'oneshot');
  assert.throws(() => validateConfig(withChange({ mode: 'once' })), /mode/);
});

test('bad settings are rejected with the setting named', () => {
  assert.throws(() => validateConfig(withChange({ rotationSize: 0 })), /rotationSize/);
  assert.throws(() => validateConfig(withChange({ idleNames: [] })), /idleNames/);
  assert.throws(() => validateConfig(withChange({ presetNames: ['Bob', 7] })), /presetNames/);
  assert.throws(() => validateConfig(withChange({ timing: { writeMs: 7000, holdMs: 4000 } })), /timing\.dissipateMs/);
  assert.throws(() => validateConfig(withChange({ prefix: '  ' })), /prefix/);
  assert.throws(() => validateConfig(withChange({ delaySeconds: -1 })), /delaySeconds/);
});

test('every problem is reported at once', () => {
  assert.throws(() => validateConfig(withChange({ port: 'x', rotationSize: 0 })), /port.*rotationSize/);
});
