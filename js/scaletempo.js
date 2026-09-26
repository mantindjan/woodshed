// Auto tempo for scales (E4): a per-key staircase that finds the fastest
// tempo you can play cleanly, and the marks that come from it.
//
// The rule (boss, 2026-09-25/26 — "build skill slow, raise it gradually"):
// after each run on Auto tempo (practice or learn),
//   clean            → streak + 1; at CLEAN_RUNS in a row, one rung UP
//   80 %+ not clean  → stay; the streak starts over
//   under 80 %, or stopped for misses → one rung DOWN; the streak starts over
// Clean = every note in practice; at most one slip in learn, where 2 clean
// in a row step up (3 in practice) — learn is for moving on, practice for
// proving it (boss: "3 tries is really long"). A 3-up/1-down staircase
// settles where about 80 % of runs are clean (Levitt 1971; the "85 % rule",
// Wilson et al. 2019); 2-up/1-down near 70 %.
//
// RUNGS, not percentages (boss, 2026-09-26): tempos move along his tempo
// scale 60 · 72 · 84 · 96 · 112 · 126, then 130 · 135 · 140 … in 5s ("it
// becomes harder and harder" — the rungs close up). Everything the
// staircase sets is a rung; the player's own Fixed tempo can be anything.
//
// Also:
//  - PLACEMENT: a key with no history goes up a rung after EVERY clean run
//    until its first run that isn't clean (a plain staircase crawls from 60
//    on scales he already owns; after PEST, Taylor & Creelman 1967).
//  - Warm-up: a key's first run in a session starts one rung below where
//    it left off (you regress a little cold, then climb back).
//  - A key never played starts from what the level has proven: one rung
//    below the median working tempo of its played keys (60 if none).
//  - The player can overrule a key's tempo (set(), the stage's rung
//    buttons); one clean run at a tempo they chose makes it the key's new
//    baseline (working tempo = it, clean best raised) — runs carry `tempoSet`.
//  - False starts (`falseStart`) are void.
//  - LEARN judges progress inside the COMFORT range (written C4–E6): the
//    extremes (low B♭ B, high F F♯) are judged and shown everywhere, but in
//    learn they don't decide clean / stay / broken — master the middle
//    first (boss, 2026-09-26, after Chad LB). Practice counts every note.
//
// Per KEY of each level (scale × pattern × written key: some keys are
// harder), whichever exercise the run came from.
//
// Marks: WORKING tempo = the mean of the last REVERSALS turning points
// (where the staircase changed direction) — it wobbles, honestly; CLEAN
// BEST = the highest tempo cleared (a step up earned from it) — it only
// rises. Pips = the tiers of TIERS the clean best has reached. A LEVEL's
// marks are the MEDIAN over its 12 keys (untried = none): one easy key
// can't carry it, one monster key can't block it.
//
// Rebuildable from events: runs carry `tempoAuto: true` and their bpm, and
// the model replays them in order (summary.js).

import { runPattern } from './scalelevels.js';

// The boss's tempo scale, eighths throughout ("a good tempo scale in general").
export const TIERS = [60, 72, 84, 96, 112, 126];
// Above the tiers, rungs every 5 bpm up to the tempo control's cap. Floor
// 60 (boss: "the minimal tempo should be 60").
const MIN = 60, MAX = 300;
export const RUNGS = [...TIERS];
for (let t = 130; t <= MAX; t += 5) RUNGS.push(t);

const cleanRuns = e => (e.mode === 'learn' ? 2 : 3);   // clean runs in a row to step up
export const CLEAN_RUNS = { learn: 2, practice: 3 };
const STAY = 0.8;          // at or above: stay; below: step down
const REVERSALS = 6;       // turning points averaged for the working tempo

// The next rung above / below a tempo (an off-ladder tempo, e.g. one the
// player set, steps to the nearest rung that way). Floor 60, cap 300.
export const rungUp = bpm => RUNGS.find(r => r > bpm) ?? MAX;
export const rungDown = bpm => [...RUNGS].reverse().find(r => r < bpm) ?? MIN;

export const tempoKey = (scale, pattern, key) => `${scale}|${pattern}|${key}`;

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

// The written range learn's tempo judges on (MIDI, written).
export const COMFORT = { low: 60, high: 88 };   // C4 … E6
export const inComfort = w => w >= COMFORT.low && w <= COMFORT.high;

// 'clean' | 'stay' | 'broken' for a run event. Notes never reached in a
// stopped run count as not hit. In learn only comfort-range notes count
// (a run entirely outside it falls back to all its notes).
export function runOutcome(e) {
  if (e.stopped) return 'broken';
  let notes = e.expected;
  if (e.mode === 'learn' && notes.some(x => inComfort(x[0]))) notes = notes.filter(x => inComfort(x[0]));
  const hits = notes.filter(x => x[3] === 'hit').length;
  if (hits / notes.length < STAY) return 'broken';
  const slips = notes.length - hits;
  return slips === 0 || (e.mode === 'learn' && slips <= 1) ? 'clean' : 'stay';
}

const clamp = v => Math.max(MIN, Math.min(MAX, v));

// The level part of a tempo key ("major|up|6" → "major|up").
const levelOf = key => key.slice(0, key.lastIndexOf('|'));

// Staircase state per key: {next, streak, dir, reversals: [bpm…], best,
// round, placing (still in placement), manual (the player set `next`)}.
// `initial` = saved [[key, state], …] from the cached summary. Feed events
// oldest first.
export function createTempoModel(initial = []) {
  const stats = new Map(initial.map(([k, v]) => [k, { ...v, reversals: [...v.reversals] }]));
  const model = {
    stats,
    add(e) {
      if (e.game !== 'scales' || !e.tempoAuto || !e.expected || e.falseStart) return;
      const k = tempoKey(e.scale, runPattern(e), e.keyWritten);
      const st = stats.get(k) || { next: e.bpm, streak: 0, dir: 0, reversals: [], best: 0, round: null, placing: true };
      if (st.round !== e.round) { st.round = e.round; st.streak = 0; }   // a new session
      const move = dir => {
        if (st.dir && dir !== st.dir) {
          st.reversals.push(e.bpm);
          if (st.reversals.length > REVERSALS) st.reversals.shift();
        }
        st.dir = dir;
        st.next = dir > 0 ? rungUp(e.bpm) : rungDown(e.bpm);
      };
      const out = runOutcome(e);
      st.manual = false;
      // A tempo the player chose, played clean: the key's new baseline.
      if (e.tempoSet && out === 'clean') {
        st.reversals = [e.bpm];
        st.dir = 0;
        st.best = Math.max(st.best, e.bpm);
      }
      if (out === 'clean' && st.placing) {
        // Placement: every clean run is cleared ground and a rung up.
        st.best = Math.max(st.best, e.bpm);
        move(1);
      } else if (out === 'clean' && ++st.streak >= cleanRuns(e)) {
        st.best = Math.max(st.best, e.bpm);
        st.streak = 0;
        move(1);
      } else if (out === 'clean') {
        st.next = e.bpm;
      } else {
        st.placing = false;
        st.streak = 0;
        if (out === 'broken') move(-1); else st.next = e.bpm;
      }
      stats.set(k, st);
    },
    // The key's working tempo, or null if never played on Auto. Before the
    // first turning point, the tempo it's at.
    working(key) {
      const st = stats.get(key);
      if (!st) return null;
      return st.reversals.length
        ? Math.round(st.reversals.reduce((a, b) => a + b, 0) / st.reversals.length) : st.next;
    },
    // Where a new session starts: the rung below the key's working tempo,
    // or for a key never played, below the median of the level's played keys.
    start(key) {
      let w = model.working(key);
      if (w === null) {
        const lvl = levelOf(key);
        const ws = [...stats.keys()].filter(k => levelOf(k) === lvl).map(k => model.working(k));
        w = ws.length ? median(ws) : null;
      }
      return w === null ? MIN : rungDown(w);
    },
    // The player overrules: this key plays at `bpm` next, in session `round`.
    set(key, bpm, round) {
      const st = stats.get(key) || { streak: 0, dir: 0, reversals: [], best: 0, placing: true };
      Object.assign(st, { next: clamp(bpm), round, streak: 0, manual: true });
      stats.set(key, st);
    },
    // Within a session: the tempo for the next run.
    next(key) { return stats.get(key)?.next ?? MIN; },
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
    manual(key) { return !!stats.get(key)?.manual; },
  };
  return model;
}

// How many tiers a clean best has reached (0–6).
export const pips = best => TIERS.filter(t => best >= t).length;
export const pipText = best => '●'.repeat(pips(best)) + '○'.repeat(TIERS.length - pips(best));
