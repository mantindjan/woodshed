// The shell: the game switch, the control panel's tabs (Play · Levels ·
// Stats · ⚙), the horn (connection, calibration, note routing), Start and
// the run controls, and ⚙ (latency, sync, backup). Each game's own panel —
// its Play settings, Levels and Stats — is a module of its own, all with
// the same shape (UI below): degrees-ui.js, lanes-ui.js (scales and
// arpeggios), cells-ui.js, guides-ui.js. Shared settings and helpers: app.js.
//
// Pitch spaces: see music.js. Calibration stores the MIDI pitch class the
// horn sends for a fingered written C; that one number converts both ways
// between written (display, judging) and concert (the Rhodes).

import { $, $$, save, load, st, hooks, CALIB_KEY, OFFSET_KEY, GAME_KEY, MODE_KEY, PICK_KEY, LATENCY_KEY } from './app.js';
import { connectMidi } from './midi.js';
import { WRITTEN_MIDDLE_C, writtenPc } from './music.js';
import { noteHTML } from './notation.js';
import { downloadBackup, loadBackup, countEvents } from './backup.js';
import { sync, syncConfig, setSyncConfig, syncState } from './sync.js';
import { startLatency, stopLatency, latencyNote, measuring } from './latency.js';
import { degreesUI } from './degrees-ui.js';
import { lanesUI, isLane } from './lanes-ui.js';
import { cellsUI } from './cells-ui.js';
import { guidesUI } from './guides-ui.js';

// Each game's panel: render() draws its Play settings; canStart(); start();
// showLevels(), showStats(); note(midi) while it runs; running(), stop();
// the lane games and cells also paused(), pause(), resume(), restart();
// optional onEnter() when switched to, onSync(res) after new data arrives.
const UI = { degrees: degreesUI, scales: lanesUI, arpeggios: lanesUI, cells: cellsUI, guides: guidesUI };
const ui = () => UI[st.game];

const statusEl = $('#status');
const noteEl = $('#note');
const rawEl = $('#raw');
const hintEl = $('#hint');
const calibBtn = $('#calibrate');
const connectBtn = $('#connect');
const startBtn = $('#start');
const stopBtn = $('#stop');
let calibrating = false;

// --- Tabs: each selects a pane (right) and a view (left stage). ---
// A view or pane shows when it's for this tab and (if game-specific) the
// current game: each game has its own Play · Levels · Stats; ⚙ is shared.
// data-for, not data-game: that attribute is reserved for the game buttons.
// data-for may list several games ("scales arpeggios": one engine, one set of views).
const forGame = el => !el.dataset.for || el.dataset.for.split(' ').includes(st.game);
let currentTab = 'play';
function showTab(tab) {
  currentTab = tab;
  $$('button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.pane').forEach(p => { p.hidden = !(p.dataset.pane === tab && forGame(p)); });
  // Views use data-view, not data-tab: sharing the tab buttons' attribute
  // made `[data-tab=…]` match hidden views too.
  $$('.view').forEach(v => { v.hidden = !(v.dataset.view === tab && forGame(v)); });
  if (tab === 'levels') ui().showLevels();
  if (tab === 'stats') ui().showStats();
  if (tab === 'horn') showCount();
  else if (measuring()) endLatencyRun();
}
$$('button[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// --- Horn status and calibration ---
function showHint() {
  if (calibrating) hintEl.textContent = 'Play middle C — the C in the third space of the staff.';
  else if (st.calib === null) hintEl.textContent = 'Not calibrated — tap Calibrate and play middle C.';
  else if (isLane(st.game) && st.calibOffset === null) hintEl.textContent = `Recalibrate on middle C for ${st.game} — the octave matters.`;
  else hintEl.textContent = 'Calibrated · redo after changing the horn’s voice.';
  showHornWarn();
}

// The horn controls live in ⚙; Play only says when something needs fixing,
// and a tap goes there.
function showHornWarn() {
  const el = $('#hornWarn');
  const problem = statusEl.dataset.state !== 'connected' ? 'Horn not connected'
    : st.calib === null ? 'Horn not calibrated'
    : isLane(st.game) && st.calibOffset === null ? `Recalibrate on middle C for ${st.game}` : '';
  el.hidden = !problem;
  el.textContent = problem ? `● ${problem} — fix in ⚙ ›` : '';
}

// Every panel from the settings: the shared ones here, each game's own
// labels by its panel (all of them — a game's card is drawn even while
// another is on screen, so switching shows it at once).
function showSettings() {
  document.body.dataset.game = st.game;
  $$('button[data-game]').forEach(b => b.classList.toggle('active', b.dataset.game === st.game));
  // Learn/Practice (lane games, Cells) and Weak/Random (degrees, lane games) are shared settings.
  $$('[data-smode], [data-cell-mode]').forEach(b => b.classList.toggle('active', (b.dataset.smode || b.dataset.cellMode) === st.mode));
  $$('[data-pick], [data-spick]').forEach(b => b.classList.toggle('active', (b.dataset.pick || b.dataset.spick) === st.pick));
  degreesUI.render();
  lanesUI.render();
  if (st.game === 'cells') cellsUI.render();
  if (st.game === 'guides') guidesUI.render();
  startBtn.disabled = !ui().canStart();
  showHint();
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
    st.calib = midi % 12;
    save(CALIB_KEY, String(st.calib));
    // Played on middle C (written C5), so the octave is known too.
    st.calibOffset = midi - WRITTEN_MIDDLE_C;
    save(OFFSET_KEY, String(st.calibOffset));
    const back = backToPlay;
    setCalibrating(false);
    noteEl.innerHTML = noteHTML(0);
    if (back) showTab('play');
    return;
  }
  if (st.calib === null) noteEl.textContent = '?';
  else noteEl.innerHTML = noteHTML(writtenPc(midi, st.calib));
  ui().note(midi);
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

// --- Start, and the controls while a game runs ---
// Idle vs running: during a round only the run controls work, and the tabs
// are locked on Play.
function showRunning(running) {
  $('#idle').hidden = running;
  startBtn.hidden = running;
  // The lane games and cells get play/pause · restart · stop (#scaleCtl
  // serves them all); the degree drill a Stop.
  const ctl = st.game !== 'degrees';
  stopBtn.hidden = !running || ctl;
  $('#scaleCtl').hidden = !running || !ctl;
  if (ctl) showPlayPause();
  $$('.pane[data-pane="play"] button, button[data-tab], button[data-game]').forEach(b => {
    if (b !== stopBtn && !b.closest('#scaleCtl')) b.disabled = running;
  });
}

startBtn.addEventListener('click', () => {
  // Every game judges in written pitch, which needs calibration first; the
  // lane games also need the octave (a middle-C calibration).
  if (st.calib === null || (isLane(st.game) && st.calibOffset === null)) {
    showTab('horn');
    setCalibrating(true);
    backToPlay = true;
    return;
  }
  if (calibrating) setCalibrating(false);
  showRunning(true);
  ui().start();
});
// The play/pause button shows what a tap does: pause while playing, play
// (resume) while paused.
const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
function showPlayPause() {
  const paused = ui().paused();
  $('#scalePlay').innerHTML = paused ? PLAY_ICON : PAUSE_ICON;
  $('#scalePlay').setAttribute('aria-label', paused ? 'Resume' : 'Pause');
}
// The stage can pause and carry on too (a tap on the lane, scales.js).
document.addEventListener('woodshed:pause', () => { if (ui().running()) showPlayPause(); });
$('#scalePlay').addEventListener('click', () => {
  if (ui().paused()) ui().resume(); else ui().pause();
  showPlayPause();
});
$('#scaleRestart').addEventListener('click', () => {
  ui().restart();
  showPlayPause();
});
$('#scaleStop').addEventListener('click', () => ui().stop());
stopBtn.addEventListener('click', () => { if (ui().running()) ui().stop(); });

// --- Game switch and the shared settings ---
$$('button[data-game]').forEach(b => b.addEventListener('click', () => {
  st.game = b.dataset.game; save(GAME_KEY, st.game); showSettings();
  ui().onEnter?.();
  showTab(currentTab === 'horn' ? 'play' : currentTab);
}));
$$('[data-smode], [data-cell-mode]').forEach(b => b.addEventListener('click', () => {
  st.mode = b.dataset.smode || b.dataset.cellMode; save(MODE_KEY, st.mode); lanesUI.clearRecap(); showSettings();
}));
$$('[data-pick], [data-spick]').forEach(b => b.addEventListener('click', () => {
  st.pick = b.dataset.pick || b.dataset.spick; save(PICK_KEY, st.pick); lanesUI.clearRecap(); showSettings();
}));
calibBtn.addEventListener('click', () => setCalibrating(!calibrating));   // a second tap cancels
connectBtn.addEventListener('click', () => connectMidi(onNote, onStatus));
$('#hornWarn').addEventListener('click', () => showTab('horn'));

// --- ⚙ Sync (A9) ---
// --- ⚙ Sync (A9) ---
function showSyncStatus(res) {
  const el = $('#syncStatus');
  const ss = syncState();
  const { repo } = syncConfig();
  if (!repo) {
    el.textContent = 'Off — add a private repo and a token to back up automatically.';
    el.className = 'small-note';
    return;
  }
  const bad = res ? !res.ok : !!ss.error;
  const when = ss.last ? new Date(ss.last).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'never';
  el.textContent = bad ? (res?.message || ss.error) : `Synced ${when}${res && (res.added || res.uploaded)
    ? ` · ${res.uploaded} file${res.uploaded === 1 ? '' : 's'} up, ${res.added} answer${res.added === 1 ? '' : 's'} down` : ''}.`;
  el.className = bad ? 'small-note bad' : 'small-note';
}

async function runSync() {
  const res = await sync();
  if (res.off) return;
  showSyncStatus(res);
  // A fresh install got its settings back: reload so they take effect.
  if (res.settingsRestored) location.reload();
  ui().onSync?.(res);                 // runs from elsewhere: staircases, stats
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

// --- ⚙ Latency ---
function showLatency(extra = '') {
  const set = load(LATENCY_KEY) !== null;
  $('#latencyVal').textContent = extra || (set
    ? `${st.latency} ms — notes are judged ${Math.abs(st.latency)} ms ${st.latency >= 0 ? 'earlier' : 'later'} than they arrive.`
    : 'Not measured — notes are judged as they arrive.');
}
// The measuring view sits on the ⚙ stage: 8 dots, one lighting per click.
function endLatencyRun() {
  stopLatency();
  $('#latencyRun').hidden = true;
  $('#latencyBtn').disabled = false;
}
$('#latencyBtn').addEventListener('click', () => {
  if (ui().running() || calibrating) return;
  $('#latencyBtn').disabled = true;
  $('#latencyRun').hidden = false;
  $('#latencyDots').innerHTML = '<i></i>'.repeat(8);
  showLatency('Listen: 4 clicks, then blow any note on each of the next 8.');
  startLatency({
    onProgress: n => $$('#latencyDots i').forEach((d, i) => d.classList.toggle('on', i < n)),
    onDone: res => {
      endLatencyRun();
      if (res.error) { showLatency(res.error); return; }
      st.latency = res.latency;
      save(LATENCY_KEY, String(st.latency));
      showLatency(`${st.latency} ms (spread ±${res.spread} ms over ${res.n} notes) — saved. ` +
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

Object.assign(hooks, { showSettings, showTab, runSync, showRunning });
showSettings();
showTab('play');   // applies the stage for the remembered game
showSyncStatus();
ui().onEnter?.();  // lanes: the auto-tempo staircases; cells: progress
connectMidi(onNote, onStatus);
runSync();   // pull anything new, push anything pending (A9)

// Offline support and fresh files after deploys; see sw.js.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
