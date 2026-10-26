// The words both views show, declared once (DISTILL, Messages): the canvas (render.js) can't be read by a test, so it
// says exactly what the status mirror (status.js) is checked to say. Data and pure derivations only: imports nothing.

export const PLAY_AGAIN = 'Press Enter to house-hunt again';   // a heading on the canvas
export const PLAY_AGAIN_SENTENCE = `${PLAY_AGAIN}.`;           // the same words as a sentence, in the mirror
export const TABLE_UNAVAILABLE = 'High-score table unavailable.';

// Enter's answer on the initials entry, by the kind of the rules' notice ({ kind, n }): fewer than 3 letters, or
// initials on the word filter, which empty the entry for different ones (D4).
export const INITIALS_NOTICES = Object.freeze({
  'too-few': 'Type 3 letters to sign.',
  refused: 'Those initials aren\'t allowed. Type different ones.',
});

// A signing { initials, rank } by its status: on its way, then what it settled as (a replaced signing's included).
export const SIGNING_MESSAGES = Object.freeze({
  pending: ({ initials }) => `Signing ${initials}…`,
  confirmed: ({ initials, rank }) => `Signed ${initials}, #${rank}.`,
  'off-table': ({ initials }) => `The table filled up before ${initials} arrived.`,
  unconfirmed: ({ initials }) => `Couldn't confirm ${initials}'s signing.`,
});
