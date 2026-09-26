// Pattern library (P game): the boss's own patterns, the exercises every
// pattern gets, and progress worked out from the runs.
//
// A PATTERN is a cell of notes over one chord (boss, 2026-09-26): each note
// is a degree of the chord plus an OCTAVE relative to the root, because
// height matters — "5 3 1 5" from the low 5 and from the high 5 are two
// different patterns. Semitones above the root = degree's semitones (by
// quality) + 12 × octave. The cell fills one 4/4 bar: 4 notes → quarters,
// 6 → triplets, n → n evenly.
//
// The library lives in localStorage (`woodshed.patterns`) and syncs as its
// own readable file (`patterns.json`, sync.js), apart from the runs. Runs
// (game `patterns`, patterns.js) carry the pattern's id AND a snapshot of
// its notes, so history stays meaningful if a pattern is renamed or
// deleted. Changing the notes of a pattern that has runs saves a NEW
// pattern, so one id never means two different things.

import { DEG_SEMI, QUALITY_NAME, degreeLabel } from './music.js';

// Degrees a pattern can use: the scale steps over the chord, and the
// alterations a chart asks for. 2 4 6 take the 9 11 13 of the quality
// (so 6 on ø is ♭6, as its 13), 3 5 7 the quality's own.
export const PATTERN_DEGREES = ['1', '2', '3', '4', '5', '6', '7', 'b9', '#9', '#11', 'b13'];
const AS = { 2: '9', 4: '11', 6: '13' };
export function degSemi(quality, deg) {
  if (deg === '1') return 0;
  if (deg === 'b13') return 8;
  return DEG_SEMI[quality][AS[deg] || deg];
}
export const noteSemis = (quality, n) => degSemi(quality, n.deg) + 12 * n.oct;

// A new note's octave: the one nearest the previous note (ties go up);
// the first note sits in the root's octave.
export function nearestOct(quality, deg, prev) {
  if (!prev) return 0;
  const target = noteSemis(quality, prev);
  let best = 0;
  for (const oct of [-2, -1, 0, 1, 2]) {
    const d = Math.abs(degSemi(quality, deg) + 12 * oct - target);
    const bd = Math.abs(degSemi(quality, deg) + 12 * best - target);
    if (d < bd || (d === bd && oct > best)) best = oct;
  }
  return best;
}

export const MIN_NOTES = 3, MAX_NOTES = 8;

// "5 1 3 5" — degrees as written; heights are drawn, not spelled.
export const degreesText = p => p.notes.map(n => degreeLabel(n.deg)).join(' ');
export const autoName = p => `${QUALITY_NAME[p.quality]} ${degreesText(p)}`;
// Two patterns are the same music when quality and notes (with heights) match.
const same = (a, b) => a.quality === b.quality && JSON.stringify(a.notes) === JSON.stringify(b.notes);

const KEY = 'woodshed.patterns';
export function loadLibrary() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
export function saveLibrary(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full/blocked */ }
}
const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// Save a draft {id?, name, quality, notes}. A new pattern, or an edit of one
// never played, is stored as is; changing the notes of a played pattern
// adds a new pattern instead (the old one and its runs stay). Returns the
// saved pattern.
export function savePattern(draft, played) {
  const list = loadLibrary();
  const old = draft.id && list.find(p => p.id === draft.id);
  const clean = { quality: draft.quality, notes: draft.notes.map(n => ({ deg: n.deg, oct: n.oct })) };
  const name = (draft.name || '').trim() || autoName(clean);
  let saved;
  if (old && (!played || same(old, clean))) {
    saved = Object.assign(old, clean, { name });
  } else {
    saved = { id: newId(), name, ...clean, created: Date.now() };
    list.push(saved);
  }
  saveLibrary(list);
  return saved;
}
export function deletePattern(id) {
  saveLibrary(loadLibrary().filter(p => p.id !== id));
}

// --- Exercises: which keys, in which order (written roots) ---
// Learn goes round the cycle of 4ths, each chord ×4, then ×2, then ×1;
// practice takes the other paths once per chord. Every path covers all 12
// keys (whole steps and minor thirds as several cycles back to back).
const cycle = (start, step, n) => Array.from({ length: n }, (_, i) => (((start + step * i) % 12) + 12) % 12);
export const EXERCISES = {
  cycle4: { name: 'Cycle of 4ths', keys: cycle(0, 5, 12) },
  chromDown: { name: 'Chromatic down', keys: cycle(0, -1, 12) },
  chromUp: { name: 'Chromatic up', keys: cycle(0, 1, 12) },
  wholeDown: { name: 'Whole steps down', keys: [...cycle(0, -2, 6), ...cycle(11, -2, 6)] },
  wholeUp: { name: 'Whole steps up', keys: [...cycle(0, 2, 6), ...cycle(1, 2, 6)] },
  minor3Down: { name: 'Minor 3rds down', keys: [...cycle(0, -3, 4), ...cycle(11, -3, 4), ...cycle(10, -3, 4)] },
};
export const PRACTICE_EXERCISES = ['chromDown', 'chromUp', 'wholeDown', 'wholeUp', 'minor3Down'];
export const STAGES = [4, 2, 1];          // learn: times on each chord

// --- Stats: key × note of the pattern ---
// For one pattern: the last RECENT times each note of the cell came up on
// each key (and on all keys pooled), newest last. A note scores 1 hit on
// the beat, sliding to 0.6 at the window's edge (as the scales map), 0
// wrong or missed. Keys "<rootPc>|<j>" and "all|<j>", j = the note's place
// in the cell.
const RECENT = 10;
export function patternGrid(events, id) {
  const grid = new Map();
  const push = (k, a) => {
    const list = grid.get(k) || [];
    list.push(a);
    if (list.length > RECENT) list.shift();
    grid.set(k, list);
  };
  for (const e of events) {
    if (e.game !== 'patterns' || e.patternId !== id || !e.expected) continue;
    const n = e.pattern.notes.length;
    e.expected.forEach(([root, , , , status, off], i) => {
      const a = { hit: status === 'hit', off, score: status === 'hit' ? 1 - 0.4 * Math.min(Math.abs(off || 0), 150) / 150 : 0 };
      push(`${root}|${i % n}`, a);
      push(`all|${i % n}`, a);
    });
  }
  return grid;
}

// --- Progress, from runs ---
// A run is SOLID at ≥ 95 % of its notes hit. Learn: 2 solid runs in a row
// at a stage move the pattern to the next (×4 → ×2 → ×1); solid at ×1 =
// learnt, practice next. Practice: an exercise is done once solid.
export const SOLID = 0.95;
// Pattern runs' expected rows are [root, degree, semitones, ms, status, offset].
export const runRate = e => e.expected.filter(x => x[4] === 'hit').length / e.expected.length;

// {stage: index into STAGES to play next, learnt, done: Set of exercise ids,
// best: {exercise|reps → best rate}} for a pattern id, from its events
// (oldest first).
export function patternProgress(events, id) {
  let stage = 0, streak = 0, learnt = false;
  const done = new Set(), best = {};
  for (const e of events) {
    if (e.game !== 'patterns' || e.patternId !== id || !e.expected?.length) continue;
    const rate = runRate(e);
    const k = `${e.exercise}|${e.reps}`;
    best[k] = Math.max(best[k] || 0, rate);
    if (e.mode === 'learn') {
      const at = STAGES.indexOf(e.reps);
      if (at !== stage) { streak = 0; continue; }      // only the current stage moves it
      streak = rate >= SOLID ? streak + 1 : 0;
      if (streak >= 2) {
        streak = 0;
        if (stage === STAGES.length - 1) learnt = true;
        else stage++;
      }
    } else if (rate >= SOLID) {
      done.add(e.exercise);
    }
  }
  return { stage, learnt, done, best };
}
