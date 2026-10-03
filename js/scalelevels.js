// Scale levels (E1 step 2): the ladder, custom picks and the weak-key model
// — the scale game's own versions of levels.js / weakspots.js (its marks
// come from auto tempo, scaletempo.js).
// Kept separate on purpose (CLAUDE.md: shared logic is extracted when a
// second game needs it, not before): a scale run is judged per note across
// a range, not as one answer, so almost none of the degree formulas apply.
//
// A level = a scale × a pattern, always in all 12 keys (boss, 2026-09-25:
// key areas dropped; the pattern is the exercise, so direction is part of
// the level, not a Play setting). Only Custom narrows the keys, and it can
// pair any scale with any pattern. Tempo and the miss limit stay Play
// settings. Nothing is locked.

import { SCALES, NOTES, inMiddle, HORN_MIDDLE } from './music.js';
import { sessionTickets } from './weakspots.js';

// Patterns: how a run walks the scale from the start note. `indices(i, n,
// notes)` gives the scale positions to play, from the start note at
// position i of the n scale notes inside the horn's range (0 = lowest;
// `notes` = their written pitches); [] when the pattern has no room from
// there. `shape` = how it starts, in degrees from the root, for the level
// card. `chip` = the custom builder's label.
//
// Every scale pattern goes CORNER TO CORNER: from the start note (the low
// root by default) UP to the top of the horn, then DOWN to its bottom —
// not back to the start (boss, 2026-09-27: one run covers the whole horn;
// the extremes are played, just not graded hard — music.js HORN_MIDDLE).
// Broken thirds keep their direction both ways: "ascending" = each pair
// played low → high (1 3 · 2 4 … then … 3 5 · 2 4 · 1 3), "descending" =
// high → low (3 1 · 4 2 … then … 5 3 · 4 2 · 3 1).
const pairs = (from, to, step, second) => {
  const out = [];
  for (let j = from; step > 0 ? j <= to : j >= to; j += step) out.push(j, j + second);
  return out;
};
const range = (from, to, step) => {
  const out = [];
  for (let j = from; step > 0 ? j <= to : j >= to; j += step) out.push(j);
  return out;
};
export const PATTERNS = {
  linear: { name: 'Linear', chip: 'Linear', shape: '1 2 3 4 … top to bottom',
            indices: (i, n) => (i + 1 < n ? [...range(i, n - 1, 1), ...range(n - 2, 0, -1)] : []) },
  '3up': { name: 'Thirds ascending', chip: 'Thirds asc', shape: '1 3 · 2 4 · 3 5 … top to bottom',
           indices: (i, n) => (i + 2 < n ? [...pairs(i, n - 3, 1, 2), ...pairs(n - 4, 0, -1, 2)] : []) },
  '3down': { name: 'Thirds descending', chip: 'Thirds desc', shape: '3 1 · 4 2 · 5 3 … top to bottom',
             indices: (i, n) => (i >= 2 && i < n ? [...pairs(i, n - 1, 1, -2), ...pairs(n - 2, 2, -1, -2)] : []) },
};
export const PATTERN_ORDER = ['linear', '3up', '3down'];

// The six one-way patterns before 2026-09-27, onto the pattern each is half
// of. Runs keep the pattern they were played with (it's what happened);
// stats, weak keys and tempo read them through runPattern().
export const OLD_PATTERNS = { up: 'linear', down: 'linear', '3up-asc': '3up', '3up-desc': '3up',
                              '3down-asc': '3down', '3down-desc': '3down' };

// Arpeggio mastery (F1, boss 2026-09-27), over the chord tones (the arp-*
// "scales", index i = the start root — by default the lowest root on the
// horn): up through the four inversions — 1357 3571 5713 7135 — then down
// from the HIGHEST root at or below high D (written D6, the top of the
// horn's middle) — 1753 7531 5317 3175 — and back up to the nearest root.
// So C7 goes up from C4 and comes down from C6; F△ up from F4, down from F5
// (F6 is past high D); D7 down from D6 itself. Groups that run off the
// horn are dropped (C from C4 has no G below low B♭ for 3175: 5317 → C).
// At least 1357 must fit. From a root only (`rootOnly`).
PATTERNS.arp = {
  name: 'Arpeggio mastery', chip: 'Arpeggio mastery', shape: '1357 3571 5713 7135 · 1753 7531 5317 3175 · 1',
  rootOnly: true,
  indices: (i, n, notes) => {
    if (i + 3 >= n) return [];
    const out = [];
    for (let g = 0; g < 4 && i + g + 3 < n; g++) for (let k = 0; k < 4; k++) out.push(i + g + k);
    // The top root: an octave up at least, the highest at or below high D.
    let top = i + 4;
    for (let j = i + 4; j < n; j += 4) if (notes[j] <= HORN_MIDDLE.high) top = j;
    for (let g = 0; g < 4; g++) {
      if (top - g >= n || top - g - 3 < 0) continue;
      for (let k = 0; k < 4; k++) out.push(top - g - k);
    }
    if (out[out.length - 1] !== top - 4) out.push(top - 4);   // back up to the nearest root
    return out;
  },
};

// Which patterns each scale's ladder has. Pentatonic gets thirds later.
const LADDER = { major: PATTERN_ORDER, penta: ['linear'],
                 'arp-maj7': ['arp'], 'arp-7': ['arp'], 'arp-m7': ['arp'], 'arp-m7b5': ['arp'] };
// The games that run on the scales engine, and their scales in ladder order.
export const GAME_SCALES = { scales: ['major', 'penta'], arpeggios: ['arp-maj7', 'arp-7', 'arp-m7', 'arp-m7b5'] };
export const SCALE_ORDER = GAME_SCALES.scales;
export const LANE_GAMES = Object.keys(GAME_SCALES);
const ALL_KEYS = [...Array(12).keys()];

const keysLabel = keys => keys.length === 12 ? 'all 12 keys' : keys.map(k => NOTES[k]).join(' ');

// Ids are stable (stored in events and settings); the "S1…" numbers are
// display only and follow ladder order. Ids from before 2026-09-27
// ('major-3up-asc' …) are renamed by migrate.js (oldLevelId).
// Numbered per game: S1… for scales, A1… for arpeggios.
export const SCALE_LEVELS = Object.entries(GAME_SCALES).flatMap(([game, scales]) => scales.flatMap(scale => LADDER[scale].map(p => ({
  id: `${scale}-${p}`, game, scale, pattern: p, title: SCALES[scale].name,
  name: PATTERNS[p].name, keys: ALL_KEYS, keysLabel: keysLabel(ALL_KEYS),
}))).map((l, i) => ({ ...l, num: `${game === 'arpeggios' ? 'A' : 'S'}${i + 1}` })));
export const levelsOf = game => SCALE_LEVELS.filter(l => l.game === game);

// Identity of a pick, for snapping a custom pick back onto a level.
const pickKey = (scale, pattern, keys) => `${scale}:${pattern}:${[...keys].sort((a, b) => a - b).join(',')}`;
export function matchScaleLevel(scale, pattern, keys) {
  const k = pickKey(scale, pattern, keys);
  return SCALE_LEVELS.find(l => pickKey(l.scale, l.pattern, l.keys) === k) || null;
}

// Resolve an exercise id (a level id, or 'custom') to
// {id, num, title, name, scale, pattern, keys, keysLabel}. Unknown ids (an
// older ladder, e.g. 'major-home') fall back to the first level. A custom
// pick saved before patterns existed runs linear.
export function scaleExercise(id, custom, game = 'scales') {
  if (id === 'custom') {
    const pattern = PATTERNS[custom.pattern] ? custom.pattern : 'linear';
    return { id, num: '', title: SCALES[custom.scale].name, name: PATTERNS[pattern].name, scale: custom.scale,
             pattern, keys: custom.keys, keysLabel: custom.keys.length ? keysLabel(custom.keys) : 'no key chosen' };
  }
  return SCALE_LEVELS.find(l => l.id === id && l.game === game) || levelsOf(game)[0];
}

// The pattern a run counts for. Runs before patterns (event v2) carry only
// `direction`, which was linear up or down; the one-way patterns count for
// the corner-to-corner pattern they're half of (OLD_PATTERNS).
export const runPattern = e => { const p = e.pattern || e.direction; return OLD_PATTERNS[p] || p; };

// The notes of a run that count toward its score, clean or not and tempo:
// those in the horn's middle (music.js HORN_MIDDLE) — all of them for a
// run entirely at an extreme. Rows are `expected` rows, written pitch first.
export const countedNotes = rows => (rows.some(x => inMiddle(x[0])) ? rows.filter(x => inMiddle(x[0])) : rows);

// --- Weak keys (the D3 idea, per scale × pattern × key) ---
// One run scores 0–1: the share of its counted notes (countedNotes: the
// horn's middle) that were hit. A run that was stopped early counts its
// unplayed notes as not hit, so restarts weigh in naturally. `recent` is an exponential moving average per key, α = 0.3:
// runs are far fewer than degree answers, so each one moves the needle
// more. Tickets follow weakspots.js: never zero, so clean keys still come
// round; +0.8 for a key with under 3 runs; untried = 2.2 (but an untried
// key is drawn before any tickets count — pickScaleKey).
const ALPHA = 0.3;
const FEW_RUNS = 3;
const UNTRIED = 2.2;

export function runScore(e) {
  if (!e.expected || !e.expected.length) return null;
  const notes = countedNotes(e.expected);
  return notes.filter(x => x[3] === 'hit').length / notes.length;
}

const statKey = (scale, pattern, key) => `${scale}|${pattern}|${key}`;

// Running stats per scale × pattern × key. Feed events oldest first.
// `initial` = saved stats ([[key, {n, recent}], …]) from the cached summary.
// On top, this SESSION (as weakspots.js): a run under 80 % of its counted
// notes is a miss for its key, adding SESSION_MISS tickets; a better run
// takes half a miss back — so a key fumbled today comes back today.
const SESSION_GOOD = 0.8;
export function createKeyModel(initial = []) {
  const stats = new Map(initial.map(([k, v]) => [k, { ...v }]));
  const session = new Map();                      // statKey → {miss, right}: this session only, never saved
  return {
    stats,
    add(e) {
      if (!LANE_GAMES.includes(e.game) || e.falseStart || e.loop) return;   // a false start or a loop pass says nothing about the key
      const score = runScore(e);
      if (score === null) return;
      const k = statKey(e.scale, runPattern(e), e.keyWritten);
      const st = stats.get(k);
      if (!st) stats.set(k, { n: 1, recent: score });
      else { st.n++; st.recent += ALPHA * (score - st.recent); }
    },
    // A run played now (the runner, after add): the session tally.
    live(e) {
      if (!LANE_GAMES.includes(e.game) || e.falseStart || e.loop) return;
      const score = runScore(e);
      if (score === null) return;
      const k = statKey(e.scale, runPattern(e), e.keyWritten);
      const t = session.get(k) || { miss: 0, right: 0 };
      t[score >= SESSION_GOOD ? 'right' : 'miss']++;
      session.set(k, t);
    },
    played: (scale, pattern, key) => stats.has(statKey(scale, pattern, key)),
    tickets(scale, pattern, key) {
      const k = statKey(scale, pattern, key);
      const st = stats.get(k);
      const base = st ? 0.6 + 4 * (1 - st.recent) + (st.n < FEW_RUNS ? 0.8 : 0) : UNTRIED;
      return base + sessionTickets(session.get(k));
    },
  };
}

// Draw the next key from `keys`: by tickets when `pick` is 'weak', evenly
// otherwise; never the same key twice in a row when there's a choice.
// Weak: keys never played on this level come FIRST, drawn evenly among
// themselves — as tickets (2.2) they lost to weak keys, and 15 runs of A3
// left C♯ D E unplayed (boss, 2026-10-03: "maximum priority to start
// with"). Called once per run, so each draw sees every run before it.
export function pickScaleKey(model, { scale, pattern, keys, pick, prev }, rand = Math.random) {
  let pool = keys.length > 1 ? keys.filter(k => k !== prev) : keys;
  if (pick === 'weak') {
    const unplayed = pool.filter(k => !model.played(scale, pattern, k));
    if (unplayed.length) pool = unplayed;
  }
  const weights = pool.map(k => (pick === 'weak' ? model.tickets(scale, pattern, k) : 1));
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// Scale levels have no hit-rate stars: their marks come from auto tempo
// (scaletempo.js — pips per tier of clean best).
