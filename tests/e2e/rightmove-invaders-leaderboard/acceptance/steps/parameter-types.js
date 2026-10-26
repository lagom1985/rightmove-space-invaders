import { defineParameterType } from 'playwright-bdd';
import { SigningStatus, SigningTrouble, PressSpacing, Refusal, TableAction, TableFailure, TableRequest, Limit } from './domain-types.js';

// Business phrases in the high-score table's .feature files -> typed domain values. Parameter types are global to the
// whole suite, so their names differ from the sound feature's (pounds, seconds, key, ...).
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const oneOf = phrases => new RegExp(Object.keys(phrases).sort((a, b) => b.length - a.length).map(escape).join('|'));
const phraseType = (name, phrases) => defineParameterType({ name, regexp: oneOf(phrases), transformer: s => phrases[s] });
const money = text => Number(text.replace(/[£,]/g, ''));

defineParameterType({ name: 'amount', regexp: /£[\d,]+/, transformer: money });
defineParameterType({ name: 'initials', regexp: /[A-Z]{3}/, transformer: s => s });
defineParameterType({ name: 'duration', regexp: /\d+(?:\.\d+)? seconds?/, transformer: s => Math.round(parseFloat(s) * 1000) });   // -> ms

phraseType('signingStatus', {
  'on its way': SigningStatus.ON_ITS_WAY, confirmed: SigningStatus.CONFIRMED,
  'off the table': SigningStatus.OFF_THE_TABLE, unconfirmed: SigningStatus.UNCONFIRMED,
});
phraseType('signingTrouble', { 'loses the connection': SigningTrouble.DROPPED, 'turns the signing away': SigningTrouble.TURNED_AWAY });
phraseType('pressSpacing', { 'a frame apart': PressSpacing.A_FRAME_APART, 'within one frame': PressSpacing.WITHIN_ONE_FRAME });
phraseType('refusal', {
  'for its format': Refusal.FORMAT, 'as too long': Refusal.TOO_LONG,
  'as not a signature': Refusal.NOT_A_SIGNATURE, 'for its initials': Refusal.INITIALS, 'as implausible': Refusal.IMPLAUSIBLE,
});
phraseType('tableFailure', {
  'a failed look at the table': TableFailure.FAILED_LOOK, 'a failed save': TableFailure.FAILED_SAVE,
  'an unexpected failure': TableFailure.UNEXPECTED, 'a failed tidy-up': TableFailure.FAILED_TIDY_UP, 'a duplicate': TableFailure.DUPLICATE,
});
phraseType('tableAction', {
  'looking at the high-score table': TableAction.LOOKING, 'saving to the high-score table': TableAction.SAVING,
  'tidying up old scores': TableAction.TIDYING,
});
phraseType('tableRequest', { 'wipe itself': TableRequest.WIPE, 'replace its rows': TableRequest.REPLACE });
// k = min(5, n - 20) (DDD-1): a signing tidies away none up to 20 scores, then as many as are over 20, at most 5.
phraseType('removals', {
  'no old scores': Object.freeze({ count: 0 }),
  'exactly 1 old score, ranked 11th or lower': Object.freeze({ count: 1 }),
  [`exactly ${Limit.PRUNE_AT_MOST} old scores, all ranked 11th or lower`]: Object.freeze({ count: Limit.PRUNE_AT_MOST }),
});

// What reaches the table in a server scenario: a signature (possibly broken on purpose), or something that isn't one.
//   the signature FAB with £1,000 [and a note | sent in the wrong format | stretched to 1 KB | stretched past 1 KB]
//   the signature FAB with no deposit · the signature fab with £1,000 · something that isn't a signature at all
//   a signature with initials on the word filter
// "1 KB" is 1,024 bytes (DDD-5): "stretched to 1 KB" is exactly 1,024 bytes long, "stretched past 1 KB" is 1,025.
const KB = 1024;
const SIGNATURE = /the signature [A-Za-z]{3} with (?:£[\d,]+|no deposit)(?: and a note| sent in the wrong format| stretched to 1 KB| stretched past 1 KB)?|something that isn't a signature at all|a signature with initials on the word filter/;
defineParameterType({
  name: 'signature',
  regexp: SIGNATURE,
  transformer(text) {
    if (text === "something that isn't a signature at all") return Object.freeze({ garbled: true });
    if (text === 'a signature with initials on the word filter') return Object.freeze({ blocked: true, score: 1000 });
    const [, initials, deposit, extra = ''] = /^the signature ([A-Za-z]{3}) with (£[\d,]+|no deposit)(.*)$/.exec(text);
    return Object.freeze({
      initials,
      score: deposit === 'no deposit' ? undefined : money(deposit),
      note: extra.includes('and a note'),
      wrongFormat: extra.includes('in the wrong format'),
      stretchTo: extra.includes('stretched to 1 KB') ? KB : extra.includes('stretched past 1 KB') ? KB + 1 : undefined,
    });
  },
});
