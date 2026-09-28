// Renames of stored data, so old data reads as today's (docs/data.md,
// "Renames"):
//
// 2026-09-27 — the Pattern game became Cells, everywhere: events
// `game: 'patterns'` → 'cells', `patternId` → `cellId`, `pattern` → `cell`
// (the snapshot of the cell); settings `woodshed.pattern*` → `woodshed.cell*`,
// the library `woodshed.patterns` → `woodshed.cells`; sync files
// `patterns/<day>.json` → `cells/<day>.json`, `patterns.json` → `cells.json`.
//
// 2026-09-28 — guide tones' first cut (a cadence + a target pattern, a
// day old) became exercises in a library: `woodshed.guideCustom` (your
// cadence), if you had changed it from the default, becomes a library
// exercise "My cadence"; `woodshed.guideCadence` becomes the selection
// `woodshed.guideSel` ('ii-V-I' → 'p:ii-V-I'); `woodshed.guidePattern`
// goes (patterns are fills in the editor now). No rounds had been synced.
//
// 2026-09-27 — clicks are scheduled to be heard on time (audio.js
// audioTimeAt): a latency measured before (`woodshed.latency`) included the
// phone's output delay and would now judge every note early — dropped, not
// renamed; measured again it's `woodshed.inputLatency`.
//
// 2026-09-27 — the six one-way scale patterns became three corner-to-corner
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

const OLD_GUIDE_KEYS = ['woodshed.guideCustom', 'woodshed.guideCadence', 'woodshed.guidePattern'];
const DEFAULT_CUSTOM = JSON.stringify({ chords: [{ deg: 2, q: 'm7', bars: 1 }, { deg: 7, q: '7', bars: 1 }, { deg: 0, q: 'maj7', bars: 2 }],
                                        targets: [0, 1, 2].map(() => ({ deg: '3', place: 'one' })) });
function migrateGuides() {
  if (!OLD_GUIDE_KEYS.some(k => localStorage.getItem(k) !== null)) return;
  const cad = localStorage.getItem('woodshed.guideCadence');
  let sel = cad && cad !== 'custom' ? `p:${cad}` : null;
  try {
    const raw = localStorage.getItem('woodshed.guideCustom');
    const c = JSON.parse(raw);
    if (c?.chords?.length && raw !== DEFAULT_CUSTOM) {
      const at = { one: 0, three: 2, late: 'late' };
      const lib = JSON.parse(localStorage.getItem('woodshed.guideLib') || '[]');
      const mine = { id: `g${Date.now().toString(36)}`, name: 'My cadence', chords: c.chords, created: Date.now(),
                     targets: c.chords.flatMap((_, i) => (c.targets?.[i]?.deg ? [{ chord: i, at: at[c.targets[i].place] ?? 0, degs: [c.targets[i].deg] }] : [])) };
      lib.push(mine);
      localStorage.setItem('woodshed.guideLib', JSON.stringify(lib));
      if (cad === 'custom') sel = mine.id;
    }
  } catch { /* nothing usable */ }
  if (sel && localStorage.getItem('woodshed.guideSel') === null) localStorage.setItem('woodshed.guideSel', sel);
  for (const k of OLD_GUIDE_KEYS) localStorage.removeItem(k);
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
    localStorage.removeItem('woodshed.latency');   // measured with the old click timing
    migrateGuides();
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
