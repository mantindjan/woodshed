// Scale runner (E1): play a scale in a pattern (linear up/down, broken
// thirds, scalelevels.js PATTERNS) across the horn's range, in time,
// hitting each note as it reaches the "now" line.
//
// Flow per run: waiting (blow any note of the scale — that's where the run
// starts) → count-in (4 clicks) → running (the pattern in EIGHTHS — two
// notes per click at the set bpm — from the start note to the edge of the
// range, low B♭ / high F♯) → summary → next run, in the next key of the
// exercise (drawn toward weak keys or evenly, scalelevels.js) … until Stop.
// A Start-to-Stop session is one `round` in the events; it earns stars.
//
// Judging: a note is HIT if it's the right written pitch (octave included)
// within the window around its time — ±150 ms, narrowed at fast tempos so
// neighbouring notes' windows never overlap; early/late is shown and graded
// but isn't an error. A wrong pitch in the window, or nothing by the end of
// it, is a MISS. Practice: after `misses` misses the run stops ("start again").
// Learn (boss, 2026-09-25): signposts and a lane that waits. Before each
// run it names a start note ("low B♭ — B♭3") and sounds the pattern's first
// PREVIEW notes at the tempo. A miss never stops the run: the lane HOLDS on
// the missed note, which shows its name, until the right note is played;
// then the run rolls on, the next note one beat later. The first attempt
// still sets the note's status (so stats stay honest); the waits are
// recorded next to it.
//
// Pitch: written = MIDI − calibOffset, where calibOffset = the MIDI note the
// horn sends for written middle C (C5 = 72) minus 72 (main.js calibration).
//
// Display: a canvas lane. Notes are degree discs (no note names), placed by
// scale step and note slot, gliding toward the now line near the left. The
// view drifts with the pattern's overall direction (its slope), so a linear
// run arrives on a diagonal and broken thirds zigzag around it. Hits bloom
// (additive halo, ring, sparks), bigger and brighter the closer to the beat.
// The count-in is four dots filling, not numbers: numbers collided with the
// degree discs (boss, 2026-09-25).

import { SCALES, SAX_RANGE, NOTES, pc, noteName } from './music.js';
import { initAudio, click, audioTimeAt, stopAll, playLine } from './audio.js';
import { addEvent, requestPersistence } from './events.js';
import { pickScaleKey, sessionStars, PATTERNS } from './scalelevels.js';
import { saveKeys, saveStars } from './summary.js';

const MAX_WINDOW_MS = 150;     // hit window either side of a note (as G2)
const COUNT_IN = 4;            // clicks before the first note
const PER_BEAT = 2;            // eighths: two scale notes per click (boss, 2026-09-25)
const SUMMARY_MS = 1800;       // how long a run's summary shows before the next
const PREVIEW = 4;             // learn: notes of the pattern sounded before a run
const GLOW_MS = 650;           // how long a hit's bloom takes to settle
// v3: `pattern` replaces `direction`. v4: learn runs add `hint` and `waits`.
const SCHEMA_VERSION = 4;

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
    .filter(x => pc(x.w - key) === 0 && x.n >= PREVIEW);
  if (!roots.length) return null;
  return PATTERNS[pattern].slope > 0 ? roots[0].w : roots[roots.length - 1].w;
}

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
  s.run = { key: k, phase: 'waiting', notes: [], expected: [], misses: 0, hold: null, waits: [], hint: null };
  topBar();
  const scaleName = `<b>${NOTES[k]} ${SCALES[s.scale].name.toLowerCase()}</b>`;
  const pattern = PATTERNS[s.pattern].name.toLowerCase();
  const start = s.mode === 'learn' ? suggestStart(s.scale, k, s.pattern) : null;
  if (start === null) {
    message(`Blow any note of ${scaleName} to start — ${pattern}`);
    return;
  }
  // Learn: name the start note and let the pattern's opening be heard.
  s.run.hint = { start, preview: PREVIEW };
  message(`Start on <b>${register(start)} ${NOTES[pc(start)]}</b> (${noteName(start)}) — ${scaleName}, ${pattern}` +
          '<br><small>any scale note works too</small>');
  const notes = scaleNotes(s.scale, k);
  const idx = PATTERNS[s.pattern].indices(notes.indexOf(start), notes.length).slice(0, PREVIEW);
  const r = s.run;
  s.timers.push(setTimeout(() => {
    if (s?.run === r && r.phase === 'waiting') {
      playLine(idx.map(j => notes[j] + s.calibOffset), audioTimeAt(performance.now() + 30), 60 / s.bpm / PER_BEAT);
    }
  }, 350));
}

// The key stays on screen the whole run, big (boss: the 2-second message
// was easy to forget); the pattern sits next to it.
function topBar() {
  const r = s?.run;
  $('#scaleKey').textContent = r ? `${NOTES[r.key]} ${SCALES[s.scale].name.toLowerCase()}` : '';
  $('#scalePattern').textContent = r ? PATTERNS[s.pattern].chip.toLowerCase() : '';
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
  if (r.hold) {
    // Learn, lane held: only the held note moves it on.
    if (w === r.hold.w) release(now);
    else r.hold.tries++;
    return;
  }
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
    miss(best, now);
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
  stopAll();                          // cut a preview still sounding
  const run = idx.map(j => notes[j]);
  const beat = 60000 / s.bpm;
  const step = beat / PER_BEAT;       // time between scale notes
  r.t0 = now;
  r.beatMs = beat;
  r.step = step;                      // the lane moves one slot per note
  r.window = Math.min(MAX_WINDOW_MS, step * 0.45);
  // Lane drift: the least-squares line through (slot, scale position) at the
  // pattern's slope — the discs are drawn relative to it (see draw()).
  r.slope = PATTERNS[s.pattern].slope;
  r.base = idx.reduce((a, j, k) => a + j - r.slope * k, 0) / idx.length;
  r.notes = [[midi, 0]];
  // Count-in clicks on beats 1–4 after the start note; note j at beat 5 +
  // j/2. Clicks keep going on every beat through the run. `t` is when a
  // note is judged; `at` when it's drawn on the now line (they part only
  // after a learn hold, see release()).
  r.expected = run.map((nw, j) => {
    const t = now + beat * (COUNT_IN + 1) + step * j;
    return { w: nw, i: idx[j], deg: degreeOf(s.scale, r.key, nw), t, at: t, status: 'pending', off: null, hitAt: null };
  });
  const beats = COUNT_IN + Math.ceil(run.length / PER_BEAT);
  for (let b = 1; b <= beats; b++) click(audioTimeAt(now + beat * b), b === 1);
  r.phase = 'countin';
  message('');
  s.timers.push(setTimeout(() => { if (s?.run === r) r.phase = 'running'; },
                           beat * (COUNT_IN + 1) - r.window - 1));
}

// A miss on note `e`. Practice counts it toward a restart; learn holds the
// lane on it until it's played (release()).
function miss(e, now) {
  const r = s.run;
  r.misses++;
  topBar();
  if (s.mode === 'practice') {
    if (r.misses >= s.misses) endRun(true);
    return;
  }
  // The lane freezes where it is (a little past the note once its window
  // has closed) rather than jumping back onto it.
  r.holdPos = lanePos(r, now);
  r.hold = e;
  e.heldAt = now;
  e.tries = 0;
  stopAll();                          // the clicks stop with the lane
}

// Learn: the held note was played. Log the wait, then re-time what's left:
// the next note a beat from now, eighths after it, clicks back on the beats.
function release(now) {
  const r = s.run;
  const e = r.hold;
  const k0 = r.expected.indexOf(e);
  r.waits.push({ note: k0, ms: Math.round(now - e.heldAt), tries: e.tries });
  // Drawn as if it crossed the line where the lane froze, so it moves on
  // from there without a jump.
  e.at = now - (r.holdPos - k0) * r.step;
  e.fixedAt = now;
  r.hold = null;
  r.expected.slice(k0 + 1).forEach((x, j) => {
    x.t = x.at = now + r.beatMs + r.step * j;
    if (j % PER_BEAT === 0) click(audioTimeAt(x.t), false);
  });
  checkDone();
}

// Called from frames: notes whose window has passed unplayed are misses.
// While learn holds the lane, time stands still for the notes ahead.
function expire(now) {
  const r = s.run;
  if (r.phase !== 'running') return;
  for (const e of r.expected) {
    if (r.hold) return;
    if (e.status === 'pending' && now > e.t + r.window) {
      e.status = 'miss';
      miss(e, now);
      if (r.phase !== 'running') return;
    }
  }
  checkDone();
}

function checkDone() {
  const r = s?.run;
  if (r && r.phase === 'running' && !r.hold && r.expected.every(e => e.status !== 'pending')) endRun(false);
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
    // Each expected note: [written pitch, ms after the start note, degree,
    // first-attempt status, timing offset ms]. After a learn hold the later
    // times are the re-timed ones.
    expected: r.expected.map(e => [e.w, Math.round(e.t - r.t0), e.deg, e.status, e.off]),
    notes: r.notes,                   // every note-on: [raw MIDI, ms after the start note]
    stopped,
  };
  // Learn only: the suggested start {start: written MIDI, preview: notes
  // sounded} and each hold {note: index in expected, ms held, tries: wrong
  // notes before the right one}.
  if (s.mode === 'learn') Object.assign(event, { hint: r.hint, waits: r.waits });
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
    : `<b>${hits.length} / ${r.expected.length} hit</b>${s.mode === 'learn' ? ' first time' : ''}${lateness}`);
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

// Where the lane should be, in note slots (note 0 on the now line = 0):
// between the draw times (`at`) of the notes either side of now; frozen
// during a learn hold.
function lanePos(r, now) {
  if (r.hold) return r.holdPos;
  const ex = r.expected;
  let k = -1;
  while (k + 1 < ex.length && ex[k + 1].at <= now) k++;
  if (k < 0) return (now - ex[0].at) / r.step;
  if (k === ex.length - 1) return k + (now - ex[k].at) / r.step;
  return k + (now - ex[k].at) / (ex[k + 1].at - ex[k].at);
}

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
  const nowX = W * 0.22, cy = H * 0.5;
  // The now line.
  g.strokeStyle = 'rgba(217,164,65,.55)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(nowX, 12); g.lineTo(nowX, H - 12); g.stroke();
  if (!r || !r.expected.length) return;

  const now = performance.now();
  const pos = lanePos(r, now);
  const pxBeat = Math.min(120, W * 0.2);
  const stepPx = Math.min(26, H / 14);
  // Count-in: four dots, one filling per click.
  if (r.phase === 'countin') {
    const filled = Math.min(COUNT_IN, Math.floor((now - r.t0) / r.beatMs));
    for (let b = 0; b < COUNT_IN; b++) {
      const x = W * 0.6 + (b - (COUNT_IN - 1) / 2) * 30;
      g.beginPath(); g.arc(x, 26, 8, 0, Math.PI * 2);
      g.fillStyle = b < filled ? '#ffe2a8' : 'transparent';
      g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(255,226,168,.7)'; g.stroke();
      if (b < filled) bloom(g, x, 26, 8, 0.4, now - (r.t0 + r.beatMs * (b + 1)));
    }
  }
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
    const held = r.hold === e;
    g.globalAlpha = fade;
    if (e.status === 'hit') bloom(g, x, y, rad, 1 - Math.min(Math.abs(e.off), r.window) / r.window, now - e.hitAt);
    if (e.fixedAt) bloom(g, x, y, rad, 0.3, now - e.fixedAt);   // learn: found after a hold
    if (held) {
      // Learn hold: a slow red pulse around the wanted note.
      const p = 0.5 + 0.5 * Math.sin(now / 180);
      g.save();
      g.shadowColor = 'rgba(214,90,90,.9)';
      g.shadowBlur = 18 + 18 * p;
      g.beginPath(); g.arc(x, y, rad + 2 + 3 * p, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,140,120,.8)'; g.lineWidth = 2; g.stroke();
      g.restore();
    } else if (e.status === 'pending' && d > -0.5 && d < 1.5) {
      // The next note to play warms up as it reaches the line.
      g.save();
      g.shadowColor = 'rgba(217,164,65,.8)';
      g.shadowBlur = 16 * (1 - Math.abs(d - 0.5) / 1);
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2);
      g.strokeStyle = COLORS.pending; g.lineWidth = 2; g.stroke();
      g.restore();
    }
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2);
    const found = !!e.fixedAt;         // learn: played right after a hold
    g.fillStyle = e.status === 'pending' ? '#1c1a14' : found ? '#8a6a3a' : COLORS[e.status];
    g.fill();
    g.lineWidth = root ? 3 : 2;
    g.strokeStyle = found ? '#ffe2a8' : COLORS[e.status];
    g.stroke();
    g.fillStyle = e.status === 'pending' ? '#ffe2a8' : '#1a1206';
    // Learn mode: a missed disc shows the note it wants.
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
