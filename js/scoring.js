// Points & combos for the degree game (D5). Practice mode only — learn
// mode is for finding notes, not scoring them.
//
// A right-first-time answer earns BASE points plus a speed bonus (tiers as
// in weakspots.js), times the combo multiplier for the current streak. A
// miss resets the streak. Numbers are opening bids (2026-09-24).

import { FAST_MS, GOOD_MS } from './weakspots.js';

const BASE = 100;

// Streak → multiplier: ×2 from 5 in a row, ×3 from 10, ×4 from 20.
export function comboMult(streak) {
  if (streak >= 20) return 4;
  if (streak >= 10) return 3;
  if (streak >= 5) return 2;
  return 1;
}

// Points for a right-first-time answer. streak includes this answer.
export function points(ms, streak) {
  const bonus = ms < FAST_MS ? 50 : ms < GOOD_MS ? 20 : 0;
  return (BASE + bonus) * comboMult(streak);
}
