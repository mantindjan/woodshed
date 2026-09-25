// Scale levels (E1 step 2): the ladder, custom picks, the weak-key model
// and stars — the scale game's own versions of levels.js / weakspots.js.
// Kept separate on purpose (CLAUDE.md: shared logic is extracted when a
// second game needs it, not before): a scale run is judged per note across
// a range, not as one answer, so almost none of the degree formulas apply.
//
// An exercise is a scale plus a set of written keys; the direction, tempo
// and miss limit are Play settings, not part of the level. The ladder goes
// key area by key area (home keys, flats, sharps, far keys, then all 12),
// once per scale. Nothing is locked.

import { SCALES, NOTES } from './music.js';

// Key areas in the order the boss meets them on a tenor chart: the written
// keys with no or one accidental first, then the flat side, the sharp side,
// then the remote ones. Written pitch classes.
const AREAS = [
  { key: 'home', name: 'Home keys', keys: [0, 5, 7] },        // C F G
  { key: 'flats', name: 'Flat keys', keys: [10, 3, 8] },      // B♭ E♭ A♭
  { key: 'sharps', name: 'Sharp keys', keys: [2, 9, 4] },     // D A E
  { key: 'far', name: 'Far keys', keys: [1, 6, 11] },         // C♯ F♯ B
  { key: 'all', name: 'All keys', keys: [...Array(12).keys()] },
];
export const SCALE_ORDER = ['major', 'penta'];

const keysLabel = keys => keys.length === 12 ? 'all 12 keys' : keys.map(k => NOTES[k]).join(' ');

// Ids are stable (stored in events and settings); the "S1…" numbers are
// display only and follow ladder order.
export const SCALE_LEVELS = SCALE_ORDER.flatMap(scale => AREAS.map(a => ({
  id: `${scale}-${a.key}`, scale, area: a.key, title: SCALES[scale].name,
  name: a.name, keys: a.keys, keysLabel: keysLabel(a.keys),
}))).map((l, i) => ({ ...l, num: `S${i + 1}` }));

// Identity of a pick, for snapping a custom pick back onto a level.
const pickKey = (scale, keys) => `${scale}:${[...keys].sort((a, b) => a - b).join(',')}`;
export function matchScaleLevel(scale, keys) {
  const k = pickKey(scale, keys);
  return SCALE_LEVELS.find(l => pickKey(l.scale, l.keys) === k) || null;
}

// Resolve an exercise id (a level id, or 'custom') to
// {id, num, title, name, keys, keysLabel, scale}. Unknown ids (an older
// ladder) fall back to the first level.
export function scaleExercise(id, custom) {
  if (id === 'custom') {
    return { id, num: '', title: SCALES[custom.scale].name, name: 'Custom', scale: custom.scale,
             keys: custom.keys, keysLabel: custom.keys.length ? keysLabel(custom.keys) : 'no key chosen' };
  }
  return SCALE_LEVELS.find(l => l.id === id) || SCALE_LEVELS[0];
}

// --- Weak keys (the D3 idea, per scale × direction × key) ---
// One run scores 0–1: the share of its notes that were hit. A run that was
// stopped early counts its unplayed notes as not hit, so restarts weigh in
// naturally. `recent` is an exponential moving average per key, α = 0.3:
// runs are far fewer than degree answers, so each one moves the needle
// more. Tickets follow weakspots.js: never zero, so clean keys still come
// round; +0.8 for a key with under 3 runs; untried = 2.2.
const ALPHA = 0.3;
const FEW_RUNS = 3;
const UNTRIED = 2.2;

export function runScore(e) {
  if (!e.expected || !e.expected.length) return null;
  return e.expected.filter(x => x[3] === 'hit').length / e.expected.length;
}

const statKey = (scale, direction, key) => `${scale}|${direction}|${key}`;

// Running stats per scale × direction × key. Feed events oldest first.
// `initial` = saved stats ([[key, {n, recent}], …]) from the cached summary.
export function createKeyModel(initial = []) {
  const stats = new Map(initial.map(([k, v]) => [k, { ...v }]));
  return {
    stats,
    add(e) {
      if (e.game !== 'scales') return;
      const score = runScore(e);
      if (score === null) return;
      const k = statKey(e.scale, e.direction, e.keyWritten);
      const st = stats.get(k);
      if (!st) stats.set(k, { n: 1, recent: score });
      else { st.n++; st.recent += ALPHA * (score - st.recent); }
    },
    tickets(scale, direction, key) {
      const st = stats.get(statKey(scale, direction, key));
      if (!st) return UNTRIED;
      return 0.6 + 4 * (1 - st.recent) + (st.n < FEW_RUNS ? 0.8 : 0);
    },
  };
}

// Draw the next key from `keys`: by tickets when `pick` is 'weak', evenly
// otherwise; never the same key twice in a row when there's a choice.
export function pickScaleKey(model, { scale, direction, keys, pick, prev }, rand = Math.random) {
  const pool = keys.length > 1 ? keys.filter(k => k !== prev) : keys;
  const weights = pool.map(k => (pick === 'weak' ? model.tickets(scale, direction, k) : 1));
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// --- Stars ---
// Per exercise, from its best practice session of ≥ MIN_RUNS runs: the
// share of all expected notes hit across the session. ★ ≥ 70 % · ★★ ≥ 85 %
// · ★★★ ≥ 95 % with no run stopped for misses. Opening bids (2026-09-25).
export const MIN_RUNS = 5;
export function sessionStars(runs, hits, total, stopped) {
  if (runs < MIN_RUNS || !total) return 0;
  const rate = hits / total;
  return rate >= 0.95 && !stopped ? 3 : rate >= 0.85 ? 2 : rate >= 0.7 ? 1 : 0;
}

// Stars per scale exercise id from events (the summary rebuild).
export function scaleStarsByExercise(events) {
  const sessions = new Map();   // round → {exercise, runs, hits, total, stopped}
  for (const e of events) {
    if (e.game !== 'scales' || e.mode !== 'practice' || !e.exercise || !e.expected) continue;
    const s = sessions.get(e.round) || { exercise: e.exercise, runs: 0, hits: 0, total: 0, stopped: 0 };
    s.runs++;
    s.hits += e.expected.filter(x => x[3] === 'hit').length;
    s.total += e.expected.length;
    if (e.stopped) s.stopped++;
    sessions.set(e.round, s);
  }
  const best = new Map();
  for (const s of sessions.values()) {
    best.set(s.exercise, Math.max(best.get(s.exercise) || 0, sessionStars(s.runs, s.hits, s.total, s.stopped)));
  }
  return best;
}
