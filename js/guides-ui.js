// The Guide tones game's panel (G2): the Play settings (exercise card, key
// path, backing, note names, tempo), the exercise library and editor on
// Levels, and the key × target stats. The runner is guides.js, the
// exercises and library guidelib.js.
//
// Levels (boss, 2026-09-28: "choose more freely where things are and what
// tones it is … savable/editable like the cells"): the pane lists the
// exercises — the built-in ones and yours — with Save / New and a name;
// the stage is the editor for the DRAFT: the cadence (per chord: root as a
// degree of the key, quality, bars) and, under each chord, its timeline —
// every beat of every bar plus "late". Tap a slot, then its tones below
// (several = one drawn at random in each key); fills set every chord at
// once. The draft is written to the library only on Save; Play plays the
// selected, saved exercise.

import { $, $$, load, save, st, hooks } from './app.js';
import { NOTES, QUALITY_TEXT, degreeLabel } from './music.js';
import { mountTempo } from './tempo.js';
import { allEvents } from './events.js';
import { initAudio, loadTrio } from './audio.js';
import { squareStyle, ratingText, paneFigures } from './rating.js';
import { esc } from './cells.js';
import { EXERCISES, PRACTICE_EXERCISES } from './celllib.js';
import { startGuides, stopGuides, guideNote, guidesRunning, guidesPaused, pauseGuides, resumeGuides, restartGuides } from './guides.js';
import { NUMERALS, QUALITIES, BARS, TONES, ALTS, BAR, LATE, MAX_CHORDS, FILLS, FILL_ORDER, PRESETS, numeral, cadenceText, slotName,
         fill, isPreset, allGuides, findGuide, selectedId, select, currentGuide, saveGuide, deleteGuide, defaultName,
         guideGrid, slotKey } from './guidelib.js';

const PATH_KEY = 'woodshed.guidePath';      // key path: cycle of 4ths or a practice path
const BACK_KEY = 'woodshed.guideBacking';
const NAMES_KEY = 'woodshed.guideNames';    // 'on' | 'off': note names under the targets
const BPM_KEY = 'woodshed.guideBpm';        // quarter notes (4/4)

const PATHS = ['cycle4', ...PRACTICE_EXERCISES];
let path = PATHS.includes(load(PATH_KEY)) ? load(PATH_KEY) : 'cycle4';
let backing = ['band', 'root', 'click'].includes(load(BACK_KEY)) ? load(BACK_KEY) : 'band';
let names = load(NAMES_KEY) !== 'off';
const tempo = mountTempo($('#guideTempo'), { min: 40, value: Math.max(40, Number(load(BPM_KEY)) || 100),
                                             onChange: v => save(BPM_KEY, String(v)) });

// A target's tones as shown: "3/♭9".
const tonesText = degs => degs.map(degreeLabel).join('/');
// What the targets say, in short: "3 · 7 late" per chord.
const targetText = ex => ex.chords.map((c, i) => ex.targets.filter(t => t.chord === i)
  .map(t => `${tonesText(t.degs)}${t.at === LATE ? ' late' : t.at ? ` @${slotName(c, t.at).replace('beat ', '')}` : ''}`).join(' ') || '–').join(' · ');

// --- Play pane ---
function render() {
  const ex = currentGuide();
  $('#guideCardName').textContent = ex.name;
  $('#guideCardChords').textContent = cadenceText(ex);
  $('#guidePaths').innerHTML = PATHS.map(p =>
    `<button data-guide-path="${p}" class="${p === path ? 'active' : ''}">${EXERCISES[p].name}</button>`).join('');
  $$('[data-guide-back]').forEach(b => b.classList.toggle('active', b.dataset.guideBack === backing));
  $$('[data-guide-names]').forEach(b => b.classList.toggle('active', (b.dataset.guideNames === 'on') === names));
  if (guidesRunning()) return;
  // Idle stage: the exercise, its targets, what Start does.
  $('#guideShow').innerHTML = `<b>${esc(ex.name)}</b><span>${cadenceText(ex)}</span>`;
  $('#guideTitle').textContent = EXERCISES[path].name;
  const msg = $('#guideMsg');
  msg.hidden = false;
  msg.innerHTML = `Targets: <b>${targetText(ex)}</b><br>Land each where it's marked; play anything in between. ` +
    'A step along the line stays a step.<br><small>Start: a bar of clicks, then one round of all 12 keys.</small>';
}
const canStart = () => currentGuide().targets.length > 0;

$('#guideCard').addEventListener('click', () => hooks.showTab('levels'));
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
  startGuides({ guide: currentGuide(), exercise: path, bpm: tempo.get(), backing, names,
                calib: st.calib, calibOffset: st.calibOffset, latency: st.latency },
              () => { hooks.showRunning(false); hooks.showSettings(); hooks.runSync(); });
}

// --- Levels: the library (pane) and the editor (stage) ---
let draft = null;             // {id, name, chords, targets} — being edited
let slot = null;              // the slot picked in the editor {chord, at}
let dirty = false;            // the draft differs from what was loaded
const copy = ex => ({ id: ex.id, name: ex.name, chords: ex.chords.map(c => ({ ...c })), targets: ex.targets.map(t => ({ ...t, degs: [...t.degs] })) });
function editDraft(ex) { draft = copy(ex); slot = null; dirty = false; }

function showLevels() {
  if (!draft) editDraft(currentGuide());
  const sel = selectedId();
  $('#guideLib').innerHTML = allGuides().map(g => `<div class="guidecard${g.id === sel ? ' active' : ''}${g.id === draft.id ? ' editing' : ''}" data-guide-sel="${g.id}">` +
    `<b>${esc(g.name)}</b><span>${cadenceText(g)}</span>` +
    (isPreset(g) ? '<i>built in</i>' : `<button data-guide-del="${g.id}" aria-label="Delete">✕</button>`) + '</div>').join('');
  showEditor();
}

function showEditor() {
  const seg = (attr, i, vals, cur, label) => `<div class="seg">${vals.map(v =>
    `<button data-${attr}="${i}:${v}" class="${String(v) === String(cur) ? 'active' : ''}">${label(v)}</button>`).join('')}</div>`;
  const tg = (i, at) => draft.targets.find(t => t.chord === i && t.at === at);
  let h = `<div class="guidefill"><span class="label">Fill</span>${FILL_ORDER.map(f => `<button data-guide-fill="${f}">${FILLS[f].name}</button>`).join('')}</div>`;
  draft.chords.forEach((c, i) => {
    h += `<div class="guiderow"><b class="num">${numeral(c)}</b>` +
      `<select data-guide-root="${i}" aria-label="Root">${NUMERALS.map((n, d) => `<option value="${d}"${d === c.deg ? ' selected' : ''}>${n}</option>`).join('')}</select>` +
      seg('guide-q', i, QUALITIES, c.q, q => QUALITY_TEXT[q]) +
      seg('guide-bars', i, BARS, c.bars, b => `${b} bar${b > 1 ? 's' : ''}`) +
      seg('guide-alt', i, ['', ...ALTS], c.alt || '', a => (a ? degreeLabel(a) : 'plain')) +
      `<button data-guide-rm="${i}" aria-label="Remove chord"${draft.chords.length < 2 ? ' disabled' : ''}>✕</button></div>`;
    // The chord's timeline: a slot per beat, bars grouped; then "late".
    h += '<div class="guidetl">';
    for (let at = 0; at < c.bars * BAR; at++) {
      const t = tg(i, at);
      const on = slot && slot.chord === i && slot.at === at;
      h += `<button class="gslot${at % BAR === 0 ? ' bar' : ''}${t ? ' set' : ''}${on ? ' on' : ''}" data-guide-slot="${i}:${at}" ` +
           `aria-label="${slotName(c, at)}">${t ? tonesText(t.degs) : at % BAR + 1}</button>`;
    }
    const t = tg(i, LATE);
    const on = slot && slot.chord === i && slot.at === LATE;
    h += `<button class="gslot late${t ? ' set' : ''}${on ? ' on' : ''}" data-guide-slot="${i}:${LATE}">${t ? `${tonesText(t.degs)} late` : 'late'}</button></div>`;
  });
  h += `<button id="guideAdd"${draft.chords.length >= MAX_CHORDS ? ' disabled' : ''}>+ chord</button>`;
  // The tones for the picked slot.
  if (slot) {
    const c = draft.chords[slot.chord];
    const t = tg(slot.chord, slot.at);
    h += `<div class="guidetones"><span>${numeral(c)} · ${slotName(c, slot.at)}:</span>` +
      TONES.map(d => `<button data-guide-tone="${d}" class="${t?.degs.includes(d) ? 'active' : ''}">${degreeLabel(d)}</button>`).join('') +
      `<small>${t && t.degs.length > 1 ? 'one of these, drawn in each key' : 'several = one drawn at random in each key'}</small></div>`;
  } else {
    h += '<div class="guidetones"><small>Tap a slot to set its tones.</small></div>';
  }
  $('#guideEdit').innerHTML = h;
  $('#guideName').value = draft.name;
  $('#guideName').placeholder = defaultName(draft);
  const n = draft.targets.length;
  $('#guideHint').textContent = !n ? 'No targets yet — tap a slot, or use a fill.'
    : isPreset(draft) ? `Built in — Save keeps your changes as your own exercise.${dirty ? ' (changed)' : ''}`
    : `${draft.id ? 'Editing' : 'New'}${dirty ? ' · unsaved changes' : ''} · ${n} target${n === 1 ? '' : 's'} a key.`;
  $('#guideSave').disabled = !n;
}

function edit(fn) {
  fn(draft);
  // Targets past a chord that got shorter, or on a removed chord, go.
  draft.targets = draft.targets.filter(t => t.chord < draft.chords.length &&
    (t.at === LATE || t.at < draft.chords[t.chord].bars * BAR));
  dirty = true;
  showEditor();
}
$('#guideEdit').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (b.id === 'guideAdd') return edit(x => { x.chords.push({ deg: 0, q: 'maj7', bars: 1 }); });
  if (d.guideFill) return edit(x => { x.targets = fill(x.chords, d.guideFill); });
  if (d.guideRm) {
    const i = Number(d.guideRm);
    slot = null;
    return edit(x => {
      x.chords.splice(i, 1);
      x.targets = x.targets.filter(t => t.chord !== i).map(t => ({ ...t, chord: t.chord > i ? t.chord - 1 : t.chord }));
    });
  }
  if (d.guideSlot) {
    const [i, at] = d.guideSlot.split(':');
    const pick = { chord: Number(i), at: at === LATE ? LATE : Number(at) };
    slot = slot && slot.chord === pick.chord && slot.at === pick.at ? null : pick;   // tap again: unpick
    return showEditor();
  }
  if (d.guideTone && slot) {
    return edit(x => {
      let t = x.targets.find(t2 => t2.chord === slot.chord && t2.at === slot.at);
      if (!t) x.targets.push(t = { chord: slot.chord, at: slot.at, degs: [] });
      t.degs = t.degs.includes(d.guideTone) ? t.degs.filter(g => g !== d.guideTone) : TONES.filter(g => g === d.guideTone || t.degs.includes(g));
      if (!t.degs.length) x.targets = x.targets.filter(t2 => t2 !== t);
    });
  }
  for (const [attr, apply] of [['guideQ', (x, i, v) => { x.chords[i].q = v; }],
                               ['guideAlt', (x, i, v) => { if (v) x.chords[i].alt = v; else delete x.chords[i].alt; }],
                               ['guideBars', (x, i, v) => { x.chords[i].bars = Number(v); }]]) {
    if (d[attr]) {
      const [i, v] = d[attr].split(':');
      return edit(x => apply(x, Number(i), v));
    }
  }
});
$('#guideEdit').addEventListener('change', e => {
  const sel = e.target.closest('[data-guide-root]');
  if (sel) edit(x => { x.chords[Number(sel.dataset.guideRoot)].deg = Number(sel.value); });
});
$('#guideName').addEventListener('input', e => { draft.name = e.target.value; dirty = true; });
$('#guideLib').addEventListener('click', e => {
  const del = e.target.closest('[data-guide-del]');
  if (del) {
    const g = findGuide(del.dataset.guideDel);
    if (g && confirm(`Delete "${g.name}"? Its rounds stay in your history.`)) {
      deleteGuide(g.id);
      if (draft.id === g.id) editDraft(currentGuide());
      showLevels();
      hooks.showSettings();
      hooks.runSync();
    }
    return;
  }
  const card = e.target.closest('[data-guide-sel]');
  if (card) {
    select(card.dataset.guideSel);
    editDraft(currentGuide());
    showLevels();
    hooks.showSettings();
  }
});
$('#guideSave').addEventListener('click', async () => {
  // Changing the music of an exercise that has rounds makes a new one.
  const played = !isPreset(draft) && (await allEvents()).some(e => e.game === 'guides' && e.guideId === draft.id);
  // A built-in one saves as your copy: "ii–V–I · 7 → 3 (mine)" unless renamed.
  const saved = saveGuide(isPreset(draft) ? { ...draft, id: null, name: draft.name === findGuide(draft.id)?.name ? `${draft.name} (mine)` : draft.name } : draft, played);
  select(saved.id);
  editDraft(saved);
  showLevels();
  hooks.showSettings();
  hooks.runSync();              // the library goes to its own file in the data repo
});
$('#guideNew').addEventListener('click', () => {
  editDraft({ id: null, name: '', chords: PRESETS[0].chords, targets: [] });
  showLevels();
});
$('#guidePlayLevel').addEventListener('click', () => hooks.showTab('play'));

// --- Stats: key × each target slot, for the exercise picked ---
let statEvents = [];
let statSelected = null;
async function showStats() {
  statEvents = (await allEvents()).filter(e => e.game === 'guides' && e.targets);
  // Every exercise, plus any played one since deleted.
  const opts = new Map(allGuides().map(g => [g.id, g]));
  for (const e of statEvents) if (e.guideId && !opts.has(e.guideId)) opts.set(e.guideId, { id: e.guideId, ...e.guide, name: `${e.guide.name} (deleted)` });
  const pick = opts.has($('#guideStatSel').value) ? $('#guideStatSel').value : selectedId();
  $('#guideStatSel').innerHTML = [...opts.values()].map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  $('#guideStatSel').value = pick;
  statGuides = opts;
  drawStats();
}
let statGuides = new Map();
function drawStats() {
  const ex = statGuides.get($('#guideStatSel').value) || currentGuide();
  const rating = guideGrid(statEvents, ex.id);
  const cols = [...ex.targets].sort((a, b) => a.chord - b.chord || (a.at === LATE) - (b.at === LATE) || a.at - b.at)
    .map(t => ({ k: slotKey(t.chord, t.at), head: `${numeral(ex.chords[t.chord])} ${tonesText(t.degs)}${t.at === LATE ? '↗' : t.at ? `·${t.at % BAR + 1}` : ''}`, t }));
  let h = `<div class="rm-grid" style="grid-template-columns: 28px repeat(${Math.max(1, cols.length)}, 1fr)"><div></div>` +
    cols.map(c => `<div class="rm-head">${c.head}</div>`).join('');
  for (const [rk, label] of [['all', 'All'], ...NOTES.map((n, k) => [String(k), n])]) {
    h += `<div class="rm-row${rk === 'all' ? ' all' : ''}">${label}</div>`;
    for (const c of cols) {
      const key = `${rk}|${c.k}`;
      const sq = squareStyle(rating.get(key));
      h += `<div class="rm-cell${sq.cls}${key === statSelected ? ' selected' : ''}" data-cell="${key}"${sq.style}></div>`;
    }
  }
  h += '</div>';
  let cap = 'Tap a square: now (colour), best day (corner), timing.';
  if (statSelected) {
    const [rk, k] = statSelected.split('|');
    const c = cols.find(x => x.k === k);
    const where = `${rk === 'all' ? 'All keys' : `In ${NOTES[Number(rk)]}`} · ${c ? `${tonesText(c.t.degs)} of ${numeral(ex.chords[c.t.chord])}, ${slotName(ex.chords[c.t.chord], c.t.at)}` : ''}`;
    cap = `${where} — ${ratingText(rating.get(statSelected))}`;
  }
  $('#guideGrid').innerHTML = h + `<div class="rm-cap">${cap}</div>`;
  // Pane figures: the whole exercise now and its best day; counts; its
  // last 20 rounds for "off the line".
  const rounds = statEvents.filter(e => e.guideId === ex.id);
  const last = rounds.slice(-20).flatMap(e => e.targets);
  const fig = paneFigures(rating.get('level'));
  const dayStart = new Date().setHours(0, 0, 0, 0);
  $('#gstRounds').textContent = rounds.length;
  $('#gstToday').textContent = rounds.filter(e => e.t >= dayStart).length;
  $('#gstNow').textContent = fig.now;
  $('#gstBestDay').textContent = fig.best;
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
