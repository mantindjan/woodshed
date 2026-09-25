// Cached summary (A8): everything the app needs day to day that would
// otherwise mean reading the whole event history — the weak-spot model
// (per-cell / per-root n and recent score) and the best stars per exercise.
// Kept in localStorage, updated after every answer / round, so a round,
// the Levels tab and the picker start instantly however long the history.
//
// It's a cache: rebuilt from the raw events whenever it's missing, its
// version is out of date (a formula changed), or events arrived from
// elsewhere (backup load, sync). Stars are kept as the max of the rebuild
// and what was cached, so stars earned on days the phone has since pruned
// (older than the 90-day window) aren't lost.

import { allEvents } from './events.js';
import { createModel } from './weakspots.js';
import { starsByExercise } from './levels.js';

const KEY = 'woodshed.summary';
// Bump when weakspots.js scoring or levels.js star rules change.
const VERSION = 1;

function read() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s && s.v === VERSION ? s : null;
  } catch { return null; }
}

function write(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full/blocked */ }
}

// {weak: [[key, {n, recent}], …], stars: {exerciseId: 0–3}}, rebuilding it
// from events first if needed.
export async function getSummary() {
  return read() || rebuildSummary();
}

export async function rebuildSummary() {
  const events = await allEvents();
  const model = createModel();
  events.forEach(e => model.add(e));
  const old = (() => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  })();
  const stars = {};
  for (const [id, n] of starsByExercise(events)) stars[id] = n;
  for (const [id, n] of Object.entries(old.stars || {})) stars[id] = Math.max(stars[id] || 0, n);
  const s = { v: VERSION, weak: [...model.stats], stars };
  write(s);
  return s;
}

// After every answer: persist the round's live model.
export function saveWeak(model) {
  const s = read();
  if (s) write({ ...s, weak: [...model.stats] });
}

// After a practice round: keep the best stars per exercise.
export function saveStars(exerciseId, stars) {
  const s = read();
  if (s && stars > (s.stars[exerciseId] || 0)) write({ ...s, stars: { ...s.stars, [exerciseId]: stars } });
}

// Events arrived from elsewhere (backup, sync): the cache no longer covers
// them. The next getSummary() rebuilds.
export function invalidateSummary() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    // Keep stars (they survive pruning); force a rebuild via the version.
    if (s) localStorage.setItem(KEY, JSON.stringify({ ...s, v: 0 }));
  } catch { /* ignore */ }
}
