// The Guide tones game's panel (G2): the Play settings (cadence card,
// target pattern, key path, backing, note names, tempo), the cadence
// editor on Levels, and the key × target stats. The runner is guides.js,
// the cadences and patterns guidelib.js.

import { $, $$, load, save, st, hooks } from './app.js';
import { NOTES, QUALITY_TEXT } from './music.js';
import { mountTempo } from './tempo.js';
import { allEvents } from './events.js';
import { initAudio, loadTrio } from './audio.js';
import { colour } from './rangemap.js';
import { EXERCISES, PRACTICE_EXERCISES } from './celllib.js';
import { startGuides, stopGuides, guideNote, guidesRunning, guidesPaused, pauseGuides, resumeGuides, restartGuides } from './guides.js';
import { CADENCES, NUMERALS, QUALITIES, BARS, PLACES, PATTERNS, PATTERN_ORDER, numeral, cadenceText,
         loadCustom, saveCustom, cadenceId, setCadenceId, currentCadence, guideGrid, sameCadence } from './guidelib.js';

const PAT_KEY = 'woodshed.guidePattern';
const PATH_KEY = 'woodshed.guidePath';      // key path: cycle of 4ths or a practice path
const BACK_KEY = 'woodshed.guideBacking';
const NAMES_KEY = 'woodshed.guideNames';    // 'on' | 'off': note names under the targets
const BPM_KEY = 'woodshed.guideBpm';        // quarter notes (4/4)

const PATHS = ['cycle4', ...PRACTICE_EXERCISES];
let pattern = PATTERNS[load(PAT_KEY)] ? load(PAT_KEY) : '7to3';
let path = PATHS.includes(load(PATH_KEY)) ? load(PATH_KEY) : 'cycle4';
let backing = ['band', 'root', 'click'].includes(load(BACK_KEY)) ? load(BACK_KEY) : 'band';
let names = load(NAMES_KEY) !== 'off';
const tempo = mountTempo($('#guideTempo'), { min: 40, value: Math.max(40, Number(load(BPM_KEY)) || 100),
                                             onChange: v => save(BPM_KEY, String(v)) });

// --- Play pane ---
function render() {
  const cad = currentCadence();
  $('#guideCardName').textContent = cad.name;
  $('#guideCardChords').textContent = cadenceText(cad);
  $('#guidePatterns').innerHTML = PATTERN_ORDER.map(p =>
    `<button data-guide-pat="${p}" class="${p === pattern ? 'active' : ''}">${PATTERNS[p].name}</button>`).join('');
  $('#guidePaths').innerHTML = PATHS.map(p =>
    `<button data-guide-path="${p}" class="${p === path ? 'active' : ''}">${EXERCISES[p].name}</button>`).join('');
  $$('[data-guide-back]').forEach(b => b.classList.toggle('active', b.dataset.guideBack === backing));
  $$('[data-guide-names]').forEach(b => b.classList.toggle('active', (b.dataset.guideNames === 'on') === names));
  if (guidesRunning()) return;
  // Idle stage: the cadence and the targets, what Start does.
  $('#guideShow').innerHTML = `<b>${cad.name}</b><span>${cadenceText(cad)}</span>`;
  $('#guideTitle').textContent = `${EXERCISES[path].name} · ${PATTERNS[pattern].name}`;
  const msg = $('#guideMsg');
  msg.hidden = false;
  msg.innerHTML = `<b>${PATTERNS[pattern].name}</b> — land each guide tone where it's marked; play anything in between. ` +
    'A 7 resolving to a 3 goes down by step.<br><small>Start: a bar of clicks, then one round of all 12 keys.</small>';
}
const canStart = () => pattern !== 'custom' || loadCustom().targets.some(t => t.deg);

$('#guideCard').addEventListener('click', () => hooks.showTab('levels'));
$('#guidePatterns').addEventListener('click', e => {
  const b = e.target.closest('[data-guide-pat]');
  if (b) { pattern = b.dataset.guidePat; save(PAT_KEY, pattern); hooks.showSettings(); }
});
$('#guidePaths').addEventListener('click', e => {
  const b = e.target.closest('[data-guide-path]');
  if (b) { path = b.dataset.guidePath; save(PATH_KEY, path); hooks.showSettings(); }
});
$$('[data-guide-back]').forEach(b => b.addEventListener('click', () => { backing = b.dataset.guideBack; save(BACK_KEY, backing); hooks.showSettings(); }));
$$('[data-guide-names]').forEach(b => b.addEventListener('click', () => { names = b.dataset.guideNames === 'on'; save(NAMES_KEY, names ? 'on' : 'off'); hooks.showSettings(); }));

async function start() {
  // The trio's samples, once; without them the round goes on with no band.
  initAudio();
  await loadTrio().catch(() => {});
  const cad = currentCadence();
  startGuides({ cadence: { name: cad.name, chords: cad.chords }, pattern, custom: loadCustom().targets, exercise: path,
                bpm: tempo.get(), backing, names, calib: st.calib, calibOffset: st.calibOffset, latency: st.latency },
              () => { hooks.showRunning(false); hooks.showSettings(); hooks.runSync(); });
}

// --- Levels: the presets and the editor for your own cadence ---
// A card picks what Play plays. The editor always shows YOUR cadence
// (stored and synced as a setting); editing it picks it, and "start from"
// copies a preset into it — browsing the presets never touches it.
function showLevels() {
  const id = cadenceId();
  const card = (cid, name, text) => `<button class="guidecad${cid === id ? ' active' : ''}" data-guide-cad="${cid}">` +
    `<b>${name}</b><span>${text}</span></button>`;
  const custom = loadCustom();
  $('#guideCads').innerHTML = CADENCES.map(c => card(c.id, c.name, cadenceText(c))).join('') +
    card('custom', 'Your cadence', cadenceText(custom));
  // The editor: your cadence, a row per chord — root, quality, bars, and
  // its target for the "Your own" pattern.
  const seg = (attr, i, vals, cur, label) => `<div class="seg">${vals.map(v =>
    `<button data-${attr}="${i}:${v}" class="${String(v) === String(cur) ? 'active' : ''}">${label(v)}</button>`).join('')}</div>`;
  $('#guideEdit').innerHTML = `<div class="guidefrom"><span class="label">Your cadence · start from</span>` +
    CADENCES.map(c => `<button data-guide-copy="${c.id}">${c.name}</button>`).join('') + '</div>' +
    custom.chords.map((c, i) => {
    const tg = custom.targets[i] || { deg: null, place: 'one' };
    return `<div class="guiderow"><b class="num">${numeral(c)}</b>` +
      `<select data-guide-root="${i}" aria-label="Root">${NUMERALS.map((n, d) => `<option value="${d}"${d === c.deg ? ' selected' : ''}>${n}</option>`).join('')}</select>` +
      seg('guide-q', i, QUALITIES, c.q, q => QUALITY_TEXT[q]) +
      seg('guide-bars', i, BARS, c.bars, b => `${b} bar${b > 1 ? 's' : ''}`) +
      seg('guide-tdeg', i, ['3', '7', ''], tg.deg || '', d => d || '–') +
      seg('guide-tplace', i, Object.keys(PLACES), tg.place, p => PLACES[p].name) +
      `<button data-guide-del="${i}" aria-label="Remove chord"${custom.chords.length < 2 ? ' disabled' : ''}>✕</button></div>`;
  }).join('') + `<button id="guideAdd"${custom.chords.length >= 8 ? ' disabled' : ''}>+ chord</button>`;
}
// Edit your cadence; switching to it.
function edit(fn) {
  const custom = loadCustom();
  fn(custom);
  custom.targets = custom.chords.map((_, i) => custom.targets[i] || { deg: '3', place: 'one' });
  saveCustom(custom);
  setCadenceId('custom');
  hooks.showSettings();
  showLevels();
}
$('#guideCads').addEventListener('click', e => {
  const b = e.target.closest('[data-guide-cad]');
  if (!b) return;
  setCadenceId(b.dataset.guideCad);
  hooks.showSettings();
  showLevels();
});
$('#guideEdit').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'guideAdd') return edit(c => { c.chords.push({ deg: 0, q: 'maj7', bars: 1 }); });
  if (b.dataset.guideCopy) {
    const p = CADENCES.find(x => x.id === b.dataset.guideCopy);
    return edit(c => { c.chords = p.chords.map(x => ({ ...x })); c.targets = []; });
  }
  if (b.dataset.guideDel) return edit(c => { const i = Number(b.dataset.guideDel); c.chords.splice(i, 1); c.targets.splice(i, 1); });
  for (const [attr, apply] of [['guideQ', (c, i, v) => { c.chords[i].q = v; }],
                               ['guideBars', (c, i, v) => { c.chords[i].bars = Number(v); }],
                               ['guideTdeg', (c, i, v) => { c.targets[i] = { ...(c.targets[i] || { place: 'one' }), deg: v || null }; }],
                               ['guideTplace', (c, i, v) => { c.targets[i] = { ...(c.targets[i] || { deg: '3' }), place: v }; }]]) {
    if (b.dataset[attr]) {
      const [i, v] = b.dataset[attr].split(':');
      return edit(c => apply(c, Number(i), v));
    }
  }
});
$('#guideEdit').addEventListener('change', e => {
  const sel = e.target.closest('[data-guide-root]');
  if (sel) edit(c => { c.chords[Number(sel.dataset.guideRoot)].deg = Number(sel.value); });
});
$('#guidePlayLevel').addEventListener('click', () => hooks.showTab('play'));

// --- Stats: key × each chord's 3 and 7, for the cadence picked ---
let statEvents = [];
let statSelected = null;
async function showStats() {
  statEvents = (await allEvents()).filter(e => e.game === 'guides' && e.targets);
  const opts = [...CADENCES.map(c => [c.id, c.name]), ['custom', 'Your cadence']];
  const pick = opts.some(([v]) => v === $('#guideStatSel').value) ? $('#guideStatSel').value : cadenceId();
  $('#guideStatSel').innerHTML = opts.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
  $('#guideStatSel').value = pick;
  drawStats();
}
function drawStats() {
  const id = $('#guideStatSel').value;
  const cad = id === 'custom' ? { chords: loadCustom().chords } : CADENCES.find(c => c.id === id);
  const grid = guideGrid(statEvents, cad);
  const cols = cad.chords.flatMap((c, i) => ['3', '7'].map(d => ({ i, d, head: `${numeral(c)}·${d}` })));
  let h = `<div class="rm-grid" style="grid-template-columns: 28px repeat(${cols.length}, 1fr)"><div></div>` +
    cols.map(c => `<div class="rm-head">${c.head}</div>`).join('');
  for (const [rk, label] of [['all', 'All'], ...NOTES.map((n, k) => [String(k), n])]) {
    h += `<div class="rm-row${rk === 'all' ? ' all' : ''}">${label}</div>`;
    for (const c of cols) {
      const key = `${rk}|${c.i}|${c.d}`;
      const list = grid.get(key);
      const score = list?.length ? list.filter(Boolean).length / list.length : null;
      h += `<div class="rm-cell${score === null ? ' empty' : ''}${key === statSelected ? ' selected' : ''}" data-cell="${key}"` +
           `${score === null ? '' : ` style="background:${colour(0.4 + 0.6 * score)}"`}></div>`;
    }
  }
  h += '</div>';
  let cap = 'Tap a square: which key, which chord and guide tone, how often landed.';
  if (statSelected) {
    const [rk, i, d] = statSelected.split('|');
    const list = grid.get(statSelected);
    const where = `${rk === 'all' ? 'All keys' : `In ${NOTES[Number(rk)]}`} · the ${d} of ${numeral(cad.chords[Number(i)])}`;
    cap = list?.length ? `${where} — ${list.filter(Boolean).length} of ${list.length} landed` : `${where} — not played yet.`;
  }
  $('#guideGrid').innerHTML = h + `<div class="rm-cap">${cap}</div>`;
  // Pane figures: this cadence's rounds, the last 20.
  const rounds = statEvents.filter(e => sameCadence(e.cadence, cad));
  const last = rounds.slice(-20).flatMap(e => e.targets);
  const dayStart = new Date().setHours(0, 0, 0, 0);
  $('#gstRounds').textContent = rounds.length;
  $('#gstToday').textContent = rounds.filter(e => e.t >= dayStart).length;
  $('#gstHit').textContent = last.length ? `${Math.round(100 * last.filter(x => x[5] === 'hit').length / last.length)}%` : '–';
  $('#gstOff').textContent = last.length ? String(last.filter(x => x[5] === 'wrong').length) : '–';
}
$('#guideGrid').addEventListener('click', e => {
  const cell = e.target.closest('[data-cell]');
  const key = cell ? cell.dataset.cell : null;
  statSelected = key && key !== statSelected ? key : null;
  drawStats();
});
$('#guideStatSel').addEventListener('change', () => { statSelected = null; drawStats(); });

function onSync(res) {
  if (res.added && !$('#view-guide-stats').hidden) showStats();
}

export const guidesUI = {
  render, canStart, start, showLevels, showStats, onSync,
  running: guidesRunning, note: guideNote, stop: stopGuides,
  paused: guidesPaused, pause: pauseGuides, resume: resumeGuides, restart: restartGuides,
};
