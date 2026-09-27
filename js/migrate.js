// Renames of stored data, so old data reads as today's (docs/data.md,
// "Renames"):
//
// 2026-09-27 — the Pattern game became Cells, everywhere: events
// `game: 'patterns'` → 'cells', `patternId` → `cellId`, `pattern` → `cell`
// (the snapshot of the cell); settings `woodshed.pattern*` → `woodshed.cell*`,
// the library `woodshed.patterns` → `woodshed.cells`; sync files
// `patterns/<day>.json` → `cells/<day>.json`, `patterns.json` → `cells.json`.
//
// 2026-09-27 — the six one-way scale patterns became three there-and-back
// ones (scalelevels.js OLD_PATTERNS): the chosen level
// (`woodshed.scaleExercise`, 'major-3up-asc' → 'major-3up') and a custom
// pick's pattern (`woodshed.scaleCustom`). Scale runs are NOT renamed —
// an 'up' run was played up only; runPattern() counts it for 'linear'.
//
// migrateLocal() rewrites this device once, at startup. upgradeEvent /
// settingKey / upgradePath also run on everything that comes in — sync
// files, backup files — so an old backup or a file written by a phone still
// on the old app lands under the new names. All of them leave current data
// untouched, so running them twice changes nothing.

import { allEvents, putEvents } from './events.js';
import { OLD_PATTERNS } from './scalelevels.js';

const KEYS = {
  'woodshed.patterns': 'woodshed.cells',
  'woodshed.patternSel': 'woodshed.cellSel',
  'woodshed.patternEx': 'woodshed.cellEx',
  'woodshed.patternBpm': 'woodshed.cellBpm',
  'woodshed.patternBacking': 'woodshed.cellBacking',
};
const FIELDS = { patternId: 'cellId', pattern: 'cell' };

// A settings key and its value under today's names.
export const settingKey = k => KEYS[k] || k;
export function settingValue(k, v) {
  const key = settingKey(k);
  if (key === 'woodshed.game') return v === 'patterns' ? 'cells' : v;
  if (key === 'woodshed.scaleExercise') {
    const m = /^(\w+)-(.+)$/.exec(v || '');
    return m && OLD_PATTERNS[m[2]] ? `${m[1]}-${OLD_PATTERNS[m[2]]}` : v;
  }
  if (key === 'woodshed.scaleCustom') {
    try {
      const c = JSON.parse(v);
      return c && OLD_PATTERNS[c.pattern] ? JSON.stringify({ ...c, pattern: OLD_PATTERNS[c.pattern] }) : v;
    } catch { return v; }
  }
  return v;
}
// A sync path under today's names.
export const upgradePath = p => p.replace(/^patterns\//, 'cells/');

// An event under today's names, fields kept in their order (the synced
// files stay readable). Anything else passes through as it is.
export function upgradeEvent(e) {
  if (e.game !== 'patterns') return e;
  return Object.fromEntries(Object.entries(e).map(([k, v]) =>
    (k === 'game' ? [k, 'cells'] : [FIELDS[k] || k, v])));
}

// This device, once per rename: settings, the library, the sync
// bookkeeping (old paths dropped, the library pushed again under its new
// name), then the event log. Returns how many events were rewritten.
export async function migrateLocal() {
  try {
    let moved = false;                 // anything under the old names on this device
    for (const [from, to] of Object.entries(KEYS)) {
      const v = localStorage.getItem(from);
      if (v === null) continue;
      if (localStorage.getItem(to) === null) localStorage.setItem(to, v);
      localStorage.removeItem(from);
      moved = true;
    }
    for (const k of ['woodshed.game', 'woodshed.scaleExercise', 'woodshed.scaleCustom']) {
      const v = localStorage.getItem(k);
      if (v !== null && settingValue(k, v) !== v) localStorage.setItem(k, settingValue(k, v));
    }
    const st = JSON.parse(localStorage.getItem('woodshed.syncState') || 'null');
    const stale = Object.keys(st?.files || {}).filter(p => p !== upgradePath(p));
    if (st && (stale.length || moved)) {
      for (const p of stale) delete st.files[p];
      if (moved) delete st.library;    // push the library once, as cells.json
      localStorage.setItem('woodshed.syncState', JSON.stringify(st));
    }
  } catch { /* storage unavailable: nothing to migrate */ }
  const old = (await allEvents()).filter(e => e.game === 'patterns');
  if (old.length) await putEvents(old.map(upgradeEvent));
  return old.length;
}
