// Level ladder (D6) and custom exercises.
//
// An exercise is a list of cells — {quality, degree} pairs — that questions
// are drawn from (roots are always all 12). The ladder goes tier by tier,
// and within a tier one chord quality at a time before mixing them, so a
// new set of degrees is learnt on one sound before it's shuffled. Nothing
// is locked: any level, or a custom pick, can be played any time. Stars
// come from the best practice round played on that exercise.

import { QUALITY_ORDER as Q, QUALITY_TEXT, VALID_DEGREES } from './music.js';

// One level per quality with the given degrees, then one mixing them all.
function tier(tierName, prefix, degreesFor) {
  const levels = Q.filter(q => degreesFor(q)).map(q => ({ quality: q, degrees: degreesFor(q) }));
  const out = levels.map(({ quality, degrees }) => ({
    tier: tierName, name: `${QUALITY_TEXT[quality]} ${prefix}`,
    cells: degrees.map(degree => ({ quality, degree })),
  }));
  out.push({
    tier: tierName, name: `All ${prefix}`,
    cells: levels.flatMap(({ quality, degrees }) => degrees.map(degree => ({ quality, degree }))),
  });
  return out;
}

const upper = { maj7: ['9', '#11', '13'], '7': ['9', '#11', '13'], m7: ['9', '11', '13'], m7b5: ['9', '11', '13'] };

const LADDER = [
  ...tier('Guide tones', 'guide tones', () => ['3', '7']),
  ...tier('Chord tones', 'chord tones', () => ['3', '5', '7']),
  ...tier('Ninths', '+ 9', () => ['3', '5', '7', '9']),
  ...tier('Upper structure', 'upper', q => upper[q]),
  { tier: 'Altered', name: '7 ♭9 ♯9', cells: ['b9', '#9'].map(degree => ({ quality: '7', degree })) },
  { tier: 'Altered', name: '7 altered', cells: ['b9', '#9', '#11', '13'].map(degree => ({ quality: '7', degree })) },
  { tier: 'Altered', name: 'Everything', cells: Q.flatMap(quality => VALID_DEGREES[quality].map(degree => ({ quality, degree }))) },
];

// Ids L1, L2, … in ladder order (stored in events and settings).
export const LEVELS = LADDER.map((l, i) => ({ id: `L${i + 1}`, ...l }));

// A custom pick: every valid combination of the chosen qualities and degrees.
export function customCells(qualities, degrees) {
  return qualities.flatMap(quality =>
    degrees.filter(d => VALID_DEGREES[quality].includes(d)).map(degree => ({ quality, degree })));
}

// Resolve an exercise id ('L3' or 'custom') to {id, name, cells}.
export function exercise(id, custom) {
  if (id === 'custom') {
    const cells = customCells(custom.qualities, custom.degrees);
    return { id, name: 'Custom', cells };
  }
  const level = LEVELS.find(l => l.id === id) || LEVELS[0];
  return { id: level.id, name: `${level.id} · ${level.name}`, cells: level.cells };
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
