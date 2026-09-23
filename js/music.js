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

// Chord qualities with their symbols as displayed.
export const QUALITIES = {
  maj7: '△',
  '7': '7',
  m7: '-',     // hyphen: drawn by the Real Book font as a short slanted stroke
  m7b5: 'ø',
};

// Semitones above the root. Degrees are plain numbers; the quality does the
// work (the 3 of C− is E♭ and is still "3"; the 5 of Cø is G♭, still "5").
export const DEG_SEMI = {
  maj7: { 3: 4, 5: 7, 7: 11 },
  '7': { 3: 4, 5: 7, 7: 10 },
  m7: { 3: 3, 5: 7, 7: 10 },
  m7b5: { 3: 3, 5: 6, 7: 10 },
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
