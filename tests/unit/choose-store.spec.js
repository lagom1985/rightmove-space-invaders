import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { chooseStore } from '../../netlify/functions/scores.mjs';

// Which table the Netlify entry opens (ADR-005, DDD-2): the site-wide one only for the published production deploy,
// and a deploy store of its own for every other deploy. A context that is missing, spelled differently or not a boolean
// never reaches the site store: the table's integrity matters more than its continuity.

// bypass: ADR-005's own table of twelve cases, kept case by case so the decision and its test read the same; the
// properties below cover every other context.
const ADR_005 = [
  [{ deploy: { context: 'production', published: true } }, 'site'],
  [{ deploy: { context: 'production', published: false } }, 'deploy'],
  [{ deploy: { context: 'production' } }, 'deploy'],
  [{ deploy: { context: 'production', published: 'true' } }, 'deploy'],
  [{ deploy: { context: 'Production', published: true } }, 'deploy'],
  [{ deploy: { context: 'deploy-preview', published: false } }, 'deploy'],
  [{ deploy: { context: 'deploy-preview', published: true } }, 'deploy'],
  [{ deploy: { context: 'branch-deploy', published: false } }, 'deploy'],
  [{ deploy: { context: 'dev' } }, 'deploy'],
  [{ deploy: { published: true } }, 'deploy'],
  [{}, 'deploy'],
  [undefined, 'deploy'],
];

test('the twelve cases of ADR-005 get the store the decision names', () => {
  expect(ADR_005.map(([context]) => chooseStore(context))).toEqual(ADR_005.map(([, store]) => store));
});

// Whatever else Netlify's Context carries, next to and inside `deploy`.
const extras = fc.dictionary(fc.string(), fc.jsonValue(), { maxKeys: 4 });
const near = fc.constantFrom('production', 'Production', 'PRODUCTION', ' production', 'production ', 'deploy-preview', 'branch-deploy', 'dev');
const raw = fc.oneof(near, fc.boolean(), fc.constantFrom('true', 1, 0, null, undefined), fc.anything());

test('the published production deploy gets the site store, whatever else its context carries', () => {
  fc.assert(fc.property(extras, extras, (outside, inside) => {
    expect(chooseStore({ ...outside, deploy: { ...inside, context: 'production', published: true } })).toBe('site');
  }));
});

// Every way a context can miss the published production deploy: another (or a differently spelled) deploy context,
// production without `published` being exactly true, no deploy at all, or no context at all.
const deployOf = (context, published) => fc.tuple(extras, extras, context, published)
  .map(([outside, inside, c, p]) => ({ ...outside, deploy: { ...inside, context: c, published: p } }));
const otherContexts = fc.oneof(
  deployOf(raw.filter(context => context !== 'production'), raw),
  deployOf(fc.constant('production'), raw.filter(published => published !== true)),
  extras.map(({ deploy, ...outside }) => outside),
  fc.oneof(fc.constantFrom(undefined, null), fc.string(), fc.integer(), fc.boolean()),
);

test('every other context gets a deploy store of its own', () => {
  fc.assert(fc.property(otherContexts, context => {
    expect(chooseStore(context)).toBe('deploy');
  }));
});
