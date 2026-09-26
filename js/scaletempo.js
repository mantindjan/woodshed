// Auto tempo for scales (E4): a per-level staircase that finds the fastest
// tempo you can play cleanly, and the marks that come from it.
//
// The rule (boss, 2026-09-25 — "build skill slow, raise it gradually"):
// after each run on Auto tempo (practice or learn),
//   clean (every note hit)            → streak + 1; at 3 in a row, +5 %
//   80–99 % hit                       → stay; the streak starts over
//   under 80 %, or stopped for misses → −5 %; the streak starts over
// A 3-up/1-down staircase settles where about 80 % of runs are clean —
// hard enough to grow, easy enough to stay clean (Levitt 1971; the
// "85 % rule" for learning, Wilson et al. 2019).
//
// A plain staircase crawls when it starts far from the player's real
// speed (boss, 2026-09-26: 60 is dumb-slow for scales he owns), and skill
// jumps as well as creeps (practice-curve plateaus and leaps; overnight
// gains, Walker et al. 2002). So (after PEST, Taylor & Creelman 1967):
//  - PLACEMENT: a key with no history steps +10 % after EVERY clean run
//    until its first run that isn't clean; then the 3-up/1-down rule.
//  - GROWING STEPS: consecutive steps up get bigger (+5 %, +8 %, +12 %);
//    any run that isn't clean resets them to +5 %.
//  - A key never played starts from what the level has proven: the median
//    working tempo of its played keys, −10 % (60 if none).
//  - The player can overrule a key's tempo (set(), the stage nudges).
//
// Per KEY of each level (scale × pattern × written key; boss 2026-09-26:
// "some keys are harder", one tempo per level made no sense), whichever
// exercise the run came from. A key's first run in a Start→Stop session
// begins WARMUP below its working tempo: you regress a little cold, then
// climb back in a few runs.
//
// Marks: WORKING tempo = the mean of the last REVERSALS turning points
// (where the staircase changed direction) — it wobbles, honestly; CLEAN
// BEST = the highest tempo cleared 3 in a row — it only rises. Pips = the
// tiers of TIERS the clean best has reached (they replace hit-rate stars).
// A LEVEL's marks are the MEDIAN over its 12 keys (untried = none): one
// easy key can't carry it, one monster key can't block it.
//
// Rebuildable from events: runs carry `tempoAuto: true` and their bpm, and
// the model replays them in order (summary.js).

import { runScore, runPattern } from './scalelevels.js';

// The boss's tempo scale, eighths throughout ("a good tempo scale in general").
export const TIERS = [60, 72, 84, 96, 112, 126];
const START = 60;          // a level never played on Auto starts at the bottom tier
const STEP = 0.05;         // ± 5 % (boss): down always, up to start with
const UP_STEPS = [0.05, 0.08, 0.12];   // consecutive steps up grow
const PLACEMENT_STEP = 0.10;           // up after every clean run, until the first that isn't
const CLEAN_RUNS = 3;      // clean runs in a row to step up
const STAY = 0.8;          // at or above: stay; below: step down
const WARMUP = 0.9;        // a session starts 10 % under the working tempo
const REVERSALS = 6;       // turning points averaged for the working tempo
// Floor 60 = the bottom of the tempo scale: auto never goes slower (boss,
// 2026-09-25). No real ceiling; 300 is the tempo control's own cap.
const MIN = 60, MAX = 300;

export const tempoKey = (scale, pattern, key) => `${scale}|${pattern}|${key}`;

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

// 'clean' | 'stay' | 'broken' for a run event.
export function runOutcome(e) {
  const score = runScore(e);
  if (e.stopped || score < STAY) return 'broken';
  return score === 1 ? 'clean' : 'stay';
}

const clamp = v => Math.max(MIN, Math.min(MAX, v));

// A move by `frac` up (dir 1) or down (−1). Always at least 1 bpm, so a
// slow tempo can't round back onto itself.
function stepped(bpm, dir, frac) {
  const v = Math.round(bpm * (1 + dir * frac));
  return clamp(v === bpm ? bpm + dir : v);
}

// The level part of a tempo key ("major|up|6" → "major|up").
const levelOf = key => key.slice(0, key.lastIndexOf('|'));

// Staircase state per key: {next, streak, dir, reversals: [bpm…], best,
// round, placing (still in placement), ups (steps up in a row)}. `initial` = saved [[key, state], …] from the cached summary. Feed
// events oldest first.
export function createTempoModel(initial = []) {
  const stats = new Map(initial.map(([k, v]) => [k, { ...v, reversals: [...v.reversals] }]));
  const model = {
    stats,
    add(e) {
      if (e.game !== 'scales' || !e.tempoAuto || !e.expected) return;
      const k = tempoKey(e.scale, runPattern(e), e.keyWritten);
      const st = stats.get(k) || { next: e.bpm, streak: 0, dir: 0, reversals: [], best: 0, round: null,
                                   placing: true, ups: 0 };
      if (st.round !== e.round) { st.round = e.round; st.streak = 0; }   // a new session
      const move = (dir, frac) => {
        if (st.dir && dir !== st.dir) {
          st.reversals.push(e.bpm);
          if (st.reversals.length > REVERSALS) st.reversals.shift();
        }
        st.dir = dir;
        st.next = stepped(e.bpm, dir, frac);
      };
      const out = runOutcome(e);
      if (out === 'clean' && st.placing) {
        // Placement: every clean run is cleared ground and a step up.
        st.best = Math.max(st.best, e.bpm);
        move(1, PLACEMENT_STEP);
      } else if (out === 'clean' && ++st.streak >= CLEAN_RUNS) {
        st.best = Math.max(st.best, e.bpm);
        st.streak = 0;
        move(1, UP_STEPS[Math.min(st.ups, UP_STEPS.length - 1)]);
        st.ups++;
      } else if (out === 'clean') {
        st.next = e.bpm;
      } else {
        st.placing = false;
        st.streak = 0;
        st.ups = 0;
        if (out === 'broken') move(-1, STEP); else st.next = e.bpm;
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
    // Where a new session starts: 10 % under the key's working tempo, or
    // for a key never played, under the median of the level's played keys.
    start(key) {
      let w = model.working(key);
      if (w === null) {
        const lvl = levelOf(key);
        const ws = [...stats.keys()].filter(k => levelOf(k) === lvl).map(k => model.working(k));
        w = ws.length ? median(ws) : null;
      }
      return w === null ? START : clamp(Math.round(w * WARMUP));
    },
    // The player overrules: this key plays at `bpm` next, in session `round`.
    set(key, bpm, round) {
      const st = stats.get(key) || { streak: 0, dir: 0, reversals: [], best: 0, placing: true, ups: 0 };
      Object.assign(st, { next: clamp(bpm), round, streak: 0 });
      stats.set(key, st);
    },
    // Within a session: the tempo for the next run.
    next(key) { return stats.get(key)?.next ?? START; },
    // The tempo for a run of `key` in session `round`: carries on where the
    // session left it, or warms up if it's the key's first run this session.
    tempoFor(key, round) {
      const st = stats.get(key);
      return st && st.round === round ? st.next : model.start(key);
    },
    // A level's marks: the median over its 12 keys (untried: best 0, and
    // working tempo left out).
    levelBest(scale, pattern) {
      return median([...Array(12).keys()].map(k => model.best(tempoKey(scale, pattern, k))));
    },
    levelWorking(scale, pattern) {
      const ws = [...Array(12).keys()].map(k => model.working(tempoKey(scale, pattern, k))).filter(w => w !== null);
      return ws.length ? median(ws) : null;
    },
    best(key) { return stats.get(key)?.best || 0; },
    streak(key) { return stats.get(key)?.streak || 0; },
  };
  return model;
}

// How many tiers a clean best has reached (0–6).
export const pips = best => TIERS.filter(t => best >= t).length;
export const pipText = best => '●'.repeat(pips(best)) + '○'.repeat(TIERS.length - pips(best));
