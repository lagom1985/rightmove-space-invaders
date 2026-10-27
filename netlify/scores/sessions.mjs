import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// The session signer (ADR-012, DESIGN DDD-R2): built by a composition root from the secret, so the handler never holds
// it. Outside netlify/functions/, because every top-level file there becomes a function (ADR-006).
//   createSessionSigner(secret) -> { sign(seed, issuedAt) -> token, verify(session) -> boolean, gameId(seed) -> 32 hex }
//   token = HMAC-SHA256 over `v1.{seed}.{issuedAt}`, base64url (43 characters); gameId = the first 32 hex characters of
//   the SHA-256 of the seed's 32 characters (clarified in DISTILL). verify checks the session's shape first and returns
//   false on any mismatch, never throws. readSessionSecret(value) -> the 32 bytes, or null for a value that isn't
//   canonical base64 of exactly 32 bytes; a root builds no signer from null (DDD-R2, clarified in DISTILL).
// The three functions hold no `this`, so a root hands each handler only the ones it needs (DDD-R1). verify takes no
// clock: how long a session lives is the handler's to check, with its own `now`.

const SECRET_BYTES = 32;
const CANONICAL_SECRET = /^[A-Za-z0-9+/]{43}=$/;   // 32 bytes in base64: 43 characters and one '='
const SEED = /^[0-9a-f]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;               // the 32 bytes of an HMAC-SHA256 in base64url, unpadded
const SESSION_FIELDS = ['issuedAt', 'seed', 'token'];
const GAME_ID_LENGTH = 32;

export function readSessionSecret(value) {
  if (typeof value !== 'string' || !CANONICAL_SECRET.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  // Only a last character whose two unused bits are zero encodes back to the same text.
  return bytes.length === SECRET_BYTES && bytes.toString('base64') === value ? bytes : null;
}

// A session as the table issues it: exactly its three fields, each in its form.
function isSession(session) {
  if (typeof session !== 'object' || session === null) return false;
  const fields = Object.keys(session).sort();
  return fields.length === SESSION_FIELDS.length && fields.every((field, at) => field === SESSION_FIELDS[at])
    && typeof session.seed === 'string' && SEED.test(session.seed)
    && Number.isSafeInteger(session.issuedAt)
    && typeof session.token === 'string' && TOKEN.test(session.token);
}

export function createSessionSigner(secret) {
  const sign = (seed, issuedAt) => createHmac('sha256', secret).update(`v1.${seed}.${issuedAt}`).digest('base64url');
  // The tokens are compared as text, 43 characters each, so one that differs only in the unused bits of its last
  // character differs.
  const verify = session => isSession(session)
    && timingSafeEqual(Buffer.from(sign(session.seed, session.issuedAt)), Buffer.from(session.token));
  const gameId = seed => createHash('sha256').update(seed).digest('hex').slice(0, GAME_ID_LENGTH);
  return { sign, verify, gameId };
}
