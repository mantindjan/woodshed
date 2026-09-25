// Tempo control (B3): a relative drag strip plus −5 −1 +1 +5 nudges, after
// the prototype. Dragging is relative to where you grabbed, so you can keep
// dragging one way indefinitely — a range slider was unusable on a phone
// (SOLVED.md). Any game that needs a tempo mounts one.

const PX_PER_BPM = 5;    // drag sensitivity
const TICK_PX = 14;      // spacing of the strip's tick marks

// Build the control inside `el`. onChange(bpm) fires on every change.
// Returns {get, set}.
export function mountTempo(el, { min = 30, max = 300, value = 80, onChange = () => {} } = {}) {
  el.classList.add('tempo');
  el.innerHTML =
    '<div class="bpm"><b class="bpm-val"></b><small> bpm</small></div>' +
    '<div class="scrub"><div class="scrubticks"></div></div>' +
    '<div class="nudge">' +
    ['-5', '-1', '+1', '+5'].map(n => `<button data-n="${n}">${n.replace('-', '−')}</button>`).join('') +
    '</div>';
  const val = el.querySelector('.bpm-val');
  const strip = el.querySelector('.scrub');
  const ticks = el.querySelector('.scrubticks');
  let cur = value;

  function set(v, notify = true) {
    cur = Math.max(min, Math.min(max, Math.round(v)));
    val.textContent = cur;
    if (notify) onChange(cur);
  }

  let startX = 0, startBpm = 0, dragging = false;
  strip.addEventListener('pointerdown', e => {
    dragging = true;
    startX = e.clientX;
    startBpm = cur;
    strip.classList.add('dragging');
    strip.setPointerCapture(e.pointerId);
  });
  strip.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    set(startBpm + dx / PX_PER_BPM);
    ticks.style.transform = `translateX(${dx % TICK_PX}px)`;   // the strip "moves" under the finger
  });
  const end = e => {
    if (!dragging) return;
    dragging = false;
    strip.classList.remove('dragging');
    try { strip.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  strip.addEventListener('pointerup', end);
  strip.addEventListener('pointercancel', end);
  el.querySelector('.nudge').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) set(cur + Number(b.dataset.n));
  });

  set(value, false);
  return { get: () => cur, set, setEnabled: on => el.querySelectorAll('button').forEach(b => { b.disabled = !on; }) };
}
