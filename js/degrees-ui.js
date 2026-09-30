// The Degrees game's panel: the Play settings (question count, the
// exercise card), the level ladder and custom builder (D6), the heatmap
// stats (D4), and the round's start and end. The drill itself is drill.js.

import { $, $$, load, save, loadJSON, st, hooks } from './app.js';
import { QUALITY_ORDER, QUALITY_TEXT, QUALITY_NAME, DEGREES, degreeLabel } from './music.js';
import { startRound, stopRound, drillNote, isRunning } from './drill.js';
import { allEvents } from './events.js';
import { LEVELS, UNIT_TITLES, exercise as resolveExercise, customCells, matchLevel, setsOf } from './levels.js';
import { getSummary } from './summary.js';
import { renderHeatmap, isMixed } from './heatmap.js';
import { eventScore } from './weakspots.js';
import { createRating, paneFigures } from './rating.js';

const LENGTH_KEY = 'woodshed.length';
const EXERCISE_KEY = 'woodshed.exercise';
const CUSTOM_KEY = 'woodshed.custom';

// Question-count choices; 0 = endless (until Stop).
const LENGTHS = [10, 20, 50, 100, 0];

let length = LENGTHS.includes(Number(load(LENGTH_KEY) ?? 20)) ? Number(load(LENGTH_KEY) ?? 20) : 20;
// Default to the first rung of the ladder, not the everything-mix.
let exerciseId = load(EXERCISE_KEY) || LEVELS[0].id;
let custom = loadJSON(CUSTOM_KEY, { qualities: ['maj7'], degrees: ['3', '7'] });

// "△: 3 7 · 7: 3 7": which degrees on which qualities (the colon keeps a
// dominant "7" apart from the degree 7).
function describe(cells) {
  const byQ = new Map();
  for (const { quality, degree } of cells) byQ.set(quality, [...(byQ.get(quality) || []), degreeLabel(degree)]);
  return [...byQ].map(([q, ds]) => `${QUALITY_TEXT[q]}: ${ds.join(' ')}`).join(' · ') || 'nothing selected';
}
const currentExercise = () => resolveExercise(exerciseId, custom, describe);

// --- Play pane ---
// The exercise everywhere as "L13 · Major" + its degrees in brass, so
// what's being practised is as clear as the chord quality.
function render() {
  $$('[data-length]').forEach(b => b.classList.toggle('active', Number(b.dataset.length) === length));
  const ex = currentExercise();
  const title = ex.num ? `${ex.num} · ${ex.title}` : ex.title;
  for (const [sel, t] of [['#exerciseLabel', title], ['#exerciseName', title], ['#idleName', title]]) $(sel).textContent = t;
  for (const sel of ['#exerciseDegrees', '#stageDegrees', '#idleWhat']) $(sel).textContent = ex.degrees;
}
// An empty custom pick can't be played.
const canStart = () => currentExercise().cells.length > 0;

$$('[data-length]').forEach(b => b.addEventListener('click', () => {
  length = Number(b.dataset.length); save(LENGTH_KEY, String(length)); hooks.showSettings();
}));
$('#exerciseBtn').addEventListener('click', () => hooks.showTab('levels'));

function start() {
  startRound(st.calib, onRoundEnd, { length, pick: st.pick, exercise: currentExercise() });
}

function onRoundEnd(result) {
  hooks.showRunning(false);
  hooks.runSync();   // push this round's answers (A9); quiet if not set up
  hooks.showSettings();
  $('#chord').textContent = '';
  $('#degree').textContent = '';
  $('#progress').textContent = '';
  $('#degree').classList.remove('pulse', 'miss', 'long');
  $('#feedback').className = '';
  if (!result) {
    $('#feedback').textContent = '';
    return;
  }
  const { total, firstTry, median, bestStreak } = result;
  const line = `${firstTry} / ${total} right first time`;
  $('#feedback').textContent = median === null
    ? line : `${line} · median ${(median / 1000).toFixed(2)} s`;
  // The final score stays up (drill.js); the combo line shows the best streak.
  $('#combo').textContent = bestStreak ? `best combo ${bestStreak}` : '';
}

// --- Levels (D6): the ladder on the stage, custom builder in the pane ---
function selectExercise(id) {
  exerciseId = id;
  save(EXERCISE_KEY, id);
  hooks.showSettings();
  showLevels();
}

// The ladder: one block per unit, one row per quality, the levels as flat
// pills along it (degrees + stars), numbered in ladder order.
async function showLevels() {
  const { stars } = await getSummary();   // cached (A8): no history read
  const starText = n => '★'.repeat(n) + '☆'.repeat(3 - n);
  const pill = l => `<button class="lvl${l.id === exerciseId ? ' active' : ''}" data-level="${l.id}">` +
    `<b>${l.num}</b><span>${l.degrees}</span><i>${starText(stars[l.id] || 0)}</i></button>`;
  let h = '';
  for (const [unit, title] of UNIT_TITLES) {
    h += `<div class="tier">${title}</div>`;
    const levels = LEVELS.filter(l => l.unit === unit);
    for (const q of [...QUALITY_ORDER, 'all']) {
      const row = levels.filter(l => l.quality === q);
      if (!row.length) continue;
      const label = q === 'all' ? (unit === 'everything' ? '' : 'All') : `${QUALITY_NAME[q]} <small>${QUALITY_TEXT[q]}</small>`;
      h += `<div class="lrow"><span class="lq">${label}</span>${row.map(pill).join('')}</div>`;
    }
  }
  h += `<div class="tier">Your own</div><div class="lrow"><span class="lq">Custom</span>` +
       `<button class="lvl${exerciseId === 'custom' ? ' active' : ''}" data-level="custom">` +
       `<span>${describe(customCells(custom.qualities, custom.degrees))}</span></button></div>`;
  $('#ladder').innerHTML = h;
  $$('#ladder [data-level]').forEach(b => b.addEventListener('click', () => selectExercise(b.dataset.level)));

  const ex = currentExercise();
  $('#levelInfo').innerHTML = '<b></b><span class="degs"></span>';
  $('#levelInfo b').textContent = ex.num ? `${ex.num} · ${ex.title}` : ex.title;
  $('#levelInfo .degs').textContent = ex.degrees;
  showCustom();
}

// The builder starts from the current exercise. Any change makes a custom
// pick — unless it matches an existing level, which is then selected.
function showCustom() {
  // A custom pick keeps the chips as tapped: derived from its cells, an
  // empty pick would forget the chosen qualities.
  const sets = exerciseId === 'custom' ? custom : setsOf(currentExercise().cells);
  const chip = (attr, value, label, on) =>
    `<button data-${attr}="${value}" class="${on ? 'active' : ''}">${label}</button>`;
  $('#customQualities').innerHTML = QUALITY_ORDER
    .map(q => chip('cq', q, QUALITY_TEXT[q], sets.qualities.includes(q))).join('');
  $('#customDegrees').innerHTML = DEGREES
    .map(d => chip('cd', d, degreeLabel(d), sets.degrees.includes(d))).join('');
  const n = currentExercise().cells.length;
  $('#customHint').textContent = n ? `${n} combination${n === 1 ? '' : 's'} × 12 roots` : 'Pick at least one quality and one degree that fits it.';
  const toggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const change = next => {
    const level = matchLevel(customCells(next.qualities, next.degrees));
    if (!level) { custom = next; save(CUSTOM_KEY, JSON.stringify(custom)); }
    selectExercise(level ? level.id : 'custom');
  };
  $$('#customQualities [data-cq]').forEach(b => b.addEventListener('click', () =>
    change({ ...sets, qualities: toggle(sets.qualities, b.dataset.cq) })));
  $$('#customDegrees [data-cd]').forEach(b => b.addEventListener('click', () =>
    change({ ...sets, degrees: toggle(sets.degrees, b.dataset.cd) })));
}
$('#playLevel').addEventListener('click', () => hooks.showTab('play'));

// --- Stats (D4) ---
// Tapping a cell selects it (root row narrows to that quality × degree);
// tapping it again, or anywhere else on the matrix, clears it.
let heatSelected = null;
let heatEvents = [];
// Mixed (asked among several degrees — the real skill) or Alone; the
// pane's Now and Best day follow it.
let heatView = 'mixed';
function drawHeatmap() {
  renderHeatmap($('#heatmap'), heatEvents, heatSelected, heatView);
  $$('[data-hm]').forEach(b => b.classList.toggle('active', b.dataset.hm === heatView));
  const level = createRating();
  for (const e of heatEvents) if (e.notes?.length && isMixed(e) === (heatView === 'mixed')) level.add('level', e.t, eventScore(e) ?? 0);
  const fig = paneFigures(level.get('level'));
  $('#statNow').textContent = fig.now;
  $('#statBestDay').textContent = fig.best;
}
$$('[data-hm]').forEach(b => b.addEventListener('click', () => { heatView = b.dataset.hm; heatSelected = null; drawHeatmap(); }));
$('#heatmap').addEventListener('click', e => {
  if (!e.target.closest('.hm-grid')) return;          // root row: no effect
  const cell = e.target.closest('[data-cell]');
  const key = cell ? cell.dataset.cell : null;
  heatSelected = key && key !== heatSelected ? key : null;
  drawHeatmap();
});

async function showStats() {
  const events = (await allEvents()).filter(e => e.game === 'degrees');
  heatEvents = events;
  drawHeatmap();
  const dayStart = new Date().setHours(0, 0, 0, 0);
  // The median of the last 100 right answers (Now and Best day: drawHeatmap).
  const times = events.slice(-100).filter(e => e.ok).map(e => e.notes[0][1]).sort((a, b) => a - b);
  $('#statAnswers').textContent = events.length;
  $('#statToday').textContent = events.filter(e => e.t >= dayStart).length;
  $('#statMedian').textContent = times.length ? `${(times[times.length >> 1] / 1000).toFixed(2)} s` : '–';
}

// New answers from sync: redraw the stats if they're up.
function onSync(res) {
  if (res.added && !$('#view-stats').hidden) showStats();
}

export const degreesUI = {
  render, canStart, start, showLevels, showStats, onSync,
  running: isRunning, note: drillNote, stop: stopRound,
};
