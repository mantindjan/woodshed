// The lane games' panel — Scales (E1) and Arpeggios (F1), one engine
// (scales.js) and one set of views and panes: the Play settings (exercise
// card, tempo with Auto/Fixed, misses), the stage between runs (what's next,
// or the session recap), the ladder and custom builder (E1 step 2), and the
// range map stats (E1 step 3). Each game keeps its own level and custom pick.

import { $, $$, load, save, loadJSON, st, hooks } from './app.js';
import { QUALITY_TEXT, NOTES, SCALES } from './music.js';
import { startScales, stopScales, scaleNote, scalesRunning, nextKey, nudgeTempo, toggleHint, ownStart,
         pauseScales, resumeScales, restartScales, scalesPaused, setScalesBpm } from './scales.js';
import { mountTempo } from './tempo.js';
import { allEvents } from './events.js';
import { getSummary } from './summary.js';
import { SCALE_LEVELS, GAME_SCALES, LANE_GAMES, levelsOf, PATTERNS, PATTERN_ORDER, scaleExercise as resolveScaleExercise, matchScaleLevel, createKeyModel, runPattern } from './scalelevels.js';
import { renderRangeMap } from './rangemap.js';
import { createRating, timedScore, paneFigures } from './rating.js';
import { createTempoModel, tempoKey, pipText, pips, runOutcome } from './scaletempo.js';

const SCALE_EX_KEY = 'woodshed.scaleExercise';   // scale level id or 'custom'
const SCALE_CUSTOM_KEY = 'woodshed.scaleCustom'; // {scale, pattern, keys: [written pcs]}
const BPM_KEY = 'woodshed.bpm';                  // the Fixed tempo
const TEMPO_AUTO_KEY = 'woodshed.tempoAuto';     // 'auto' | 'fixed' (E4)
const MISSES_KEY = 'woodshed.misses';

export const isLane = g => LANE_GAMES.includes(g);
// The lane game on screen (scales when another game is: its labels are
// still drawn).
const laneGame = () => (isLane(st.game) ? st.game : 'scales');

const LANE_KEYS = {
  scales: [SCALE_EX_KEY, SCALE_CUSTOM_KEY, { scale: 'major', pattern: 'up', keys: [0] }],
  arpeggios: ['woodshed.arpExercise', 'woodshed.arpCustom', { scale: 'arp-7', pattern: 'arp', keys: [0] }],
};
// Each starts on its first rung (major linear up; the △ arpeggio).
const laneEx = Object.fromEntries(LANE_GAMES.map(g => [g, load(LANE_KEYS[g][0]) || levelsOf(g)[0].id]));
const laneCustom = Object.fromEntries(LANE_GAMES.map(g => [g, loadJSON(LANE_KEYS[g][1], LANE_KEYS[g][2])]));
const currentScaleExercise = () => resolveScaleExercise(laneEx[laneGame()], laneCustom[laneGame()], laneGame());
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
let scaleRecap = null;             // the last session's recap, shown until something changes
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
  hooks.showSettings();
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
  // Both modes draw keys the same way, each run (toward the weak ones —
  // today's runs included — or evenly).
  const next = `${ex.keys.length > 1 ? (st.pick === 'weak' ? 'Keys drawn toward your weak ones, today\'s runs included' : 'Keys at random') : `${NOTES[ex.keys[0]]} only`}` +
               (tempoAuto ? ' · each at its own tempo' : ` · ${fixedBpm} bpm`);
  const how = st.mode === 'learn'
    ? 'The whole run is laid out; a line sweeps across it in time — play along, nothing stops.' +
      (tempoAuto ? ' Clean runs raise a key\'s tempo.' : '') + ' Next key skips to another.'
    : `Notes scroll to the line — hit each on the beat. ${misses} miss${misses === 1 ? '' : 'es'} and the run starts again.` +
      (tempoAuto ? ' Three clean runs in a row raise that key\'s tempo; a bad one lowers it.' : '');
  el.innerHTML = `<div class="label">${st.mode === 'learn' ? 'Learn' : 'Practice'} · next up</div>` +
    `<div class="big">${exName}</div><div class="what">${next}</div><div class="how">${how}</div>` +
    `<div class="go">Press Start: it names the start note and counts you in — tap My note to start where you like.` +
    `${PATTERNS[ex.pattern].rootOnly && st.mode === 'learn' ? ' Stuck? Tap Hint to see the chord spelled out.' : ''}</div>`;
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

$$('[data-misses]').forEach(b => b.addEventListener('click', () => { misses = Number(b.dataset.misses); save(MISSES_KEY, String(misses)); hooks.showSettings(); }));
// B3: tempo control, remembered (the Fixed tempo).
let fixedBpm = Math.max(60, Number(load(BPM_KEY)) || 80);
// Min 60, as auto tempo's floor (boss: "the minimal tempo should be 60").
const tempo = mountTempo($('#tempo'), { min: 60, value: fixedBpm,
                                        onChange: v => { fixedBpm = v; save(BPM_KEY, String(v)); setScalesBpm(v); if (isLane(st.game)) showScaleIdle(); } });
// Auto | Fixed: one small toggle under the bpm (a full-width row pushed the
// exercise card off the pane at 390 px). Notes are always eighths.
$('#tempo .bpm').insertAdjacentHTML('beforeend', '<button id="tempoMode" class="tmode"></button>');
$('#tempoMode').addEventListener('click', () => {
  tempoAuto = !tempoAuto; save(TEMPO_AUTO_KEY, tempoAuto ? 'auto' : 'fixed'); scaleRecap = null; hooks.showSettings();
});

$('#scaleNext').addEventListener('click', nextKey);
$('#scaleOwn').addEventListener('click', ownStart);
$('#scaleHint').addEventListener('click', toggleHint);
$$('#scaleNudge [data-sn]').forEach(b => b.addEventListener('click', () => nudgeTempo(Number(b.dataset.sn))));

// --- Scale levels (E1 step 2): ladder on the stage, custom builder in the pane ---
function selectScaleExercise(id) {
  laneEx[laneGame()] = id;
  scaleRecap = null;
  save(LANE_KEYS[laneGame()][0], id);
  hooks.showSettings();
  showScaleLevels();
}

// One block per scale, its levels as pills (number · pattern · tempo pips),
// then the custom pick — the same shape as the degree ladder. A pip per
// tier of the tempo scale (60 72 84 96 112 126) the clean best has reached.
async function showScaleLevels() {
  await loadTempo();                 // the cached summary may have been rebuilt
  const lg = laneGame();
  const pill = l => `<button class="lvl${l.id === laneEx[lg] ? ' active' : ''}" data-slevel="${l.id}">` +
    `<b>${l.num}</b><span>${l.name}</span><i>${pipText(tempoModel.levelBest(l.scale, l.pattern))}</i></button>`;
  let h = '';
  for (const sc of GAME_SCALES[lg]) {
    h += `<div class="tier">${SCALES[sc].name}</div><div class="lrow">` +
         SCALE_LEVELS.filter(l => l.scale === sc).map(pill).join('') + '</div>';
  }
  const cx = resolveScaleExercise('custom', laneCustom[lg], lg);
  h += `<div class="tier">Your own</div><div class="lrow">` +
       `<button class="lvl${laneEx[lg] === 'custom' ? ' active' : ''}" data-slevel="custom">` +
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
  const lg = laneGame();
  const sets = { scale: ex.scale, pattern: ex.pattern, keys: ex.keys };
  // The game's scales (major / pentatonic, or the four chords), and for
  // scales its patterns — an arpeggio has the one.
  $('#customScales').innerHTML = GAME_SCALES[lg].map(sc =>
    `<button data-cs="${sc}" class="${sc === sets.scale ? 'active' : ''}">${SCALES[sc].chord ? QUALITY_TEXT[SCALES[sc].chord] : SCALES[sc].name}</button>`).join('');
  $('#customPatterns').hidden = lg === 'arpeggios';
  $('#customPatterns').innerHTML = PATTERN_ORDER.map(p =>
    `<button data-cp="${p}" class="${p === sets.pattern ? 'active' : ''}">${PATTERNS[p].chip}</button>`).join('');
  $('#customKeys').innerHTML = NOTES.map((n, k) =>
    `<button data-ck="${k}" class="${sets.keys.includes(k) ? 'active' : ''}">${n}</button>`).join('');
  const n = sets.keys.length;
  $('#scaleCustomHint').textContent = n ? `${SCALES[sets.scale].name}, ${PATTERNS[sets.pattern].name.toLowerCase()}, in ${n} key${n === 1 ? '' : 's'}` : 'Pick at least one key.';
  const change = next => {
    const level = matchScaleLevel(next.scale, next.pattern, next.keys);
    if (!level) { laneCustom[lg] = next; save(LANE_KEYS[lg][1], JSON.stringify(next)); }
    selectScaleExercise(level ? level.id : 'custom');
  };
  $$('[data-cs]').forEach(b => { b.onclick = () => change({ ...sets, scale: b.dataset.cs }); });
  $$('#customPatterns [data-cp]').forEach(b => b.addEventListener('click', () => change({ ...sets, pattern: b.dataset.cp })));
  $$('#customKeys [data-ck]').forEach(b => b.addEventListener('click', () => {
    const k = Number(b.dataset.ck);
    change({ ...sets, keys: sets.keys.includes(k) ? sets.keys.filter(x => x !== k) : [...sets.keys, k] });
  }));
}
$('#scaleExBtn').addEventListener('click', () => hooks.showTab('levels'));
$('#playScaleLevel').addEventListener('click', () => hooks.showTab('play'));

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
  // Ratings from practice runs only: learn lays the whole run out with its
  // names and never stops — the easier version (boss, 2026-09-30). Counts
  // and the tempo marks still take every run.
  const rated = runs.filter(e => e.mode === 'practice');
  renderRangeMap($('#rangemap'), rated, l.scale, mapView, rangeSelected, rowTempo);
  // Pane figures: the whole level now and its best day (rating.js); its
  // clean runs among the last 20.
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const last = runs.slice(-20);
  const level = createRating();
  for (const e of rated) for (const x of e.expected) if (x[3] !== 'pending') level.add('level', e.t, timedScore(x[3] === 'hit', x[4]));
  const fig = paneFigures(level.get('level'));
  const clean = last.filter(e => runOutcome(e) === 'clean').length;   // as the tempo judges it: the horn's middle
  $('#sstatRuns').textContent = runs.length;
  $('#sstatToday').textContent = runs.filter(e => e.t >= dayStart).length;
  $('#sstatNow').textContent = fig.now;
  $('#sstatBestDay').textContent = fig.best;
  $('#sstatClean').textContent = last.length ? `${clean} / ${last.length}` : '–';
  const working = tempoModel.levelWorking(l.scale, l.pattern), best = tempoModel.levelBest(l.scale, l.pattern);
  $('#sstatWorking').textContent = working === null ? '–' : `${working} bpm`;
  $('#sstatBest').textContent = best ? `${best} bpm` : '–';
}
// The picker lists every level: "S3 · Major · Thirds up · ascending".
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
  // The picker lists this game's levels: "S3 · Major · Thirds up · ascending", "A2 · Dominant 7 · …".
  const levels = levelsOf(laneGame());
  $('#mapLevel').innerHTML = levels.map(l => `<option value="${l.id}">${l.num} · ${l.title} · ${l.name}</option>`).join('');
  if (!levels.some(l => l.id === mapLevel)) {
    const ex = currentScaleExercise();
    mapLevel = (levels.find(l => l.scale === ex.scale && l.pattern === ex.pattern) || levels[0]).id;
  }
  scaleEvents = (await allEvents()).filter(e => e.game === st.game && e.expected && !e.falseStart);
  await loadTempo();
  drawRangeMap();
}
// --- Play pane ---
// The scale exercise as "S3 · Major" + its pattern in brass; a custom pick
// adds its keys to the label (levels are always all 12).
function render() {
  // The miss limit only applies in practice: learn never restarts a run.
  $$('[data-misses]').forEach(b => { b.classList.toggle('active', Number(b.dataset.misses) === misses); b.disabled = st.mode === 'learn'; });
  const sx = currentScaleExercise();
  $('#scaleExLabel').textContent = sx.num ? `${sx.num} · ${sx.title}` : `Custom · ${sx.title} · ${sx.keysLabel}`;
  $('#scaleExKeys').textContent = PATTERNS[sx.pattern].chip;
  // Tempo: on Auto the strip shows roughly where the session starts (each
  // key has its own) and can't be dragged; on Fixed it's the remembered tempo.
  if (tempoAuto) tempo.set(autoStartTempo(), false);
  else tempo.set(fixedBpm, false);
  // Fixed: open between runs and while paused (tempoLive); the toggle is
  // set after, as setEnabled locks every button in the block.
  tempo.setEnabled(!tempoAuto && (!scalesRunning() || scalesPaused()));
  $('#tempoMode').textContent = tempoAuto ? 'auto' : 'fixed';
  $('#tempoMode').classList.toggle('active', tempoAuto);
  $('#tempoMode').disabled = scalesRunning();
  if (isLane(st.game)) showScaleIdle();
}
const canStart = () => currentScaleExercise().keys.length > 0;

async function start() {
  // The weak-key model continues from the cached summary (A8): no history read.
  const model = createKeyModel((await getSummary()).keys || []);
  scaleRecap = null;
  $('#scaleIdle').hidden = true;
  startScales({ game: st.game, exercise: currentScaleExercise(), mode: st.mode, pick: st.pick, model, latency: st.latency,
                tempoAuto, tempo: tempoModel, bpm: tempo.get(), misses, calib: st.calib, calibOffset: st.calibOffset },
              recap => { scaleRecap = recap; hooks.showRunning(false); loadTempo(); hooks.runSync(); });
}

// A setting changed (mode, pick): the last session's recap gives way to
// what's next.
function clearRecap() { scaleRecap = null; }

// Switched to a lane game: the stats picker starts over on its level, and
// the staircases are fresh from the summary.
function onEnter() { mapLevel = null; loadTempo(); }

// New runs from sync move the staircases and the map.
function onSync(res) {
  if (!res.added) return;
  loadTempo();
  if (!$('#view-scale-stats').hidden) showScaleStats();
}

export const lanesUI = {
  render, canStart, start, onEnter, onSync, clearRecap,
  showLevels: showScaleLevels, showStats: showScaleStats,
  running: scalesRunning, note: scaleNote, stop: stopScales,
  paused: scalesPaused, pause: pauseScales, resume: resumeScales, restart: restartScales,
  // The tempo control: idle or paused, on Fixed (Auto has the stage's ‹ ›);
  // the Auto | Fixed toggle only between sessions.
  tempoLive: on => { tempo.setEnabled(on && !tempoAuto); $('#tempoMode').disabled = !on || scalesRunning(); },
};
