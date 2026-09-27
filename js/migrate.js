// Renames of stored data, so old data reads as today's (docs/data.md,
// "Renames"). One so far:
//
// 2026-09-27 — the Pattern game became Cells, everywhere: events
// `game: 'patterns'` → 'cells', `patternId` → `cellId`, `pattern` → `cell`
// (the snapshot of the cell); settings `woodshed.pattern*` → `woodshed.cell*`,
// the library `woodshed.patterns` → `woodshed.cells`; sync files
// `patterns/<day>.json` → `cells/<day>.json`, `patterns.json` → `cells.json`.
//
// migrateLocal() rewrites this device once, at startup. upgradeEvent /
// settingKey / upgradePath also run on everything that comes in — sync
// files, backup files — so an old backup or a file written by a phone still
// on the old app lands under the new names. All of them leave current data
// untouched, so running them twice changes nothing.

import { allEvents, putEvents } from './events.js';

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
export const settingValue = (k, v) => (settingKey(k) === 'woodshed.game' && v === 'patterns' ? 'cells' : v);
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
    if (localStorage.getItem('woodshed.game') === 'patterns') localStorage.setItem('woodshed.game', 'cells');
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
