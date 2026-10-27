import { expect } from '@playwright/test';
import { loadRecordedGames } from '../../../../common/recorded-games.js';

// The recorded-games check (DESIGN DDD-R12, K21): the corpus in tests/fixtures/recorded-games/. In Node each game signs
// the table through the Score API harness (steps/score-api.js), which replays it. In a browser no driving port runs the
// replay, so the production replay (src/game/replay.js) is loaded into a page of the local server and played back there,
// in whichever of Chromium, Firefox and WebKit runs the scenario (a deviation from Mandate 1 the ATDD policy records).
// The check only reads the corpus: it is made apart, by scripts/record-corpus.mjs, which won't overwrite a game recorded
// on the same rules version.

const HOST = '/tests/e2e/rightmove-invaders-replay-verified-scores/acceptance/fixtures/replay-host.html';
const MINUTE = 60 * 120;   // steps

export class RecordedGamesCheck {
  // -> the corpus, checked to be what K21 asks for: at least 6 games, from about a minute to 15 minutes or more.
  async load() {
    this.games = await loadRecordedGames();
    expect(this.games.length, 'no recorded games: make them with node scripts/record-corpus.mjs (see the feature)').toBeGreaterThanOrEqual(6);
    const minutes = this.games.map(game => game.steps / MINUTE);
    expect(Math.min(...minutes), 'the shortest recorded game, in minutes').toBeLessThanOrEqual(2);
    expect(Math.max(...minutes), 'the longest recorded game, in minutes').toBeGreaterThanOrEqual(15);
  }

  // The first game's recorded deposit moved by £50, or its game over a step later: what a change to how the game plays,
  // with no new version, looks like.
  async loadWithOneChanged(what) {
    await this.load();
    const [first, ...rest] = this.games;
    this.changed = first.name;
    const changed = what === 'deposit' ? { ...first, deposit: first.deposit + 50 }
      : { ...first, steps: first.steps + 1, record: { ...first.record, steps: first.record.steps + 1 } };
    this.games = [changed, ...rest];
  }

  async replayInBrowser(page) {
    await page.goto(HOST);
    this.replayed = await page.evaluate(async games => {
      const { replay } = await import('/src/game/replay.js');
      return games.map(({ seed, record }) => replay({ seed, record }));
    }, this.games.map(({ seed, record }) => ({ seed, record })));
  }

  differing() {
    return this.games.filter(({ steps, deposit }, i) => {
      const { over, steps: replayedSteps, deposit: replayedDeposit } = this.replayed[i];
      return !(over === true && replayedSteps === steps && replayedDeposit === deposit);
    }).map(({ name }) => name);
  }

  expectAllAsRecorded() { expect(this.differing(), 'recorded games that play back differently').toEqual([]); }
}
