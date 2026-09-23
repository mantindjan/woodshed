// TEMPORARY: breath log, to set a threshold for filtering stray low-breath
// notes. Remove this file, its <section> in index.html, its sw.js entry and
// the onRaw wiring in main.js once the breath filter is built.
//
// The YDS streams breath as CC 11 (0–127) every few ms while air flows,
// sends note-on as breath rises past a low level, and releases the note
// when breath returns to 0 (see docs/midi.md). This log prints one line per
// breath — from CC 11 leaving 0 until it returns to 0:
//   53 on@15  peak 99  612ms      note 53 triggered at breath 15
//   no note  peak 5  40ms         air, but the horn sent no note

const BREATH_CC = 11;
const MAX_LINES = 300;
const $ = sel => document.querySelector(sel);

let lines = [];
let breath = null;   // current breath: {start, peak, level, notes: []}

function render() {
  const el = $('#midilog');
  el.textContent = lines.join('\n');
  el.scrollTop = el.scrollHeight;   // oldest first; keep the newest in view
}

function push(line) {
  lines.push(line);
  if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
  render();
}

function endBreath(t) {
  const ms = Math.round(t - breath.start);
  if (breath.notes.length) push(`${breath.notes.join(', ')}  peak ${breath.peak}  ${ms}ms`);
  // Peaks of 0–1 are sensor flicker at rest, not a puff; skip them.
  else if (breath.peak > 1) push(`no note  peak ${breath.peak}  ${ms}ms`);
  breath = null;
}

export function logMidi([status, d1, d2], t) {
  const type = status & 0xf0;
  if (type === 0xb0 && d1 === BREATH_CC) {
    if (d2 > 0 && !breath) breath = { start: t, peak: 0, level: 0, notes: [] };
    if (!breath) return;
    breath.peak = Math.max(breath.peak, d2);
    breath.level = d2;
    if (d2 === 0) endBreath(t);
  } else if (type === 0x90 && d2 > 0) {
    if (!breath) breath = { start: t, peak: 0, level: 0, notes: [] };
    breath.notes.push(`${d1} on@${breath.level}`);
  }
}

$('#midilogClear').addEventListener('click', () => {
  lines = [];
  breath = null;
  render();
});

$('#midilogCopy').addEventListener('click', async () => {
  const btn = $('#midilogCopy');
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
});
