// Note names and chord symbols as HTML, in the Real Book style.
//
// Letters and digits use the Real Book font; accidentals and quality
// symbols use Georgia, because the font's flat is a plain "b" and its
// triangle a solid blob. Sizes and offsets live in index.html (.acc, .q-*)
// and are tuned by eye at phone size — see docs/notation.md.
// Everything here is built from fixed tables, never from user input, so
// returning HTML strings is safe.

import { NOTES, QUALITIES } from './music.js';

// NOTES entries are a letter plus an optional ♯ or ♭.
export function noteHTML(pc) {
  const [letter, acc] = [NOTES[pc][0], NOTES[pc].slice(1)];
  if (!acc) return `<span class="rb">${letter}</span>`;
  const kind = acc === '♭' ? 'f' : 's';
  return `<span class="rb">${letter}</span><span class="acc acc-${kind}">${acc}</span>`;
}

export function chordHTML(rootPc, quality) {
  return noteHTML(rootPc) + `<span class="q q-${quality}">${QUALITIES[quality]}</span>`;
}
