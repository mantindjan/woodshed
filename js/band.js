// The backing for the chord-lane games (Cells, Guide tones): what the band
// plays over a run's chords, and the look-ahead scheduler that queues it
// (C3). Extracted from cells.js when the guide-tones game needed the same
// band (2026-09-28). The trio's brain is trio.js; its sounds are audio.js.
//
// A run object `r` carries: t0 (page ms of the count-in's first click),
// beat (ms), countIn (beats), beats (count-in + tune), nextBeat, and the
// band's parts `bass`, `comp` with their cursors `bassAt`, `compAt` —
// beats counted from the tune's first beat (after the count-in).

import { click, audioTimeAt, swingAt, bassNote, kitHit, compChord } from './audio.js';
import { walk, comp, spansOf, rootLine } from './trio.js';

// Sound is queued this far ahead, as the run goes. Queuing a whole run at
// Start — 12 chords × 7 voices with their filters, plus every click —
// piled up in the audio graph and played choppy on the phone (boss,
// 2026-09-26).
export const LOOKAHEAD_MS = 1500;

// The root's octave in the Rhodes' low mids, A2 (45) to G♯3 (56).
const lowMid = m => { while (m < 45) m += 12; while (m > 56) m -= 12; return m; };

// The band's parts for `chords` [{key (written pc), beats, q}], beats from
// the chords' first beat. Backing (boss, 2026-09-26): 'band' = the trio
// (walking bass, Rhodes comping 3 5 7); 'root' = drums + the root on the
// bass, doubled by the Rhodes in the low mids (A2–G♯3) and its octave,
// played hard — the bass alone was felt more than heard on the phone, the
// low-mid note alone vanished on its speaker; struck again every
// `rootEvery` beats; never a 3rd or 5th. 'click' = no parts (the
// scheduler clicks instead). `calib` turns written into concert.
export function bandParts(chords, backing, calib, rootEvery) {
  if (backing === 'click') return { bass: [], comp: [] };
  const spans = spansOf(chords, undefined, calib);
  if (backing === 'root') {
    const bass = rootLine(chords, calib, rootEvery);
    return { bass, comp: bass.map(b => ({ beat: b.beat, len: b.len, midis: [lowMid(b.midi), lowMid(b.midi) + 12], vel: 1.4 })) };
  }
  return { bass: walk(spans), comp: comp(spans, spans.reduce((a, sp) => a + sp.len, 0)) };
}

// Queue what sounds within LOOKAHEAD_MS of `now`. The count-in is clicks
// (the first accented), so it's clear when to come in; then, with a band,
// the jazz kit — ride on the beats and the swung and of 2 and 4, hi-hat
// foot on 2 and 4, a feathered kick, snare ghosts and a push before each
// 4-bar phrase — plus the bass and comping parts; with 'click', the
// metronome alone, accented where `accent(beatOfTune)` says. Levels are
// the prototype's (docs/trio/). T() gives page time, swung on the upbeats.
export function scheduleBand(r, now, bpm, backing, accent) {
  const swing = swingAt(bpm);
  const first = r.t0 + r.countIn * r.beat;
  const T = b => first + (Math.floor(b) + (b % 1 ? swing : 0)) * r.beat;
  const jit = ms => Math.random() * ms;                          // a band isn't a grid
  const horizon = now + LOOKAHEAD_MS;
  while (r.nextBeat < r.beats && r.t0 + r.nextBeat * r.beat < horizon) {
    const b = r.nextBeat;
    if (b < r.countIn) click(audioTimeAt(r.t0 + b * r.beat), b === 0);
    else if (backing === 'click') click(audioTimeAt(r.t0 + b * r.beat), accent(b - r.countIn));
    else {
      const k = b - r.countIn;                                    // beat of the tune
      const at = x => audioTimeAt(x);
      kitHit('ride', at(T(k) + jit(6)), (k % 2 ? 0.19 : 0.22) * (0.9 + Math.random() * 0.15));
      kitHit('kick', at(T(k) + jit(6)), 0.12);
      if (k % 2 === 1) {
        kitHit('ride', at(T(k + 0.5) + jit(6)), 0.14);
        kitHit('hatfoot', at(T(k) + jit(4)), 0.45);
      }
      if (Math.random() < 0.12) kitHit('snare', at(T(k + 0.5)), 0.12);
      if (k % 16 === 15 && Math.random() < 0.6) kitHit('snare', at(T(k + 0.5)), 0.3);
    }
    r.nextBeat++;
  }
  while (r.bassAt < r.bass.length && T(r.bass[r.bassAt].beat) < horizon) {
    const n = r.bass[r.bassAt++];
    // Each note rings into the next; a touch more on 1 and 3.
    const vel = (n.beat % 2 === 0 ? 1 : 0.9) * (0.85 + Math.random() * 0.15);
    // Walking: a beat each; root only: held till struck again.
    bassNote(n.midi, audioTimeAt(T(n.beat) - 4 + jit(14)), ((n.len || 1) * r.beat) / 1000 + 0.02, vel);
  }
  while (r.compAt < r.comp.length && T(r.comp[r.compAt].beat) < horizon) {
    const h = r.comp[r.compAt++];
    compChord(h.midis, audioTimeAt(T(h.beat)), (h.len * r.beat) / 1000, h.vel ?? 0.7 + Math.random() * 0.25);
  }
}
