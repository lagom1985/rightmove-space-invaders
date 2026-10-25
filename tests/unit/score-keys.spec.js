import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { MAX_SCORE, TABLE_SIZE } from '../../src/game/high-scores.js';
import { decodeKey, encodeKey, planPrune, rankKeys } from '../../netlify/functions/scores.mjs';

// A row's key is the persisted schema (ADR-004): s/{MAX_SCORE - score, 7 digits}-{epoch ms, 15 digits}-{initials}-{id},
// so that the keys sort as strings into arcade order. Only keys of exactly this shape are rows: a store also lists
// other things (the emulator's temporary files s/.xxxx, a malformed row, another prefix), and none of them is a row.

const row = fc.record({
  initials: fc.stringMatching(/^[A-Z]{3}$/),
  score: fc.integer({ min: 0, max: MAX_SCORE }),
  at: fc.integer({ min: 0, max: 999_999_999_999_999 }),
  id: fc.stringMatching(/^[a-z0-9]{1,32}$/),
});

// A score key broken in one place, the way a stray entry or a bug would break it.
const BREAKS = [
  key => key.slice('s/'.length),                                         // no prefix
  key => `archive/${key}`,                                               // another prefix
  key => `${key}\n`,                                                     // a trailing line break
  key => `${key} `,
  key => key.replace(/^s\/\d/, 's/'),                                    // a 6-digit score
  key => key.replace(/^s\//, 's/0'),                                     // an 8-digit score
  key => key.replace(/^(s\/\d{7}-)/, '$10'),                             // a 16-digit time
  key => key.replace(/-([A-Z]{3})-/, (_, initials) => `-${initials.toLowerCase()}-`),
  key => key.replace(/-([A-Z]{3})-/, '-$1X-'),                           // four letters
  key => key.replace(/-([A-Z]{3})-/, (_, initials) => `-${initials.slice(1)}-`),
  key => key.replace(/-[a-z0-9]+$/, '-'),                                // no id
  key => key.replace(/-([a-z0-9]+)$/, '-$1Z'),                           // a capital in the id
  key => key.replace(/-([a-z0-9]+)$/, '-$1-x'),                          // a dash in the id
];
const temporaryFile = fc.string().map(name => `s/.${name}`);
const brokenKey = fc.tuple(row, fc.constantFrom(...BREAKS)).map(([r, breakIt]) => breakIt(encodeKey(r)));
const SCORE_KEY = /^s\/\d{7}-\d{15}-[A-Z]{3}-[a-z0-9]+$/;
const notAKey = fc.oneof(temporaryFile, brokenKey, fc.string(), fc.constantFrom('', 's/', 's/.k3j2tmp', 's/FAB-1000', 'archive/s-0001-FAB'))
  .filter(key => !SCORE_KEY.test(key));

test('a row read back from its key is the same row, and the key has the persisted shape', () => {
  fc.assert(fc.property(row, r => {
    const key = encodeKey(r);
    const [prefix, rest] = [key.slice(0, 2), key.slice(2)];
    const [inverted, at, initials, id, ...more] = rest.split('-');
    expect({ prefix, inverted: inverted.length, at: at.length, more }).toEqual({ prefix: 's/', inverted: 7, at: 15, more: [] });
    expect({ score: MAX_SCORE - Number(inverted), at: Number(at), initials, id }).toEqual({ score: r.score, at: r.at, initials: r.initials, id: r.id });
    expect(decodeKey(key)).toEqual(r);
  }));
});

test('anything that is not a score key reads as no row, the emulator\'s temporary files included', () => {
  fc.assert(fc.property(notAKey, key => {
    expect(decodeKey(key)).toBeNull();
  }));
});

// A store's listing: rows and stray entries, in any order, the same row possibly listed twice.
const listing = fc.array(fc.oneof(row.map(r => ({ key: encodeKey(r), row: r })), notAKey.map(key => ({ key, row: null }))), { maxLength: 40 });
const outranksOrTies = (a, b) => a.score > b.score || (a.score === b.score && a.at <= b.at);

test('ranking keeps exactly the score keys: higher score first, then the earlier of two equal scores', () => {
  fc.assert(fc.property(listing, items => {
    const ranked = rankKeys(items.map(({ key }) => key));
    const rows = new Map(items.filter(item => item.row).map(item => [item.key, item.row]));
    expect([...ranked].sort()).toEqual(items.filter(item => item.row).map(item => item.key).sort());
    const order = ranked.map(key => rows.get(key));
    expect(order.slice(1).filter((next, i) => !outranksOrTies(order[i], next))).toEqual([]);
  }));
});

// The accepted prune rule (DDD-1): with n well-formed keys listed after a write, a signing tidies away k = min(5, n - 20)
// of them when n is above 20 and none otherwise, every one ranked 11th or lower, so no top-ten row is ever touched.
// Every length from 0 to 40 is as likely as any other, so the runs cross the 20-key edge many times.
const ranked = fc.integer({ min: 0, max: 40 })
  .chain(n => fc.uniqueArray(row, { minLength: n, maxLength: n, selector: encodeKey }))
  .map(rows => rankKeys(rows.map(encodeKey)));
const KEPT_BEFORE_PRUNING = 20, PRUNED_AT_MOST = 5;

test('a tidy-up plans min(5, n - 20) keys ranked 11th or lower, each once, and none for 20 keys or fewer', () => {
  fc.assert(fc.property(ranked, keys => {
    const planned = planPrune(keys);
    const belowTheTable = keys.slice(TABLE_SIZE);
    expect(planned).toHaveLength(Math.max(0, Math.min(PRUNED_AT_MOST, keys.length - KEPT_BEFORE_PRUNING)));
    expect(planned.filter(key => !belowTheTable.includes(key)), 'planned keys not ranked 11th or lower').toEqual([]);
    expect(new Set(planned).size, 'a key planned twice').toBe(planned.length);
  }));
});
