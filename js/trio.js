// The rhythm section's brain (C3): a walking bass line and comping hits
// over a chart, as data — audio.js plays them, patterns.js schedules them.
// Ported from the prototype the boss approved by ear (docs/trio/, 2026-09-26:
// "YEEEES this is good"); the plan is docs/handover/IDEAS.md.
//
// A chart is a list of SPANS {root (concert pc), q, start (beat), len
// (beats)}; a chord longer than a bar is given one span per bar, so the
// bass walks every bar.

// 1 3 5 7 of each quality, and its scale for passing tones.
const TONES = { maj7: [0, 4, 7, 11], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10] };
const SCALE = { maj7: [0, 2, 4, 5, 7, 9, 11], '7': [0, 2, 4, 5, 7, 9, 10], m7: [0, 2, 3, 5, 7, 9, 10], m7b5: [0, 1, 3, 5, 6, 8, 10] };
const pcOf = n => ((n % 12) + 12) % 12;

// --- Walking bass (IDEAS.md) ---
// Downbeats first — each near the last, kept around C2 (root; 12 % the
// 3rd) — so the approach on the last beat aims at the note that actually
// comes next: half step below (most), above, or the 5th above/below, within
// a 5th of the downbeat. Beats 2–3: chord tones then scale steps toward it,
// no repeats. Range E1–E3. Checked over 200 choruses: worst leap a 5th.
const LO = 28, HI = 52;
function near(pc, from) {
  let best = null;
  for (let m = LO; m <= HI; m++) if (pcOf(m) === pc && (best === null || Math.abs(m - from) < Math.abs(best - from))) best = m;
  return best;
}
const pick = (xs, rnd) => xs[Math.floor(rnd() * xs.length)];

// → [{midi, beat}], one note per beat.
export function walk(spans, rnd = Math.random) {
  const ones = [];
  let prev = 36;
  for (const c of spans) {
    let one = near(pcOf(c.root + (rnd() < 0.12 ? TONES[c.q][1] : 0)), prev);
    if (one > 47) one -= 12;
    if (one < 31) one += 12;
    ones.push(one);
    prev = one;
  }
  const notes = [];
  spans.forEach((c, i) => {
    const one = ones[i], target = ones[i + 1] ?? ones[0];
    const opts = [[target - 1, 4], [target + 1, 3], [target + 7, 2], [target - 5, 1]]
      .filter(([m]) => m >= LO && m <= HI && m !== one && m !== target);
    const close = opts.filter(([m]) => Math.abs(m - one) <= 7);
    const bag = (close.length ? close : opts).flatMap(([m, w]) => Array(w).fill(m));
    const four = bag.length ? pick(bag, rnd) : target - 1;
    const line = [one];
    if (c.len >= 4) {
      const dir = Math.sign(four - one) || (one > 38 ? -1 : 1);
      const scale = [];
      for (let m = LO; m <= HI; m++) if (SCALE[c.q].includes(pcOf(m - c.root))) scale.push(m);
      const isChord = m => TONES[c.q].includes(pcOf(m - c.root));
      const twoC = scale.filter(m => (m - one) * dir > 0 && Math.abs(m - one) <= 5);
      const two = twoC.find(isChord) ?? twoC[0] ?? one + 2 * dir;
      const threeC = scale.filter(m => m !== two && m !== four && Math.abs(m - two) <= 5 && Math.abs(m - four) <= 4);
      const onward = threeC.filter(m => (m - two) * dir > 0);
      const three = (onward.length ? onward : threeC).sort((x, y) => Math.abs(x - four) - Math.abs(y - four))[0] ?? four - dir;
      line.push(two, three, four);
    } else if (c.len >= 2) {
      line.push(four);
    }
    line.forEach((m, k) => notes.push({ midi: m, beat: c.start + k }));
  });
  return notes;
}

// --- Comping ---
// Two-bar rhythm cells picked at random, laying out now and then —
// predictable comping becomes a second metronome (IDEAS.md). Offsets in
// beats (.5 = the swung upbeat), lengths in beats. Voicings: 3 5 7 of the
// chord sounding at the hit — rootless, the bass has the root, and never a
// 9 or 13 (the boss's rule) — the inversion nearest the last, E3–E4.
const CELLS = [
  [[0, 1], [1.5, 0.6]],                          // Charleston
  [[1.5, 0.5], [3.5, 1.6]],                      // upbeats, the last anticipating
  [[0, 1.8], [2, 1.8], [4, 3.5]],                // half notes, then hold
  [[1, 0.4], [3, 0.4], [5, 0.4], [7, 0.4]],      // 2 and 4
  [[2.5, 0.7], [5.5, 0.7]],                      // sparse
  [[0, 0.5], [1.5, 0.4], [4, 0.6], [6.5, 0.9]],
  [],                                            // lay out
];
export function voicing(c, prev) {
  const pcs = TONES[c.q].slice(1).map(s => pcOf(c.root + s));
  let best = null, bestCost = Infinity;
  for (let low = 52; low <= 64; low++) {
    if (!pcs.includes(pcOf(low))) continue;
    const v = [low];
    for (const pc of pcs.filter(p => p !== pcOf(low))) { let m = low + 1; while (pcOf(m) !== pc) m++; v.push(m); }
    v.sort((a, b) => a - b);
    if (v[v.length - 1] - v[0] > 11) continue;
    const cost = prev ? v.reduce((a, m, i) => a + Math.abs(m - (prev[i] ?? prev[0])), 0) : Math.abs(v[0] - 58);
    if (cost < bestCost) { best = v; bestCost = cost; }
  }
  return best;
}
// → [{beat, len, midis}]. An anticipation (the and of 4) voices the next chord.
export function comp(spans, totalBeats, rnd = Math.random) {
  const hits = [];
  const at = beat => spans.find(c => beat >= c.start && beat < c.start + c.len) || spans[spans.length - 1];
  let prev = null;
  for (let b = 0; b < totalBeats; b += 8) {
    const cell = rnd() < 0.18 ? [] : pick(CELLS, rnd);
    for (const [off, len] of cell) {
      const beat = b + off;
      if (beat >= totalBeats) continue;
      const c = at(off % 1 && Math.ceil(beat) % 4 === 0 ? Math.ceil(beat) : beat);
      prev = voicing(c, prev);
      hits.push({ beat, len, midis: prev });
    }
  }
  return hits;
}

// A pattern run's chords as spans: one per bar (a chord held ×4 walks 4
// bars). `chords` = [{key (written pc), bars}], `calib` turns written into
// concert.
export function spansOf(chords, quality, calib) {
  const spans = [];
  let beat = 0;
  for (const c of chords) {
    for (let b = 0; b < c.bars; b++) { spans.push({ root: pcOf(c.key + calib), q: quality, start: beat, len: 4 }); beat += 4; }
  }
  return spans;
}
