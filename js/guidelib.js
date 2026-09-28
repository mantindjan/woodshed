// Guide tones (G2): the exercises, a round's timeline, the library and
// the stats — pure where it can be, so the tests can build rounds without
// a horn.
//
// The game (boss, 2026-09-28): an EXERCISE is a cadence — chords as
// degrees of the key, each lasting 1, 2 or 4 bars of 4/4 — plus its
// TARGETS: on a chord, at a beat of any of its bars or "late" (anywhere in
// the chord's last two beats, off the beat is fine), one tone or several
// (1 3 5 7, the colours 9 11 13 and the alterations ♭9 ♯9 ♯11 ♭13;
// several = one drawn at random in each key). A chord may carry an
// alteration in its symbol (V7♭9 — boss, 2026-09-28): shown on the chord,
// its tones are what the targets say; the band still comps 3 5 7. It goes
// round the 12 keys on a key path; the player blows through it and only
// the targets are judged. A target's pitch is free in octave, except along
// the line: when the next target is a step (≤ 2 semitones) from the one
// just hit, it must be played a step away — 7 resolving down to 3, not an
// octave off. bpm = quarter notes. No modes and nothing stops a round.
//
// Exercises are saved, edited and deleted like the cells (the boss:
// "savable/editable like the cells"): the built-in ones are read-only;
// changing a played one saves a new one, so one id never means two
// exercises. The library syncs as its own file, guides.json.

import { DEG_SEMI, QUALITY_TEXT, degreeLabel } from './music.js';

// Chord roots as degrees of the key (semitones above the tonic), shown as
// Roman numerals — lower case on minor and half-diminished chords.
export const NUMERALS = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
export const numeral = c => {
  const n = NUMERALS[c.deg];
  return `${c.q === 'm7' || c.q === 'm7b5' ? n.toLowerCase() : n}${QUALITY_TEXT[c.q]}${c.alt ? degreeLabel(c.alt) : ''}`;
};
export const cadenceText = ex => ex.chords.map(c => `${numeral(c)}${c.bars > 1 ? ` ×${c.bars}` : ''}`).join(' · ');

export const BAR = 4;                         // 4/4
export const QUALITIES = ['maj7', '7', 'm7', 'm7b5'];
export const BARS = [1, 2, 4];
export const TONES = ['1', '3', '5', '7', '9', 'b9', '#9', '11', '#11', '13', 'b13'];
export const ALTS = ['b9', '#9', '#11', 'b13'];     // a chord's alteration, shown in its symbol
// A tone's semitones above the root (DEG_SEMI has no ♭13: 8 on every chord).
const toneSemi = (q, deg) => (deg === 'b13' ? 8 : DEG_SEMI[q][deg]);
export const MAX_CHORDS = 8;

// Where a target sits: `at` = the beat from the chord's start (0 = its
// 1; bar 2's 1 = 4 …), or 'late' — the chord's last two beats.
export const LATE = 'late';
export const slotName = (c, at) => (at === LATE ? 'late' : `${c.bars > 1 ? `bar ${Math.floor(at / BAR) + 1} ` : ''}beat ${(at % BAR) + 1}`);

// Fills: quick ways to set every chord's targets, then tweak by hand
// (the patterns of the first cut, 2026-09-28).
export const FILLS = {
  '3on1': { name: '3s on 1', of: () => [{ at: 0, degs: ['3'] }] },
  '7on1': { name: '7s on 1', of: () => [{ at: 0, degs: ['7'] }] },
  line7: { name: 'Line from 7', of: i => [{ at: 0, degs: [i % 2 ? '3' : '7'] }] },
  line3: { name: 'Line from 3', of: i => [{ at: 0, degs: [i % 2 ? '7' : '3'] }] },
  // The boss's example: the 3 on the chord's 1, its 7 late, resolving down
  // to the next chord's 3 on its 1.
  '7to3': { name: '7 → 3', of: () => [{ at: 0, degs: ['3'] }, { at: LATE, degs: ['7'] }] },
  either: { name: '3 or 7 on 1', of: () => [{ at: 0, degs: ['3', '7'] }] },
  clear: { name: 'Clear', of: () => [] },
};
export const FILL_ORDER = ['3on1', '7on1', 'line7', 'line3', '7to3', 'either', 'clear'];
export const fill = (chords, id) => chords.flatMap((_, i) => FILLS[id].of(i).map(t => ({ chord: i, ...t })));

const ii_V_I = [{ deg: 2, q: 'm7', bars: 1 }, { deg: 7, q: '7', bars: 1 }, { deg: 0, q: 'maj7', bars: 2 }];
// Minor: the V as it's played, 7♭9.
const minor = [{ deg: 2, q: 'm7b5', bars: 1 }, { deg: 7, q: '7', bars: 1, alt: 'b9' }, { deg: 0, q: 'm7', bars: 2 }];
const V_I = [{ deg: 7, q: '7', bars: 1 }, { deg: 0, q: 'maj7', bars: 2 }];
const turnaround = [{ deg: 0, q: 'maj7', bars: 1 }, { deg: 9, q: 'm7', bars: 1 }, { deg: 2, q: 'm7', bars: 1 }, { deg: 7, q: '7', bars: 1 }];
// The built-in exercises (read-only; ids start with "p:"). The tonic chord
// of a cadence lasts two bars, as it would in a tune.
export const PRESETS = [
  { id: 'p:ii-V-I', name: 'ii–V–I · 7 → 3', chords: ii_V_I, targets: fill(ii_V_I, '7to3') },
  { id: 'p:minor', name: 'Minor ii–V–i · 7 → 3', chords: minor, targets: fill(minor, '7to3') },
  { id: 'p:V-I', name: 'V–I · 3s on 1', chords: V_I, targets: fill(V_I, '3on1') },
  { id: 'p:turnaround', name: 'I–vi–ii–V · line from 7', chords: turnaround, targets: fill(turnaround, 'line7') },
];
export const isPreset = ex => ex.id.startsWith('p:');

const pcOf = n => ((n % 12) + 12) % 12;

// A round: the exercise in each of `keys` (written tonics, in order), from
// beat 0 (the first beat after the count-in). → {chords: [{key (written
// root pc), q, alt, beats, start, keyIdx, chordIdx, tonic}], targets: [{from, to
// (beats), pc (written), deg (the tone drawn), at, keyIdx, chordIdx, key
// (the tonic)}] in time order, beats}.
export function buildRound(ex, keys, rnd = Math.random) {
  const chords = [], targets = [];
  let beat = 0;
  keys.forEach((key, keyIdx) => {
    ex.chords.forEach((c, chordIdx) => {
      const beats = c.bars * BAR;
      const root = pcOf(key + c.deg);
      chords.push({ key: root, q: c.q, alt: c.alt || null, beats, start: beat, keyIdx, chordIdx, tonic: key });
      for (const tg of ex.targets.filter(t => t.chord === chordIdx && t.degs.length)) {
        if (tg.at !== LATE && tg.at >= beats) continue;         // a beat past the chord (it got shorter)
        const deg = tg.degs[Math.floor(rnd() * tg.degs.length)];
        const [a, b] = tg.at === LATE ? [beats - 2, beats] : [tg.at, tg.at];
        targets.push({ from: beat + a, to: beat + b, pc: pcOf(root + toneSemi(c.q, deg)), deg, at: tg.at,
                       keyIdx, chordIdx, key });
      }
      beat += beats;
    });
  });
  targets.sort((x, y) => x.from - y.from);
  return { chords, targets, beats: beat };
}

// Along the line: may pitch `w` hit a target (written pc `pc`) right after
// the previous target was hit at `prevW`? When the two pitch classes are a
// step or less apart (7 → 3, a common tone), the line must move by that
// step: |w − prevW| ≤ 2. Otherwise any octave.
export function onTheLine(w, pc, prevW) {
  if (prevW == null) return true;
  const d = Math.abs(pcOf(pc - prevW));
  if (Math.min(d, 12 - d) > 2) return true;
  return Math.abs(w - prevW) <= 2;
}

// --- The library ---
const LIB_KEY = 'woodshed.guideLib';          // your exercises, [{id, name, chords, targets, created}]
const SEL_KEY = 'woodshed.guideSel';          // the exercise Play plays
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* storage unavailable */ } return null; };
export function loadLibrary() {
  try { return JSON.parse(ls(LIB_KEY)) || []; } catch { return []; }
}
const saveLibrary = list => ls(LIB_KEY, JSON.stringify(list));
export const allGuides = () => [...PRESETS, ...loadLibrary()];
export const findGuide = id => allGuides().find(g => g.id === id) || null;
export const selectedId = () => ls(SEL_KEY) || PRESETS[0].id;
export const select = id => ls(SEL_KEY, id);
export const currentGuide = () => findGuide(selectedId()) || PRESETS[0];

const clean = ex => ({
  chords: ex.chords.map(c => ({ deg: c.deg, q: c.q, bars: c.bars, ...(c.alt ? { alt: c.alt } : {}) })),
  targets: ex.targets.filter(t => t.degs.length).map(t => ({ chord: t.chord, at: t.at, degs: TONES.filter(d => t.degs.includes(d)) }))
    .sort((a, b) => a.chord - b.chord || (a.at === LATE) - (b.at === LATE) || a.at - b.at),
});
const same = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));
export const defaultName = ex => `${cadenceText(ex)}`;
const newId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// Save a draft {id?, name, chords, targets}. A preset, or a played
// exercise whose music changed, is saved as a NEW exercise; else in place.
// Returns the saved exercise.
export function saveGuide(draft, played) {
  const list = loadLibrary();
  const old = draft.id && list.find(g => g.id === draft.id);
  const c = clean(draft);
  const name = (draft.name || '').trim() || defaultName(c);
  let saved;
  if (old && (!played || same(old, c))) {
    saved = Object.assign(old, c, { name });
  } else {
    saved = { id: newId(), name, ...c, created: Date.now() };
    list.push(saved);
  }
  saveLibrary(list);
  return saved;
}
export function deleteGuide(id) {
  saveLibrary(loadLibrary().filter(g => g.id !== id));
  if (selectedId() === id) select(PRESETS[0].id);
}

// --- Stats: key × each target slot of an exercise ---
// For one exercise (by id): the last RECENT times each of its target
// slots came up in each key and pooled; hit = true.
const RECENT = 10;
export const slotKey = (chord, at) => `${chord}@${at}`;
export function guideGrid(events, id) {
  const grid = new Map();
  const push = (k, hit) => { const l = grid.get(k) || []; l.push(hit); if (l.length > RECENT) l.shift(); grid.set(k, l); };
  for (const e of events) {
    if (e.game !== 'guides' || e.guideId !== id || !e.targets) continue;
    for (const [key, chordIdx, , at, , status] of e.targets) {
      push(`${key}|${slotKey(chordIdx, at)}`, status === 'hit');
      push(`all|${slotKey(chordIdx, at)}`, status === 'hit');
    }
  }
  return grid;
}
