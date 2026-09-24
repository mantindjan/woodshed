// The backing pad, synthesised (no samples). Sound design from
// docs/handover/SOLVED.md: one sawtooth per voice → lowpass (freq × 3 + 600,
// capped 2600) → gain → master → lowpass 5200. No detune and no LFO — a
// backing pad wants stillness, anything moving competes with the player.

import { VOICING } from './music.js';

let ctx = null;
let master = null;
let voices = [];   // every live oscillator, so stopAll() can silence them

// Must be called from a user gesture (tap), or Chrome keeps audio muted.
export function initAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.8;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    lp.Q.value = 0.4;
    master.connect(lp);
    lp.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function playNote(midi, time, level, dur) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const flt = ctx.createBiquadFilter();
  flt.type = 'lowpass';
  flt.Q.value = 0.4;
  flt.frequency.value = Math.min(f * 3 + 600, 2600);
  const g = ctx.createGain();
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = f;
  o.connect(flt);
  flt.connect(g);
  g.connect(master);
  // Envelope: 12 ms in, hold, 30 ms out.
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(level, time + 0.012);
  g.gain.setValueAtTime(level, time + dur);
  g.gain.linearRampToValueAtTime(0, time + dur + 0.03);
  o.start(time);
  o.stop(time + dur + 0.08);
  voices.push({ o, g });
}

// Play a chord. rootConcertPc is a CONCERT pitch class; the root sits in
// octave 3 (MIDI 48–59) so the bass lands in octave 2, as in the prototype.
export function playChord(rootConcertPc, quality, dur) {
  if (!ctx) return;
  stopAll();
  const t = ctx.currentTime + 0.02;
  VOICING[quality].forEach((semi, i) => {
    // Bass loudest, close voicing medium, top doublings quiet.
    const level = i === 0 ? 0.13 : i <= 4 ? 0.085 : 0.05;
    playNote(48 + rootConcertPc + semi, t, level, dur);
  });
}

// A soft, bell-like ping of one note on a right answer: a sine plus a quiet
// octave partial, 5 ms attack, exponential fade. Sits an octave above the
// pad's close voicing (MIDI 72–83) so it reads as an echo, not a new chord.
// pitchConcertPc is a CONCERT pitch class, so it matches the horn.
export function playPing(pitchConcertPc) {
  if (!ctx) return;
  const t = ctx.currentTime + 0.01;
  const f = 440 * Math.pow(2, (72 + pitchConcertPc - 69) / 12);
  for (const [mult, level] of [[1, 0.16], [2, 0.04]]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f * mult;
    o.connect(g);
    g.connect(master);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.start(t);
    o.stop(t + 0.75);
    voices.push({ o, g });
  }
}

// Silence everything now. Called on every stop path, or notes hang.
export function stopAll() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const { o, g } of voices) {
    try { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t); } catch { /* already stopped */ }
    try { o.stop(t); } catch { /* already stopped */ }
  }
  voices = [];
}
