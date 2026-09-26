// The app's sound, synthesised (no samples, nothing to download or cache).
//
// Chords: an FM electric piano (DX7-style Rhodes tine), in a generated
// room — chosen by the boss by ear on 2026-09-26 over the old sawtooth pad
// ("the other sounds like absolute shit"). Per note: a sine carrier with
// two sine modulators, ratio 1 for the warm bark (brightness decaying over
// ~0.45 s) and ratio 14 for the bell ping on the attack (~70 ms); the
// amplitude strikes fast and decays, low notes ringing longer. Chord tones
// only — bass root below, then 1 3 5 7 close (SOLVED.md: extensions were
// tried and rejected as muddy; the boss said it again). Notes are rolled a
// few ms apart, as no hand strikes five keys at once.
//
// Room: a ConvolverNode on an impulse made in code (stereo noise with a
// decaying envelope, 2.4 s), after a gentle saturation that glues the
// voices; dry 0.85 + wet 0.32.
//
// Swing is set by tempo (swingAt).
//
// Trio (patterns, C3): samples from FluidR3 Mono GM (MIT, public/sounds/,
// licence alongside) — its "Acoustic Bass" (6 zones, looped sustain) and
// "Jazz" kit (ride, hi-hat foot, kick, snare) — plus Rhodes comping. The
// levels are the prototype's the boss approved by ear (docs/trio/, clip 8,
// bass −2 dB on his word). The bass bus has the phone-speaker trick: phone
// speakers can't play a bass fundamental, so a parallel drive adds
// harmonics the ear reads as the note and a +7 dB peak at 800 Hz lifts the
// growl (A-weighted, the old orchestral pizz was 4 % of the mix — inaudible).
//
// The metronome click keeps its own bus (SOLVED.md) and the right-answer
// ping stays a sine echo an octave up.

import { VOICING } from './music.js';

let ctx = null;
let master = null;     // the ping
let room = null;       // Rhodes in: → saturation → dry + reverb
let verb = null;       // the room's convolver, for sends
let clickBus = null;   // metronome clicks: own bus, bypassing everything else
let out = null;        // everything but the click: a little headroom, then a limiter
let bassBus = null, kitBus = null, compBus = null;   // the trio
let noise = null;      // cached white-noise buffer (clicks)
// Every live source, so stopAll() can silence them. A source leaves the set
// when it ends — kept forever, a long session piled up thousands.
let voices = new Set();
function track(o, g) {
  const v = { o, g };
  voices.add(v);
  o.onended = () => voices.delete(v);
}

// Must be called from a user gesture (tap), or Chrome keeps audio muted.
export function initAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    // The output: 0.85 of headroom, then a hard limiter. Without it the
    // trio's buses (bass with its drive, kit, comping, room) summed straight
    // into the speaker and a loud Rhodes hit on top clipped — it crackled on
    // the phone (boss, 2026-09-26).
    out = ctx.createGain();
    out.gain.value = 0.85;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20;
    lim.attack.value = 0.002; lim.release.value = 0.12;
    out.connect(lim);
    lim.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 0.8;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    lp.Q.value = 0.4;
    master.connect(lp);
    lp.connect(out);
    buildRoom();
    // Clicks go straight out with their own compressor (SOLVED.md): routed
    // through the master lowpass they were too quiet against the chords.
    clickBus = ctx.createGain();
    clickBus.gain.value = 2.6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6; comp.knee.value = 6; comp.ratio.value = 4;
    comp.attack.value = 0.001; comp.release.value = 0.05;
    clickBus.connect(comp);
    comp.connect(ctx.destination);
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function buildRoom() {
  room = ctx.createGain();
  room.gain.value = 0.8;
  const sat = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(1.4 * x) / Math.tanh(1.4); }
  sat.curve = curve;
  sat.oversample = '4x';               // no aliasing grit (heard as crackle on the phone)
  room.connect(sat);
  const sr = ctx.sampleRate, len = Math.round(sr * 2.4);
  const ir = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  verb = ctx.createConvolver();
  verb.buffer = ir;
  const dry = ctx.createGain(); dry.gain.value = 0.85;
  const wet = ctx.createGain(); wet.gain.value = 0.32;
  sat.connect(dry); dry.connect(out);
  sat.connect(verb); verb.connect(wet); wet.connect(out);
  buildTrio();
}

// The trio's buses (as the prototype's mix): bass centre with the phone
// trick and a little room, kit a touch left, comping a touch right.
function buildTrio() {
  const bus = (level, sendLevel, pan) => {
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    const g = ctx.createGain(); g.gain.value = level;
    p.connect(g); g.connect(out);
    const snd = ctx.createGain(); snd.gain.value = sendLevel; g.connect(snd); snd.connect(verb);
    return p;
  };
  const bassOut = bus(1.0, 0.08, 0);
  bassBus = ctx.createGain();
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 35;
  const peak = ctx.createBiquadFilter(); peak.type = 'peaking'; peak.frequency.value = 800; peak.Q.value = 0.9; peak.gain.value = 9;   // 7 → 9: "a tad more in the mids" (boss)
  const drive = ctx.createWaveShaper(); const cv = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; cv[i] = Math.tanh(3 * x) / Math.tanh(3); }
  drive.curve = cv;
  drive.oversample = '4x';             // a driven bass aliases without it: fine crackle
  const drv = ctx.createGain(); drv.gain.value = 0.35;
  bassBus.connect(hp); hp.connect(peak); peak.connect(bassOut);
  hp.connect(drive); drive.connect(drv); drv.connect(bassOut);
  kitBus = bus(0.9, 0.15, -0.2);
  compBus = bus(0.55, 0.35, 0.25);
}

// --- Trio samples: loaded once, on first use (patterns' Start) ---
// Bass zones: root (MIDI), the keys it covers, its sustain loop (frames).
const BASS_ZONES = [
  { root: 28, lo: 0, hi: 28, loop: [76560, 78701] }, { root: 29, lo: 29, hi: 29, loop: [90123, 91133] },
  { root: 36, lo: 30, hi: 36, loop: [51742, 52417] }, { root: 41, lo: 37, hi: 41, loop: [52903, 53409] },
  { root: 46, lo: 42, hi: 46, loop: [43947, 44705] }, { root: 54, lo: 47, hi: 127, loop: [36227, 36704] },
];
const KIT = ['ride', 'hatfoot', 'kick', 'snare'];
let trio = null;           // {bass: [{…zone, buf}], kit: {name: buf}} once loaded
let trioLoading = null;
export function loadTrio() {
  if (trio) return Promise.resolve();
  if (!trioLoading) {
    const get = async url => ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    trioLoading = Promise.all([
      Promise.all(BASS_ZONES.map(async z => ({ ...z, buf: await get(`sounds/bass/bass-${z.root}.ogg`) }))),
      Promise.all(KIT.map(async k => [k, await get(`sounds/kit/${k}.ogg`)])),
    ]).then(([bass, kit]) => { trio = { bass, kit: Object.fromEntries(kit) }; })
      .catch(err => { trioLoading = null; throw err; });
  }
  return trioLoading;
}

// A bass note at `t`, held `dur` s (looping its sustain), then released.
export function bassNote(midi, t, dur, vel = 1) {
  if (!ctx || !trio) return;
  const z = trio.bass.find(b => midi >= b.lo && midi <= b.hi);
  const src = ctx.createBufferSource(); src.buffer = z.buf;
  src.playbackRate.value = Math.pow(2, (midi - z.root) / 12);
  src.loop = true; src.loopStart = z.loop[0] / 44100; src.loopEnd = z.loop[1] / 44100;
  const g = ctx.createGain(); src.connect(g); g.connect(bassBus);
  // 0.31: the prototype's 0.35 less 2 dB ("tone the bass down slightly"),
  // then +1 dB ("a tad louder") — boss, 2026-09-26.
  g.gain.setValueAtTime(0.31 * vel, t); g.gain.setTargetAtTime(0, t + dur, 0.06);
  src.start(t); src.stop(t + dur + 0.4); track(src, g);
}

// A kit hit ('ride', 'hatfoot', 'kick', 'snare') at `t`.
export function kitHit(name, t, vel) {
  if (!ctx || !trio) return;
  const src = ctx.createBufferSource(); src.buffer = trio.kit[name];
  const g = ctx.createGain(); g.gain.value = vel; src.connect(g); g.connect(kitBus);
  src.start(t); track(src, g);
}

// A comping voicing (MIDI notes, concert) at `t` for `dur` s, rolled a few ms.
export function compChord(midis, t, dur, vel) {
  if (!ctx) return;
  for (const m of midis) rhodesNote(m, t + rnd(0, 0.012), dur, vel, 0, compBus);
}

const rnd = (a, b) => a + Math.random() * (b - a);
const freq = midi => 440 * Math.pow(2, (midi - 69) / 12);

// One Rhodes note at audio time `t`, released at t + dur, into `dest`
// (the room, or the comping bus).
function rhodesNote(midi, t, dur, vel, pan, dest = room) {
  const f = freq(midi);
  const car = ctx.createOscillator(); car.frequency.value = f;
  const m1 = ctx.createOscillator(); m1.frequency.value = f;
  const m2 = ctx.createOscillator(); m2.frequency.value = f * 14;
  const i1 = ctx.createGain(), i2 = ctx.createGain();
  const bright = Math.max(0.4, 1.4 - (midi - 48) / 40);            // lower notes bark more
  i1.gain.setValueAtTime(f * 2.4 * vel * bright, t); i1.gain.exponentialRampToValueAtTime(f * 0.35, t + 0.45);
  i2.gain.setValueAtTime(f * 1.1 * vel * bright, t); i2.gain.exponentialRampToValueAtTime(f * 0.001, t + 0.07);
  m1.connect(i1); i1.connect(car.frequency); m2.connect(i2); i2.connect(car.frequency);
  const amp = ctx.createGain();
  const decay = 1.2 + 2.2 * Math.max(0, (84 - midi) / 36);          // low notes ring longer
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.16 * vel, t + 0.004);
  amp.gain.setTargetAtTime(0.04 * vel, t + 0.004, decay);
  amp.gain.setTargetAtTime(0, t + dur, 0.08);
  const p = ctx.createStereoPanner(); p.pan.value = pan;
  car.connect(amp); amp.connect(p); p.connect(dest);
  // Stop what's no longer heard, to spare the phone's CPU (a crackle
  // suspect): the bell modulator is gone after ~70 ms, the rest shortly
  // after the release.
  for (const o of [car, m1, m2]) { o.start(t); track(o, amp); }
  car.stop(t + dur + 0.35); m1.stop(t + dur + 0.35); m2.stop(t + 0.12);
}

// A chord: bass root an octave down, then 1 3 5 7 close (VOICING's first
// five). rootConcertPc is a CONCERT pitch class; the root sits in octave 3
// (MIDI 48–59).
function rhodesChord(rootConcertPc, quality, t, dur) {
  VOICING[quality].slice(0, 5).forEach((semi, i) => {
    rhodesNote(48 + rootConcertPc + semi, t + rnd(0, 0.012), dur, rnd(0.85, 1), i === 0 ? 0 : (i % 2 ? -0.35 : 0.35));
  });
}

// Play a chord now (the degree drill: a new question cuts the last one).
export function playChord(rootConcertPc, quality, dur) {
  if (!ctx) return;
  stopAll();
  rhodesChord(rootConcertPc, quality, ctx.currentTime + 0.02, dur);
}

// --- Swing ---
// Where the swung "and" falls, as a fraction of the beat: near 3:1 at
// ballads, 2:1 at medium, flattening toward straight eighths fast (IDEAS.md:
// hard-code 2:1 and it feels leaden slow and frantic fast).
export function swingAt(bpm) {
  if (bpm <= 80) return 0.72;
  if (bpm <= 160) return 0.72 - (bpm - 80) * (0.72 - 0.64) / 80;
  if (bpm >= 280) return 0.54;
  return 0.64 - (bpm - 160) * (0.64 - 0.54) / 120;
}

// A soft, bell-like ping of one note on a right answer: a sine plus a quiet
// octave partial, 5 ms attack, exponential fade. Sits an octave above the
// chord's close voicing (MIDI 72–83) so it reads as an echo, not a new chord.
// pitchConcertPc is a CONCERT pitch class, so it matches the horn.
export function playPing(pitchConcertPc) {
  if (!ctx) return;
  const t = ctx.currentTime + 0.01;
  const f = freq(72 + pitchConcertPc);
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
    track(o, g);
  }
}

// The audio-clock time (s) matching a performance.now() time (ms), so
// clicks can be scheduled exactly on beats measured in page time.
export function audioTimeAt(perfMs) {
  return ctx ? ctx.currentTime + (perfMs - performance.now()) / 1000 : 0;
}

// Metronome click (B4) at audio time `time`: a white-noise burst through a
// bandpass — noise, not a sine, reads as a tick rather than a beep
// (SOLVED.md). Accents sit higher and louder.
export function click(time, accent = false) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = accent ? 2600 : 1900;
  bp.Q.value = accent ? 6 : 5;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 600;
  const g = ctx.createGain();
  src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(clickBus);
  const peak = accent ? 1.0 : 0.62;
  const dur = accent ? 0.038 : 0.028;
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(peak, time + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  src.start(time);
  src.stop(time + dur + 0.02);
  track(src, g);
}

// Silence everything now. Called on every stop path, or notes hang.
export function stopAll() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const { o, g } of voices) {
    try { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t); } catch { /* already stopped */ }
    try { o.stop(t); } catch { /* already stopped */ }
  }
  voices = new Set();
}
