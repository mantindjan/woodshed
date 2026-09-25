// Scale runner (E1): play a scale in a pattern (linear up/down, broken
// thirds, scalelevels.js PATTERNS) across the horn's range, in time,
// hitting each note as it reaches the "now" line.
//
// Flow per run: waiting (blow any note of the scale — that's where the run
// starts) → count-in (4 clicks) → running (the pattern in EIGHTHS — two
// notes per click at the set bpm — from the start note to the edge of the
// range, low B♭ / high F♯) → summary → next run, in the next key of the
// exercise (drawn toward weak keys or evenly, scalelevels.js) … until Stop. A Start-to-Stop
// session is one `round` in the events; it earns stars (E1 step 2).
//
// Judging: a note is HIT if it's the right written pitch (octave included)
// within the window around its time — ±150 ms, narrowed at fast tempos so
// neighbouring notes' windows never overlap; early/late is shown and graded
// but isn't an error. A wrong pitch in the window, or nothing by the end of it, is a
// MISS. Practice: after `misses` misses the run stops ("start again").
// Learn: the run always goes to the end, and a missed disc shows the note's
// name as it leaves — the answer on a miss, as the degree drill's learn mode.
//
// Pitch: written = MIDI − calibOffset, where calibOffset = the MIDI note the
// horn sends for written middle C (C5 = 72) minus 72 (main.js calibration).
//
// Display: a canvas lane. Notes are degree discs (no note names), placed by
// scale step and note slot, gliding toward the now line near the left. The
// view drifts with the pattern's overall direction (its slope), so a linear
// run arrives on a diagonal and broken thirds zigzag around it.

import { SCALES, SAX_RANGE, NOTES, pc } from './music.js';
import { initAudio, click, audioTimeAt, stopAll } from './audio.js';
import { addEvent, requestPersistence } from './events.js';
import { pickScaleKey, sessionStars, PATTERNS } from './scalelevels.js';
import { saveKeys, saveStars } from './summary.js';

const MAX_WINDOW_MS = 150;     // hit window either side of a note (as G2)
const COUNT_IN = 4;            // clicks before the first note
const PER_BEAT = 2;            // eighths: two scale notes per click (boss, 2026-09-25)
const SUMMARY_MS = 1800;       // how long a run's summary shows before the next
const SCHEMA_VERSION = 3;       // v3: `pattern` replaces `direction`

const $ = sel => document.querySelector(sel);

// Every written note of `scale` in key `key` (pc) within the sax range.
function scaleNotes(scale, key) {
  const out = [];
  for (let w = SAX_RANGE.low; w <= SAX_RANGE.high; w++) {
    if (SCALES[scale].steps.includes(pc(w - key))) out.push(w);
  }
  return out;
}
const degreeOf = (scale, key, w) => SCALES[scale].degrees[SCALES[scale].steps.indexOf(pc(w - key))];

let s = null;        // session state while running, else null
let raf = 0;
let wakeLock = null;

export const scalesRunning = () => s !== null;

// opts: {exercise: {id, scale, pattern, keys}, mode: 'learn'|'practice',
// pick: 'weak'|'random', model (the weak-key model, from the
// cached summary), bpm, misses, calib, calibOffset}. onEnd() when stopped.
export function startScales(opts, onEnd) {
  initAudio();
  requestPersistence();
  navigator.wakeLock?.request('screen').then(l => { wakeLock = l; }).catch(() => {});
  s = { ...opts, scale: opts.exercise.scale, pattern: opts.exercise.pattern, keys: opts.exercise.keys, onEnd,
        session: Date.now().toString(36), run: null, timers: [],
        // Session tally for stars: runs, notes hit / expected, runs stopped.
        tally: { runs: 0, hits: 0, total: 0, stopped: 0 } };
  nextRun();
  resize();
  raf = requestAnimationFrame(frame);
}

export function stopScales() {
  if (!s) return;
  const { onEnd, tally, mode, exercise } = s;
  s.timers.forEach(clearTimeout);
  cancelAnimationFrame(raf);
  stopAll();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  s = null;
  message('');
  draw(null);
  // Stars come from practice sessions only (learn never stops a run).
  if (mode === 'practice') saveStars(exercise.id, sessionStars(tally.runs, tally.hits, tally.total, tally.stopped));
  onEnd();
}

// A new run: the next key of the exercise, weighted toward weak ones or
// even, never the same twice in a row when there's a choice.
function nextRun() {
  const k = pickScaleKey(s.model, { scale: s.scale, pattern: s.pattern, keys: s.keys, pick: s.pick, prev: s.run?.key });
  s.run = { key: k, phase: 'waiting', notes: [], expected: [], misses: 0 };
  topBar();
  message(`Blow any note of <b>${NOTES[k]} ${SCALES[s.scale].name.toLowerCase()}</b> to start — ` +
          `${PATTERNS[s.pattern].name.toLowerCase()}`);
}

function topBar() {
  const r = s?.run;
  $('#scaleTitle').textContent = r ? `${NOTES[r.key]} ${SCALES[s.scale].name.toLowerCase()} · ${PATTERNS[s.pattern].name.toLowerCase()}` : '';
  $('#scaleInfo').textContent = r ? `${s.bpm} bpm · misses ${r.misses}${s.mode === 'practice' ? `/${s.misses}` : ''}` : '';
}

function message(html) {
  const el = $('#scaleMsg');
  el.innerHTML = html;
  el.hidden = !html;
}

// Every note-on from the horn while the scale runner is active.
export function scaleNote(midi) {
  if (!s) return;
  const r = s.run;
  const now = performance.now();
  const w = midi - s.calibOffset;
  if (r.phase === 'waiting') return startRun(w, now, midi);
  if (r.phase !== 'running' && r.phase !== 'countin') return;
  r.notes.push([midi, Math.round(now - r.t0)]);
  if (r.phase !== 'running') return;
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
  } else {
    best.status = 'wrong';
    miss();
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
  r.beat = step;                      // the lane moves one slot per note
  r.window = Math.min(MAX_WINDOW_MS, step * 0.45);
  // Lane drift: the least-squares line through (slot, scale position) at the
  // pattern's slope — the discs are drawn relative to it (see draw()).
  r.slope = PATTERNS[s.pattern].slope;
  r.base = idx.reduce((a, j, k) => a + j - r.slope * k, 0) / idx.length;
  r.notes = [[midi, 0]];
  // Count-in clicks on beats 1–4 after the start note; note j at beat 5 +
  // j/2. Clicks keep going on every beat through the run.
  r.expected = run.map((nw, j) => ({ w: nw, i: idx[j], deg: degreeOf(s.scale, r.key, nw),
                                      t: now + beat * (COUNT_IN + 1) + step * j, status: 'pending', off: null }));
  const beats = COUNT_IN + Math.ceil(run.length / PER_BEAT);
  for (let b = 1; b <= beats; b++) click(audioTimeAt(now + beat * b), b === 1);
  r.phase = 'countin';
  message('');
  s.timers.push(setTimeout(() => { if (s?.run === r) r.phase = 'running'; },
                           beat * (COUNT_IN + 1) - r.window - 1));
}

function miss() {
  const r = s.run;
  r.misses++;
  topBar();
  if (s.mode === 'practice' && r.misses >= s.misses) endRun(true);
}

// Called from frames: notes whose window has passed unplayed are misses.
function expire(now) {
  const r = s.run;
  if (r.phase !== 'running') return;
  for (const e of r.expected) {
    if (e.status === 'pending' && now > e.t + r.window) {
      e.status = 'miss';
      miss();
      if (r.phase !== 'running') return;
    }
  }
  checkDone();
}

function checkDone() {
  const r = s?.run;
  if (r && r.phase === 'running' && r.expected.every(e => e.status !== 'pending')) endRun(false);
}

function endRun(stopped) {
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
  addEvent(event);
  // The key model adapts within the session; the summary keeps it for next time.
  s.model.add(event);
  saveKeys(s.model);
  s.tally.runs++;
  s.tally.hits += hits.length;
  s.tally.total += r.expected.length;
  if (stopped) s.tally.stopped++;
  const lateness = mean === null ? '' : mean > 15 ? ` · ${mean} ms late on average` : mean < -15 ? ` · ${-mean} ms early on average` : ' · right on the beat';
  message(stopped
    ? `<b>${r.misses} misses — start again.</b> ${hits.length} of ${r.expected.length} hit.`
    : `<b>${hits.length} / ${r.expected.length} hit</b>${lateness}`);
  s.timers.push(setTimeout(() => { if (s) nextRun(); }, SUMMARY_MS));
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

const COLORS = { pending: '#d9a441', hit: '#ffe2a8', wrong: '#d65a5a', miss: '#6a3434' };

function draw(r) {
  const c = canvas();
  const g = c.getContext('2d');
  const W = c.clientWidth, H = c.clientHeight;
  g.clearRect(0, 0, W, H);
  const nowX = W * 0.22, cy = H * 0.5;
  // The now line.
  g.strokeStyle = 'rgba(217,164,65,.55)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(nowX, 12); g.lineTo(nowX, H - 12); g.stroke();
  if (!r || !r.expected.length) return;

  const now = performance.now();
  // Position along the run in beats (note 0 at 0), smooth in time.
  const pos = (now - r.expected[0].t) / r.beat;
  const pxBeat = Math.min(120, W * 0.2);
  const stepPx = Math.min(26, H / 14);
  // Count-in numbers.
  if (r.phase === 'countin' && pos < 0) {
    const n = Math.ceil(-pos / PER_BEAT);   // pos is in notes; count in beats
    if (n >= 1 && n <= COUNT_IN) {
      g.fillStyle = 'rgba(255,226,168,.9)';
      g.font = '800 64px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), W * 0.6, cy);
    }
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  r.expected.forEach((e, i) => {
    const d = i - pos;                        // note slots until this note
    const x = nowX + d * pxBeat;
    // Height = scale position above the drift line at the current slot.
    const y = cy - (e.i - (r.base + r.slope * pos)) * stepPx;
    if (x < -30 || x > W + 30) return;
    const root = e.deg === '1';
    const rad = root ? 20 : 17;
    const fade = x < nowX - 10 ? Math.max(0, 1 - (nowX - x) / (nowX + 30)) : 1;
    g.globalAlpha = fade;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2);
    g.fillStyle = e.status === 'pending' ? '#1c1a14' : COLORS[e.status];
    g.fill();
    g.lineWidth = root ? 3 : 2;
    g.strokeStyle = COLORS[e.status];
    g.stroke();
    g.fillStyle = e.status === 'pending' ? '#ffe2a8' : '#1a1206';
    // Learn mode: a missed disc leaves showing the note it wanted.
    const showName = s.mode === 'learn' && (e.status === 'wrong' || e.status === 'miss');
    g.font = `800 ${showName ? 13 : root ? 18 : 16}px system-ui, sans-serif`;
    g.fillText(showName ? NOTES[pc(e.w)] : e.deg, x, y + 1);
    // Early/late tick for hits: a small bar left (early) or right (late).
    if (e.status === 'hit' && Math.abs(e.off) > 30) {
      g.fillStyle = '#ffe2a8';
      g.fillRect(x + (e.off > 0 ? rad + 3 : -rad - 7), y - 2, 4, 4);
    }
    g.globalAlpha = 1;
  });
}

document.addEventListener('visibilitychange', () => { if (document.hidden) stopScales(); });
