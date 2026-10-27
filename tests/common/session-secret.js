// The session secret the tests sign with (rightmove-invaders-replay-verified-scores, DDD-R2, DDD-R17): 32 bytes in
// canonical base64, as the roots require, and public, since it is in the repository. The acceptance harness builds its
// session signer from it, as the roots build theirs; the preview smoke test signs a session with it and expects it to be
// refused, so a deploy whose secret is this value fails the run. It is never a deploy context's value (the owner guide).
export const TEST_SECRET = Buffer.alloc(32, 7).toString('base64');
