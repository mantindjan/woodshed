// MIDI input from the horn.
//
// Listens on every connected input (the YDS appears as one, over USB or BLE)
// and re-attaches when devices come and go.
//
// Breath gate: the YDS streams breath as CC 11 and sends note-on as breath
// rises past a very low level, so a faint residual puff still plays a note.
// A note is only reported once the current breath reaches BREATH_THRESHOLD;
// after that, every note change in the same breath is reported instantly,
// so legato and fast trills aren't delayed. There is no time-based filter —
// see docs/midi.md for why the prototype's 70 ms debounce was dropped.

// Captured 2026-09-23: stray puffs peaked at 6, the softest real answer
// at 21, typical answers 33–49. Started at 15; lowered to 10 by the boss
// after playing (still above the puffs) so soft answers register sooner.
const BREATH_THRESHOLD = 10;
const BREATH_CC = 11;

// onNote(midiNumber)  — a note-on, raw MIDI number as the horn sent it.
// onStatus({state, names, error}) — state is one of:
//   'unsupported' (no Web MIDI: iOS, non-Chrome, or insecure origin)
//   'denied'      (permission refused; error = Chrome's error text)
//   'failed'      (any other failure; error = Chrome's error text)
//   'none'        (access granted, no input connected)
//   'connected'   (names = input device names)
export async function connectMidi(onNote, onStatus) {
  if (!navigator.requestMIDIAccess) {
    onStatus({ state: 'unsupported', names: [] });
    return;
  }

  let access;
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch (err) {
    // Report Chrome's actual error: a generic "refused" hid the real cause
    // once already.
    const error = `${err.name}: ${err.message}`;
    const denied = err.name === 'NotAllowedError' || err.name === 'SecurityError';
    onStatus({ state: denied ? 'denied' : 'failed', names: [], error });
    return;
  }

  let breathSeen = false;   // a horn that never sends CC 11 isn't gated
  let breathOpen = false;   // current breath has reached the threshold
  let pending = null;       // note sounding before the breath reached it

  function onMessage(e) {
    const [status, data1, data2] = e.data;
    const type = status & 0xf0;

    if (type === 0xb0 && data1 === BREATH_CC) {
      breathSeen = true;
      if (data2 === 0) {
        // Breath over: a note that never reached the threshold was a puff.
        breathOpen = false;
        pending = null;
      } else if (data2 >= BREATH_THRESHOLD && !breathOpen) {
        breathOpen = true;
        if (pending !== null) onNote(pending);
        pending = null;
      }
      return;
    }

    // Note-on is 0x9n on any channel. Velocity 0 is a note-off by MIDI
    // convention (the YDS releases notes this way); releasing the pending
    // note means it ended before the breath got there.
    if (type !== 0x90) return;
    if (data2 === 0) {
      if (data1 === pending) pending = null;
      return;
    }
    if (breathOpen || !breathSeen) onNote(data1);
    else pending = data1;   // latest note wins if fingers move before then
  }

  function attachAll() {
    const inputs = [...access.inputs.values()];
    // Assigning onmidimessage also opens the port.
    for (const input of inputs) input.onmidimessage = onMessage;
    onStatus(inputs.length
      ? { state: 'connected', names: inputs.map(i => i.name || 'MIDI input') }
      : { state: 'none', names: [] });
  }

  // Fires on plug/unplug (USB OTG auto-disables after 10 min idle on OnePlus,
  // so this does happen mid-session).
  access.onstatechange = attachAll;
  attachAll();
}
