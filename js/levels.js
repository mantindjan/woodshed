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
// structure, alterations. Within a unit: every quality × single degree
// (Major 3, Major 5, …, Half-dim 7), then each quality with all its unit
// degrees, then all qualities mixed. A level whose cells repeat an earlier
// one (e.g. Major alterations = just ♯11) is skipped.
const UNITS = [
  { key: 'chord', name: 'Chord tones', degrees: ['3', '5', '7'] },
  { key: 'upper', name: 'Upper structure', degrees: ['9', '11', '13'] },
  { key: 'alt', name: 'Alterations', degrees: ['b9', '#9', '#11'] },
];

const labelOf = degrees => degrees.map(degreeLabel).join(' ');
const idPart = d => d.replace('#', 's');   // ids stay plain: #11 → s11

// A level: `quality` is a quality id or 'all' (for the row it sits on).
function level(id, unit, quality, degrees, cells) {
  return { id, unit: unit.key, tier: `${unit.name} · ${labelOf(unit.degrees)}`,
           quality, name: quality === 'all' ? 'All' : QUALITY_NAME[quality],
           degrees: labelOf(degrees), cells };
}

function unitLevels(unit) {
  const perQuality = Q.map(q => ({ q, degrees: unit.degrees.filter(d => VALID_DEGREES[q].includes(d)) }))
    .filter(x => x.degrees.length);
  const singles = perQuality.flatMap(({ q, degrees }) => degrees.map(d =>
    level(`${unit.key}-${q}-${idPart(d)}`, unit, q, [d], [{ quality: q, degree: d }])));
  const combined = perQuality.filter(x => x.degrees.length > 1).map(({ q, degrees }) =>
    level(`${unit.key}-${q}`, unit, q, degrees, degrees.map(degree => ({ quality: q, degree }))));
  const all = level(`${unit.key}-all`, unit, 'all', unit.degrees,
    perQuality.flatMap(({ q, degrees }) => degrees.map(degree => ({ quality: q, degree }))));
  return [...singles, ...combined, all];
}

// Identity of a cell set, for spotting duplicates and matching custom picks.
export const cellsKey = cells => cells.map(c => `${c.quality}|${c.degree}`).sort().join(',');

function dedupe(levels) {
  const seen = new Set();
  return levels.filter(l => !seen.has(cellsKey(l.cells)) && seen.add(cellsKey(l.cells)));
}

// Ids are stable (stored in events and settings); the "L1…" numbers are
// display only and follow ladder order.
export const LEVELS = dedupe([
  ...UNITS.flatMap(unitLevels),
  { id: 'everything', unit: 'everything', tier: 'Everything', quality: 'all', name: 'Everything', degrees: 'all degrees',
    cells: Q.flatMap(q => VALID_DEGREES[q].map(degree => ({ quality: q, degree }))) },
]).map((l, i) => ({ ...l, num: `L${i + 1}` }));

export const UNIT_TITLES = [...new Map(LEVELS.map(l => [l.unit, l.tier])).entries()];

// The level with exactly these cells, if any.
export function matchLevel(cells) {
  const key = cellsKey(cells);
  return LEVELS.find(l => cellsKey(l.cells) === key) || null;
}

// The qualities and degrees a cell set is built from (every level and
// custom pick is qualities × degrees, filtered to valid combinations).
export function setsOf(cells) {
  return {
    qualities: Q.filter(q => cells.some(c => c.quality === q)),
    degrees: [...new Set(cells.map(c => c.degree))],
  };
}

// A custom pick: every valid combination of the chosen qualities and degrees.
export function customCells(qualities, degrees) {
  return qualities.flatMap(quality =>
    degrees.filter(d => VALID_DEGREES[quality].includes(d)).map(degree => ({ quality, degree })));
}

// Resolve an exercise id (a level id, or 'custom') to
// {id, num, title, degrees, name, cells}: `title` is the quality in words,
// `degrees` what gets asked — shown big wherever the exercise is named.
// Unknown ids (e.g. from an older ladder) fall back to the first level.
export function exercise(id, custom, describe) {
  if (id === 'custom') {
    const cells = customCells(custom.qualities, custom.degrees);
    return { id, num: '', title: 'Custom', degrees: describe(cells), name: 'Custom', cells };
  }
  const l = LEVELS.find(x => x.id === id) || LEVELS[0];
  return { id: l.id, num: l.num, title: l.name, degrees: l.degrees,
           name: `${l.num} · ${l.name} · ${l.degrees}`, cells: l.cells };
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
