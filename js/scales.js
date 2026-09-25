// Scale runner (E1): play a scale in a pattern (linear up/down, broken
// thirds, scalelevels.js PATTERNS) across the horn's range, in time,
// hitting each note as it reaches the "now" line.
//
// Flow per run: waiting (blow any note of the scale — that's where the run
// starts) → count-in (4 clicks) → running (the pattern in EIGHTHS — two
// notes per click at the set bpm — from the start note to the edge of the
// range, low B♭ / high F♯) → summary → next run, in the next key of the
// exercise (drawn toward weak keys or evenly, scalelevels.js) … until Stop.
// A Start-to-Stop session is one `round` in the events. On Auto tempo
// (practice) each run's outcome moves the tempo for the next (scaletempo.js);
// the tempo is always on screen, big, with an arrow when it just moved.
//
// Judging: a note is HIT if it's the right written pitch (octave included)
// within the window around its time — ±150 ms, narrowed at fast tempos so
// neighbouring notes' windows never overlap; early/late is shown and graded
// but isn't an error. A wrong pitch in the window, or nothing by the end of
// it, is a MISS. Practice: after `misses` misses the run stops ("start again").
// Learn (boss, 2026-09-25): the same judging, shown the other way round, and
// nothing ever stops. Before each run it names a start note ("low B♭ — B♭3");
// the player plays first — no preview sound (boss: a 4-note preview before
// the start note was dropped the same day). Once the start note is blown the whole run is drawn at once, still, as a SHEET (wrapped
// into rows); after the count-in a playhead sweeps across it left to right,
// each note played lands as a mark where it was played (time × pitch), and
// the end shows a tally: right notes and how many were on the beat.
// (A first cut held the lane on a miss; it froze unreliably when a note
// slid past the line, and was dropped.)
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
import { pickScaleKey, PATTERNS } from './scalelevels.js';
import { tempoKey } from './scaletempo.js';
import { saveKeys, saveTempo } from './summary.js';

const MAX_WINDOW_MS = 150;     // hit window either side of a note (as G2)
const COUNT_IN = 4;            // clicks before the first note
const PER_BEAT = 2;            // eighths: two scale notes per click (boss, 2026-09-25)
const SUMMARY_MS = 1800;       // how long a run's summary shows before the next
const SHEET_SUMMARY_MS = 4000; // learn: longer, to read the marks on the sheet
const SHEET_ROW = 16;          // learn: most notes per sheet row
// A hit this close counts "on the beat"; beyond it the disc gets an
// early/late tick. 30 ms was too tight on the horn (boss, 2026-09-25).
const ON_BEAT_MS = 100;
const MIN_RUN = 4;             // learn suggests a start with at least this many notes ahead
const GLOW_MS = 650;           // how long a hit's bloom takes to settle
// v3: `pattern` replaces `direction`. v4: learn runs add `hint` (and, that
// evening only, `waits` from the dropped lane-hold learn). v5: learn = sheet.
// v6: `tempoAuto` (was the bpm set by the auto-tempo staircase).
const SCHEMA_VERSION = 6;

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
// bpm (the first run's), misses, calib, calibOffset}. onEnd() when stopped.
export function startScales(opts, onEnd) {
  initAudio();
  requestPersistence();
  navigator.wakeLock?.request('screen').then(l => { wakeLock = l; }).catch(() => {});
  s = { ...opts, scale: opts.exercise.scale, pattern: opts.exercise.pattern, keys: opts.exercise.keys, onEnd,
        session: Date.now().toString(36), run: null, timers: [], moved: 0 };
  nextRun();
  resize();
  raf = requestAnimationFrame(frame);
}

export function stopScales() {
  if (!s) return;
  const { onEnd } = s;
  s.timers.forEach(clearTimeout);
  cancelAnimationFrame(raf);
  stopAll();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  s = null;
  message('');
  draw(null);
  onEnd();
}

// A new run: the next key of the exercise, weighted toward weak ones or
// even, never the same twice in a row when there's a choice.
function nextRun() {
  const k = pickScaleKey(s.model, { scale: s.scale, pattern: s.pattern, keys: s.keys, pick: s.pick, prev: s.run?.key });
  s.run = { key: k, phase: 'waiting', notes: [], expected: [], misses: 0, hint: null };
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
  $('#scaleBpmNote').textContent = !r ? '' : `${s.moved > 0 ? '↑ ' : s.moved < 0 ? '↓ ' : ''}bpm${s.tempoAuto ? ' auto' : ''}`;
  $('#scaleInfo').textContent = r ? `misses ${r.misses}${s.mode === 'practice' ? `/${s.misses}` : ''}` : '';
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
    best.hitAt = now;
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
  r.scaleNotes = notes;               // for placing played marks on the sheet
  r.beatMs = beat;
  r.step = step;                      // the lane moves one slot per note
  r.window = Math.min(MAX_WINDOW_MS, step * 0.45);
  // Lane drift: the least-squares line through (slot, scale position) at the
  // pattern's slope — the discs are drawn relative to it (see draw()).
  r.slope = PATTERNS[s.pattern].slope;
  r.base = idx.reduce((a, j, k) => a + j - r.slope * k, 0) / idx.length;
  r.notes = [[midi, 0]];
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
  addEvent(event);
  // The key model adapts within the session; the summary keeps it for next time.
  s.model.add(event);
  saveKeys(s.model);
  // Auto tempo: this run moves the tempo for the next.
  let tempoNote = '';
  if (s.tempoAuto) {
    s.tempo.add(event);
    saveTempo(s.tempo);
    const key = tempoKey(s.scale, s.pattern);
    const next = s.tempo.next(key);
    s.moved = Math.sign(next - s.bpm);
    tempoNote = s.moved > 0 ? `<br>Tempo up → <b>${next}</b>` : s.moved < 0 ? `<br>Tempo down → <b>${next}</b>`
      : `<br><small>clean ${s.tempo.streak(key)} of 3 at ${next}</small>`;
    s.bpm = next;
  }
  const lateness = mean === null ? '' : mean > 15 ? ` · ${mean} ms late on average` : mean < -15 ? ` · ${-mean} ms early on average` : ' · right on the beat';
  if (s.mode === 'learn') {
    // The tally sits under the sheet, which stays up to be read.
    const onBeat = hits.filter(e => Math.abs(e.off) <= ON_BEAT_MS).length;
    const drift = mean !== null && Math.abs(mean) > 15 ? lateness : '';   // "on the beat" is already said
    message(`<b>${hits.length} / ${r.expected.length} right</b> · ${onBeat} on the beat${drift}`);
    $('#scaleMsg').classList.add('tally');
  } else {
    message((stopped
      ? `<b>${r.misses} misses — start again.</b> ${hits.length} of ${r.expected.length} hit.`
      : `<b>${hits.length} / ${r.expected.length} hit</b>${lateness}`) + tempoNote);
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
  if (r && r.expected.length) countIn(g, r, W);
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
    disc(g, e, x, y, rad, root, false);
    g.globalAlpha = 1;
  });
}

// 0–1: how close to the beat a hit was.
const accuracy = (r, e) => 1 - Math.min(Math.abs(e.off), r.window) / r.window;

// One degree disc, coloured by status. `named`: a wrong/missed disc shows
// its note name instead (learn: the answer on a miss).
function disc(g, e, x, y, rad, root, named) {
  g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2);
  g.fillStyle = e.status === 'pending' ? '#1c1a14' : COLORS[e.status];
  g.fill();
  g.lineWidth = root ? 3 : 2;
  g.strokeStyle = COLORS[e.status];
  g.stroke();
  g.fillStyle = e.status === 'pending' ? '#ffe2a8' : '#1a1206';
  const showName = named && (e.status === 'wrong' || e.status === 'miss');
  const size = Math.round(rad * (showName ? 0.75 : root ? 0.9 : 0.95));
  g.font = `800 ${size}px system-ui, sans-serif`;
  g.fillText(showName ? NOTES[pc(e.w)] : e.deg, x, y + 1);
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
    const stepPx = Math.min(rad * 0.9, (bandH - 2 * rad - 4) / Math.max(1, hi - lo));
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
  const marks = r.notes.slice(1).map(([midi, ms]) => {
    const p = slotAt(r, r.t0 + ms);
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
    disc(g, e, x, y, L.rad, e.deg === '1', true);
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
