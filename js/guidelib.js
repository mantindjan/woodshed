// Guide tones (G2): the cadences, the target patterns, and a round's
// timeline — pure, so the tests can build rounds without a horn.
//
// The game (boss, 2026-09-28): a cadence (ii–V–I, with how many bars each
// chord lasts) goes round the 12 keys on a key path; the player blows
// through it and only the TARGETS are judged — a guide tone (3 or 7) of a
// chord, on beat 1, on beat 3, or "late" (anywhere in the chord's last two
// beats, off the beat is fine). A target's pitch is free in octave, except
// along the guide-tone line: when the next target is a step (≤ 2
// semitones) from the one just hit, it must be played a step away — 7
// resolving down to 3, not an octave off. 4/4; bpm = quarter notes. No
// learn/practice modes and nothing stops a round: it's all practice.

import { DEG_SEMI, QUALITY_TEXT } from './music.js';

// Chord roots as degrees of the key (semitones above the tonic), shown as
// Roman numerals — lower case on minor and half-diminished chords.
export const NUMERALS = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
export const numeral = c => {
  const n = NUMERALS[c.deg];
  return `${c.q === 'm7' || c.q === 'm7b5' ? n.toLowerCase() : n}${QUALITY_TEXT[c.q]}`;
};
export const cadenceText = cad => cad.chords.map(c => `${numeral(c)}${c.bars > 1 ? ` ×${c.bars}` : ''}`).join(' · ');

export const BAR = 4;                         // 4/4

// The presets (boss, 2026-09-28). The tonic chord of a cadence lasts two
// bars, as it would in a tune.
export const CADENCES = [
  { id: 'ii-V-I', name: 'ii–V–I', chords: [{ deg: 2, q: 'm7', bars: 1 }, { deg: 7, q: '7', bars: 1 }, { deg: 0, q: 'maj7', bars: 2 }] },
  { id: 'minor', name: 'Minor ii–V–i', chords: [{ deg: 2, q: 'm7b5', bars: 1 }, { deg: 7, q: '7', bars: 1 }, { deg: 0, q: 'm7', bars: 2 }] },
  { id: 'V-I', name: 'V–I', chords: [{ deg: 7, q: '7', bars: 1 }, { deg: 0, q: 'maj7', bars: 2 }] },
  { id: 'turnaround', name: 'I–vi–ii–V', chords: [{ deg: 0, q: 'maj7', bars: 1 }, { deg: 9, q: 'm7', bars: 1 },
                                                   { deg: 2, q: 'm7', bars: 1 }, { deg: 7, q: '7', bars: 1 }] },
];
export const QUALITIES = ['maj7', '7', 'm7', 'm7b5'];
export const BARS = [1, 2, 4];
// Where a target falls in its chord: `from`/`to` in beats from the chord's
// start; a span wider than the hit window is a "late" target.
export const PLACES = {
  one: { name: 'on 1', at: () => [0, 0] },
  three: { name: 'on 3', at: () => [2, 2] },
  late: { name: 'late', at: beats => [beats - 2, beats] },
};

// Target patterns: per chord of the cadence (i = its index, n = how many),
// a list of {deg, place}. `random` draws 3 or 7 afresh for every chord.
export const PATTERNS = {
  '3on1': { name: '3s on 1', targets: () => [{ deg: '3', place: 'one' }] },
  '7on1': { name: '7s on 1', targets: () => [{ deg: '7', place: 'one' }] },
  line7: { name: 'Line from 7', targets: i => [{ deg: i % 2 ? '3' : '7', place: 'one' }] },
  line3: { name: 'Line from 3', targets: i => [{ deg: i % 2 ? '7' : '3', place: 'one' }] },
  // The boss's example: the 3 on the chord's 1, its 7 late in the chord,
  // resolving down to the next chord's 3 on its 1.
  '7to3': { name: '7 → 3', targets: () => [{ deg: '3', place: 'one' }, { deg: '7', place: 'late' }] },
  random: { name: 'Random 3/7', targets: (i, n, rnd = Math.random) => [{ deg: rnd() < 0.5 ? '3' : '7', place: 'one' }] },
  custom: { name: 'Your own', targets: (i, n, rnd, custom) => (custom?.[i]?.deg ? [custom[i]] : []) },
};
export const PATTERN_ORDER = ['3on1', '7on1', 'line7', 'line3', '7to3', 'random', 'custom'];

const pcOf = n => ((n % 12) + 12) % 12;

// A round: the cadence in each of `keys` (written tonics, in order), from
// beat 0 (the first beat after the count-in). → {chords: [{key (written
// root pc), q, beats, start, keyIdx, chordIdx}], targets: [{from, to (beats),
// pc (written), deg, place, keyIdx, chordIdx, key (tonic)}], beats}, the
// targets in time order. `custom` = the per-chord targets for 'custom'.
export function buildRound(cadence, keys, pattern, custom = null, rnd = Math.random) {
  const chords = [], targets = [];
  let beat = 0;
  keys.forEach((key, keyIdx) => {
    cadence.chords.forEach((c, chordIdx) => {
      const beats = c.bars * BAR;
      const root = pcOf(key + c.deg);
      chords.push({ key: root, q: c.q, beats, start: beat, keyIdx, chordIdx });
      for (const tg of PATTERNS[pattern].targets(chordIdx, cadence.chords.length, rnd, custom)) {
        const [a, b] = PLACES[tg.place].at(beats);
        targets.push({ from: beat + a, to: beat + b, pc: pcOf(root + DEG_SEMI[c.q][tg.deg]), deg: tg.deg,
                       place: tg.place, keyIdx, chordIdx, key });
      }
      beat += beats;
    });
  });
  targets.sort((x, y) => x.from - y.from);
  return { chords, targets, beats: beat };
}

// Along the guide-tone line: may pitch `w` hit a target (written pc `pc`)
// right after the previous target was hit at `prevW`? When the two pitch
// classes are a step or less apart (7 → 3, a common tone), the line must
// move by that step: |w − prevW| ≤ 2. Otherwise any octave.
export function onTheLine(w, pc, prevW) {
  if (prevW == null) return true;
  const d = Math.abs(pcOf(pc - prevW));
  if (Math.min(d, 12 - d) > 2) return true;
  return Math.abs(w - prevW) <= 2;
}

// --- The player's own cadence and targets (Levels) ---
const CAD_KEY = 'woodshed.guideCadence';     // a preset id or 'custom'
const CUSTOM_KEY = 'woodshed.guideCustom';   // {chords: [{deg, q, bars}], targets: [{deg, place} | {deg: null}]}
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* storage unavailable */ } return null; };
export function loadCustom() {
  try {
    const c = JSON.parse(ls(CUSTOM_KEY));
    if (c?.chords?.length) return c;
  } catch { /* none yet */ }
  const base = CADENCES[0];
  return { chords: base.chords.map(c => ({ ...c })), targets: base.chords.map(() => ({ deg: '3', place: 'one' })) };
}
export const saveCustom = c => ls(CUSTOM_KEY, JSON.stringify(c));
export const cadenceId = () => ls(CAD_KEY) || CADENCES[0].id;
export const setCadenceId = id => ls(CAD_KEY, id);
export function currentCadence() {
  const id = cadenceId();
  if (id === 'custom') return { id, name: 'Your cadence', chords: loadCustom().chords };
  return CADENCES.find(c => c.id === id) || CADENCES[0];
}

// --- Stats: key × (chord, guide tone) ---
// For one cadence (matched by its chords): the last RECENT targets of each
// chord's 3 and 7 in each key and pooled; hit = 1, else 0.
const RECENT = 10;
export const sameCadence = (a, b) => JSON.stringify(a.chords) === JSON.stringify(b.chords);
export function guideGrid(events, cadence) {
  const grid = new Map();
  const push = (k, hit) => { const l = grid.get(k) || []; l.push(hit); if (l.length > RECENT) l.shift(); grid.set(k, l); };
  for (const e of events) {
    if (e.game !== 'guides' || !e.targets || !sameCadence(e.cadence, cadence)) continue;
    for (const [key, chordIdx, deg, , , status] of e.targets) {
      push(`${key}|${chordIdx}|${deg}`, status === 'hit');
      push(`all|${chordIdx}|${deg}`, status === 'hit');
    }
  }
  return grid;
}
