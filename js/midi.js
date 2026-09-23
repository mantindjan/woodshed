// MIDI input from the horn.
//
// Listens on every connected input (the YDS appears as one, over USB or BLE),
// re-attaches when devices come and go, and debounces note-ons: the YDS emits
// brief intermediate pitches while fingers move between notes, so a note only
// counts once no other note-on has arrived for DEBOUNCE_MS. Last note wins.
// Note-ons only fire with breath, so every reported note was actually blown.

const DEBOUNCE_MS = 70;

// onNote(midiNumber)  — a debounced note-on, raw MIDI number as the horn sent it.
// onStatus({state, names}) — state is one of:
//   'unsupported' (no Web MIDI: iOS, non-Chrome, or insecure origin)
//   'denied'      (permission refused)
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
  } catch {
    onStatus({ state: 'denied', names: [] });
    return;
  }

  let pendingTimer = null;

  function onMessage(e) {
    const [status, note, velocity] = e.data;
    // Note-on is 0x9n on any channel. Velocity 0 is a note-off by MIDI
    // convention and is ignored.
    if ((status & 0xf0) !== 0x90 || velocity === 0) return;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => onNote(note), DEBOUNCE_MS);
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
