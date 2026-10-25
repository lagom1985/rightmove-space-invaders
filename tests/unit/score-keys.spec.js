import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { MAX_SCORE } from '../../src/game/high-scores.js';
import { decodeKey, encodeKey, rankKeys } from '../../netlify/functions/scores.mjs';

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
