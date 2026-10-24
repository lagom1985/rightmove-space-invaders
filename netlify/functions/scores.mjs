// The shared high-score table: a Netlify Function (v2) over Netlify Blobs.
//   GET  /api/scores                        -> { scores: [{ initials, score, id }] }   best first, at most 10
//   POST /api/scores { initials, score }    -> { scores, id }   id = the new row's, so the game can find it
// One blob per score, with everything in its key and an empty body (spike findings, strategy D). Every write
// goes to a key of its own, so players signing at the same moment never overwrite each other, and the keys
// sort as strings into arcade order: higher score first, then the earlier entry. scripts/serve.mjs mounts
// handleScores locally against the Blobs emulator, with a store of its own.
import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const config = { path: '/api/scores' };

export default req => handleScores(req, getStore({ name: 'leaderboard', consistency: 'strong' }));

const TABLE_SIZE = 10;
const MAX_SCORE = 9_999_999;
const SCORE_STEP = 50;          // every hurdle and bonus is worth a multiple of £50
const KEEP = 20;                // keys kept before pruning starts
const PRUNE_AT_MOST = 5;        // per submit, so a burst of submits never becomes a storm of deletes
const PREFIX = 's/';
// Only keys of this shape count: the emulator lists its own temporary files (`s/.xxxx`) next to them.
const KEY = /^s\/(\d{7})-\d{15}-([A-Z]{3})-([a-z0-9]+)$/;

const keyFor = ({ initials, score }, id) =>
  `${PREFIX}${String(MAX_SCORE - score).padStart(7, '0')}-${String(Date.now()).padStart(15, '0')}-${initials}-${id}`;

function isValid(entry) {
  const { initials, score } = entry ?? {};
  return typeof initials === 'string' && /^[A-Z]{3}$/.test(initials) &&
    Number.isSafeInteger(score) && score > 0 && score <= MAX_SCORE && score % SCORE_STEP === 0;
}

// Every well-formed key, in arcade order.
async function rankedKeys(store) {
  const { blobs } = await store.list({ prefix: PREFIX });   // strong: the store was opened with consistency 'strong'
  return blobs.map(blob => blob.key).filter(key => KEY.test(key)).sort();
}

function table(keys) {
  return keys.slice(0, TABLE_SIZE).map(key => {
    const [, inverted, initials, id] = KEY.exec(key);
    return { initials, score: MAX_SCORE - Number(inverted), id };
  });
}

// A key ranked below 10th can never climb back (rows only ever leave the table), so any instance may delete it
// without coordinating with the others.
async function prune(store, keys) {
  if (keys.length <= KEEP) return;
  await Promise.all(keys.slice(TABLE_SIZE, TABLE_SIZE + PRUNE_AT_MOST).map(key => store.delete(key)));
}

async function readEntry(req) {
  try { return await req.json(); } catch { return null; }
}

export async function handleScores(req, store) {
  if (req.method === 'GET') return Response.json({ scores: table(await rankedKeys(store)) });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const entry = await readEntry(req);
  if (!isValid(entry)) return new Response('Expected { initials: three letters A-Z, score: a positive multiple of 50 }', { status: 400 });
  const id = randomUUID().replaceAll('-', '');
  const { modified } = await store.set(keyFor(entry, id), '', { onlyIfNew: true });
  if (!modified) return new Response('Score not saved, try again', { status: 503 });
  const keys = await rankedKeys(store);
  await prune(store, keys);
  return Response.json({ scores: table(keys), id });
}
