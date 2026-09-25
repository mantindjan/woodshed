// Weak-spot picker (D3): asks more of what the player is weak at right now.
//
// A cell is a chord quality × degree ("the 3 of m7"); inside each cell, each
// root is tracked too. Every FIRST attempt scores 0–1: wrong = 0, right in
// under FAST_MS (1 s) = 1, sliding down to SLOW_FLOOR at SLOW_MS (2 s,
// where the "slow" label starts) or slower — so "right but slow" counts as
// partly weak (the cells worth serving once speed matters). A cell's `recent` is an exponential moving average of those
// scores (α = 0.15: roughly the last 15 answers dominate), so old mistakes
// fade and new slips surface fast.
//
// Questions are a weighted random draw, never "always the weakest": tickets
// = 0.6 + 4 × (1 − recent), +0.8 while a cell has fewer than 6 answers; a
// never-tried cell gets 2.2. Nothing ever drops to zero, so mastered cells
// still come round. Pick a cell by tickets, then a root inside it the same
// way. Weights from docs/handover/SOLVED.md; speed tiers from the boss after
// playing, 2026-09-24: < 1 s blazing, < 1.5 good, < 2 to improve, else slow
// (his fastest real answers, seeing + hearing + fingering, are ~1.1 s).
//
// Everything is derived from the raw event log (docs/data.md), so changing
// any constant here recomputes the whole history.

import { pc } from './music.js';

export const FAST_MS = 1000;     // "blazing": full marks
export const GOOD_MS = 1500;     // "good" tier ends here
export const SLOW_MS = 2000;     // "slow" tier: from here a right answer scores SLOW_FLOOR
const SLOW_FLOOR = 0.6;
const ALPHA = 0.15;
const UNTRIED = 2.2;
const FEW_ANSWERS = 6;

// Score of one right answer by its reaction time.
export function speedScore(ms) {
  if (ms <= FAST_MS) return 1;
  if (ms >= SLOW_MS) return SLOW_FLOOR;
  return 1 - (1 - SLOW_FLOOR) * (ms - FAST_MS) / (SLOW_MS - FAST_MS);
}

// Score of a degree-drill event's first attempt, recomputed from raw fields
// (not the stored `ok`), so a rule change applies to old data too.
export function eventScore(e) {
  const first = e.notes && e.notes[0];
  if (!first) return null;
  const [midi, ms] = first;
  return pc(midi - e.calib) === e.targetsWritten[0] ? speedScore(ms) : 0;
}

export function tickets(stat) {
  if (!stat) return UNTRIED;
  return 0.6 + 4 * (1 - stat.recent) + (stat.n < FEW_ANSWERS ? 0.8 : 0);
}

const cellKey = (quality, degree) => `${quality}|${degree}`;
const rootKey = (quality, degree, root) => `${quality}|${degree}|${root}`;

// Running stats per cell and per cell+root. Feed events oldest first.
// `initial`: saved stats ([[key, {n, recent}], …]) to continue from — the
// cached summary (A8), so a round starts without reading history.
export function createModel(initial = []) {
  const stats = new Map(initial.map(([k, v]) => [k, { ...v }]));   // key → {n, recent}

  function bump(key, score) {
    const st = stats.get(key);
    if (!st) stats.set(key, { n: 1, recent: score });
    else { st.n++; st.recent += ALPHA * (score - st.recent); }
  }

  return {
    stats,
    // Add one event; ignores other games and events without a first note.
    add(e) {
      if (e.game !== 'degrees') return;
      const score = eventScore(e);
      if (score === null) return;
      const degree = e.degrees[0];
      bump(cellKey(e.quality, degree), score);
      bump(rootKey(e.quality, degree, e.rootWritten), score);
    },
    cellTickets: (quality, degree) => tickets(stats.get(cellKey(quality, degree))),
    rootTickets: (quality, degree, root) => tickets(stats.get(rootKey(quality, degree, root))),
  };
}

// Weighted random choice: items[i] with probability weights[i] / sum.
function weighted(items, weights, rand) {
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

// Draw {quality, degree, root}: a cell (from the exercise's cells, each
// {quality, degree}) by its tickets, then a root inside it.
export function pickWeighted(model, cells, rand = Math.random) {
  const cell = weighted(cells, cells.map(c => model.cellTickets(c.quality, c.degree)), rand);
  const roots = [...Array(12).keys()];
  const root = weighted(roots, roots.map(r => model.rootTickets(cell.quality, cell.degree, r)), rand);
  return { ...cell, root };
}
