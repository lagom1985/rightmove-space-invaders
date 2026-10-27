import { createHash, createHmac } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { createSessionSigner, readSessionSecret } from '../../netlify/scores/sessions.mjs';

// The session signer (ADR-012, DESIGN DDD-R2, C1). A root reads SCORES_SESSION_SECRET with readSessionSecret and builds
// the signer from the 32 bytes; the handlers take sign, verify and gameId unbound (DDD-R1). Every function here is pure
// and changes no state, so the properties check answers only.

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const HEX = '0123456789abcdef';

const secretBytes = fc.uint8Array({ minLength: 32, maxLength: 32 }).map(bytes => Buffer.from(bytes));
const secret = secretBytes.map(bytes => ({ text: bytes.toString('base64'), bytes }));   // the text, as the environment holds it
const twoSecrets = fc.tuple(secret, secret).filter(([mine, theirs]) => !mine.bytes.equals(theirs.bytes));
const seed = fc.stringMatching(/^[0-9a-f]{32}$/);
const issuedAt = fc.maxSafeInteger();
const token = length => fc.string({ unit: fc.constantFrom(...BASE64URL), minLength: length, maxLength: length });
const replaceAt = (text, at, char) => `${text.slice(0, at)}${char}${text.slice(at + 1)}`;

// A signer built as a root builds it, from the secret's text.
const signerFor = ({ text }) => createSessionSigner(readSessionSecret(text));

test('a session is signed as HMAC-SHA256 over v1.{seed}.{issuedAt} in 43 base64url characters, and its game id is the SHA-256 of the seed\'s text, cut to 32 hex', () => {
  fc.assert(fc.property(secret, seed, issuedAt, (mine, seed, issuedAt) => {
    const { sign, verify, gameId } = signerFor(mine);   // detached, as the handlers take them
    const token = sign(seed, issuedAt);
    expect(token).toBe(createHmac('sha256', mine.bytes).update(`v1.${seed}.${issuedAt}`).digest('base64url'));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verify({ seed, issuedAt, token })).toBe(true);
    expect(gameId(seed)).toBe(createHash('sha256').update(Buffer.from(seed, 'ascii')).digest('hex').slice(0, 32));
  }));
});

// One field of a signed session changed, every way a forger or a bug would change it, all tried on each session.
const changes = fc.tuple(
  seed.map(other => session => ({ ...session, seed: other })),
  fc.tuple(fc.nat(31), fc.constantFrom(...HEX)).map(([at, char]) => session => ({ ...session, seed: replaceAt(session.seed, at, char) })),
  issuedAt.map(other => session => ({ ...session, issuedAt: other })),
  fc.constantFrom(-1, 1).map(by => session => ({ ...session, issuedAt: session.issuedAt + by })),
  token(43).map(other => session => ({ ...session, token: other })),
  fc.tuple(fc.nat(42), fc.constantFrom(...BASE64URL)).map(([at, char]) => session => ({ ...session, token: replaceAt(session.token, at, char) })),
  // only the two unused bits of the last character, which a base64url decoder drops: the same bytes, another token
  fc.integer({ min: 1, max: 3 }).map(bits => session => ({ ...session, token: replaceAt(session.token, 42, BASE64URL[BASE64URL.indexOf(session.token[42]) ^ bits]) })),
);

test('any changed field of a session fails verify, and a token from another secret never verifies', () => {
  fc.assert(fc.property(twoSecrets, seed, issuedAt, changes, ([mine, theirs], seed, issuedAt, changes) => {
    const signer = signerFor(mine);
    const another = signerFor(theirs);
    const session = { seed, issuedAt, token: signer.sign(seed, issuedAt) };
    expect(another.verify(session)).toBe(false);
    expect(signer.verify({ seed, issuedAt, token: another.sign(seed, issuedAt) })).toBe(false);
    const changed = changes.map(changeIt => changeIt(session)).filter(other => !isDeepStrictEqual(other, session));
    expect(changed.map(signer.verify)).toEqual(changed.map(() => false));
  }));
});

// A token one character short or long: the signed one cut or extended, or any other, all tried on each session.
const resizes = fc.tuple(
  fc.nat(42).map(at => token => `${token.slice(0, at)}${token.slice(at + 1)}`),
  fc.tuple(fc.nat(43), fc.constantFrom(...BASE64URL, '=')).map(([at, char]) => token => `${token.slice(0, at)}${char}${token.slice(at)}`),
  token(42).map(other => () => other),
  token(44).map(other => () => other),
);

test('tokens of 42 and 44 characters verify false and never throw', () => {
  fc.assert(fc.property(secret, seed, issuedAt, resizes, (mine, seed, issuedAt, resizes) => {
    const { sign, verify } = signerFor(mine);
    const tokens = resizes.map(resizeIt => resizeIt(sign(seed, issuedAt)));
    expect(tokens.every(token => token.length === 42 || token.length === 44)).toBe(true);
    expect(tokens.map(token => verify({ seed, issuedAt, token }))).toEqual(tokens.map(() => false));   // a throw fails the property too
  }));
});

// A signed session reshaped: a field missing, one more, a field of another type or form, or not a session at all. Every
// one of these is tried on each session, and one of the drawn ones.
const FIELDS = ['seed', 'issuedAt', 'token'];
const RESHAPES = [
  ...FIELDS.map(field => session => Object.fromEntries(Object.entries(session).filter(([key]) => key !== field))),
  session => ({ ...session, seed: session.seed.toUpperCase().replace(/^[0-9]/, 'A') }),
  session => ({ ...session, seed: session.seed.slice(1) }),
  session => ({ ...session, seed: `${session.seed}0` }),
  session => ({ ...session, seed: replaceAt(session.seed, 0, 'g') }),
  session => ({ ...session, seed: [session.seed] }),
  session => ({ ...session, seed: Buffer.from(session.seed, 'hex') }),
  session => ({ ...session, issuedAt: String(session.issuedAt) }),
  session => ({ ...session, issuedAt: (session.issuedAt % 1000) + 0.5 }),   // small enough to keep its half
  session => ({ ...session, issuedAt: BigInt(session.issuedAt) }),
  session => ({ ...session, issuedAt: [session.issuedAt] }),
  session => ({ ...session, issuedAt: 2 ** 53 }),
  session => ({ ...session, issuedAt: -(2 ** 53) }),
  session => ({ ...session, issuedAt: Number.NaN }),
  session => ({ ...session, issuedAt: Number.POSITIVE_INFINITY }),
  session => ({ ...session, issuedAt: null }),
  session => ({ ...session, token: [session.token] }),
  session => ({ ...session, token: Buffer.from(session.token) }),
  session => [session.seed, session.issuedAt, session.token],
  session => JSON.stringify(session),
  session => Object.create(session),   // the fields inherited, none its own
];
const reshape = fc.oneof(
  fc.tuple(fc.string().filter(key => !FIELDS.includes(key)), fc.anything()).map(([key, value]) => session => ({ ...session, [key]: value })),
  fc.tuple(fc.nat(42), fc.constantFrom('+', '/', '=', '.', ' ', 'é')).map(([at, char]) => session => ({ ...session, token: replaceAt(session.token, at, char) })),
  fc.anything().map(value => () => value),
);

test('a session of any other shape verifies false and never throws', () => {
  fc.assert(fc.property(secret, seed, issuedAt, reshape, (mine, seed, issuedAt, reshapeIt) => {
    const { sign, verify } = signerFor(mine);
    const session = { seed, issuedAt, token: sign(seed, issuedAt) };
    const answers = [...RESHAPES, reshapeIt].map(reshapeOne => verify(reshapeOne(session)));
    expect(answers).toEqual(answers.map(() => false));
  }));
});

// A secret's text that is near canonical base64 of 32 bytes, or nothing like it.
const notCanonical = fc.oneof(
  // the last character's two unused bits not zero: the same 32 bytes decoded, a different text re-encoded
  fc.tuple(secret, fc.integer({ min: 1, max: 3 })).map(([{ text }, bits]) => `${text.slice(0, 42)}${BASE64[BASE64.indexOf(text[42]) | bits]}=`),
  secret.map(({ text }) => text.slice(0, 43)),
  secret.map(({ text }) => `${text}=`),
  fc.tuple(secret, fc.constantFrom(' ', '\n', '\r\n', '\t'), fc.boolean()).map(([{ text }, space, before]) => (before ? `${space}${text}` : `${text}${space}`)),
  fc.tuple(secret, fc.nat(41), fc.constantFrom('-', '_', '.', '!', ' ', '=', 'é')).map(([{ text }, at, char]) => replaceAt(text, at, char)),
  secret.map(({ bytes }) => bytes.toString('base64url')),
  secret.map(({ bytes }) => bytes.toString('hex')),
  fc.uint8Array({ maxLength: 64 }).filter(bytes => bytes.length !== 32).map(bytes => Buffer.from(bytes).toString('base64')),
  fc.string({ maxLength: 64 }).filter(text => !/^[A-Za-z0-9+/]{43}=$/.test(text)),
  fc.constantFrom(undefined, null, 0, true, {}, []),
  secretBytes,                                                // the bytes themselves, not their text
);

test('readSessionSecret takes canonical base64 of exactly 32 bytes, and nothing else', () => {
  fc.assert(fc.property(secret, ({ text, bytes }) => {
    const read = readSessionSecret(text);
    expect(read).toHaveLength(32);
    expect(Buffer.from(read).equals(bytes)).toBe(true);
  }));
  fc.assert(fc.property(notCanonical, value => {
    expect(readSessionSecret(value)).toBeNull();
  }));
});
