// Auto tempo for scales (E4): a per-level staircase that finds the fastest
// tempo you can play cleanly, and the marks that come from it.
//
// The rule (boss, 2026-09-25 — "build skill slow, raise it gradually"):
// after each PRACTICE run on Auto tempo,
//   clean (every note hit)            → streak + 1; at 3 in a row, +5 %
//   80–99 % hit                       → stay; the streak starts over
//   under 80 %, or stopped for misses → −5 %; the streak starts over
// A 3-up/1-down staircase settles where about 80 % of runs are clean —
// hard enough to grow, easy enough to stay clean (Levitt 1971; the
// "85 % rule" for learning, Wilson et al. 2019).
//
// Per level = scale × pattern (as the stats), whichever exercise the run
// came from. Each Start→Stop session begins WARMUP below the working tempo:
// you regress a little cold, then climb back in a few runs.
//
// Marks: WORKING tempo = the mean of the last REVERSALS turning points
// (where the staircase changed direction) — it wobbles, honestly; CLEAN
// BEST = the highest tempo cleared 3 in a row — it only rises. Pips = the
// tiers of TIERS the clean best has reached (they replace hit-rate stars).
//
// Rebuildable from events: runs carry `tempoAuto: true` and their bpm, and
// the model replays them in order (summary.js).

import { runScore, runPattern } from './scalelevels.js';

// The boss's tempo scale, eighths throughout ("a good tempo scale in general").
export const TIERS = [60, 72, 84, 96, 112, 126];
const START = 60;          // a level never played on Auto starts at the bottom tier
const STEP = 0.05;         // ± 5 % (boss)
const CLEAN_RUNS = 3;      // clean runs in a row to step up
const STAY = 0.8;          // at or above: stay; below: step down
const WARMUP = 0.9;        // a session starts 10 % under the working tempo
const REVERSALS = 6;       // turning points averaged for the working tempo
// Floor 60 = the bottom of the tempo scale: auto never goes slower (boss,
// 2026-09-25). No real ceiling; 300 is the tempo control's own cap.
const MIN = 60, MAX = 300;

export const tempoKey = (scale, pattern) => `${scale}|${pattern}`;

// 'clean' | 'stay' | 'broken' for a run event.
export function runOutcome(e) {
  const score = runScore(e);
  if (e.stopped || score < STAY) return 'broken';
  return score === 1 ? 'clean' : 'stay';
}

const clamp = v => Math.max(MIN, Math.min(MAX, v));

// A move by one step. Always at least 1 bpm, so a slow tempo can't round
// back onto itself.
function stepped(bpm, dir) {
  const v = Math.round(bpm * (1 + dir * STEP));
  return clamp(v === bpm ? bpm + dir : v);
}

// Staircase state per level: {next, streak, dir, reversals: [bpm…], best,
// round}. `initial` = saved [[key, state], …] from the cached summary. Feed
// events oldest first.
export function createTempoModel(initial = []) {
  const stats = new Map(initial.map(([k, v]) => [k, { ...v, reversals: [...v.reversals] }]));
  const model = {
    stats,
    add(e) {
      if (e.game !== 'scales' || e.mode !== 'practice' || !e.tempoAuto || !e.expected) return;
      const k = tempoKey(e.scale, runPattern(e));
      const st = stats.get(k) || { next: e.bpm, streak: 0, dir: 0, reversals: [], best: 0, round: null };
      if (st.round !== e.round) { st.round = e.round; st.streak = 0; }   // a new session
      const move = dir => {
        if (st.dir && dir !== st.dir) {
          st.reversals.push(e.bpm);
          if (st.reversals.length > REVERSALS) st.reversals.shift();
        }
        st.dir = dir;
        st.next = stepped(e.bpm, dir);
      };
      const out = runOutcome(e);
      if (out === 'clean' && ++st.streak >= CLEAN_RUNS) {
        st.best = Math.max(st.best, e.bpm);
        st.streak = 0;
        move(1);
      } else if (out === 'clean') {
        st.next = e.bpm;
      } else {
        st.streak = 0;
        if (out === 'broken') move(-1); else st.next = e.bpm;
      }
      stats.set(k, st);
    },
    // The level's working tempo, or null if never played on Auto. Before
    // the first turning point, the tempo it's at.
    working(key) {
      const st = stats.get(key);
      if (!st) return null;
      return st.reversals.length
        ? Math.round(st.reversals.reduce((a, b) => a + b, 0) / st.reversals.length) : st.next;
    },
    // Where a new session starts.
    start(key) {
      const w = model.working(key);
      return w === null ? START : clamp(Math.round(w * WARMUP));
    },
    // Within a session: the tempo for the next run.
    next(key) { return stats.get(key)?.next ?? START; },
    best(key) { return stats.get(key)?.best || 0; },
    streak(key) { return stats.get(key)?.streak || 0; },
  };
  return model;
}

// How many tiers a clean best has reached (0–6).
export const pips = best => TIERS.filter(t => best >= t).length;
export const pipText = best => '●'.repeat(pips(best)) + '○'.repeat(TIERS.length - pips(best));
