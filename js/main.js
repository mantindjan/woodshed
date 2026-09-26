// App wiring: the game switch, the control panel (tabs Play · Levels ·
// Stats · ⚙), horn connection and calibration, the degree drill, its levels
// and custom exercises (D6) and heatmap (D4), the scale runner with its
// levels (E1 step 2) and range map (E1 step 3), sync (A9) and backup (A7).
//
// Pitch spaces: see music.js. Calibration stores the MIDI pitch class the
// horn sends for a fingered written C; that one number converts both ways
// between written (display, judging) and concert (the pad).

import { connectMidi } from './midi.js';
import { QUALITY_ORDER, QUALITY_TEXT, QUALITY_NAME, DEGREES, NOTES, SCALES, WRITTEN_MIDDLE_C, degreeLabel, writtenPc } from './music.js';
import { startScales, stopScales, scaleNote, scalesRunning, nextKey, nudgeTempo, learnOrder,
         pauseScales, resumeScales, restartScales, scalesPaused } from './scales.js';
import { mountTempo } from './tempo.js';
import { noteHTML } from './notation.js';
import { startRound, stopRound, drillNote, isRunning } from './drill.js';
import { downloadBackup, loadBackup, countEvents } from './backup.js';
import { allEvents } from './events.js';
import { LEVELS, UNIT_TITLES, exercise as resolveExercise, customCells, matchLevel, setsOf } from './levels.js';
import { getSummary } from './summary.js';
import { sync, syncConfig, setSyncConfig, syncState } from './sync.js';
import { renderHeatmap } from './heatmap.js';
import { SCALE_LEVELS, SCALE_ORDER, PATTERNS, PATTERN_ORDER, scaleExercise as resolveScaleExercise, matchScaleLevel, createKeyModel, runPattern } from './scalelevels.js';
import { renderRangeMap, colour } from './rangemap.js';
import { createTempoModel, tempoKey, pipText, pips } from './scaletempo.js';
import { startLatency, stopLatency, latencyNote, measuring } from './latency.js';
import { startPatterns, stopPatterns, patternNote, patternsRunning, patternHTML, esc,
         pausePatterns, resumePatterns, restartPatterns, patternsPaused } from './patterns.js';
import { loadLibrary, savePattern, deletePattern, patternProgress, nearestOct, autoName, degreesText,
         PATTERN_DEGREES, EXERCISES, PRACTICE_EXERCISES, STAGES, MIN_NOTES, MAX_NOTES, patternGrid, runRate, SOLID } from './patternlib.js';

// Settings (localStorage, all carried by the backup file).
const CALIB_KEY = 'woodshed.calib';
const MODE_KEY = 'woodshed.mode';
const PICK_KEY = 'woodshed.pick';
const LENGTH_KEY = 'woodshed.length';
const EXERCISE_KEY = 'woodshed.exercise';
const CUSTOM_KEY = 'woodshed.custom';
const OFFSET_KEY = 'woodshed.calibOffset';   // horn MIDI − written, from middle C
const GAME_KEY = 'woodshed.game';
const SCALE_EX_KEY = 'woodshed.scaleExercise';   // scale level id or 'custom'
const SCALE_CUSTOM_KEY = 'woodshed.scaleCustom'; // {scale, pattern, keys: [written pcs]}
const BPM_KEY = 'woodshed.bpm';                  // the Fixed tempo
const TEMPO_AUTO_KEY = 'woodshed.tempoAuto';     // 'auto' | 'fixed' (scales, E4)
const LATENCY_KEY = 'woodshed.latency';          // ms, measured in ⚙ (latency.js); absent = 0
const MISSES_KEY = 'woodshed.misses';

// Question-count choices; 0 = endless (until Stop).
const LENGTHS = [10, 20, 50, 100, 0];

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const statusEl = $('#status');
const noteEl = $('#note');
const rawEl = $('#raw');
const hintEl = $('#hint');
const calibBtn = $('#calibrate');
const connectBtn = $('#connect');
const startBtn = $('#start');
const stopBtn = $('#stop');

// localStorage can throw (private mode, storage disabled); fall back to
// defaults rather than breaking the page.
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
function loadJSON(key, fallback) {
  try { return JSON.parse(load(key)) ?? fallback; } catch { return fallback; }
}

let calib = load(CALIB_KEY) === null ? null : Number(load(CALIB_KEY));
// Octave-aware calibration (E1): older calibrations only know the pitch
// class, which the degree drill needs; scales need the octave too.
let calibOffset = load(OFFSET_KEY) === null ? null : Number(load(OFFSET_KEY));
const GAMES = ['degrees', 'scales', 'patterns'];
let game = GAMES.includes(load(GAME_KEY)) ? load(GAME_KEY) : 'degrees';
// Scales start on the first rung too (major, linear up).
let scaleExerciseId = load(SCALE_EX_KEY) || SCALE_LEVELS[0].id;
let scaleCustom = loadJSON(SCALE_CUSTOM_KEY, { scale: 'major', pattern: 'up', keys: [0] });
const currentScaleExercise = () => resolveScaleExercise(scaleExerciseId, scaleCustom);
// Which level the range map shows (a level id) and how ('range' | 'degrees');
// starts on the current exercise's level, then follows the picker.
let mapLevel = null;
let mapView = 'range';
// Auto tempo (E4): on by default, in practice and learn (boss 2026-09-26:
// learn should climb too), one staircase per key. The staircases live in
// the cached summary; kept here too so the panes can show tempos without
// waiting.
let tempoAuto = load(TEMPO_AUTO_KEY) !== 'fixed';
let tempoModel = createTempoModel();
let keyModel = createKeyModel();   // weak keys, for learn's key order on the idle card
let scaleRecap = null;             // the last session's recap, shown until something changes
const autoActive = () => tempoAuto;
// What the Play strip shows on Auto: the middle of the exercise's keys'
// starting tempos (each run then plays at its own key's, shown on stage).
function autoStartTempo() {
  const x = currentScaleExercise();
  const starts = x.keys.map(k => tempoModel.start(tempoKey(x.scale, x.pattern, k))).sort((a, b) => a - b);
  return starts.length ? starts[starts.length >> 1] : 60;
}
async function loadTempo() {
  const sm = await getSummary();
  tempoModel = createTempoModel(sm.tempo || []);
  keyModel = createKeyModel(sm.keys || []);
  showSettings();
}

// --- Scales stage when not running (boss 2026-09-26: a new user must see
// what the mode does and what the practice did for them) ---
// Before Start: what's next, how this mode works, what to do. After Stop:
// the session recap — runs, keys with their tempo moves and new bests,
// pips gained — until the player changes something or starts again.
function showScaleIdle() {
  const el = $('#scaleIdle');
  if (scalesRunning()) { el.hidden = true; return; }
  el.hidden = false;
  const ex = currentScaleExercise();
  const exName = `${ex.num ? `${ex.num} · ` : ''}${ex.title} · ${ex.name}`;
  if (scaleRecap) { el.innerHTML = recapHTML(scaleRecap, ex, exName); return; }
  const tk = k => tempoKey(ex.scale, ex.pattern, k);
  let next, how;
  if (mode === 'learn') {
    const first = learnOrder(ex.keys, keyModel, ex.scale, ex.pattern)[0];
    next = `${NOTES[first]} major first — hardest keys first` +
           (tempoAuto ? ` · ${tempoModel.start(tk(first))} bpm` : ` · ${fixedBpm} bpm`);
    if (ex.scale !== 'major') next = next.replace('major', SCALES[ex.scale].name.toLowerCase());
    how = 'The whole run is laid out; a line sweeps across it in time — play along, nothing stops. ' +
          (tempoAuto ? 'A key repeats; clean runs raise its tempo, and after a step up the next key comes.'
                     : 'A key repeats until you tap Next key.');
  } else {
    next = `${ex.keys.length > 1 ? (pick === 'weak' ? 'Keys drawn toward your weak ones' : 'Keys at random') : `${NOTES[ex.keys[0]]} only`}` +
           (tempoAuto ? ' · each at its own tempo' : ` · ${fixedBpm} bpm`);
    how = `Notes scroll to the line — hit each on the beat. ${misses} miss${misses === 1 ? '' : 'es'} and the run starts again.` +
          (tempoAuto ? ' Three clean runs in a row raise that key\'s tempo; a bad one lowers it.' : '');
  }
  el.innerHTML = `<div class="label">${mode === 'learn' ? 'Learn' : 'Practice'} · next up</div>` +
    `<div class="big">${exName}</div><div class="what">${next}</div><div class="how">${how}</div>` +
    '<div class="go">Press Start, then blow the first note of the run.</div>';
}

function recapHTML(r, ex, exName) {
  const mins = Math.max(1, Math.round((r.t1 - r.t0) / 60000));
  const keys = r.keys.map(k => {
    const move = !r.tempoAuto ? `${Math.round(100 * k.hits / k.total)}%`
      : k.to > k.from ? `${k.from} → <b class="up">${k.to} ↑</b>` : k.to < k.from ? `${k.from} → <span class="down">${k.to} ↓</span>` : `${k.from}`;
    const star = k.best > k.bestBefore ? ` <span class="star">★ ${k.best}</span>` : '';
    return `<span class="k"><b>${NOTES[k.key]}</b> ${move}${star}</span>`;
  }).join('');
  const bestNow = tempoModel.levelBest(ex.scale, ex.pattern);
  const gained = pips(bestNow) - pips(r.levelBestBefore);
  const level = gained > 0 ? `<div class="how">${exName}: ${pipText(bestNow)} — ${gained} tier${gained === 1 ? '' : 's'} up</div>` : '';
  return `<div class="label">Session</div>` +
    `<div class="big">${r.runs} run${r.runs === 1 ? '' : 's'} · ${r.clean} clean · ${mins} min</div>` +
    `<div class="keys">${keys}</div>${level}` +
    `<div class="go">${r.tempoAuto ? 'Tempos per key: first run → where it plays next. ★ = new clean best.' : 'Notes hit per key.'}</div>`;
}
let misses = [1, 2, 3, 5].includes(Number(load(MISSES_KEY))) ? Number(load(MISSES_KEY)) : 3;
let calibrating = false;
let mode = load(MODE_KEY) === 'learn' ? 'learn' : 'practice';
let pick = load(PICK_KEY) === 'random' ? 'random' : 'weak';
let length = LENGTHS.includes(Number(load(LENGTH_KEY) ?? 20)) ? Number(load(LENGTH_KEY) ?? 20) : 20;
// Default to the first rung of the ladder, not the everything-mix.
let exerciseId = load(EXERCISE_KEY) || LEVELS[0].id;
let custom = loadJSON(CUSTOM_KEY, { qualities: ['maj7'], degrees: ['3', '7'] });

const currentExercise = () => resolveExercise(exerciseId, custom, describe);

// --- Tabs: each selects a pane (right) and a view (left stage). ---
// A view or pane shows when it's for this tab and (if game-specific) the
// current game: each game has its own Play · Levels · Stats; ⚙ is shared.
// data-for, not data-game: that attribute is reserved for the game buttons.
const forGame = el => !el.dataset.for || el.dataset.for === game;
let currentTab = 'play';
function showTab(tab) {
  currentTab = tab;
  $$('button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.pane').forEach(p => { p.hidden = !(p.dataset.pane === tab && forGame(p)); });
  // Views use data-view, not data-tab: sharing the tab buttons' attribute
  // made `[data-tab=…]` match hidden views too.
  $$('.view').forEach(v => { v.hidden = !(v.dataset.view === tab && forGame(v)); });
  if (game === 'degrees' && tab === 'levels') showLevels();
  if (game === 'degrees' && tab === 'stats') showStats();
  if (game === 'scales' && tab === 'levels') showScaleLevels();
  if (game === 'scales' && tab === 'stats') showScaleStats();
  if (game === 'patterns' && tab === 'levels') showPatternLevels();
  if (game === 'patterns' && tab === 'stats') showPatternStats();
  if (tab === 'horn') showCount();
  else if (measuring()) endLatencyRun();
}
$$('button[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// --- Play pane ---
function showHint() {
  if (calibrating) hintEl.textContent = 'Play middle C — the C in the third space of the staff.';
  else if (calib === null) hintEl.textContent = 'Not calibrated — tap Calibrate and play middle C.';
  else if (game === 'scales' && calibOffset === null) hintEl.textContent = 'Recalibrate on middle C for scales — the octave matters.';
  else hintEl.textContent = 'Calibrated · redo after changing the horn’s voice.';
  showHornWarn();
}

// The horn controls live in ⚙; Play only says when something needs fixing,
// and a tap goes there.
function showHornWarn() {
  const el = $('#hornWarn');
  const problem = statusEl.dataset.state !== 'connected' ? 'Horn not connected'
    : calib === null ? 'Horn not calibrated'
    : game === 'scales' && calibOffset === null ? 'Recalibrate on middle C for scales' : '';
  el.hidden = !problem;
  el.textContent = problem ? `● ${problem} — fix in ⚙ ›` : '';
}

function showSettings() {
  document.body.dataset.game = game;
  $$('button[data-game]').forEach(b => b.classList.toggle('active', b.dataset.game === game));
  // The miss limit only applies in practice: learn never restarts a run.
  $$('[data-misses]').forEach(b => { b.classList.toggle('active', Number(b.dataset.misses) === misses); b.disabled = mode === 'learn'; });
  // Learn/Practice and Weak/Random are one setting shared by both games.
  $$('[data-mode], [data-smode], [data-pmode]').forEach(b => b.classList.toggle('active', (b.dataset.mode || b.dataset.smode || b.dataset.pmode) === mode));
  $$('[data-pick], [data-spick]').forEach(b => b.classList.toggle('active', (b.dataset.pick || b.dataset.spick) === pick));
  $$('[data-length]').forEach(b => b.classList.toggle('active', Number(b.dataset.length) === length));
  // The exercise everywhere as "L13 · Major" + its degrees in brass, so
  // what's being practised is as clear as the chord quality.
  const ex = currentExercise();
  const title = ex.num ? `${ex.num} · ${ex.title}` : ex.title;
  for (const [sel, t] of [['#exerciseLabel', title], ['#exerciseName', title], ['#idleName', title]]) $(sel).textContent = t;
  for (const sel of ['#exerciseDegrees', '#stageDegrees', '#idleWhat']) $(sel).textContent = ex.degrees;
  // The scale exercise the same way: "S3 · Major" + its pattern in brass;
  // a custom pick adds its keys to the label (levels are always all 12).
  const sx = currentScaleExercise();
  $('#scaleExLabel').textContent = sx.num ? `${sx.num} · ${sx.title}` : `Custom · ${sx.title} · ${sx.keysLabel}`;
  $('#scaleExKeys').textContent = PATTERNS[sx.pattern].chip;
  // Tempo: on Auto the strip shows roughly where the session starts (each
  // key has its own) and can't be dragged; on Fixed it's the remembered tempo.
  if (autoActive()) tempo.set(autoStartTempo(), false);
  else tempo.set(fixedBpm, false);
  tempo.setEnabled(!autoActive());   // every button in the block — the toggle is set after
  $('#tempoMode').textContent = tempoAuto ? 'auto' : 'fixed';
  $('#tempoMode').classList.toggle('active', tempoAuto);
  $('#tempoMode').disabled = false;   // setEnabled above just locked it with the rest
  // An empty custom pick can't be played.
  startBtn.disabled = game === 'degrees' ? ex.cells.length === 0
    : game === 'scales' ? sx.keys.length === 0 : !currentPattern();
  if (game === 'patterns') showPatternSettings();
  showHint();
  if (game === 'scales') showScaleIdle();
}

// Set when Start sent the player to ⚙ to calibrate: back to Play after.
let backToPlay = false;
function setCalibrating(on) {
  calibrating = on;
  if (!on) backToPlay = false;
  calibBtn.classList.toggle('active', on);
  showHint();
  // The prompt can sit below the fold of a long pane (Scales): bring it up.
  if (on) hintEl.scrollIntoView({ block: 'nearest' });
}

function onNote(midi) {
  rawEl.textContent = `MIDI ${midi}`;
  if (measuring()) { latencyNote(); return; }
  if (calibrating) {
    calib = midi % 12;
    save(CALIB_KEY, String(calib));
    // Played on middle C (written C5), so the octave is known too.
    calibOffset = midi - WRITTEN_MIDDLE_C;
    save(OFFSET_KEY, String(calibOffset));
    const back = backToPlay;
    setCalibrating(false);
    noteEl.innerHTML = noteHTML(0);
    if (back) showTab('play');
    return;
  }
  if (calib === null) noteEl.textContent = '?';
  else noteEl.innerHTML = noteHTML(writtenPc(midi, calib));
  if (patternsRunning()) patternNote(midi);
  else if (scalesRunning()) scaleNote(midi);
  else drillNote(midi);
}

function onStatus({ state, names, error }) {
  const text = {
    unsupported: 'No Web MIDI here — use Chrome on Android or desktop.',
    denied: `MIDI permission refused — allow it via the icon left of the address bar, then reload. (${error})`,
    // Chrome caches this failure until it's fully restarted, so Connect
    // can't fix it; the text says what does. (Every entry here is evaluated
    // on every call, and `error` is only set for failures — hence `?.`.)
    failed: error?.startsWith('InvalidStateError')
      ? 'Android’s MIDI service didn’t start. Force-stop Chrome (Settings → Apps → Chrome), replug the horn, reopen. Still broken? Restart the phone.'
      : `MIDI failed — ${error}`,
    none: 'No horn connected.',
    connected: `Horn: ${names.join(', ')}`,
  }[state];
  statusEl.textContent = text;
  statusEl.dataset.state = state;
  showHornWarn();
  // The connect button is only useful when a retry could change something.
  connectBtn.hidden = state === 'connected' || state === 'unsupported';
}

// Idle vs running: during a round only Stop works, and the tabs are locked
// on Play.
function showRunning(running) {
  $('#idle').hidden = running;
  startBtn.hidden = running;
  // Scales and patterns get play/pause · restart · stop (#scaleCtl serves
  // both); the degree drill a Stop.
  const scales = game !== 'degrees';
  stopBtn.hidden = !running || scales;
  $('#scaleCtl').hidden = !running || !scales;
  showScalePlay();
  $$('.pane[data-pane="play"] button, button[data-tab], button[data-game]').forEach(b => {
    if (b !== stopBtn && !b.closest('#scaleCtl')) b.disabled = running;
  });
}

function onRoundEnd(result) {
  showRunning(false);
  runSync();   // push this round's answers (A9); quiet if not set up
  showSettings();
  $('#chord').textContent = '';
  $('#degree').textContent = '';
  $('#progress').textContent = '';
  $('#degree').classList.remove('reveal', 'pulse', 'miss', 'long');
  $('#feedback').className = '';
  if (!result) {
    $('#feedback').textContent = '';
    return;
  }
  const { mode: m, total, firstTry, median, bestStreak } = result;
  const line = m === 'practice'
    ? `${firstTry} / ${total} right first time`
    : `${total} done · ${total - firstTry} needed another go`;
  $('#feedback').textContent = median === null
    ? line : `${line} · median ${(median / 1000).toFixed(2)} s`;
  // The final score stays up (drill.js); the combo line shows the best streak.
  if (m === 'practice') $('#combo').textContent = bestStreak ? `best combo ${bestStreak}` : '';
}

startBtn.addEventListener('click', async () => {
  // Both games judge in written pitch, which needs calibration first;
  // scales also need the octave (a middle-C calibration).
  if (calib === null || (game === 'scales' && calibOffset === null)) {
    showTab('horn');
    setCalibrating(true);
    backToPlay = true;
    return;
  }
  if (calibrating) setCalibrating(false);
  showRunning(true);
  if (game === 'scales') {
    // The weak-key model continues from the cached summary (A8): no history read.
    const model = createKeyModel((await getSummary()).keys || []);
    scaleRecap = null;
    $('#scaleIdle').hidden = true;
    startScales({ exercise: currentScaleExercise(), mode, pick, model, latency,
                  tempoAuto: autoActive(), tempo: tempoModel,
                  bpm: tempo.get(), misses, calib, calibOffset },
                recap => { scaleRecap = recap; showRunning(false); loadTempo(); runSync(); });
  } else if (game === 'patterns') {
    const p = currentPattern();
    startPatterns({ pattern: p, mode, exercise: mode === 'learn' ? 'cycle4' : pExercise, stage: currentStage(p),
                    bpm: ptempo.get(), calib, calibOffset, latency },
                  () => { showRunning(false); showSettings(); loadPatternProgress(); runSync(); });
  } else {
    startRound(mode, calib, onRoundEnd, { length, pick, exercise: currentExercise() });
  }
});
// The play/pause button shows what a tap does: pause while playing, play
// (resume) while paused.
const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
function showScalePlay() {
  const paused = game === 'patterns' ? patternsPaused() : scalesPaused();
  $('#scalePlay').innerHTML = paused ? PLAY_ICON : PAUSE_ICON;
  $('#scalePlay').setAttribute('aria-label', paused ? 'Resume' : 'Pause');
}
$('#scalePlay').addEventListener('click', () => {
  if (game === 'patterns') { if (patternsPaused()) resumePatterns(); else pausePatterns(); }
  else if (scalesPaused()) resumeScales(); else pauseScales();
  showScalePlay();
});
$('#scaleRestart').addEventListener('click', () => {
  if (game === 'patterns') restartPatterns(); else restartScales();
  showScalePlay();
});
$('#scaleStop').addEventListener('click', () => (game === 'patterns' ? stopPatterns() : stopScales()));
stopBtn.addEventListener('click', () => {
  if (patternsRunning()) stopPatterns();
  else if (scalesRunning()) stopScales();
  else if (isRunning()) stopRound();
});

// --- Game switch and scale settings (E1) ---
$$('button[data-game]').forEach(b => b.addEventListener('click', () => {
  game = b.dataset.game; save(GAME_KEY, game); showSettings();
  if (game === 'scales') loadTempo();
  if (game === 'patterns') loadPatternProgress();
  showTab(currentTab === 'horn' ? 'play' : currentTab);
}));
$$('[data-misses]').forEach(b => b.addEventListener('click', () => { misses = Number(b.dataset.misses); save(MISSES_KEY, String(misses)); showSettings(); }));
// B3: tempo control, remembered (the Fixed tempo).
let fixedBpm = Math.max(60, Number(load(BPM_KEY)) || 80);
// Min 60, as auto tempo's floor (boss: "the minimal tempo should be 60").
const tempo = mountTempo($('#tempo'), { min: 60, value: fixedBpm,
                                        onChange: v => { fixedBpm = v; save(BPM_KEY, String(v)); if (game === 'scales') showScaleIdle(); } });
// Auto | Fixed: one small toggle under the bpm (a full-width row pushed the
// exercise card off the pane at 390 px). Notes are always eighths.
$('#tempo .bpm').insertAdjacentHTML('beforeend', '<button id="tempoMode" class="tmode"></button>');
$('#tempoMode').addEventListener('click', () => {
  tempoAuto = !tempoAuto; save(TEMPO_AUTO_KEY, tempoAuto ? 'auto' : 'fixed'); scaleRecap = null; showSettings();
});

$$('[data-mode], [data-smode], [data-pmode]').forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.mode || b.dataset.smode || b.dataset.pmode; save(MODE_KEY, mode); scaleRecap = null; showSettings();
}));
$$('[data-pick], [data-spick]').forEach(b => b.addEventListener('click', () => {
  pick = b.dataset.pick || b.dataset.spick; save(PICK_KEY, pick); scaleRecap = null; showSettings();
}));
$$('[data-length]').forEach(b => b.addEventListener('click', () => {
  length = Number(b.dataset.length); save(LENGTH_KEY, String(length)); showSettings();
}));
$('#exerciseBtn').addEventListener('click', () => showTab('levels'));
calibBtn.addEventListener('click', () => setCalibrating(!calibrating));   // a second tap cancels
connectBtn.addEventListener('click', () => connectMidi(onNote, onStatus));
$('#hornWarn').addEventListener('click', () => showTab('horn'));
$('#scaleNext').addEventListener('click', nextKey);
$$('#scaleNudge [data-sn]').forEach(b => b.addEventListener('click', () => nudgeTempo(Number(b.dataset.sn))));

// --- Levels (D6): the ladder on the stage, custom builder in the pane ---

// "△: 3 7 · 7: 3 7": which degrees on which qualities (the colon keeps a
// dominant "7" apart from the degree 7).
function describe(cells) {
  const byQ = new Map();
  for (const { quality, degree } of cells) byQ.set(quality, [...(byQ.get(quality) || []), degreeLabel(degree)]);
  return [...byQ].map(([q, ds]) => `${QUALITY_TEXT[q]}: ${ds.join(' ')}`).join(' · ') || 'nothing selected';
}

function selectExercise(id) {
  exerciseId = id;
  save(EXERCISE_KEY, id);
  showSettings();
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
$('#playLevel').addEventListener('click', () => showTab('play'));

// --- Scale levels (E1 step 2): ladder on the stage, custom builder in the pane ---
function selectScaleExercise(id) {
  scaleExerciseId = id;
  scaleRecap = null;
  save(SCALE_EX_KEY, id);
  showSettings();
  showScaleLevels();
}

// One block per scale, its levels as pills (number · pattern · tempo pips),
// then the custom pick — the same shape as the degree ladder. A pip per
// tier of the tempo scale (60 72 84 96 112 126) the clean best has reached.
async function showScaleLevels() {
  await loadTempo();                 // the cached summary may have been rebuilt
  const pill = l => `<button class="lvl${l.id === scaleExerciseId ? ' active' : ''}" data-slevel="${l.id}">` +
    `<b>${l.num}</b><span>${l.name}</span><i>${pipText(tempoModel.levelBest(l.scale, l.pattern))}</i></button>`;
  let h = '';
  for (const sc of SCALE_ORDER) {
    h += `<div class="tier">${SCALES[sc].name}</div><div class="lrow">` +
         SCALE_LEVELS.filter(l => l.scale === sc).map(pill).join('') + '</div>';
  }
  const cx = resolveScaleExercise('custom', scaleCustom);
  h += `<div class="tier">Your own</div><div class="lrow">` +
       `<button class="lvl${scaleExerciseId === 'custom' ? ' active' : ''}" data-slevel="custom">` +
       `<span>${cx.title} · ${cx.name.toLowerCase()} · ${cx.keysLabel}</span></button></div>`;
  $('#scaleLadder').innerHTML = h;
  $$('#scaleLadder [data-slevel]').forEach(b => b.addEventListener('click', () => selectScaleExercise(b.dataset.slevel)));

  const ex = currentScaleExercise();
  // Name, then how the pattern starts (in degrees) and the keys.
  $('#scaleLevelInfo').innerHTML = '<b></b><span class="degs keys"></span><span class="lvkeys"></span>';
  $('#scaleLevelInfo b').textContent = ex.num ? `${ex.num} · ${ex.title} · ${ex.name}` : `${ex.title} · ${ex.name} · Custom`;
  $('#scaleLevelInfo .degs').textContent = PATTERNS[ex.pattern].shape;
  const best = tempoModel.levelBest(ex.scale, ex.pattern);   // median key
  $('#scaleLevelInfo .lvkeys').textContent = `${ex.keysLabel} · clean best ${best ? `${best} bpm` : '–'}`;
  showScaleCustom();
}

// The builder starts from the current exercise; any change makes a custom
// pick unless it matches a level, which is then selected. A custom pick
// keeps its chips as tapped (an empty pick must not forget the scale).
function showScaleCustom() {
  const ex = currentScaleExercise();
  const sets = { scale: ex.scale, pattern: ex.pattern, keys: ex.keys };
  $$('[data-cs]').forEach(b => b.classList.toggle('active', b.dataset.cs === sets.scale));
  $('#customPatterns').innerHTML = PATTERN_ORDER.map(p =>
    `<button data-cp="${p}" class="${p === sets.pattern ? 'active' : ''}">${PATTERNS[p].chip}</button>`).join('');
  $('#customKeys').innerHTML = NOTES.map((n, k) =>
    `<button data-ck="${k}" class="${sets.keys.includes(k) ? 'active' : ''}">${n}</button>`).join('');
  const n = sets.keys.length;
  $('#scaleCustomHint').textContent = n ? `${SCALES[sets.scale].name}, ${PATTERNS[sets.pattern].name.toLowerCase()}, in ${n} key${n === 1 ? '' : 's'}` : 'Pick at least one key.';
  const change = next => {
    const level = matchScaleLevel(next.scale, next.pattern, next.keys);
    if (!level) { scaleCustom = next; save(SCALE_CUSTOM_KEY, JSON.stringify(scaleCustom)); }
    selectScaleExercise(level ? level.id : 'custom');
  };
  $$('[data-cs]').forEach(b => { b.onclick = () => change({ ...sets, scale: b.dataset.cs }); });
  $$('#customPatterns [data-cp]').forEach(b => b.addEventListener('click', () => change({ ...sets, pattern: b.dataset.cp })));
  $$('#customKeys [data-ck]').forEach(b => b.addEventListener('click', () => {
    const k = Number(b.dataset.ck);
    change({ ...sets, keys: sets.keys.includes(k) ? sets.keys.filter(x => x !== k) : [...sets.keys, k] });
  }));
}
$('#scaleExBtn').addEventListener('click', () => showTab('levels'));
$('#playScaleLevel').addEventListener('click', () => showTab('play'));

// --- Scale stats (E1 step 3): the range map, per level ---
// The map and the pane figures cover one level: runs of its scale ×
// pattern, whichever exercise they came from (a custom run in C counts
// for the level too — events are musical, not per game mode).
let rangeSelected = null;
let scaleEvents = [];           // every scale run in the local window
const levelRuns = l => scaleEvents.filter(e => e.scale === l.scale && runPattern(e) === l.pattern);
function drawRangeMap() {
  const l = SCALE_LEVELS.find(x => x.id === mapLevel);
  $('#mapLevel').value = mapLevel;
  $$('[data-mv]').forEach(b => b.classList.toggle('active', b.dataset.mv === mapView));
  $('#rangeTitle').textContent = mapView === 'range'
    ? 'Recent runs · key × note, low B♭ to high F♯' : 'Recent runs · key × degree, all octaves';
  const runs = levelRuns(l);
  // Each key row ends with that key's auto tempo (clean best, or where it
  // is if nothing cleared yet); the pooled row with the median.
  const rowTempo = rk => {
    if (rk === 'all') { const b = tempoModel.levelBest(l.scale, l.pattern); return b ? String(b) : ''; }
    const k = tempoKey(l.scale, l.pattern, Number(rk));
    const b = tempoModel.best(k), w = tempoModel.working(k);
    return b ? String(b) : w === null ? '' : `(${w})`;
  };
  renderRangeMap($('#rangemap'), runs, l.scale, mapView, rangeSelected, rowTempo);
  // Pane figures: the level's last 20 runs.
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const last = runs.slice(-20);
  const notes = last.flatMap(e => e.expected.filter(x => x[3] !== 'pending'));
  const hit = notes.filter(x => x[3] === 'hit').length;
  const clean = last.filter(e => e.expected.every(x => x[3] === 'hit')).length;
  $('#sstatRuns').textContent = runs.length;
  $('#sstatToday').textContent = runs.filter(e => e.t >= dayStart).length;
  $('#sstatHit').textContent = notes.length ? `${Math.round(100 * hit / notes.length)}%` : '–';
  $('#sstatClean').textContent = last.length ? `${clean} / ${last.length}` : '–';
  const working = tempoModel.levelWorking(l.scale, l.pattern), best = tempoModel.levelBest(l.scale, l.pattern);
  $('#sstatWorking').textContent = working === null ? '–' : `${working} bpm`;
  $('#sstatBest').textContent = best ? `${best} bpm` : '–';
}
// The picker lists every level: "S3 · Major · Thirds up · ascending".
$('#mapLevel').innerHTML = SCALE_LEVELS.map(l => `<option value="${l.id}">${l.num} · ${l.title} · ${l.name}</option>`).join('');
$('#mapLevel').addEventListener('change', e => { mapLevel = e.target.value; rangeSelected = null; drawRangeMap(); });
$$('[data-mv]').forEach(b => b.addEventListener('click', () => { mapView = b.dataset.mv; rangeSelected = null; drawRangeMap(); }));
$('#rangemap').addEventListener('click', e => {
  const cell = e.target.closest('[data-cell]');
  const key = cell ? cell.dataset.cell : null;
  rangeSelected = key && key !== rangeSelected ? key : null;
  drawRangeMap();
});

async function showScaleStats() {
  // First visit: the level being played (a custom pick maps to the level
  // with its scale × pattern, if the ladder has one).
  if (!mapLevel) {
    const ex = currentScaleExercise();
    mapLevel = (SCALE_LEVELS.find(l => l.scale === ex.scale && l.pattern === ex.pattern) || SCALE_LEVELS[0]).id;
  }
  scaleEvents = (await allEvents()).filter(e => e.game === 'scales' && e.expected && !e.falseStart);
  await loadTempo();
  drawRangeMap();
}

// --- Stats (D4) ---
// Tapping a cell selects it (root row narrows to that quality × degree);
// tapping it again, or anywhere else on the matrix, clears it.
let heatSelected = null;
let heatEvents = [];
function drawHeatmap() { renderHeatmap($('#heatmap'), heatEvents, heatSelected); }
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
  const last = events.slice(-100);
  const ok = last.filter(e => e.ok);
  const times = ok.map(e => e.notes[0][1]).sort((a, b) => a - b);
  $('#statAnswers').textContent = events.length;
  $('#statToday').textContent = events.filter(e => e.t >= dayStart).length;
  $('#statAcc').textContent = last.length ? `${Math.round(100 * ok.length / last.length)}%` : '–';
  $('#statMedian').textContent = times.length ? `${(times[times.length >> 1] / 1000).toFixed(2)} s` : '–';
}

// --- ⚙ Sync (A9) ---
function showSyncStatus(res) {
  const el = $('#syncStatus');
  const st = syncState();
  const { repo } = syncConfig();
  if (!repo) {
    el.textContent = 'Off — add a private repo and a token to back up automatically.';
    el.className = 'small-note';
    return;
  }
  const bad = res ? !res.ok : !!st.error;
  const when = st.last ? new Date(st.last).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'never';
  el.textContent = bad ? (res?.message || st.error) : `Synced ${when}${res && (res.added || res.uploaded)
    ? ` · ${res.uploaded} file${res.uploaded === 1 ? '' : 's'} up, ${res.added} answer${res.added === 1 ? '' : 's'} down` : ''}.`;
  el.className = bad ? 'small-note bad' : 'small-note';
}

async function runSync() {
  const res = await sync();
  if (res.off) return;
  showSyncStatus(res);
  // A fresh install got its settings back: reload so they take effect.
  if (res.settingsRestored) location.reload();
  if (res.added && game === 'scales') loadTempo();     // runs from elsewhere move the staircases
  if (res.added && !$('#view-stats').hidden) showStats();
  if (res.added && !$('#view-pattern-stats').hidden) showPatternStats();
  else if (res.added && !$('#view-scale-stats').hidden) showScaleStats();
}

$('#syncRepo').value = syncConfig().repo;
$('#syncToken').value = syncConfig().token;
$('#syncSave').addEventListener('click', () => {
  setSyncConfig($('#syncRepo').value, $('#syncToken').value);
  $('#syncStatus').textContent = 'Syncing…';
  runSync();
});

// --- ⚙ Backup (A7) ---
const menuMsg = $('#menuMsg');
function say(text, bad = false) {
  menuMsg.textContent = text;
  menuMsg.className = bad ? 'bad' : '';
}
// --- Patterns (P game): Play pane, library + editor on Levels ---
const PSEL_KEY = 'woodshed.patternSel';    // the selected pattern's id
const PEX_KEY = 'woodshed.patternEx';      // practice path
const PBPM_KEY = 'woodshed.patternBpm';    // a tempo of its own (quarter notes), set by the player
let patternId = load(PSEL_KEY);
let pExercise = PRACTICE_EXERCISES.includes(load(PEX_KEY)) ? load(PEX_KEY) : PRACTICE_EXERCISES[0];
let pStage = null;                          // learn stage picked by hand; null = where progress says
let pProgress = new Map();                  // pattern id → patternProgress()
const currentPattern = () => { const lib = loadLibrary(); return lib.find(p => p.id === patternId) || lib[0] || null; };
const currentStage = p => pStage ?? (p && pProgress.get(p.id)?.stage) ?? 0;
const ptempo = mountTempo($('#ptempo'), { min: 60, value: Math.max(60, Number(load(PBPM_KEY)) || 60),
                                          note: '♩ quarters', onChange: v => save(PBPM_KEY, String(v)) });

async function loadPatternProgress() {
  const evs = (await allEvents()).filter(e => e.game === 'patterns');
  pProgress = new Map(loadLibrary().map(p => [p.id, patternProgress(evs, p.id)]));
  showSettings();
  if (!$('#view-pattern-levels').hidden) showPatternLevels();
}

function showPatternSettings() {
  const p = currentPattern();
  const prog = p && pProgress.get(p.id);
  $('#pCardName').textContent = p ? p.name : 'No pattern yet';
  $('#pCardDeg').textContent = p ? degreesText(p) : 'build one ›';
  $('#pStages').hidden = mode !== 'learn';
  $('#pExercises').hidden = mode === 'learn';
  const stage = currentStage(p);
  $$('[data-pstage]').forEach(b => b.classList.toggle('active', Number(b.dataset.pstage) === stage));
  $('#pExercises').innerHTML = PRACTICE_EXERCISES.map(id =>
    `<button data-pex="${id}" class="${id === pExercise ? 'active' : ''}">${EXERCISES[id].name}${prog?.done.has(id) ? ' ✓' : ''}</button>`).join('');
  if (patternsRunning()) return;
  // Idle stage: the pattern on top, what Start will do underneath.
  $('#pShow').innerHTML = p ? `<b>${esc(p.name)}</b>${patternHTML(p)}` : '<b>Build a pattern in Levels</b>';
  $('#pTitle').textContent = !p ? '' : mode === 'learn' ? `Cycle of 4ths · ×${STAGES[stage]}` : EXERCISES[pExercise].name;
  const msg = $('#pMsg');
  msg.hidden = !p;
  msg.innerHTML = !p ? '' : mode === 'learn'
    ? `<b>Learn</b> — the pattern ${STAGES[stage]}× on each chord round the cycle of 4ths. Nothing is shown ahead: ` +
      'play it from the top on each chord. Two solid runs (95 %) and it moves to fewer times per chord.<br><small>Start goes straight into a one-bar count-in.</small>'
    : `<b>Practice</b> — once on each chord, ${EXERCISES[pExercise].name.toLowerCase()}.<br><small>Start goes straight into a one-bar count-in.</small>`;
}
$('#pCard').addEventListener('click', () => showTab('levels'));
$('#pStages').addEventListener('click', e => {
  const b = e.target.closest('[data-pstage]');
  if (b) { pStage = Number(b.dataset.pstage); showSettings(); }
});
$('#pExercises').addEventListener('click', e => {
  const b = e.target.closest('[data-pex]');
  if (b) { pExercise = b.dataset.pex; save(PEX_KEY, pExercise); showSettings(); }
});

// The library on the stage: each pattern with its height-drawn shape and
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
  const marks = STAGES.map((n, i) => (prog.learnt || i < prog.stage ? `<b>×${n} ✓</b>` : `×${n}`)).join(' ');
  return `Learn ${marks}<br>Practice ${prog.done.size} / ${PRACTICE_EXERCISES.length}`;
}

function showPatternLevels() {
  const lib = loadLibrary();
  const sel = currentPattern();
  $('#pLib').innerHTML = lib.length ? lib.map(p => `<div class="pcard${sel && p.id === sel.id ? ' active' : ''}" data-psel="${p.id}">` +
      `<span class="pname">${esc(p.name)}</span>${patternHTML(p)}` +
      `<span class="pprog">${stageText(pProgress.get(p.id))}</span>` +
      `<span class="pact"><button data-pedit="${p.id}">edit</button><button data-pdel="${p.id}">✕</button></span></div>`).join('')
    : '<div class="small-note">No patterns yet — build one on the right (an example is loaded), then Save.</div>';
  if (!draft) editDraft(null);
  showEditor();
}

function showEditor() {
  $$('[data-pq]').forEach(b => b.classList.toggle('active', b.dataset.pq === draft.quality));
  $('#pEdit').innerHTML = draft.notes.length ? patternHTML(draft, draft.sel) : '<span class="small-note">Tap degrees below</span>';
  $('#pKeys').innerHTML = PATTERN_DEGREES.map(d => `<button data-pd="${d}">${degreeLabel(d)}</button>`).join('');
  $('#pName').value = draft.name;
  $('#pName').placeholder = draft.notes.length ? autoName(draft) : 'name (optional)';
  const n = draft.notes.length;
  $('#pHint').textContent = n < MIN_NOTES ? `At least ${MIN_NOTES} notes. Each new note goes to the nearest octave; ↑ ↓ move the selected one.`
    : `${n} notes to a bar — ${n === 4 ? 'quarters' : n === 6 ? 'triplets' : 'evenly spread'}.${draft.id ? ' Editing' : ' New'}${n >= MAX_NOTES ? ' · full' : ''}`;
  $('#pSave').disabled = n < MIN_NOTES;
}

$('#pKeys').addEventListener('click', e => {
  const b = e.target.closest('[data-pd]');
  if (!b || draft.notes.length >= MAX_NOTES) return;
  const at = draft.sel + 1;
  const deg = b.dataset.pd;
  draft.notes.splice(at, 0, { deg, oct: nearestOct(draft.quality, deg, draft.notes[at - 1]) });
  draft.sel = at;
  showEditor();
});
$('#pEdit').addEventListener('click', e => {
  const n = e.target.closest('[data-i]');
  if (n) { draft.sel = Number(n.dataset.i); showEditor(); }
});
const shiftOct = d => {
  const n = draft.notes[draft.sel];
  if (n && Math.abs(n.oct + d) <= 2) { n.oct += d; showEditor(); }
};
$('#pUp').addEventListener('click', () => shiftOct(1));
$('#pDown').addEventListener('click', () => shiftOct(-1));
$('#pDel').addEventListener('click', () => {
  if (draft.sel < 0) return;
  draft.notes.splice(draft.sel, 1);
  draft.sel = Math.min(draft.sel, draft.notes.length - 1);
  showEditor();
});
$$('[data-pq]').forEach(b => b.addEventListener('click', () => { draft.quality = b.dataset.pq; showEditor(); }));
$('#pName').addEventListener('input', e => { draft.name = e.target.value; });
$('#pNew').addEventListener('click', () => { editDraft(null); draft.notes = []; draft.sel = -1; showEditor(); });
$('#pSave').addEventListener('click', async () => {
  // Changing the notes of a pattern that has runs makes a new pattern.
  const played = !!draft.id && (await allEvents()).some(e => e.game === 'patterns' && e.patternId === draft.id);
  const saved = savePattern(draft, played);
  patternId = saved.id;
  save(PSEL_KEY, patternId);
  pStage = null;
  editDraft(saved);
  await loadPatternProgress();
  showPatternLevels();
  runSync();                    // the library goes to its own file in the data repo
});
$('#pLib').addEventListener('click', e => {
  const edit = e.target.closest('[data-pedit]');
  const del = e.target.closest('[data-pdel]');
  const card = e.target.closest('[data-psel]');
  const lib = loadLibrary();
  if (del) {
    const p = lib.find(x => x.id === del.dataset.pdel);
    if (p && confirm(`Delete "${p.name}"? Its runs stay in your history.`)) {
      deletePattern(p.id);
      if (patternId === p.id) patternId = null;
      showPatternLevels();
      showSettings();
      runSync();
    }
    return;
  }
  if (edit) { editDraft(lib.find(x => x.id === edit.dataset.pedit)); showEditor(); }
  if (card) {
    patternId = card.dataset.psel;
    save(PSEL_KEY, patternId);
    pStage = null;
    showPatternLevels();
    showSettings();
  }
});

// --- Pattern stats: key × note of the pattern, for the pattern picked ---
let pStatSelected = null;       // a tapped cell key, or null
let pStatEvents = [];
async function showPatternStats() {
  pStatEvents = (await allEvents()).filter(e => e.game === 'patterns' && e.expected);
  // The picker: every library pattern, plus any played pattern since deleted.
  const lib = loadLibrary();
  const names = new Map(lib.map(p => [p.id, p]));
  for (const e of pStatEvents) if (!names.has(e.patternId)) names.set(e.patternId, { id: e.patternId, ...e.pattern, name: `${e.pattern.name} (deleted)` });
  const cur = currentPattern();
  const pick = names.has($('#pStatSel').value) ? $('#pStatSel').value : cur?.id || [...names.keys()][0];
  $('#pStatSel').innerHTML = [...names.values()].map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if (pick) $('#pStatSel').value = pick;
  drawPatternStats();
}
function drawPatternStats() {
  const id = $('#pStatSel').value;
  const lib = loadLibrary();
  const p = lib.find(x => x.id === id) || pStatEvents.find(e => e.patternId === id)?.pattern;
  if (!p) { $('#pGrid').innerHTML = '<div class="small-note">No pattern yet.</div>'; return; }
  const grid = patternGrid(pStatEvents, id);
  const n = p.notes.length;
  const fig = list => {
    if (!list?.length) return null;
    const hits = list.filter(a => a.hit);
    const off = hits.length ? Math.round(hits.reduce((a, b) => a + (b.off || 0), 0) / hits.length) : null;
    return { n: list.length, hits: hits.length, off, score: list.reduce((a, b) => a + b.score, 0) / list.length };
  };
  let h = `<div class="rm-grid" style="grid-template-columns: 28px repeat(${n}, 1fr)"><div></div>` +
    p.notes.map(x => `<div class="rm-head">${degreeLabel(x.deg)}</div>`).join('');
  for (const [rk, label] of [['all', 'All'], ...NOTES.map((nm, k) => [String(k), nm])]) {
    h += `<div class="rm-row${rk === 'all' ? ' all' : ''}">${label}</div>`;
    for (let j = 0; j < n; j++) {
      const key = `${rk}|${j}`;
      const f = fig(grid.get(key));
      h += `<div class="rm-cell${f ? '' : ' empty'}${key === pStatSelected ? ' selected' : ''}" data-cell="${key}"` +
           `${f ? ` style="background:${colour(f.score)}"` : ''}></div>`;
    }
  }
  h += '</div>';
  let cap = 'Tap a cell: which chord, which note of the pattern, how often right.';
  if (pStatSelected) {
    const [rk, j] = pStatSelected.split('|');
    const f = fig(grid.get(pStatSelected));
    const where = `${rk === 'all' ? 'All chords' : `${NOTES[Number(rk)]}${QUALITY_TEXT[p.quality]}`} · note ${Number(j) + 1} (the ${degreeLabel(p.notes[j].deg)})`;
    cap = !f ? `${where} — not played yet.` : `${where} — ${f.hits} of ${f.n} right` +
      (f.off === null ? '' : f.off > 15 ? ` · ${f.off} ms late` : f.off < -15 ? ` · ${-f.off} ms early` : ' · on the beat');
  }
  $('#pGrid').innerHTML = h + `<div class="rm-cap">${cap}</div>`;
  // Pane figures: this pattern's last 20 runs, and where it stands.
  const runs = pStatEvents.filter(e => e.patternId === id);
  const last = runs.slice(-20);
  const notes = last.flatMap(e => e.expected);
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const prog = patternProgress(pStatEvents, id);
  $('#pstRuns').textContent = runs.length;
  $('#pstToday').textContent = runs.filter(e => e.t >= dayStart).length;
  $('#pstHit').textContent = notes.length ? `${Math.round(100 * notes.filter(x => x[4] === 'hit').length / notes.length)}%` : '–';
  $('#pstSolid').textContent = last.length ? `${last.filter(e => runRate(e) >= SOLID).length} / ${last.length}` : '–';
  $('#pstLearn').textContent = prog.learnt ? 'learnt ✓' : `×${STAGES[prog.stage]}`;
  $('#pstPractice').textContent = `${prog.done.size} / ${PRACTICE_EXERCISES.length}`;
}
$('#pGrid').addEventListener('click', e => {
  const cell = e.target.closest('[data-cell]');
  const key = cell ? cell.dataset.cell : null;
  pStatSelected = key && key !== pStatSelected ? key : null;
  drawPatternStats();
});
$('#pStatSel').addEventListener('change', () => { pStatSelected = null; drawPatternStats(); });

// --- ⚙ Latency ---
let latency = Number(load(LATENCY_KEY)) || 0;
function showLatency(extra = '') {
  const set = load(LATENCY_KEY) !== null;
  $('#latencyVal').textContent = extra || (set
    ? `${latency} ms — notes are judged ${Math.abs(latency)} ms ${latency >= 0 ? 'earlier' : 'later'} than they arrive.`
    : 'Not measured — notes are judged as they arrive.');
}
// The measuring view sits on the ⚙ stage: 8 dots, one lighting per click.
function endLatencyRun() {
  stopLatency();
  $('#latencyRun').hidden = true;
  $('#latencyBtn').disabled = false;
}
$('#latencyBtn').addEventListener('click', () => {
  if (isRunning() || scalesRunning() || calibrating) return;
  $('#latencyBtn').disabled = true;
  $('#latencyRun').hidden = false;
  $('#latencyDots').innerHTML = '<i></i>'.repeat(8);
  showLatency('Listen: 4 clicks, then blow any note on each of the next 8.');
  startLatency({
    onProgress: n => $$('#latencyDots i').forEach((d, i) => d.classList.toggle('on', i < n)),
    onDone: res => {
      endLatencyRun();
      if (res.error) { showLatency(res.error); return; }
      latency = res.latency;
      save(LATENCY_KEY, String(latency));
      showLatency(`${latency} ms (spread ±${res.spread} ms over ${res.n} notes) — saved. ` +
                  (res.spread > 40 ? 'Wide spread: measure again for a steadier number.' : ''));
    },
  });
});
showLatency();

async function showCount() {
  const n = await countEvents();
  $('#menuCount').textContent = `${n} answer${n === 1 ? '' : 's'} stored on this device.`;
}
$('#saveBackup').addEventListener('click', async () => {
  const n = await downloadBackup();
  say(`Saved ${n} answer${n === 1 ? '' : 's'} — check your Downloads.`);
});
$('#loadBackupBtn').addEventListener('click', () => $('#loadBackup').click());
$('#loadBackup').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';                 // allow loading the same file again
  if (!file) return;
  try {
    const { added, skipped } = await loadBackup(await file.text());
    const answers = n => `${n} answer${n === 1 ? '' : 's'}`;
    say(`Loaded ${answers(added)}; ${skipped} already here. Restarting…`);
    // Reload so restored settings (calibration, mode, …) take effect.
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    say(err.message, true);
  }
});

showHint();
showSettings();
showTab('play');   // applies the stage for the remembered game
showSyncStatus();
if (game === 'scales') loadTempo();   // the auto-tempo staircases, from the cached summary
if (game === 'patterns') loadPatternProgress();
connectMidi(onNote, onStatus);
runSync();   // pull anything new, push anything pending (A9)

// Offline support and fresh files after deploys; see sw.js.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
