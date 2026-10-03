// The Cells game's panel (I1): the Play settings (cell card, learn stage
// or practice path, backing, tempo), the library and 4-note editor on
// Levels, and the key × note stats. The runner itself is cells.js.

import { $, $$, load, save, st, hooks, cellMode } from './app.js';
import { QUALITY_TEXT, NOTES, degreeLabel } from './music.js';
import { mountTempo } from './tempo.js';
import { allEvents } from './events.js';
import { initAudio, loadTrio, playPreview } from './audio.js';
import { squareStyle, ratingText, paneFigures } from './rating.js';
import { startCells, stopCells, cellNote, cellsRunning, cellHTML, esc,
         pauseCells, resumeCells, restartCells, cellsPaused, setCellsBpm } from './cells.js';
import { loadLibrary, saveCell, deleteCell, cellProgress, nearestOct, autoName, degreesText,
         CELL_DEGREES, EXERCISES, PRACTICE_EXERCISES, STAGES, CELL_NOTES, playedNotes, cellGrid, runRate, SOLID, noteSemis } from './celllib.js';

const CELL_SEL_KEY = 'woodshed.cellSel';    // the selected cell's id
const CELL_EX_KEY = 'woodshed.cellEx';      // practice path
const CELL_BPM_KEY = 'woodshed.cellBpm';    // a tempo of its own (notes per minute), set by the player
const CELL_BACK_KEY = 'woodshed.cellBacking';   // 'band' | 'root' | 'click'
let cellId = load(CELL_SEL_KEY);
let cellExercise = PRACTICE_EXERCISES.includes(load(CELL_EX_KEY)) ? load(CELL_EX_KEY) : PRACTICE_EXERCISES[0];
const CELL_STAGE_KEY = 'woodshed.cellStage';  // learn: ×4 / ×2 / ×1 on each chord — the player's pick
let cellStage = [0, 1, 2].includes(Number(load(CELL_STAGE_KEY))) ? Number(load(CELL_STAGE_KEY)) : 0;
// Backing (boss, 2026-09-26): the trio, drums + the root only (no fifth: it
// lies on ø and ° chords), or the click alone. The band by default.
let backing = ['band', 'root', 'click'].includes(load(CELL_BACK_KEY)) ? load(CELL_BACK_KEY) : 'band';
let progressById = new Map();                  // cell id → cellProgress()
const currentCell = () => { const lib = loadLibrary(); return lib.find(p => p.id === cellId) || lib[0] || null; };
const cellTempo = mountTempo($('#cellTempo'), { min: 60, value: Math.max(60, Number(load(CELL_BPM_KEY)) || 60),
                                          note: 'a note a beat', onChange: v => { save(CELL_BPM_KEY, String(v)); setCellsBpm(v); } });

async function loadCellProgress() {
  const evs = (await allEvents()).filter(e => e.game === 'cells');
  progressById = new Map(loadLibrary().map(p => [p.id, cellProgress(evs, p.id)]));
  hooks.showSettings();
  if (!$('#view-cell-levels').hidden) showCellLevels();
}

function showCellSettings() {
  const p = currentCell();
  const prog = p && progressById.get(p.id);
  $('#cellCardName').textContent = p ? p.name : 'No cell yet';
  $('#cellCardDeg').textContent = p ? degreesText(p) : 'build one ›';
  $('#cellStages').hidden = cellMode() !== 'learn';
  $('#cellExercises').hidden = cellMode() === 'learn';
  const stage = cellStage;
  $$('[data-cell-stage]').forEach(b => b.classList.toggle('active', Number(b.dataset.cellStage) === stage));
  $$('[data-cell-back]').forEach(b => b.classList.toggle('active', b.dataset.cellBack === backing));
  $('#cellExercises').innerHTML = PRACTICE_EXERCISES.map(id =>
    `<button data-cell-ex="${id}" class="${id === cellExercise ? 'active' : ''}">${EXERCISES[id].name}${prog?.done.has(id) ? ' ✓' : ''}</button>`).join('');
  if (cellsRunning()) return;
  // Idle stage: what will be played on top (learn: a b c d c b), what
  // Start will do underneath.
  $('#cellShow').innerHTML = p ? `<b>${esc(p.name)}</b>${cellHTML({ ...p, notes: playedNotes(p, cellMode()) }, -1, p.notes.length)}` : '<b>Build a cell in Levels</b>';
  $('#cellTitle').textContent = !p ? '' : cellMode() === 'learn' ? `Cycle of 4ths · ×${STAGES[stage]}` : EXERCISES[cellExercise].name;
  const msg = $('#cellMsg');
  msg.hidden = !p;
  msg.innerHTML = !p ? '' : cellMode() === 'learn'
    ? `<b>Learn</b> — the cell there and back (a b c d c b), ${STAGES[stage]}× on each chord round the cycle of 4ths. Nothing is shown ahead: ` +
      'play it from the top on each chord. A solid round (95 %) ticks the stage; pick fewer times per chord when you\'re ready.<br><small>Start goes straight into a one-bar count-in.</small>'
    : `<b>Practice</b> — the 4 notes once on each chord, ${EXERCISES[cellExercise].name.toLowerCase()}.<br><small>Start goes straight into a one-bar count-in.</small>`;
}
$('#cellCard').addEventListener('click', () => hooks.showTab('levels'));
$$('[data-cell-back]').forEach(b => b.addEventListener('click', () => { backing = b.dataset.cellBack; save(CELL_BACK_KEY, backing); hooks.showSettings(); }));
$('#cellStages').addEventListener('click', e => {
  const b = e.target.closest('[data-cell-stage]');
  if (b) { cellStage = Number(b.dataset.cellStage); save(CELL_STAGE_KEY, String(cellStage)); hooks.showSettings(); }
});
$('#cellExercises').addEventListener('click', e => {
  const b = e.target.closest('[data-cell-ex]');
  if (b) { cellExercise = b.dataset.cellEx; save(CELL_EX_KEY, cellExercise); hooks.showSettings(); }
});

// The library on the stage: each cell with its height-drawn shape and
// progress; the editor in the pane. A draft is edited in place and only
// written to the library on Save.
let draft = null;            // {id, name, quality, notes: [{deg, oct}], sel}
// The first time, the editor opens on an example (the boss's "5 1 3 5 on
// a dominant", from the low 5) — not saved until Save.
const EXAMPLE = { quality: '7', notes: [{ deg: '5', oct: -1 }, { deg: '1', oct: 0 }, { deg: '3', oct: 0 }, { deg: '5', oct: 0 }] };
function editDraft(p) {
  const src = p || (loadLibrary().length ? { quality: '7', notes: [] } : EXAMPLE);
  draft = { id: p?.id || null, name: p?.name || '', quality: src.quality, notes: src.notes.map(n => ({ ...n })), sel: src.notes.length - 1 };
}

function stageText(prog) {
  if (!prog) return 'new';
  const marks = STAGES.map((n, i) => (prog.solid.has(i) ? `<b>×${n} ✓</b>` : `×${n}`)).join(' ');
  return `Learn ${marks}<br>Practice ${prog.done.size} / ${PRACTICE_EXERCISES.length}`;
}

function showCellLevels() {
  const lib = loadLibrary();
  const sel = currentCell();
  $('#cellLib').innerHTML = lib.length ? lib.map(p => `<div class="cellcard${sel && p.id === sel.id ? ' active' : ''}" data-cell-sel="${p.id}">` +
      `<button class="cellplay" data-cell-hear="${p.id}" aria-label="Hear ${esc(p.name)}">▶</button><span class="cellname">${esc(p.name)}</span>${cellHTML(p)}` +
      `<span class="cellprog">${stageText(progressById.get(p.id))}</span>` +
      `<span class="cellact"><button data-cell-del="${p.id}">✕</button></span></div>`).join('')
    : '<div class="small-note">No cells yet — build one on the right (an example is loaded), then Save.</div>';
  // The editor holds the selected cell (boss, 2026-10-01: no edit button —
  // the card picked is the one open on the right), or the example at first.
  if (!draft) editDraft(sel);
  showEditor();
}

function showEditor() {
  $$('[data-cell-q]').forEach(b => b.classList.toggle('active', b.dataset.cellQ === draft.quality));
  $('#cellEdit').innerHTML = draft.notes.length ? cellHTML(draft, draft.sel) : '<span class="small-note">Tap degrees below</span>';
  $('#cellKeys').innerHTML = CELL_DEGREES.map(d => `<button data-cell-deg="${d}">${degreeLabel(d)}</button>`).join('');
  $('#cellName').value = draft.name;
  $('#cellName').placeholder = draft.notes.length ? autoName(draft) : 'name (optional)';
  const n = draft.notes.length;
  $('#cellHint').textContent = n < CELL_NOTES ? `A cell is ${CELL_NOTES} notes (${n} so far). Each new note goes to the nearest octave; ↑ ↓ move the selected one.`
    : `${draft.id ? 'Editing' : 'New'} · learn plays it there and back: ${degreesText({ notes: playedNotes(draft, 'learn') })}.`;
  $('#cellSave').disabled = n !== CELL_NOTES;
}

$('#cellKeys').addEventListener('click', e => {
  const b = e.target.closest('[data-cell-deg]');
  if (!b || draft.notes.length >= CELL_NOTES) return;
  const at = draft.sel + 1;
  const deg = b.dataset.cellDeg;
  draft.notes.splice(at, 0, { deg, oct: nearestOct(draft.quality, deg, draft.notes[at - 1]) });
  draft.sel = at;
  showEditor();
});
$('#cellEdit').addEventListener('click', e => {
  const n = e.target.closest('[data-i]');
  if (n) { draft.sel = Number(n.dataset.i); showEditor(); }
});
const shiftOct = d => {
  const n = draft.notes[draft.sel];
  if (n && Math.abs(n.oct + d) <= 2) { n.oct += d; showEditor(); }
};
$('#cellUp').addEventListener('click', () => shiftOct(1));
$('#cellDown').addEventListener('click', () => shiftOct(-1));
$('#cellDel').addEventListener('click', () => {
  if (draft.sel < 0) return;
  draft.notes.splice(draft.sel, 1);
  draft.sel = Math.min(draft.sel, draft.notes.length - 1);
  showEditor();
});
$$('[data-cell-q]').forEach(b => b.addEventListener('click', () => { draft.quality = b.dataset.cellQ; showEditor(); }));
$('#cellName').addEventListener('input', e => { draft.name = e.target.value; });
$('#cellNew').addEventListener('click', () => { editDraft(null); draft.notes = []; draft.sel = -1; showEditor(); });
// Hear a cell from its card (boss, 2026-10-01: a ▶ on the row, so it plays
// without opening the editor; it replaced the editor's ▶ Hear). The key
// doesn't matter (2026-09-27): over a C chord of its quality, the line a
// note a beat at 150 bpm, its root at C5 (concert), so the octaves are as
// drawn.
const HEAR_BEAT = 0.4;
function hear(cell) {
  initAudio();
  // The chord soft underneath, the cell on the clear bell an octave above
  // it (its root at C5), so the two never blur. Pre-rendered (audio.js).
  playPreview(0, cell.quality, cell.notes.map(n => 72 + noteSemis(cell.quality, n)), HEAR_BEAT);
}
$('#cellSave').addEventListener('click', async () => {
  // Changing the notes of a cell that has runs makes a new cell.
  const played = !!draft.id && (await allEvents()).some(e => e.game === 'cells' && e.cellId === draft.id);
  const saved = saveCell(draft, played);
  cellId = saved.id;
  save(CELL_SEL_KEY, cellId);
  editDraft(saved);
  await loadCellProgress();
  showCellLevels();
  hooks.runSync();                    // the library goes to its own file in the data repo
});
$('#cellLib').addEventListener('click', e => {
  const del = e.target.closest('[data-cell-del]');
  const card = e.target.closest('[data-cell-sel]');
  const play = e.target.closest('[data-cell-hear]');
  const lib = loadLibrary();
  if (play) {                         // hear only: the selection stays as it is
    const p = lib.find(x => x.id === play.dataset.cellHear);
    if (p) hear(p);
    return;
  }
  if (del) {
    const p = lib.find(x => x.id === del.dataset.cellDel);
    if (p && confirm(`Delete "${p.name}"? Its runs stay in your history.`)) {
      deleteCell(p.id);
      if (cellId === p.id) cellId = null;
      if (draft?.id === p.id) draft = null;      // the editor moves to the next selected cell
      showCellLevels();
      hooks.showSettings();
      hooks.runSync();
    }
    return;
  }
  if (card) {
    cellId = card.dataset.cellSel;
    save(CELL_SEL_KEY, cellId);
    editDraft(lib.find(x => x.id === cellId));   // selected = open in the editor
    showCellLevels();
    hooks.showSettings();
  }
});

// --- Cell stats: key × note of the cell, for the cell picked ---
let cellStatSelected = null;       // a tapped cell key, or null
let cellStatEvents = [];
async function showCellStats() {
  cellStatEvents = (await allEvents()).filter(e => e.game === 'cells' && e.expected);
  // The picker: every library cell, plus any played cell since deleted.
  const lib = loadLibrary();
  const names = new Map(lib.map(p => [p.id, p]));
  for (const e of cellStatEvents) if (!names.has(e.cellId)) names.set(e.cellId, { id: e.cellId, ...e.cell, name: `${e.cell.name} (deleted)` });
  const cur = currentCell();
  const pick = names.has($('#cellStatSel').value) ? $('#cellStatSel').value : cur?.id || [...names.keys()][0];
  $('#cellStatSel').innerHTML = [...names.values()].map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if (pick) $('#cellStatSel').value = pick;
  drawCellStats();
}
function drawCellStats() {
  const id = $('#cellStatSel').value;
  const lib = loadLibrary();
  const p = lib.find(x => x.id === id) || cellStatEvents.find(e => e.cellId === id)?.cell;
  if (!p) { $('#cellGrid').innerHTML = '<div class="small-note">No cell yet.</div>'; return; }
  const rating = cellGrid(cellStatEvents, id);
  const n = p.notes.length;
  let h = `<div class="rm-grid" style="grid-template-columns: 28px repeat(${n}, 1fr)"><div></div>` +
    p.notes.map(x => `<div class="rm-head">${degreeLabel(x.deg)}</div>`).join('');
  for (const [rk, label] of [['all', 'All'], ...NOTES.map((nm, k) => [String(k), nm])]) {
    h += `<div class="rm-row${rk === 'all' ? ' all' : ''}">${label}</div>`;
    for (let j = 0; j < n; j++) {
      const key = `${rk}|${j}`;
      const sq = squareStyle(rating.get(key));
      h += `<div class="rm-cell${sq.cls}${key === cellStatSelected ? ' selected' : ''}" data-cell="${key}"${sq.style}></div>`;
    }
  }
  h += '</div>';
  let cap = 'Tap a square: now (colour), best day (corner), timing.';
  if (cellStatSelected) {
    const [rk, j] = cellStatSelected.split('|');
    const where = `${rk === 'all' ? 'All chords' : `${NOTES[Number(rk)]}${QUALITY_TEXT[p.quality]}`} · note ${Number(j) + 1} (the ${degreeLabel(p.notes[j].deg)})`;
    cap = `${where} — ${ratingText(rating.get(cellStatSelected))}`;
  }
  $('#cellGrid').innerHTML = h + `<div class="rm-cap">${cap}</div>`;
  // Pane figures: the whole cell now and its best day; its last 20 runs;
  // where it stands.
  const runs = cellStatEvents.filter(e => e.cellId === id);
  const last = runs.slice(-20);
  const fig = paneFigures(rating.get('level'));
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const prog = cellProgress(cellStatEvents, id);
  $('#cstRuns').textContent = runs.length;
  $('#cstToday').textContent = runs.filter(e => e.t >= dayStart).length;
  $('#cstNow').textContent = fig.now;
  $('#cstBestDay').textContent = fig.best;
  $('#cstSolid').textContent = last.length ? `${last.filter(e => runRate(e) >= SOLID).length} / ${last.length}` : '–';
  $('#cstLearn').textContent = prog.learnt ? 'learnt ✓' : prog.solid.size ? STAGES.filter((_, i) => prog.solid.has(i)).map(n => `×${n} ✓`).join(' ') : '–';
  $('#cstPractice').textContent = `${prog.done.size} / ${PRACTICE_EXERCISES.length}`;
}
$('#cellGrid').addEventListener('click', e => {
  const cell = e.target.closest('[data-cell]');
  const key = cell ? cell.dataset.cell : null;
  cellStatSelected = key && key !== cellStatSelected ? key : null;
  drawCellStats();
});
$('#cellStatSel').addEventListener('change', () => { cellStatSelected = null; drawCellStats(); });

// --- Start ---
async function start() {
  const p = currentCell();
  // The trio's samples, once (cached for offline by the service worker).
  // If they can't load, the run goes on with the count-in and no band.
  initAudio();
  await loadTrio().catch(() => {});
  startCells({ cell: p, mode: cellMode(), exercise: cellMode() === 'learn' ? 'cycle4' : cellExercise, stage: cellStage,
               bpm: cellTempo.get(), backing: backing, calib: st.calib, calibOffset: st.calibOffset, latency: st.latency },
             () => { hooks.showRunning(false); hooks.showSettings(); loadCellProgress(); hooks.runSync(); });
}

// New runs from sync: redraw the stats if they're up.
function onSync(res) {
  if (res.added && !$('#view-cell-stats').hidden) showCellStats();
}

export const cellsUI = {
  render: showCellSettings, canStart: () => !!currentCell(), start, onEnter: loadCellProgress, onSync,
  showLevels: showCellLevels, showStats: showCellStats,
  running: cellsRunning, note: cellNote, stop: stopCells,
  paused: cellsPaused, pause: pauseCells, resume: resumeCells, restart: restartCells,
  tempoLive: on => cellTempo.setEnabled(on),
};
