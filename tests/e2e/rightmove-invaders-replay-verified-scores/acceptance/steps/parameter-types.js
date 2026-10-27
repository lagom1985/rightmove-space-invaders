import { defineParameterType } from 'playwright-bdd';
import {
  Verdict, SessionRefusal, CarriedSession, RecordTwist, RecordFault, HonestPace, SessionAnswer, SeedRequest, Limit,
  MAX_GAME_STEPS,
} from './domain-types.js';

// Business phrases in the replay-verified table's .feature files -> typed domain values. Parameter types are global to
// the whole suite, so their names differ from every other feature's, and no phrase here is one the leaderboard's
// `refusal` type already reads after the same words ("the signature is refused …").
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const oneOf = phrases => new RegExp(Object.keys(phrases).sort((a, b) => b.length - a.length).map(escape).join('|'));
const phraseType = (name, phrases) => defineParameterType({ name, regexp: oneOf(phrases), transformer: s => phrases[s] });

const MINUTE = 60_000, HOUR = 60 * MINUTE;

phraseType('verdict', {
  'as having no session': Verdict.NO_SESSION,
  "as carrying a session the table didn't seal": Verdict.UNSEALED_SESSION,
  'as carrying an expired session': Verdict.EXPIRED_SESSION,
  'as a game that has already signed': Verdict.ALREADY_SIGNED,
  "as carrying something that isn't a record": Verdict.NOT_A_RECORD,
  'as played on other rules': Verdict.OTHER_RULES,
  'as longer than an hour': Verdict.OVER_AN_HOUR,
  'as faster than the clock': Verdict.FASTER_THAN_THE_CLOCK,
  'as not the game it claims': Verdict.NOT_THE_GAME_IT_CLAIMS,
});

phraseType('sessionRefusal', {
  'as not a seed': SessionRefusal.NOT_A_SEED, 'for its format': SessionRefusal.FORMAT, 'as too long': SessionRefusal.TOO_LONG,
});

phraseType('carriedSession', {
  'its session': CarriedSession.ITS_OWN,
  'the session it signed with': CarriedSession.THE_ONE_IT_SIGNED_WITH,
  'another session for the same game': CarriedSession.ANOTHER_FOR_THE_SAME_GAME,
  'its session with the issue time moved an hour earlier': CarriedSession.ISSUE_TIME_MOVED,
  "its session with another game's seed put in it": CarriedSession.ANOTHER_SEED,
  'its session with one character of its seal changed': CarriedSession.SEAL_CHANGED,
  'its session with its seal cut short': CarriedSession.SEAL_CUT_SHORT,
  'a session made up from nothing': CarriedSession.MADE_UP,
  "something that isn't a session at all": CarriedSession.NOT_A_SESSION,
});

// When a signing's session was issued, from the moment it signs: "1 hour 59 minutes ago" -> its age in ms; "11 seconds
// from now" (issued in the future) -> a negative age.
defineParameterType({
  name: 'sessionAge',
  regexp: /\d+ hours? \d+ minutes? ago|\d+ seconds? from now/,
  transformer(text) {
    const future = /^(\d+) seconds? from now$/.exec(text);
    if (future) return -Number(future[1]) * 1000;
    const [, hours, minutes] = /^(\d+) hours? (\d+) minutes? ago$/.exec(text);
    return Number(hours) * HOUR + Number(minutes) * MINUTE;
  },
});

// A stretch of game time, in seconds or minutes -> ms.
defineParameterType({
  name: 'lengthOfPlay',
  regexp: /\d+ (?:seconds?|minutes?)/,
  transformer: text => Number.parseInt(text, 10) * (text.includes('minute') ? MINUTE : 1000),
});

phraseType('recordTwist', {
  'stops a step before its game over': RecordTwist.STOPS_EARLY,
  'goes on a step after its game over': RecordTwist.GOES_ON,
  'names other rules than the table plays': RecordTwist.OTHER_RULES,
});

phraseType('recordFault', {
  "controls aren't written down as text": RecordFault.KEYS_NOT_TEXT,
  "controls name a key the game doesn't have": RecordFault.UNKNOWN_LETTER,
  'changes come twice at the same moment': RecordFault.SAME_STEP_TWICE,
  "first change comes after the game's start": RecordFault.FIRST_CHANGE_LATE,
  'last change comes at or after the end it gives': RecordFault.CHANGE_AT_THE_END,
  "rules aren't named": RecordFault.NO_RULES,
  'length is nothing at all': RecordFault.NO_STEPS,
});

// A signing far over the 128 KB limit -> bytes.
phraseType('bulk', { '10 MB': 10 * 1024 * 1024 });

// How a recorded game is changed to stand for a gameplay change made without a new rules version.
phraseType('corpusChange', { 'on another deposit': 'deposit', 'at another moment': 'steps' });

// The length of a forged record of standing still, at the 60-minute limit (D9) -> steps.
phraseType('recordLength', {
  'exactly 60 minutes': MAX_GAME_STEPS,
  '60 minutes and one step': MAX_GAME_STEPS + 1,
});

// A signing's size, at the 128 KB limit (DDD-R3) -> bytes.
phraseType('bodySize', { 'exactly 128 KB': Limit.BODY_CAP, '128 KB and one byte': Limit.BODY_CAP + 1 });

phraseType('honestPace', {
  'signed a second after its game over': HonestPace.SIGNED_AT_ONCE,
  'given its session 4 seconds after it started and signed at its game over': HonestPace.SLOW_SESSION,
  'paused for 10 minutes and signed a second after its game over': HonestPace.LONG_PAUSE,
});

phraseType('sessionAnswer', {
  'at once': SessionAnswer.AT_ONCE, '3 seconds later': SessionAnswer.LATE,
  'with a failure': SessionAnswer.FAILS, 'never': SessionAnswer.NEVER,
});

phraseType('sessionTrouble', { "can't be reached": SessionAnswer.FAILS, 'never answers': SessionAnswer.NEVER });

phraseType('clockError', { 'an hour fast': HOUR, 'an hour slow': -HOUR });

phraseType('seedRequest', {
  'its seed in capitals': SeedRequest.CAPITALS,
  'a seed one character short': SeedRequest.SHORT,
  'no seed at all': SeedRequest.NO_SEED,
  'its seed and a note': SeedRequest.WITH_A_NOTE,
  "something that isn't a request at all": SeedRequest.GARBLED,
  'its seed sent in the wrong format': SeedRequest.WRONG_FORMAT,
  'its seed stretched past 1 KB': SeedRequest.STRETCHED,
});
