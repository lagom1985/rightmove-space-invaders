import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import * as theme from '../../src/theme.js';

// US-06: the music sits under the effects, at least 6 dB below them. The mix is theme data: a voice's peak
// gain is its recipe's level times the level of the bus it plays on. This reads the theme data only:
// synth-mix.spec.js checks the mix the synth builds from it.

const MINIMUM_GAP_DB = 6;
const decibelsBetween = (louder, quieter) => 20 * Math.log10(louder / quieter);

function mix() {
  expect(theme.BUS_LEVELS, 'the mix has no bus levels').toBeDefined();
  expect(theme.MUSIC, 'the game has no music').toBeDefined();
  return { buses: theme.BUS_LEVELS, musicLevel: theme.MUSIC.level, effects: Object.values(theme.SOUND_RECIPES) };
}

test('the theme data puts the music at least 6 dB below every effect (recipe level times bus level)', () => {
  const { buses, musicLevel, effects } = mix();
  fc.assert(fc.property(fc.constantFrom(...effects), effect => {
    const gap = decibelsBetween(effect.level * buses.effects, musicLevel * buses.music);
    expect(gap).toBeGreaterThanOrEqual(MINIMUM_GAP_DB);
  }));
});
