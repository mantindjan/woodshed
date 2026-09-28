// Shared by the shell (main.js) and the per-game panels (degrees-ui.js,
// lanes-ui.js, cells-ui.js): DOM and storage helpers, the settings every
// game uses, and hooks the shell fills in so a panel can ask for a redraw,
// a tab or a sync without importing the shell (no import cycles).
//
// Old data is renamed before anything reads it: the top-level await below
// runs first, as every module that reads settings imports this one.

import { migrateLocal } from './migrate.js';

await migrateLocal();

export const $ = sel => document.querySelector(sel);
export const $$ = sel => document.querySelectorAll(sel);

// localStorage can throw (private mode, storage disabled); fall back to
// defaults rather than breaking the page. Keys are prefixed `woodshed.`.
export function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
export function loadJSON(key, fallback) {
  try { return JSON.parse(load(key)) ?? fallback; } catch { return fallback; }
}

// Settings shared by the games (all carried by the backup and sync).
export const CALIB_KEY = 'woodshed.calib';
export const OFFSET_KEY = 'woodshed.calibOffset';   // horn MIDI − written, from middle C
export const GAME_KEY = 'woodshed.game';
export const MODE_KEY = 'woodshed.mode';            // learn | practice, one setting for every game
export const PICK_KEY = 'woodshed.pick';            // weak | random: degrees' questions, lanes' keys
export const LATENCY_KEY = 'woodshed.inputLatency'; // ms, measured in ⚙ (latency.js); absent = 0

export const GAMES = ['degrees', 'scales', 'cells', 'arpeggios', 'guides'];

// The live values. Pitch spaces: see music.js. `calib` is the MIDI pitch
// class the horn sends for a fingered written C (converts both ways between
// written and concert); `calibOffset` adds the octave (from middle C), which
// the lane games need.
export const st = {
  game: GAMES.includes(load(GAME_KEY)) ? load(GAME_KEY) : 'degrees',
  mode: load(MODE_KEY) === 'learn' ? 'learn' : 'practice',
  pick: load(PICK_KEY) === 'random' ? 'random' : 'weak',
  calib: load(CALIB_KEY) === null ? null : Number(load(CALIB_KEY)),
  calibOffset: load(OFFSET_KEY) === null ? null : Number(load(OFFSET_KEY)),
  latency: Number(load(LATENCY_KEY)) || 0,
};

// Filled in by main.js at startup.
export const hooks = {
  showSettings: () => {},        // redraw every panel from the settings
  showTab: () => {},             // (tab) → switch the control panel
  runSync: () => {},             // push/pull now (A9)
  showRunning: () => {},         // (running) → lock the panel while a game runs, or unlock it
};
