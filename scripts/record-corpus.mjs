// Records the recorded-games corpus (tests/fixtures/recorded-games/, DESIGN DDD-R12, K21): bot games played in Node on
// the real rules. Run it once the rules are deterministic (DELIVER, enabling task E5), and again after every RULES_VERSION
// bump: node scripts/record-corpus.mjs. It refuses to overwrite a game recorded on the rules version the game plays now,
// so it can't make a failing recorded-games check pass. The check itself never records.
import { recordCorpus } from '../tests/common/recorded-games.js';

const written = await recordCorpus();
console.log(`Recorded ${written.length} games: ${written.join(', ')}`);
