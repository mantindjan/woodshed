// TEMPORARY: raw MIDI log, decoding every message, to find how the YDS
// reports breath strength (for filtering stray low-breath notes). Remove
// this file, its <section> in index.html, its sw.js entry and the onRaw
// wiring in main.js once the breath filter is built.

const MAX_LINES = 300;
const $ = sel => document.querySelector(sel);

let lines = [];
let lastT = null;

// One human-readable line per MIDI message.
function decode([status, d1, d2]) {
  const type = status & 0xf0;
  switch (type) {
    case 0x90: return d2 === 0 ? `off ${d1} (on v0)` : `on  ${d1} v${d2}`;
    case 0x80: return `off ${d1} v${d2}`;
    case 0xa0: return `polyAT ${d1} = ${d2}`;
    case 0xb0: return `cc${d1} = ${d2}`;
    case 0xc0: return `program ${d1}`;
    case 0xd0: return `pressure ${d1}`;
    case 0xe0: return `bend ${(d2 << 7) | d1}`;
    default: return `sys ${[status, d1, d2].map(b => b?.toString(16)).join(' ')}`;
  }
}

function render() {
  const el = $('#midilog');
  el.textContent = lines.join('\n');
  el.scrollTop = el.scrollHeight;   // oldest first; keep the newest in view
}

export function logMidi(data, t) {
  const dt = lastT === null ? '' : `+${Math.round(t - lastT)}`;
  lastT = t;
  lines.push(`${dt.padStart(6)}ms  ${decode(data)}`);
  if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
  render();
}

$('#midilogClear').addEventListener('click', () => {
  lines = [];
  lastT = null;
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
