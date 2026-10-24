// The synth's journal (ADR-003): the last sounds actually started, for tests and diagnostics.
//   createJournal(now) -> { record(sound, detail, t), snapshot() }
// `now()` is the page clock stamped on each entry as `at`. `seq` increases by one per entry and never repeats.
const SIZE = 100;

const frozenCopy = entry => Object.freeze({ ...entry, detail: Object.freeze({ ...entry.detail }) });

export function createJournal(now) {
  const entries = [];
  let lastSeq = 0;

  function record(sound, detail, t) {
    entries.push({ seq: ++lastSeq, sound, detail, t, at: now() });
    if (entries.length > SIZE) entries.shift();
  }

  const snapshot = () => Object.freeze(entries.map(frozenCopy));

  return { record, snapshot };
}
