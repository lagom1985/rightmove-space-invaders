// The session signer (ADR-012, DESIGN DDD-R2): built by a composition root from the secret, so the handler never holds
// it. Outside netlify/functions/, because every top-level file there becomes a function (ADR-006).
//   createSessionSigner(secret) -> { sign(seed, issuedAt) -> token, verify(session) -> boolean, gameId(seed) -> 32 hex }
//   token = HMAC-SHA256 over `v1.{seed}.{issuedAt}`, base64url (43 characters); gameId = the first 32 hex characters of
//   the SHA-256 of the seed's 32 characters (clarified in DISTILL). verify checks the session's shape first and returns
//   false on any mismatch, never throws. readSessionSecret(value) -> the 32 bytes, or null for a value that isn't
//   canonical base64 of exactly 32 bytes; a root builds no signer from null (DDD-R2, clarified in DISTILL).
//
// RED scaffold (DISTILL, rightmove-invaders-replay-verified-scores): it throws until DELIVER builds it (slice 01). The
// acceptance harness builds the signer from a known test secret, as the roots build it from theirs (DDD-R17).
export const __SCAFFOLD__ = true;

export function readSessionSecret(value) {
  throw new Error('__SCAFFOLD__: readSessionSecret is not yet implemented (netlify/scores/sessions.mjs, DDD-R2)');
}

export function createSessionSigner(secret) {
  throw new Error('__SCAFFOLD__: createSessionSigner is not yet implemented (netlify/scores/sessions.mjs, DDD-R2)');
}
