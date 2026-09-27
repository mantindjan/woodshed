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

import { SCALES, NOTES } from './music.js';

// Patterns: how a run walks the scale from the start note. `indices(i, n)`
// gives the scale positions to play, from the blown start note at position
// i of the n scale notes inside the horn's range (0 = lowest); [] when the
// pattern has no room from there. `slope` = scale steps per played note
// along the run, for the lane's drift. `shape` = how it starts, in degrees
// from the root, for the level card. `chip` = the custom builder's label.
// Broken thirds (boss, 2026-09-25): "thirds up" = each pair played low →
// high (1 3), "thirds down" = high → low (3 1); "ascending" / "descending"
// = which way the pairs move through the scale.
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
  up: { name: 'Linear up', chip: 'Linear up', shape: '1 2 3 4 …', slope: 1, indices: (i, n) => range(i, n - 1, 1) },
  down: { name: 'Linear down', chip: 'Linear down', shape: '5 4 3 2 …', slope: -1, indices: (i, n) => range(i, 0, -1) },
  '3up-asc': { name: 'Thirds up · ascending', chip: 'Thirds up · asc', shape: '1 3 · 2 4 · 3 5 …', slope: 0.5,
               indices: (i, n) => pairs(i, n - 3, 1, 2) },
  '3up-desc': { name: 'Thirds up · descending', chip: 'Thirds up · desc', shape: '5 7 · 4 6 · 3 5 …', slope: -0.5,
                indices: (i, n) => (i + 2 < n ? pairs(i, 0, -1, 2) : []) },
  '3down-asc': { name: 'Thirds down · ascending', chip: 'Thirds down · asc', shape: '3 1 · 4 2 · 5 3 …', slope: 0.5,
                 indices: (i, n) => (i >= 2 ? pairs(i, n - 1, 1, -2) : []) },
  '3down-desc': { name: 'Thirds down · descending', chip: 'Thirds down · desc', shape: '7 5 · 6 4 · 5 3 …', slope: -0.5,
                  indices: i => pairs(i, 2, -1, -2) },
};
export const PATTERN_ORDER = ['up', 'down', '3up-asc', '3up-desc', '3down-asc', '3down-desc'];

// Arpeggio mastery (F1, boss 2026-09-27), over the chord tones (the arp-*
// "scales"): up through the four inversions — 1357 3571 5713 7135 — then
// down from the root two octaves up (the 1 above the next 7, boss's
// correction) — 1753 7531 5317 3175 1753 7531 — ending on the root: 40
// notes, two octaves. From the root only (`rootOnly`).
PATTERNS.arp = {
  name: 'Arpeggio mastery', chip: 'Arpeggio mastery', shape: '1357 3571 5713 7135 · 1753 7531 5317 3175 1753 7531',
  slope: 0, rootOnly: true,
  indices: (i, n) => {
    if (i + 8 >= n) return [];
    const out = [];
    for (let g = 0; g < 4; g++) for (let k = 0; k < 4; k++) out.push(i + g + k);
    for (let g = 8; g >= 3; g--) for (let k = 0; k < 4; k++) out.push(i + g - k);
    return out;
  },
};

// Which patterns each scale's ladder has. Pentatonic gets thirds later.
const LADDER = { major: PATTERN_ORDER, penta: ['up', 'down'],
                 'arp-maj7': ['arp'], 'arp-7': ['arp'], 'arp-m7': ['arp'], 'arp-m7b5': ['arp'] };
// The games that run on the scales engine, and their scales in ladder order.
export const GAME_SCALES = { scales: ['major', 'penta'], arpeggios: ['arp-maj7', 'arp-7', 'arp-m7', 'arp-m7b5'] };
export const SCALE_ORDER = GAME_SCALES.scales;
export const LANE_GAMES = Object.keys(GAME_SCALES);
const ALL_KEYS = [...Array(12).keys()];

const keysLabel = keys => keys.length === 12 ? 'all 12 keys' : keys.map(k => NOTES[k]).join(' ');

// Ids are stable (stored in events and settings); the "S1…" numbers are
// display only and follow ladder order. ('major-up' / 'major-down' were
// also the first day's pre-ladder ids — same meaning, so their runs count.)
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
// pick saved before patterns existed runs linear up.
export function scaleExercise(id, custom, game = 'scales') {
  if (id === 'custom') {
    const pattern = PATTERNS[custom.pattern] ? custom.pattern : 'up';
    return { id, num: '', title: SCALES[custom.scale].name, name: PATTERNS[pattern].name, scale: custom.scale,
             pattern, keys: custom.keys, keysLabel: custom.keys.length ? keysLabel(custom.keys) : 'no key chosen' };
  }
  return SCALE_LEVELS.find(l => l.id === id && l.game === game) || levelsOf(game)[0];
}

// The pattern of a run event. Runs before patterns (event v2) carry only
// `direction`, which was linear up or down.
export const runPattern = e => e.pattern || e.direction;

// --- Weak keys (the D3 idea, per scale × pattern × key) ---
// One run scores 0–1: the share of its notes that were hit. A run that was
// stopped early counts its unplayed notes as not hit, so restarts weigh in
// naturally. `recent` is an exponential moving average per key, α = 0.3:
// runs are far fewer than degree answers, so each one moves the needle
// more. Tickets follow weakspots.js: never zero, so clean keys still come
// round; +0.8 for a key with under 3 runs; untried = 2.2.
const ALPHA = 0.3;
const FEW_RUNS = 3;
const UNTRIED = 2.2;

export function runScore(e) {
  if (!e.expected || !e.expected.length) return null;
  return e.expected.filter(x => x[3] === 'hit').length / e.expected.length;
}

const statKey = (scale, pattern, key) => `${scale}|${pattern}|${key}`;

// Running stats per scale × pattern × key. Feed events oldest first.
// `initial` = saved stats ([[key, {n, recent}], …]) from the cached summary.
export function createKeyModel(initial = []) {
  const stats = new Map(initial.map(([k, v]) => [k, { ...v }]));
  return {
    stats,
    add(e) {
      if (!LANE_GAMES.includes(e.game) || e.falseStart) return;   // a false start says nothing about the key
      const score = runScore(e);
      if (score === null) return;
      const k = statKey(e.scale, runPattern(e), e.keyWritten);
      const st = stats.get(k);
      if (!st) stats.set(k, { n: 1, recent: score });
      else { st.n++; st.recent += ALPHA * (score - st.recent); }
    },
    tickets(scale, pattern, key) {
      const st = stats.get(statKey(scale, pattern, key));
      if (!st) return UNTRIED;
      return 0.6 + 4 * (1 - st.recent) + (st.n < FEW_RUNS ? 0.8 : 0);
    },
  };
}

// Draw the next key from `keys`: by tickets when `pick` is 'weak', evenly
// otherwise; never the same key twice in a row when there's a choice.
export function pickScaleKey(model, { scale, pattern, keys, pick, prev }, rand = Math.random) {
  const pool = keys.length > 1 ? keys.filter(k => k !== prev) : keys;
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
