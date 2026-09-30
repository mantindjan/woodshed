// Cell library (I1 Cells; the Pattern game until 2026-09-27, see
// migrate.js): the boss's own cells, the exercises every cell gets, and
// progress worked out from the runs.
//
// A CELL is 4 notes over one chord (boss, 2026-09-26/27): each note
// is a degree of the chord plus an OCTAVE relative to the root, because
// height matters — "5 3 1 5" from the low 5 and from the high 5 are two
// different cells. Semitones above the root = degree's semitones (by
// quality) + 12 × octave. A note a beat: the tempo is notes per minute
// (mastered ≈ 240 = 4 a second), and a chord lasts the cell × reps.
//
// The library lives in localStorage (`woodshed.cells`) and syncs as its
// own readable file (`cells.json`, sync.js), apart from the runs. Runs
// (game `cells`, cells.js) carry the cell's id AND a snapshot of
// its notes, so history stays meaningful if a cell is renamed or
// deleted. Changing the notes of a cell that has runs saves a NEW
// cell, so one id never means two different things.

import { DEG_SEMI, QUALITY_NAME, degreeLabel } from './music.js';
import { createRating, timedScore } from './rating.js';

// Degrees a cell can use: the scale steps over the chord, and the
// alterations a chart asks for. 2 4 6 take the 9 11 13 of the quality
// (so 6 on ø is ♭6, as its 13), 3 5 7 the quality's own.
export const CELL_DEGREES = ['1', '2', '3', '4', '5', '6', '7', 'b9', '#9', '#11', 'b13'];
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

// Every cell is 4 notes, a b c d, in any order (boss, 2026-09-27; longer
// lines are licks — scope, not built).
export const CELL_NOTES = 4;

// What gets played. Learn (the cycle of 4ths) plays a b c d c b on each
// chord — back through the middle gets the cell under the fingers; the
// practice paths play the 4 notes only (boss, 2026-09-27).
const CYCLE = [0, 1, 2, 3, 2, 1];
export const playedNotes = (p, mode) =>
  mode === 'learn' && p.notes.length === CELL_NOTES ? CYCLE.map(i => p.notes[i]) : p.notes;
// A 6-note a b c d c b typed out by hand (as the boss did before cells
// were 4 notes) is that cell.
const isCycle = notes => notes.length === 6 &&
  JSON.stringify(CYCLE.map(i => notes[i])) === JSON.stringify(notes);

// "5 1 3 5" — degrees as written; heights are drawn, not spelled.
export const degreesText = p => p.notes.map(n => degreeLabel(n.deg)).join(' ');
export const autoName = p => `${QUALITY_NAME[p.quality]} ${degreesText(p)}`;
// Two cells are the same music when quality and notes (with heights) match.
const same = (a, b) => a.quality === b.quality && JSON.stringify(a.notes) === JSON.stringify(b.notes);

const KEY = 'woodshed.cells';
export function loadLibrary() {
  let list;
  try { list = JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  // Written out a b c d c b before cells were 4 notes: keep a b c d, same
  // id — and store it so, so the synced cells.json says 4 notes too.
  const cycles = list.filter(p => isCycle(p.notes));
  for (const p of cycles) p.notes = p.notes.slice(0, CELL_NOTES);
  if (cycles.length) saveLibrary(list);
  return list;
}
export function saveLibrary(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full/blocked */ }
}
const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// Save a draft {id?, name, quality, notes}. A new cell, or an edit of one
// never played, is stored as is; changing the notes of a played cell
// adds a new cell instead (the old one and its runs stay). Returns the
// saved cell.
export function saveCell(draft, played) {
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
export function deleteCell(id) {
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
  // Random roots (boss, 2026-09-26): a fresh shuffle of the 12 every round
  // (exerciseKeys), never starting on the key the last round ended on. The
  // quality stays the cell's — a dominant cell wants a dominant chord.
  random: { name: 'Random keys', keys: cycle(0, 1, 12), random: true },
};
export const PRACTICE_EXERCISES = ['chromDown', 'chromUp', 'wholeDown', 'wholeUp', 'minor3Down', 'random'];

// The keys of one round of an exercise: its fixed path, or for 'random' a
// shuffle whose first key isn't `prevLast`.
export function exerciseKeys(id, prevLast = null, rnd = Math.random) {
  const ex = EXERCISES[id];
  if (!ex.random) return ex.keys;
  const keys = [...ex.keys];
  for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
  if (keys[0] === prevLast) [keys[0], keys[keys.length - 1]] = [keys[keys.length - 1], keys[0]];
  return keys;
}
export const STAGES = [4, 2, 1];          // learn: times on each chord

// --- Stats: key × note of the cell ---
// For one cell, rated as every game rates (rating.js): each time a note of
// the cell came up on each key (and on all keys pooled, and "level" for the
// whole cell) — 1 hit on the beat, sliding to 0.6 at the window's edge, 0
// wrong or missed. Keys "<rootPc>|<j>", "all|<j>", j = the note's place in
// the cell; "level". → a rating (get(key)).
export function cellGrid(events, id) {
  const rating = createRating();
  for (const e of events) {
    if (e.game !== 'cells' || e.cellId !== id || !e.expected) continue;
    // Each played note back to its place in the cell: learn's a b c d c b
    // (v3, `cellBeats` 6) and a hand-typed 6-note cycle fold onto a b c d.
    const notes = e.cell.notes;
    const cyc = isCycle(notes) || (e.v >= 3 && e.cellBeats === 6 && notes.length === CELL_NOTES);
    const place = i => (cyc ? CYCLE[i % 6] : i % notes.length);
    e.expected.forEach(([root, , , , status, off], i) => {
      const hit = status === 'hit';
      for (const k of [`${root}|${place(i)}`, `all|${place(i)}`, 'level']) rating.add(k, e.t, timedScore(hit, off), hit ? off : null);
    });
  }
  return rating;
}

// --- Progress, from runs ---
// A run is SOLID at ≥ 95 % of its notes hit. Learn: a stage (×4, ×2, ×1)
// is ticked once a round at it is solid; solid at ×1 = learnt. Practice:
// a path is done once solid. Nothing moves the player on — the stage is
// theirs to pick (boss, 2026-09-28: "two times to count it … I can be the
// best judge of that if I fix the tempo"; "two solid in a row" is auto
// tempo's rule, in scales).
export const SOLID = 0.95;
// Cell runs' expected rows are [root, degree, semitones, ms, status, offset].
export const runRate = e => e.expected.filter(x => x[4] === 'hit').length / e.expected.length;

// {solid: Set of STAGES indexes ticked, learnt, done: Set of exercise ids,
// best: {exercise|reps → best rate}} for a cell id, from its events.
export function cellProgress(events, id) {
  const solid = new Set(), done = new Set(), best = {};
  for (const e of events) {
    if (e.game !== 'cells' || e.cellId !== id || !e.expected?.length) continue;
    const rate = runRate(e);
    const k = `${e.exercise}|${e.reps}`;
    best[k] = Math.max(best[k] || 0, rate);
    if (rate < SOLID) continue;
    if (e.mode === 'learn' && STAGES.includes(e.reps)) solid.add(STAGES.indexOf(e.reps));
    else if (e.mode !== 'learn') done.add(e.exercise);
  }
  return { solid, learnt: solid.has(STAGES.length - 1), done, best };
}
