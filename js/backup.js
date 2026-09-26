// Backup file (A7): download every raw event plus settings as JSON, and load
// such a file back. The player stores the file wherever they like (Drive).
//
// Loading MERGES, never replaces: an event already on this device is
// recognised by its wall-clock time + round id and skipped, so loading the
// same file twice, or an older backup, can't duplicate or wipe anything.
// Settings from the file replace local ones, then the page reloads to apply
// them. A file that isn't a Woodshed backup changes nothing.

import { addEvents, allEvents } from './events.js';
import { invalidateSummary } from './summary.js';

export const FORMAT = 1;
// localStorage keys carried in the backup (see main.js).
// The sync repo address travels (harmless alone); the sync TOKEN never does
// — backup files sit in Downloads/Drive.
const SETTINGS = ['woodshed.calib', 'woodshed.mode', 'woodshed.pick', 'woodshed.length',
                  'woodshed.exercise', 'woodshed.custom',
                  'woodshed.calibOffset', 'woodshed.game', 'woodshed.tempoAuto', 'woodshed.latency', 'woodshed.patternSel', 'woodshed.patternEx', 'woodshed.patternBpm', 'woodshed.patterns', 'woodshed.scaleExercise',
                  'woodshed.scaleCustom', 'woodshed.bpm', 'woodshed.misses', 'woodshed.syncRepo'];

// Identity of an event across devices: one question = one appearance time
// within one round. IndexedDB's own ids differ per device, so aren't used.
const eventKey = e => `${e.t}|${e.round}`;

function readSettings() {
  const out = {};
  for (const k of SETTINGS) {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = v;
    } catch { /* storage unavailable */ }
  }
  return out;
}

export async function buildBackup() {
  const events = (await allEvents()).map(({ id, ...rest }) => rest);   // drop local ids
  return { app: 'woodshed', format: FORMAT, exported: new Date().toISOString(),
           settings: readSettings(), events };
}

// Trigger a download of the backup. Returns the number of events saved.
export async function downloadBackup() {
  const backup = await buildBackup();
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `woodshed-backup-${backup.exported.slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return backup.events.length;
}

// Merge a backup file's text into this device.
// Returns {added, skipped}; throws Error with a readable message if invalid.
export async function loadBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Not a Woodshed backup (not JSON).'); }
  if (!data || data.app !== 'woodshed' || !Array.isArray(data.events)) {
    throw new Error('Not a Woodshed backup.');
  }
  if (data.format > FORMAT) throw new Error('Backup is from a newer version of the app.');

  const have = new Set((await allEvents()).map(eventKey));
  const fresh = [];
  for (const { id, ...e } of data.events) {
    const key = eventKey(e);
    if (!have.has(key)) { fresh.push(e); have.add(key); }
  }
  if (fresh.length) {
    await addEvents(fresh);
    invalidateSummary();   // the cache doesn't cover them yet
  }

  for (const [k, v] of Object.entries(data.settings || {})) {
    if (SETTINGS.includes(k)) {
      try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
    }
  }
  return { added: fresh.length, skipped: data.events.length - fresh.length };
}

export async function countEvents() {
  return (await allEvents()).length;
}
