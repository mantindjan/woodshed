// Level ladder (D6) and custom exercises.
//
// An exercise is a list of cells — {quality, degree} pairs — that questions
// are drawn from (roots are always all 12). The ladder goes unit by unit,
// and within a unit one chord quality at a time before mixing them, so a
// new set of degrees is learnt on one sound before it's shuffled. Nothing
// is locked: any level, or a custom pick, can be played any time. Stars
// come from the best practice round played on that exercise.

import { QUALITY_ORDER as Q, QUALITY_NAME, VALID_DEGREES, degreeLabel } from './music.js';

// Units of degrees, as the boss plays them (2026-09-24): chord tones, upper
// structure, alterations. Each unit goes one quality at a time (only the
// degrees valid on it), then all qualities mixed.
const UNITS = [
  { key: 'chord', name: 'Chord tones', degrees: ['3', '5', '7'] },
  { key: 'upper', name: 'Upper structure', degrees: ['9', '11', '13'] },
  { key: 'alt', name: 'Alterations', degrees: ['b9', '#9', '#11'] },
];

const labelOf = degrees => degrees.map(degreeLabel).join(' ');

function unitLevels(unit) {
  const perQuality = Q.map(q => ({ q, degrees: unit.degrees.filter(d => VALID_DEGREES[q].includes(d)) }))
    .filter(x => x.degrees.length);
  const levels = perQuality.map(({ q, degrees }) => ({
    id: `${unit.key}-${q}`, tier: `${unit.name} · ${labelOf(unit.degrees)}`,
    name: QUALITY_NAME[q], degrees: labelOf(degrees),
    cells: degrees.map(degree => ({ quality: q, degree })),
  }));
  levels.push({
    id: `${unit.key}-all`, tier: levels[0].tier, name: 'All', degrees: labelOf(unit.degrees),
    cells: perQuality.flatMap(({ q, degrees }) => degrees.map(degree => ({ quality: q, degree }))),
  });
  return levels;
}

// Ids are stable (stored in events and settings); the "L1…" numbers are
// display only and follow ladder order.
export const LEVELS = [
  ...UNITS.flatMap(unitLevels),
  { id: 'everything', tier: 'Everything', name: 'Everything', degrees: 'all',
    cells: Q.flatMap(q => VALID_DEGREES[q].map(degree => ({ quality: q, degree }))) },
].map((l, i) => ({ ...l, num: `L${i + 1}` }));

// A custom pick: every valid combination of the chosen qualities and degrees.
export function customCells(qualities, degrees) {
  return qualities.flatMap(quality =>
    degrees.filter(d => VALID_DEGREES[quality].includes(d)).map(degree => ({ quality, degree })));
}

// Resolve an exercise id ('chord-7', … or 'custom') to {id, name, cells}.
// Unknown ids (e.g. from the old ladder) fall back to the first level.
export function exercise(id, custom) {
  if (id === 'custom') {
    const cells = customCells(custom.qualities, custom.degrees);
    return { id, name: 'Custom', cells };
  }
  const level = LEVELS.find(l => l.id === id) || LEVELS[0];
  const name = level.name === level.tier ? level.name : `${level.name} · ${level.degrees}`;
  return { id: level.id, name: `${level.num} · ${name}`, cells: level.cells };
}

// Stars per exercise id from the event log: the best PRACTICE round of at
// least MIN_ROUND questions. ★ ≥ 70% right first time, ★★ ≥ 85%,
// ★★★ ≥ 95% with a median right answer under 1.5 s (the "good" edge).
const MIN_ROUND = 10;
export function starsByExercise(events) {
  const rounds = new Map();   // round id → {exercise, n, ok, times}
  for (const e of events) {
    if (e.game !== 'degrees' || e.mode !== 'practice' || !e.exercise) continue;
    const r = rounds.get(e.round) || { exercise: e.exercise, n: 0, ok: 0, times: [] };
    r.n++;
    if (e.ok) { r.ok++; r.times.push(e.notes[0][1]); }
    rounds.set(e.round, r);
  }
  const best = new Map();
  for (const r of rounds.values()) {
    if (r.n < MIN_ROUND) continue;
    const acc = r.ok / r.n;
    const t = [...r.times].sort((a, b) => a - b);
    const median = t.length ? t[t.length >> 1] : Infinity;
    const stars = acc >= 0.95 && median < 1500 ? 3 : acc >= 0.85 ? 2 : acc >= 0.7 ? 1 : 0;
    best.set(r.exercise, Math.max(best.get(r.exercise) || 0, stars));
  }
  return best;
}
