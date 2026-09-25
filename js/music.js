// Musical constants and pitch helpers. Conventions from
// docs/handover/SOLVED.md — arrived at by ear, don't change casually.
//
// Pitch spaces: WRITTEN is what the player reads and fingers; CONCERT is
// what sounds. Calibration stores `calib`, the MIDI pitch class the horn
// sends for a fingered written C. Because the horn transmits the pitch its
// current voice actually sounds, written + calib = concert, for any voice.

// Spelling chosen by the player: sharps for the two lower black keys,
// flats for the three upper. Indexed by pitch class.
export const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

// Quality ids in display order. Always iterate this, never Object.keys:
// JS puts integer-like keys ("7") first, which scrambled every list.
export const QUALITY_ORDER = ['maj7', '7', 'm7', 'm7b5'];

// Symbols for plain-text contexts (labels, chips): a real minus sign, since
// the chord symbol's hyphen only looks right in the Real Book font.
export const QUALITY_TEXT = { maj7: '△', '7': '7', m7: '−', m7b5: 'ø' };

// Words for level names, where a symbol next to degree numbers is ambiguous
// ("7 3 5 7").
export const QUALITY_NAME = { maj7: 'Major', '7': 'Dominant', m7: 'Minor', m7b5: 'Half-dim' };

// Chord qualities with their symbols as displayed in chord symbols.
export const QUALITIES = {
  maj7: '△',
  '7': '7',
  m7: '-',     // hyphen: drawn by the Real Book font as a short slanted stroke
  m7b5: 'ø',
};

// Semitones above the root (SOLVED.md). Degrees are plain numbers; the
// quality does the work (the 3 of C− is E♭ and is still "3"; the 5 of Cø is
// G♭, still "5"; ø takes ♭13, still "13"). Only b9 #9 #11 are named as
// alterations, because those are choices on a chart.
export const DEG_SEMI = {
  maj7: { 1: 0, 3: 4, 5: 7, 7: 11, 9: 2, 11: 5, 13: 9, b9: 1, '#9': 3, '#11': 6 },
  '7': { 1: 0, 3: 4, 5: 7, 7: 10, 9: 2, 11: 5, 13: 9, b9: 1, '#9': 3, '#11': 6 },
  m7: { 1: 0, 3: 3, 5: 7, 7: 10, 9: 2, 11: 5, 13: 9, b9: 1, '#9': 3, '#11': 6 },
  m7b5: { 1: 0, 3: 3, 5: 6, 7: 10, 9: 2, 11: 5, 13: 8, b9: 1, '#9': 3, '#11': 6 },
};

// Degree ids in display order, and how they're written.
export const DEGREES = ['3', '5', '7', '9', '11', '13', 'b9', '#9', '#11'];
export const degreeLabel = d => d.replace('b', '♭').replace('#', '♯');

// Degrees that make musical sense to ask per quality. The natural 11 on △
// and 7 is in the table but never asked ("nobody wants that sound"); the
// alterations belong to the dominant, plus ♯11 (lydian) on △.
export const VALID_DEGREES = {
  maj7: ['3', '5', '7', '9', '13', '#11'],
  '7': ['3', '5', '7', '9', '13', 'b9', '#9', '#11'],
  m7: ['3', '5', '7', '9', '11', '13'],
  m7b5: ['3', '5', '7', '9', '11', '13'],
};

// The pad voicing, semitones from the root: bass root an octave down, close
// 1-3-5-7, then the 3rd and 7th doubled an octave up. Pure chord tones;
// extensions were tried and rejected as muddy.
export const VOICING = {
  maj7: [-12, 0, 4, 7, 11, 16, 23],
  '7': [-12, 0, 4, 7, 10, 16, 22],
  m7: [-12, 0, 3, 7, 10, 15, 22],
  m7b5: [-12, 0, 3, 6, 10, 15, 22],
};

// Pitch class 0–11 for any integer.
export const pc = n => ((n % 12) + 12) % 12;

// Written pitch class of a raw MIDI note from the horn.
export const writtenPc = (midi, calib) => pc(midi - calib);

// Concert pitch class of a written pitch class.
export const concertPc = (written, calib) => pc(written + calib);

// Scales (E1), as semitone steps above the root with their degree labels.
// Pentatonic = major pentatonic (minor pentatonic is its mode from the 6).
export const SCALES = {
  major: { name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11], degrees: ['1', '2', '3', '4', '5', '6', '7'] },
  penta: { name: 'Pentatonic', steps: [0, 2, 4, 7, 9], degrees: ['1', '2', '3', '5', '6'] },
};

// The saxophone's written range, low B♭ to high F♯ (MIDI numbers of the
// WRITTEN pitch; middle-of-the-staff C = C5 = 72).
export const SAX_RANGE = { low: 58, high: 90 };
export const WRITTEN_MIDDLE_C = 72;

// Name + octave of a written MIDI note, e.g. 58 → "B♭3".
export const noteName = w => `${NOTES[pc(w)]}${Math.floor(w / 12) - 1}`;
