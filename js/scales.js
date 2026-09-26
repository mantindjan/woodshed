// Scale runner (E1): play a scale in a pattern (linear up/down, broken
// thirds, scalelevels.js PATTERNS) across the horn's range, in time,
// hitting each note as it reaches the "now" line.
//
// Flow per run: waiting (blow any note of the scale — that's where the run
// starts) → count-in (4 clicks) → running (the pattern in EIGHTHS — two
// notes per click at the set bpm — from the start note to the edge of the
// range, low B♭ / high F♯) → summary → next run, in the next key of the
// exercise (drawn toward weak keys or evenly, scalelevels.js) … until Stop.
// A Start-to-Stop session is one `round` in the events. On Auto tempo each
// run's outcome moves that KEY's tempo (scaletempo.js), so every run plays
// at its own key's tempo;
// the tempo is always on screen, big, with an arrow when it just moved.
//
// Judging: a note is HIT if it's the right written pitch (octave included)
// within the window around its time — ±150 ms, narrowed at fast tempos so
// neighbouring notes' windows never overlap; early/late is shown and graded
// but isn't an error. The right pitch anywhere in the window wins: a wrong
// note-on only counts (WRONG) if the window closes without the right one —
// the horn often sends a brief in-between note while the fingers change
// (data 2026-09-26: 51 "wrong" notes were a semitone-below glitch with the
// right note 20–80 ms behind). Nothing by the end of the window is a MISS. Practice: after `misses` misses the run stops ("start again").
// Learn (boss, 2026-09-25/26): the same judging, shown the other way round,
// and nothing ever stops. Keys go HARDEST FIRST (most accidentals in the
// written key, weak keys bumped up — master F♯ and C is a breeze) and a key
// repeats run after run while its tempo climbs; it moves on after a tempo
// step up, or when the player taps Next key. Before each run it names a start note ("low B♭ — B♭3");
// the player plays first — no preview sound (boss: a 4-note preview before
// the start note was dropped the same day). Once the start note is blown the whole run is drawn at once, still, as a SHEET (wrapped
// into rows); after the count-in a playhead sweeps across it left to right,
// each note played lands as a mark where it was played (time × pitch), and
// the end shows a tally: right notes and how many were on the beat.
// (A first cut held the lane on a miss; it froze unreliably when a note
// slid past the line, and was dropped.)
//
// Latency: every note-on is judged `latency` ms earlier than it arrived
// (measured in ⚙, latency.js) — the click is heard late and the horn's
// note arrives late; `notes` in the event stay raw.
//
// Pitch: written = MIDI − calibOffset, where calibOffset = the MIDI note the
// horn sends for written middle C (C5 = 72) minus 72 (main.js calibration).
//
// Display (practice): a canvas lane. Notes are degree discs (no note names), placed by
// scale step and note slot, gliding toward the now line near the left. The
// view drifts with the pattern's overall direction (its slope), so a linear
// run arrives on a diagonal and broken thirds zigzag around it. Hits bloom
// (additive halo, ring, sparks), bigger and brighter the closer to the beat.
// The count-in is four dots filling, not numbers: numbers collided with the
// degree discs (boss, 2026-09-25).

import { SCALES, SAX_RANGE, NOTES, pc, noteName } from './music.js';
import { initAudio, click, audioTimeAt, stopAll } from './audio.js';
import { addEvent, requestPersistence } from './events.js';
import { pickScaleKey, PATTERNS, runPattern } from './scalelevels.js';
import { tempoKey, runOutcome, CLEAN_RUNS } from './scaletempo.js';
import { saveKeys, saveTempo } from './summary.js';

const MAX_WINDOW_MS = 150;     // hit window either side of a note (as G2)
const COUNT_IN = 4;            // clicks before the first note
const PER_BEAT = 2;            // eighths: two scale notes per click (boss, 2026-09-25)
const SUMMARY_MS = 1800;       // how long a run's summary shows before the next
const SHEET_SUMMARY_MS = 4000; // learn: longer, to read the marks on the sheet
const SHEET_ROW = 16;          // learn: most notes per sheet row
// A run that's gone (boss, 2026-09-26): after a false start, or in learn
// ERRORS_IN_A_ROW wrong/missed notes running, it stops, pauses RESTART_MS,
// and the same run starts again straight into the count-in.
const ERRORS_IN_A_ROW = 5;
const RESTART_MS = 1500;
// A hit this close counts "on the beat"; beyond it the disc gets an
// early/late tick. 30 ms was too tight on the horn (boss, 2026-09-25).
const ON_BEAT_MS = 100;
const MIN_RUN = 4;             // learn suggests a start with at least this many notes ahead
const GLOW_MS = 650;           // how long a hit's bloom takes to settle
// v3: `pattern` replaces `direction`. v4: learn runs add `hint` (and, that
// evening only, `waits` from the dropped lane-hold learn). v5: learn = sheet.
// v6: `tempoAuto` (was the bpm set by the auto-tempo staircase).
// v7: `latency` (ms subtracted from note-ons before judging).
// v8: `falseStart` (run begun on another note: void) and `tempoSet` (the
// player chose this bpm on Auto). v9: `restarted` (the app restarted the
// run after a false start or too many errors: no start note was blown, so
// `notes` has no start-note entry).
const SCHEMA_VERSION = 9;

const $ = sel => document.querySelector(sel);

// Every written note of `scale` in key `key` (pc) within the sax range.
function scaleNotes(scale, key) {
  const out = [];
  for (let w = SAX_RANGE.low; w <= SAX_RANGE.high; w++) {
    if (SCALES[scale].steps.includes(pc(w - key))) out.push(w);
  }
  return out;
}
// Accidentals in each written key's signature, by pitch class (C♯ counted
// as D♭, 5 flats; F♯ as 6 sharps) — the learn order's difficulty.
const ACCIDENTALS = [0, 5, 2, 3, 4, 1, 6, 1, 4, 3, 2, 5];

// Learn's key order: hardest first, weak keys bumped up. Difficulty =
// accidentals + the weak-key model's tickets (0.6 for a solid key up to 4.6
// for a weak one, 2.2 untried) — a weak C still trails a solid F♯.
export function learnOrder(keys, model, scale, pattern) {
  const score = k => ACCIDENTALS[k] + model.tickets(scale, pattern, k);
  return [...keys].sort((a, b) => score(b) - score(a) || ACCIDENTALS[b] - ACCIDENTALS[a] || a - b);
}

const degreeOf = (scale, key, w) => SCALES[scale].degrees[SCALES[scale].steps.indexOf(pc(w - key))];

// Where a tenor player would call a written note: low up to F4, middle up
// to F♯5 (middle C = C5 sits in it), high above.
const register = w => (w <= 65 ? 'low' : w <= 78 ? 'middle' : 'high');

// Learn's suggested start: the root that gives the pattern the most room —
// the lowest root for a pattern that climbs, the highest for one that
// falls — among roots with at least a few notes of pattern ahead.
function suggestStart(scale, key, pattern) {
  const notes = scaleNotes(scale, key);
  const roots = notes.map((w, i) => ({ w, n: PATTERNS[pattern].indices(i, notes.length).length }))
    .filter(x => pc(x.w - key) === 0 && x.n >= MIN_RUN);
  if (!roots.length) return null;
  return PATTERNS[pattern].slope > 0 ? roots[0].w : roots[roots.length - 1].w;
}

let s = null;        // session state while running, else null
let raf = 0;
let wakeLock = null;

export const scalesRunning = () => s !== null;

// opts: {exercise: {id, scale, pattern, keys}, mode: 'learn'|'practice',
// pick: 'weak'|'random', model (the weak-key model, from the cached
// summary), tempoAuto (practice on Auto tempo), tempo (the staircase model),
// bpm (the first run's), misses, calib, calibOffset, latency (ms)}. onEnd(recap)
// when stopped.
export function startScales(opts, onEnd) {
  initAudio();
  requestPersistence();
  navigator.wakeLock?.request('screen').then(l => { wakeLock = l; }).catch(() => {});
  s = { ...opts, scale: opts.exercise.scale, pattern: opts.exercise.pattern, keys: opts.exercise.keys, onEnd,
        session: Date.now().toString(36), run: null, timers: [], moved: 0,
        // Learn: the key order, fixed for the session, and where we are in it.
        order: opts.mode === 'learn' ? learnOrder(opts.exercise.keys, opts.model, opts.exercise.scale, opts.exercise.pattern) : null,
        at: 0, advance: false,
        // Session recap, handed to onEnd on Stop (main.js shows it on the
        // stage): what the session did, key by key, so progress is seen.
        recap: { t0: Date.now(), runs: 0, clean: 0, keys: [], levelBestBefore: opts.tempo.levelBest(opts.exercise.scale, opts.exercise.pattern) } };
  nextRun();
  resize();
  raf = requestAnimationFrame(frame);
}

// Auto tempo: the player overrules the current key's tempo by `delta`.
// Before the run starts it plays at the new tempo; once it's under way the
// change is for the key's next run (endRun applies it after the staircase).
export function nudgeTempo(delta) {
  if (!s?.tempoAuto || !s.run) return;
  const key = tempoKey(s.scale, s.pattern, s.run.key);
  if (s.run.phase === 'waiting') {
    s.bpm = Math.max(60, Math.min(300, s.bpm + delta));
    s.tempo.set(key, s.bpm, s.session);
    saveTempo(s.tempo);
    s.override = null;
    s.run.manual = true;
  } else {
    s.override = Math.max(60, Math.min(300, (s.override ?? s.bpm) + delta));
  }
  topBar();
}

// Learn: skip to the next key now. A run in progress is dropped unlogged —
// half a run is no evidence either way.
export function nextKey() {
  if (!s?.order) return;
  s.timers.forEach(clearTimeout);
  s.timers = [];
  stopAll();
  s.advance = true;
  nextRun();
}

export function stopScales() {
  if (!s) return;
  const { onEnd } = s;
  s.timers.forEach(clearTimeout);
  cancelAnimationFrame(raf);
  stopAll();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  const recap = s.recap.runs ? { ...s.recap, t1: Date.now(), tempoAuto: s.tempoAuto, mode: s.mode } : null;
  s = null;
  topBar();                           // empties the key, tempo and misses
  message('');
  $('#scaleNext').hidden = true;
  $('#scaleNudge').hidden = true;
  draw(null);
  onEnd(recap);
}

// A new run. Practice: the next key, weighted toward weak ones or even,
// never the same twice in a row when there's a choice. Learn: the same key
// again, or the next in the hardest-first order once it's to advance. On
// Auto, the run takes its key's tempo.
function nextRun() {
  let k;
  if (s.order) {
    if (s.advance && s.run) s.at = (s.at + 1) % s.order.length;
    k = s.order[s.at];
  } else {
    k = pickScaleKey(s.model, { scale: s.scale, pattern: s.pattern, keys: s.keys, pick: s.pick, prev: s.run?.key });
  }
  if (k !== s.run?.key) s.moved = 0;  // the ↑/↓ is about this key's last run
  s.advance = false;
  if (s.tempoAuto) s.bpm = s.tempo.tempoFor(tempoKey(s.scale, s.pattern, k), s.session);
  s.run = { key: k, phase: 'waiting', notes: [], expected: [], misses: 0, hint: null,
            // A tempo the player set for this key (stage nudges) — its run is marked `tempoSet`.
            manual: !!s.tempoAuto && s.tempo.manual(tempoKey(s.scale, s.pattern, k)) };
  $('#scaleNext').hidden = !s.order || s.order.length < 2;
  topBar();
  const scaleName = `<b>${NOTES[k]} ${SCALES[s.scale].name.toLowerCase()}</b>`;
  const pattern = PATTERNS[s.pattern].name.toLowerCase();
  const start = s.mode === 'learn' ? suggestStart(s.scale, k, s.pattern) : null;
  if (start === null) {
    message(`Blow any note of ${scaleName} to start — ${pattern}`);
    return;
  }
  // Learn: name a start note; the sheet appears once it's blown.
  s.run.hint = { start };
  message(`Start on <b>${register(start)} ${NOTES[pc(start)]}</b> (${noteName(start)}) — ${scaleName}, ${pattern}` +
          '<br><small>any scale note works too</small>');
}

// The key stays on screen the whole run, big (boss: the 2-second message
// was easy to forget); the pattern sits next to it.
function topBar() {
  const r = s?.run;
  $('#scaleKey').textContent = r ? `${NOTES[r.key]} ${SCALES[s.scale].name.toLowerCase()}` : '';
  $('#scalePattern').textContent = r ? PATTERNS[s.pattern].chip.toLowerCase() : '';
  // Tempo big on the right (boss: "make sure the tempo is printed on
  // screen"); ↑/↓ when Auto just moved it, "auto" while it's in charge.
  $('#scaleBpm').textContent = r ? s.bpm : '';
  $('#scaleBpmNote').textContent = !r ? '' : `${s.moved > 0 ? '↑ ' : s.moved < 0 ? '↓ ' : ''}bpm${s.tempoAuto ? ' auto' : ''}` +
    (s.override != null ? ` → ${s.override} next` : '');
  $('#scaleNudge').hidden = !r || !s.tempoAuto;
  $('#scaleInfo').textContent = r ? `· misses ${r.misses}${s.mode === 'practice' ? `/${s.misses}` : ''}` : '';
}

function message(html) {
  const el = $('#scaleMsg');
  el.classList.remove('tally');
  el.innerHTML = html;
  el.hidden = !html;
}

// Every note-on from the horn while the scale runner is active.
export function scaleNote(midi) {
  if (!s) return;
  const r = s.run;
  const arrived = performance.now();
  const w = midi - s.calibOffset;
  // The start note only starts the clock: nothing to judge, so no correction.
  if (r.phase === 'waiting') return startRun(w, arrived, midi);
  if (r.phase !== 'running' && r.phase !== 'countin') return;
  r.notes.push([midi, Math.round(arrived - r.t0)]);   // raw, as received
  if (r.phase !== 'running') return;
  const now = arrived - s.latency;    // when it was played, relative to the heard click
  // The pending note whose beat is nearest, within the window.
  let best = null;
  for (const e of r.expected) {
    if (e.status !== 'pending') continue;
    const d = Math.abs(now - e.t);
    if (d <= r.window && (!best || d < Math.abs(now - best.t))) best = e;
  }
  if (!best) return;                  // between beats: just recorded
  if (w === best.w) {
    best.status = 'hit';
    best.off = Math.round(now - best.t);
    best.hitAt = arrived;             // page time, for the bloom
  } else {
    // Not final: the right pitch may still come inside the window (expire()).
    if (!best.wrongAt) { best.wrongAt = now; best.wrongW = w; }
  }
  checkDone();
}

function startRun(w, now, midi) {
  const r = s.run;
  const notes = scaleNotes(s.scale, r.key);
  if (!notes.includes(w)) {
    message(`That's ${NOTES[pc(w)]} — not in <b>${NOTES[r.key]} ${SCALES[s.scale].name.toLowerCase()}</b>` +
            (w < SAX_RANGE.low || w > SAX_RANGE.high ? ' (or outside low B♭–high F♯)' : '') +
            '. Blow a scale note to start.');
    return;
  }
  // From the start note to the edge of the range, in the level's pattern.
  // Broken thirds need two scale notes of room beyond the start note.
  const i = notes.indexOf(w);
  const idx = PATTERNS[s.pattern].indices(i, notes.length);
  if (!idx.length) {
    message(`No room for ${PATTERNS[s.pattern].name.toLowerCase()} from ${NOTES[pc(w)]} there — ` +
            `start ${i + 2 >= notes.length ? 'lower' : 'higher'}.`);
    return;
  }
  const run = idx.map(j => notes[j]);
  const beat = 60000 / s.bpm;
  const step = beat / PER_BEAT;       // time between scale notes
  r.t0 = now;
  r.scaleNotes = notes;               // for placing played marks on the sheet
  r.beatMs = beat;
  r.step = step;                      // the lane moves one slot per note
  r.window = Math.min(MAX_WINDOW_MS, step * 0.45);
  // Lane drift: the least-squares line through (slot, scale position) at the
  // pattern's slope — the discs are drawn relative to it (see draw()).
  r.slope = PATTERNS[s.pattern].slope;
  r.base = idx.reduce((a, j, k) => a + j - r.slope * k, 0) / idx.length;
  r.notes = midi === null ? [] : [[midi, 0]];   // a restart has no blown start note
  // Count-in clicks on beats 1–4 after the start note; note j at beat 5 +
  // j/2. Clicks keep going on every beat through the run.
  r.expected = run.map((nw, j) => ({ w: nw, i: idx[j], deg: degreeOf(s.scale, r.key, nw),
                                      t: now + beat * (COUNT_IN + 1) + step * j, status: 'pending', off: null, hitAt: null }));
  const beats = COUNT_IN + Math.ceil(run.length / PER_BEAT);
  for (let b = 1; b <= beats; b++) click(audioTimeAt(now + beat * b), b === 1);
  r.phase = 'countin';
  message('');
  s.timers.push(setTimeout(() => { if (s?.run === r) r.phase = 'running'; },
                           beat * (COUNT_IN + 1) - r.window - 1));
}

// A miss. Practice counts it toward a restart; learn just carries on.
function miss() {
  const r = s.run;
  r.misses++;
  topBar();
  if (s.mode === 'practice' && r.misses >= s.misses) endRun(true);
}

// Called from frames: a note whose window has closed without its pitch is
// WRONG if something else was played in it, else a MISS. `now` is page
// time; windows are in played time (note-ons minus the latency), so the
// window closes `latency` later on the page clock — without that, late
// notes were expired before they even arrived (fixed 2026-09-26).
function expire(now) {
  const r = s.run;
  if (r.phase !== 'running') return;
  for (const e of r.expected) {
    if (e.status === 'pending' && now - s.latency > e.t + r.window) {
      e.status = e.wrongAt ? 'wrong' : 'miss';
      miss();
      if (r.phase !== 'running') return;
      // A run that's gone stops now rather than being played out.
      const i = r.expected.indexOf(e);
      if (i === 1 && falseStart(r)) return endRun(true, 'false');
      if (s.mode === 'learn' && errorsInARow(r, i) >= ERRORS_IN_A_ROW) return endRun(true, 'errors');
    }
  }
  checkDone();
}

// False start: the first two notes both missed, and what was played on the
// first is another note of the scale — the player began somewhere else
// (data 2026-09-26: runs like 0/11). A first note outside the scale is a
// wrong note, not another start.
function falseStart(r) {
  const [a, b] = r.expected;
  return a.status !== 'hit' && b.status !== 'hit' && a.wrongW != null && r.scaleNotes.includes(a.wrongW);
}

// Wrong/missed notes in a row, ending at note i.
function errorsInARow(r, i) {
  let n = 0;
  while (i >= 0 && r.expected[i].status !== 'hit' && r.expected[i].status !== 'pending') { n++; i--; }
  return n;
}

// The same run again, straight into the count-in (no start note to blow),
// at the key's tempo now.
function restartRun() {
  const old = s.run;
  const start = old.expected[0].w;
  const tk = tempoKey(s.scale, s.pattern, old.key);
  if (s.tempoAuto) s.bpm = s.tempo.tempoFor(tk, s.session);
  s.run = { key: old.key, phase: 'waiting', notes: [], expected: [], misses: 0, hint: old.hint,
            manual: !!s.tempoAuto && s.tempo.manual(tk), restarted: true };
  topBar();
  startRun(start, performance.now(), null);
}

function checkDone() {
  const r = s?.run;
  if (r && r.phase === 'running' && r.expected.every(e => e.status !== 'pending')) endRun(false);
}

// `abort`: 'false' (false start: logged, void) or 'errors' (learn: too many
// in a row — counts as a stopped run); either way the same run restarts.
function endRun(stopped, abort = null) {
  const r = s.run;
  r.phase = 'summary';
  stopAll();                          // drop the rest of the clicks
  const hits = r.expected.filter(e => e.status === 'hit');
  const offs = hits.map(e => e.off);
  const mean = offs.length ? Math.round(offs.reduce((a, b) => a + b, 0) / offs.length) : null;
  const event = {
    v: SCHEMA_VERSION,
    t: Date.now() - Math.round(performance.now() - r.t0),   // wall clock of the start note
    round: s.session,
    game: 'scales',
    mode: s.mode,
    exercise: s.exercise.id,          // level id or 'custom' (scalelevels.js)
    scale: s.scale,
    keyWritten: r.key,
    pattern: s.pattern,               // scalelevels.js PATTERNS id
    bpm: s.bpm,
    latency: s.latency,               // ms subtracted from note-ons before judging (offsets are after it)
    tempoAuto: !!s.tempoAuto,         // bpm set by the auto-tempo staircase (scaletempo.js)
    perBeat: PER_BEAT,                // scale notes per click (2 = eighths)
    allowedMisses: s.misses,
    calib: s.calib,
    calibOffset: s.calibOffset,
    startWritten: r.expected[0].w,
    // Each expected note: [written pitch, ms after the start note, degree, status, timing offset ms].
    expected: r.expected.map(e => [e.w, Math.round(e.t - r.t0), e.deg, e.status, e.off]),
    notes: r.notes,                   // every note-on: [raw MIDI, ms after the start note]
    stopped,
  };
  // Learn only: the suggested start {start: written MIDI}.
  if (s.mode === 'learn') event.hint = r.hint;
  if (s.tempoAuto && r.manual) event.tempoSet = true;
  if (r.restarted) event.restarted = true;
  // False start: logged, marked and void — no tempo, weak-key or recap
  // change; the same run again.
  if (abort === 'false') {
    event.falseStart = true;
    addEvent(event);
    message(`<b>False start</b> — you began on ${noteName(r.expected[0].wrongW)}; this run starts on ` +
            `<b>${noteName(r.expected[0].w)}</b> (the teal one). Doesn't count — again.`);
    if (s.mode === 'learn') $('#scaleMsg').classList.add('tally');
    s.timers.push(setTimeout(() => { if (s) restartRun(); }, RESTART_MS));
    return;
  }
  addEvent(event);
  // The key model adapts within the session; the summary keeps it for next time.
  s.model.add(event);
  saveKeys(s.model);
  // Recap: per key, where the session took it. `from` is the key's first
  // run's tempo, `to` where it'll play next; the clean best before and after.
  const tk = tempoKey(s.scale, s.pattern, r.key);
  let rk = s.recap.keys.find(x => x.key === r.key);
  if (!rk) s.recap.keys.push(rk = { key: r.key, from: s.bpm, to: s.bpm, runs: 0, clean: 0, hits: 0, total: 0,
                                    bestBefore: s.tempo.best(tk), best: s.tempo.best(tk) });
  const clean = runOutcome(event) === 'clean';   // learn allows one slip
  s.recap.runs++; rk.runs++;
  if (clean) { s.recap.clean++; rk.clean++; }
  rk.hits += hits.length; rk.total += r.expected.length;
  // Auto tempo: this run moves the tempo for the next.
  let tempoNote = '';
  if (s.tempoAuto) {
    s.tempo.add(event);
    const key = tk;
    if (s.override != null) { s.tempo.set(key, s.override, s.session); s.override = null; }
    saveTempo(s.tempo);
    const next = s.tempo.next(key);
    rk.to = next;
    rk.best = s.tempo.best(key);
    s.moved = Math.sign(next - s.bpm);
    const name = NOTES[r.key];
    tempoNote = s.moved > 0 ? `<br>${name} tempo up → <b>${next}</b>` : s.moved < 0 ? `<br>${name} tempo down → <b>${next}</b>`
      : `<br><small>clean ${s.tempo.streak(key)} of ${CLEAN_RUNS[s.mode]} at ${next}</small>`;
    // Learn: a tempo step up means this key is done for now — next key.
    if (s.order && s.moved > 0) {
      s.advance = true;
      tempoNote += s.order.length > 1 ? ` · next: <b>${NOTES[s.order[(s.at + 1) % s.order.length]]}</b>` : '';
    }
  }
  const lateness = mean === null ? '' : mean > 15 ? ` · ${mean} ms late on average` : mean < -15 ? ` · ${-mean} ms early on average` : ' · right on the beat';
  if (s.mode === 'learn') {
    // The tally sits under the sheet, which stays up to be read.
    const onBeat = hits.filter(e => Math.abs(e.off) <= ON_BEAT_MS).length;
    const drift = mean !== null && Math.abs(mean) > 15 ? lateness : '';   // "on the beat" is already said
    message(`<b>${hits.length} / ${r.expected.length} right</b> · ${onBeat} on the beat${drift}${tempoNote}`);
    $('#scaleMsg').classList.add('tally');
  } else {
    message((stopped
      ? `<b>${r.misses} misses — start again.</b> ${hits.length} of ${r.expected.length} hit.`
      : `<b>${hits.length} / ${r.expected.length} hit</b>${lateness}`) + tempoNote);
  }
  if (abort === 'errors') {
    message(`<b>${ERRORS_IN_A_ROW} wrong in a row</b> — again from ${noteName(r.expected[0].w)}.${tempoNote}`);
    $('#scaleMsg').classList.add('tally');
    s.advance = false;                 // same key, whatever the tempo did
    s.timers.push(setTimeout(() => { if (s) restartRun(); }, RESTART_MS));
    return;
  }
  s.timers.push(setTimeout(() => { if (s) nextRun(); }, s.mode === 'learn' ? SHEET_SUMMARY_MS : SUMMARY_MS));
}

// --- Drawing ---
const canvas = () => $('#lane');
function resize() {
  const c = canvas();
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(r.width * dpr);
  c.height = Math.round(r.height * dpr);
  c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', () => { if (s) resize(); });

function frame() {
  if (!s) return;
  expire(performance.now());
  draw(s.run);
  raf = requestAnimationFrame(frame);
}

// Position along the run in note slots at time `t` (note 0 due = 0).
const slotAt = (r, t) => (t - r.expected[0].t) / r.step;

const COLORS = { pending: '#d9a441', hit: '#ffe2a8', wrong: '#d65a5a', miss: '#6a3434' };

// A hit's bloom at (x, y): additive halo that swells then settles to a
// soft glow, a ring flying out, and sparks for hits near the beat. `acc`
// 0–1 = how close to the beat; `age` ms since the hit.
function bloom(g, x, y, rad, acc, age) {
  const k = Math.min(1, age / GLOW_MS);            // 0 → 1 over the bloom
  const ease = 1 - (1 - k) * (1 - k);
  g.save();
  g.globalCompositeOperation = 'lighter';
  // Halo: large and hot at first, then a lasting puff sized by accuracy.
  const haloR = rad * (1.6 + acc * 1.4 + (1 - ease) * 1.2);
  const a = (0.35 + 0.45 * acc) * (1 - 0.5 * ease);
  const grad = g.createRadialGradient(x, y, rad * 0.4, x, y, haloR);
  grad.addColorStop(0, `rgba(255,214,130,${a})`);
  grad.addColorStop(0.5, `rgba(255,170,60,${a * 0.45})`);
  grad.addColorStop(1, 'rgba(255,150,40,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(x, y, haloR, 0, Math.PI * 2); g.fill();
  if (k < 1) {
    // Flash: a white-hot core on impact, gone in the first third.
    const f = Math.max(0, 1 - k * 3);
    if (f > 0) {
      const core = g.createRadialGradient(x, y, 0, x, y, rad * 1.5);
      core.addColorStop(0, `rgba(255,250,235,${0.9 * f})`);
      core.addColorStop(1, 'rgba(255,220,150,0)');
      g.fillStyle = core;
      g.beginPath(); g.arc(x, y, rad * 1.5, 0, Math.PI * 2); g.fill();
    }
    // Ring: out to 3× the disc, thinning and fading.
    g.strokeStyle = `rgba(255,226,168,${(1 - k) * (0.4 + 0.5 * acc)})`;
    g.lineWidth = 3 * (1 - k) + 0.5;
    g.beginPath(); g.arc(x, y, rad * (1 + 2 * ease), 0, Math.PI * 2); g.stroke();
    // Sparks: only for hits close to the beat, more the closer.
    const n = acc > 0.6 ? Math.round(4 + 6 * acc) : 0;
    g.fillStyle = `rgba(255,236,190,${1 - k})`;
    for (let j = 0; j < n; j++) {
      const ang = (j / n) * Math.PI * 2 + x * 0.01;
      const d = rad * (1.1 + 2.2 * ease);
      g.beginPath(); g.arc(x + Math.cos(ang) * d, y + Math.sin(ang) * d, 2.2 * (1 - k) + 0.4, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
}

function draw(r) {
  const c = canvas();
  const g = c.getContext('2d');
  const W = c.clientWidth, H = c.clientHeight;
  g.clearRect(0, 0, W, H);
  if (!r) return;                     // stopped: the stage belongs to the idle card
  if (r.expected.length) countIn(g, r, W);
  if (s?.mode === 'learn') return drawSheet(g, r, W, H);
  const nowX = W * 0.22, cy = H * 0.5;
  // The now line.
  g.strokeStyle = 'rgba(217,164,65,.55)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(nowX, 12); g.lineTo(nowX, H - 12); g.stroke();
  if (!r || !r.expected.length) return;

  const now = performance.now();
  const pos = slotAt(r, now);
  const pxBeat = Math.min(120, W * 0.2);
  const stepPx = Math.min(26, H / 14);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  r.expected.forEach((e, i) => {
    const d = i - pos;                        // note slots until this note
    const x = nowX + d * pxBeat;
    // Height = scale position above the drift line at the current slot.
    const y = cy - (e.i - (r.base + r.slope * pos)) * stepPx;
    if (x < -60 || x > W + 30) return;
    const root = e.deg === '1';
    const rad = root ? 20 : 17;
    const fade = x < nowX - 10 ? Math.max(0, 1 - (nowX - x) / (nowX + 30)) : 1;
    g.globalAlpha = fade;
    if (e.status === 'hit') bloom(g, x, y, rad, accuracy(r, e), now - e.hitAt);
    if (e.status === 'pending' && d > -0.5 && d < 1.5) {
      // The next note to play warms up as it reaches the line.
      g.save();
      g.shadowColor = 'rgba(217,164,65,.8)';
      g.shadowBlur = 16 * (1 - Math.abs(d - 0.5) / 1);
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2);
      g.strokeStyle = COLORS.pending; g.lineWidth = 2; g.stroke();
      g.restore();
    }
    disc(g, e, x, y, rad, root, false, i === 0);
    g.globalAlpha = 1;
  });
}

// 0–1: how close to the beat a hit was.
const accuracy = (r, e) => 1 - Math.min(Math.abs(e.off), r.window) / r.window;

// One degree disc, coloured by status. `named`: a wrong/missed disc shows
// its note name instead (learn: the answer on a miss). `start`: the run's
// first note — the one the player blew to start — is written out with its
// octave ("B♭3") in teal under a "start" tag, so which note it was isn't
// lost to a bare degree number (boss, 2026-09-26).
const START_COLOR = '#6fd3c6';
function disc(g, e, x, y, rad, root, named, start = false) {
  g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2);
  g.fillStyle = e.status === 'pending' ? '#1c1a14' : COLORS[e.status];
  g.fill();
  g.lineWidth = start ? 3 : root ? 3 : 2;
  g.strokeStyle = start && e.status === 'pending' ? START_COLOR : COLORS[e.status];
  g.stroke();
  if (start) {
    g.fillStyle = START_COLOR;
    g.font = `700 ${Math.max(9, Math.round(rad * 0.6))}px system-ui, sans-serif`;
    g.fillText('start', x, y - rad - 8);
  }
  g.fillStyle = e.status === 'pending' ? (start ? START_COLOR : '#ffe2a8') : '#1a1206';
  const showName = start || (named && (e.status === 'wrong' || e.status === 'miss'));
  const label = start ? noteName(e.w) : showName ? NOTES[pc(e.w)] : e.deg;
  const size = Math.round(rad * (start ? 0.62 : showName ? 0.75 : root ? 0.9 : 0.95));
  g.font = `800 ${size}px system-ui, sans-serif`;
  g.fillText(label, x, y + 1);
  // Early/late tick for hits: a small bar left (early) or right (late).
  if (e.status === 'hit' && Math.abs(e.off) > ON_BEAT_MS) {
    g.fillStyle = '#ffe2a8';
    g.fillRect(x + (e.off > 0 ? rad + 3 : -rad - 7), y - 2, 4, 4);
  }
}

// Count-in: four dots across the top, one filling (and blooming) per click.
function countIn(g, r, W) {
  if (r.phase !== 'countin') return;
  const now = performance.now();
  const filled = Math.min(COUNT_IN, Math.floor((now - r.t0) / r.beatMs));
  for (let b = 0; b < COUNT_IN; b++) {
    const x = W * 0.6 + (b - (COUNT_IN - 1) / 2) * 30;
    g.beginPath(); g.arc(x, 16, 8, 0, Math.PI * 2);
    g.fillStyle = b < filled ? '#ffe2a8' : 'transparent';
    g.fill();
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,226,168,.7)'; g.stroke();
    if (b < filled) bloom(g, x, 16, 8, 0.4, now - (r.t0 + r.beatMs * (b + 1)));
  }
}

// --- Learn: the sheet ---
// The whole run laid out at once, in rows of up to SHEET_ROW notes (split
// evenly), each row its own band with its notes placed by scale position.
// A playhead sweeps each row in time; each note played is a mark at the
// time and pitch it was played. Layout is computed once per run.
function sheetLayout(r, W, H) {
  if (r.sheet && r.sheet.W === W && r.sheet.H === H) return r.sheet;
  const n = r.expected.length;
  const rows = Math.ceil(n / SHEET_ROW);
  const per = Math.ceil(n / rows);
  const top = 34;                                   // under the count-in dots
  const bandH = (H - top - 44) / rows;              // room for the tally below
  const slot = (W - 24) / per;
  const rad = Math.max(8, Math.min(16, slot * 0.4, bandH * 0.2));
  const bands = [];
  for (let k = 0; k < rows; k++) {
    const a = k * per, b = Math.min(n, a + per);
    const is = r.expected.slice(a, b).map(e => e.i);
    const lo = Math.min(...is), hi = Math.max(...is);
    // Room for the note name under the lowest disc and the "start" tag over the top.
    const stepPx = Math.min(rad * 0.9, (bandH - 2 * rad - 22) / Math.max(1, hi - lo));
    bands.push({ a, b, mid: (lo + hi) / 2, cy: top + bandH * (k + 0.5), stepPx });
  }
  r.sheet = { W, H, per, slot, rad, bands, bandH, left: 12 };
  return r.sheet;
}

// Screen point for slot position `p` (fractional note index) at scale
// position `i` (fractional too, for played marks between scale notes).
function sheetPoint(L, p, i) {
  const k = Math.max(0, Math.min(L.bands.length - 1, Math.floor((p + 0.5) / L.per)));
  const band = L.bands[k];
  return { x: L.left + (p - band.a + 0.5) * L.slot, y: band.cy - (i - band.mid) * band.stepPx, band };
}

// Fractional scale position of any written pitch: between the scale notes
// around it, so a wrong note sits between the right ones.
function scalePos(notes, w) {
  if (w <= notes[0]) return (w - notes[0]) / 2;
  for (let j = 0; j < notes.length - 1; j++) {
    if (w <= notes[j + 1]) return j + (w - notes[j]) / (notes[j + 1] - notes[j]);
  }
  return notes.length - 1 + (w - notes[notes.length - 1]) / 2;
}

function drawSheet(g, r, W, H) {
  if (!r || !r.expected.length) return;
  const L = sheetLayout(r, W, H);
  const now = performance.now();
  // Played marks: a small diamond per note-on after the count-in, where it
  // was played (time × pitch). Right pitch for the nearest note: gold, drawn
  // UNDER the discs so it only peeks out when early or late; wrong pitch:
  // red, drawn over them. Count-in notes aren't drawn.
  // Skip the blown start note (a restarted run has none).
  const marks = r.notes.slice(r.restarted ? 0 : 1).map(([midi, ms]) => {
    const p = slotAt(r, r.t0 + ms - s.latency);
    const w = midi - s.calibOffset;
    const near = r.expected[Math.max(0, Math.min(r.expected.length - 1, Math.round(p)))];
    return { p, w, right: w === near.w };
  }).filter(m => m.p >= -0.5);
  const drawMarks = right => marks.filter(m => m.right === right).forEach(m => {
    const { x, y } = sheetPoint(L, Math.min(m.p, r.expected.length - 0.5), scalePos(r.scaleNotes, m.w));
    g.fillStyle = right ? '#fff3d6' : '#ff6b6b';
    g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 4, y); g.lineTo(x, y + 5); g.lineTo(x - 4, y); g.closePath(); g.fill();
  });
  drawMarks(true);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  r.expected.forEach((e, j) => {
    const { x, y } = sheetPoint(L, j, e.i);
    if (e.status === 'hit') bloom(g, x, y, L.rad, accuracy(r, e), now - e.hitAt);
    g.globalAlpha = e.status === 'pending' ? 0.85 : 1;
    disc(g, e, x, y, L.rad, e.deg === '1', false, j === 0);
    // Learn: the note name under every degree (boss, 2026-09-26); the start
    // disc already carries its name, so its degree goes under instead.
    g.fillStyle = j === 0 ? START_COLOR : 'rgba(255,226,168,.6)';
    g.font = `600 ${Math.max(9, Math.round(L.rad * 0.62))}px system-ui, sans-serif`;
    g.fillText(j === 0 ? e.deg : NOTES[pc(e.w)], x, y + L.rad + 9);
    g.globalAlpha = 1;
  });
  drawMarks(false);
  // Playhead: sweeps each row in turn, from the count-in until the end.
  if (r.phase === 'countin' || r.phase === 'running') {
    const p = Math.max(-0.5, Math.min(slotAt(r, now), r.expected.length - 0.5));
    const { x, band } = sheetPoint(L, p, 0);
    const half = L.bandH / 2;
    g.save();
    g.shadowColor = 'rgba(217,164,65,.9)'; g.shadowBlur = 12;
    g.strokeStyle = 'rgba(255,226,168,.85)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, band.cy - half + 4); g.lineTo(x, band.cy + half - 4); g.stroke();
    g.restore();
  }
}

document.addEventListener('visibilitychange', () => { if (document.hidden) stopScales(); });
