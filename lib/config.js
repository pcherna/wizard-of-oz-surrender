// Reads and checks config.json. Throws with a readable message when a setting is wrong.

import fs from 'node:fs';

// rotation: names go live after a delay and the sky cycles the latest few, or the idle list.
// oneshot: the sky shows clouds only, and each name plays once as soon as the sky is free.
export const MODES = ['rotation', 'oneshot'];

const isPositive =(v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isNameList = (v) => Array.isArray(v) && v.every((n) => typeof n === 'string' && n.trim() !== '');

export function validateConfig(config) {
  const problems = [];
  if (!config || typeof config !== 'object') throw new Error('config must be a JSON object');
  config.mode ??= 'rotation';
  if (!MODES.includes(config.mode)) problems.push(`mode must be one of: ${MODES.join(', ')}`);
  if (!Number.isInteger(config.port) || config.port <= 0) problems.push('port must be a positive whole number');
  if (typeof config.prefix !== 'string' || !config.prefix.trim()) problems.push('prefix must be a non-empty string');
  if (typeof config.delaySeconds !== 'number' || !(config.delaySeconds >= 0)) problems.push('delaySeconds must be 0 or more');
  if (!Number.isInteger(config.rotationSize) || config.rotationSize < 1) problems.push('rotationSize must be a whole number of 1 or more');
  const t = config.timing ?? {};
  for (const key of ['writeMs', 'holdMs', 'dissipateMs']) {
    if (!isPositive(t[key])) problems.push(`timing.${key} must be a positive number`);
  }
  if (!isNameList(config.idleNames) || config.idleNames.length === 0) problems.push('idleNames must be a non-empty list of names');
  if (!isNameList(config.presetNames)) problems.push('presetNames must be a list of names');
  if (problems.length) throw new Error(problems.join('; '));
  return config;
}

export function loadConfig(file) {
  return validateConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
}
