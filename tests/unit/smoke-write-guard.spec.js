import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { assertStateDelta, appendedWith } from '../common/state-delta.js';
import { createSmokeClient, decidePost, publishedIdFromApi, Refusal } from '../../scripts/smoke-leaderboard.mjs';

// The smoke test's write guard (DEVOPS "Preview smoke test", write guard rules 1-3), decided before every POST in every
// mode, with no network. Rule 1: a POST goes only to a deploy preview or a branch deploy of the site named by --site.
// Rule 2: the unpublished check alone may POST to a permalink, and only one that isn't the published deploy, whose ID
// the script learned (from Netlify's API or typed back by the owner, never from a flag). Rule 3: only after the run's
// first request to the host, a GET, answered 200 with an empty table. decidePost is pure; the client is where it is
// wired in, so the client's network (a port) is the state the last property watches.

const site = fc.stringMatching(/^[a-z0-9]{1,8}(?:-[a-z0-9]{1,8}){0,2}$/);
const deployId = fc.stringMatching(/^[0-9a-f]{24}$/);
const preview = fc.integer({ min: 1, max: 99_999 }).map(n => `deploy-preview-${n}`);
// Not main (production), nor xn: xn--<site> is punycode the URL parser rejects (as fc.domain() leaves out xn-- labels),
// so the guard rightly refuses it, and Netlify never serves it. A named refusal below pins that refusal.
const branch = fc.stringMatching(/^[a-z0-9]{1,10}(?:-[a-z0-9]{1,10}){0,3}$/).filter(name => name !== 'main' && name !== 'xn');
const previewOrBranch = fc.oneof(preview, branch);
const scoresAt = host => `https://${host}/api/scores`;

const EMPTY_TABLE = Object.freeze({ method: 'GET', status: 200, body: { scores: [], listedAt: 1 } });
const HOST_REFUSALS = [Refusal.PRODUCTION_HOST, Refusal.PERMALINK, Refusal.NOT_A_PREVIEW];

test('a POST to a deploy preview or a branch deploy of the site is allowed once its first GET found an empty table', () => {
  fc.assert(fc.property(site, previewOrBranch, (name, prefix) => {
    expect(decidePost({ site: name, url: scoresAt(`${prefix}--${name}.netlify.app`), firstAnswer: EMPTY_TABLE })).toEqual({ allowed: true });
  }));
});

// bypass: the refusals the DEVOPS spec names, case by case, so the spec and its test read the same; the properties below
// cover every other host, published ID and first answer.
const SITE = 'make-the-right-move';
const TARGET_ID = '0123456789abcdef01234567';
const PUBLISHED_ID = 'fedcba9876543210fedcba98';
const PERMALINK = scoresAt(`${TARGET_ID}--${SITE}.netlify.app`);
const PREVIEW = scoresAt(`deploy-preview-7--${SITE}.netlify.app`);
const A_TABLE_WITH_ROWS = Object.freeze({ scores: [{ initials: 'FAB', score: 1000, id: 'a1' }], listedAt: 1 });
const NAMED_REFUSALS = [
  ['the custom domain', { url: 'https://maketherightmove.fabiodamico.xyz/api/scores' }, Refusal.NOT_A_PREVIEW],
  ['<site>.netlify.app', { url: scoresAt(`${SITE}.netlify.app`) }, Refusal.PRODUCTION_HOST],
  ['main--<site>.netlify.app', { url: scoresAt(`main--${SITE}.netlify.app`) }, Refusal.PRODUCTION_HOST],
  ['a permalink outside the unpublished check', { url: PERMALINK }, Refusal.PERMALINK],
  ['another site\'s deploy preview', { url: scoresAt('deploy-preview-7--another-site.netlify.app') }, Refusal.NOT_A_PREVIEW],
  ['a host the URL parser rejects (a branch named xn)', { url: scoresAt(`xn--${SITE}.netlify.app`) }, Refusal.NOT_A_PREVIEW],
  ['no --site', { site: undefined, url: PREVIEW }, Refusal.NO_SITE],
  ['a deploy preview, in the unpublished check', { url: PREVIEW, unpublished: { publishedId: PUBLISHED_ID } }, Refusal.NOT_A_PERMALINK],
  ['the published deploy\'s permalink', { url: PERMALINK, unpublished: { publishedId: TARGET_ID } }, Refusal.PUBLISHED_DEPLOY],
  ['a failed API answer', { url: PERMALINK, unpublished: { publishedId: null } }, Refusal.PUBLISHED_UNKNOWN],
  ['an empty API answer', { url: PERMALINK, unpublished: { publishedId: '' } }, Refusal.PUBLISHED_UNKNOWN],
  ['a typed answer that isn\'t a deploy ID', { url: PERMALINK, unpublished: { publishedId: 'the old one' } }, Refusal.PUBLISHED_UNKNOWN],
  ['a first GET whose table isn\'t empty', { url: PREVIEW, firstAnswer: { ...EMPTY_TABLE, body: A_TABLE_WITH_ROWS } }, Refusal.NO_EMPTY_FIRST_GET],
  ['a first GET that failed', { url: PREVIEW, firstAnswer: { method: 'GET', status: 500, body: { error: 'unexpected' } } }, Refusal.NO_EMPTY_FIRST_GET],
  ['no first request', { url: PREVIEW, firstAnswer: undefined }, Refusal.NO_EMPTY_FIRST_GET],
  ['a first request that was a POST', { url: PREVIEW, firstAnswer: { ...EMPTY_TABLE, method: 'POST' } }, Refusal.NO_EMPTY_FIRST_GET],
];

test('every refusal the DEVOPS spec names is refused, for its own reason', () => {
  const decided = NAMED_REFUSALS.map(([name, input]) => [name, decidePost({ site: SITE, firstAnswer: EMPTY_TABLE, ...input })]);
  expect(decided).toEqual(NAMED_REFUSALS.map(([name, , reason]) => [name, { allowed: false, reason }]));
});

// Hosts outside both patterns: any domain not of the site's on netlify.app, and every near miss of the site's own.
const outsideBothPatterns = name => fc.oneof(
  fc.domain().filter(host => !host.endsWith(`--${name}.netlify.app`)),
  fc.constantFrom(`${name}.netlify.app`, `main--${name}.netlify.app`, `--${name}.netlify.app`),
  deployId.map(id => `${id}--${name}.netlify.app`),
  fc.tuple(previewOrBranch, site.filter(other => other !== name)).map(([prefix, other]) => `${prefix}--${other}.netlify.app`),
  fc.tuple(previewOrBranch, fc.domain()).map(([prefix, domain]) => `${prefix}--${name}.netlify.app.${domain}`),
  previewOrBranch.map(prefix => `${prefix}--${name}.netlify.com`),
  previewOrBranch.map(prefix => `${prefix}.${name}.netlify.app`),
  fc.tuple(previewOrBranch, branch).map(([prefix, label]) => `${label}.${prefix}--${name}.netlify.app`),
  previewOrBranch.map(prefix => `${prefix}--${prefix}--${name}.netlify.app`),
);
const withOutsideHost = site.chain(name => fc.tuple(fc.constant(name), outsideBothPatterns(name)));

test('any host outside both patterns is refused, even after an empty first GET', () => {
  fc.assert(fc.property(withOutsideHost, ([name, host]) => {
    const decision = decidePost({ site: name, url: scoresAt(host), firstAnswer: EMPTY_TABLE });
    expect(decision.allowed, host).toBe(false);
    expect(HOST_REFUSALS, host).toContain(decision.reason);
  }));
});

// Every first answer but a GET that answered 200 with scores: [].
const notAnEmptyTable = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom('POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS').map(method => ({ ...EMPTY_TABLE, method })),
  fc.integer({ min: 0, max: 599 }).filter(status => status !== 200).map(status => ({ ...EMPTY_TABLE, status })),
  fc.anything().filter(body => !(Array.isArray(body?.scores) && body.scores.length === 0)).map(body => ({ ...EMPTY_TABLE, body })),
);

test('no POST goes out unless the host\'s first request was a GET that found an empty table', () => {
  fc.assert(fc.property(site, previewOrBranch, notAnEmptyTable, (name, prefix, firstAnswer) => {
    expect(decidePost({ site: name, url: scoresAt(`${prefix}--${name}.netlify.app`), firstAnswer })).toEqual({ allowed: false, reason: Refusal.NO_EMPTY_FIRST_GET });
  }));
});

// The published deploy's ID as the unpublished check may have learned it: anything but a deploy ID refuses.
const notADeployId = fc.oneof(fc.constantFrom(null, undefined, ''), fc.string(), deployId.map(id => id.toUpperCase()), deployId.map(id => ` ${id}`))
  .filter(answer => typeof answer !== 'string' || !/^[0-9a-f]{24}$/.test(answer));

const isPermalinkOf = (name, host) => new RegExp(`^[0-9a-f]{24}--${name}\\.netlify\\.app$`).test(host);
const withNonPermalinkHost = site.chain(name => fc.tuple(fc.constant(name), fc.oneof(
  previewOrBranch.map(prefix => `${prefix}--${name}.netlify.app`),
  outsideBothPatterns(name).filter(host => !isPermalinkOf(name, host)),
)));
const decideUnpublished = (name, host, publishedId) =>
  decidePost({ site: name, url: scoresAt(host), unpublished: { publishedId }, firstAnswer: EMPTY_TABLE });

test('the unpublished check posts only to a permalink of the site whose ID isn\'t the published deploy\'s', () => {
  fc.assert(fc.property(site, deployId, deployId, (name, target, published) => {
    fc.pre(target !== published);
    expect(decideUnpublished(name, `${target}--${name}.netlify.app`, published)).toEqual({ allowed: true });
    expect(decideUnpublished(name, `${target}--${name}.netlify.app`, target)).toEqual({ allowed: false, reason: Refusal.PUBLISHED_DEPLOY });
  }));
  fc.assert(fc.property(site, deployId, notADeployId, (name, target, publishedId) => {
    expect(decideUnpublished(name, `${target}--${name}.netlify.app`, publishedId)).toEqual({ allowed: false, reason: Refusal.PUBLISHED_UNKNOWN });
  }));
  fc.assert(fc.property(withNonPermalinkHost, deployId, ([name, host], publishedId) => {
    expect(decideUnpublished(name, host, publishedId), host).toEqual({ allowed: false, reason: Refusal.NOT_A_PERMALINK });
  }));
});

// Where the unpublished check learns the published deploy's ID: Netlify's API, getSite, GET /api/v1/sites/{site_id}
// (https://open-api.netlify.com/). Its Site object has published_deploy, a Deploy object, and a Deploy's id is a
// string. The reference doesn't say the id's format, so the script keeps to the 24 hex digits a permalink starts with,
// and any other shape refuses (fail-closed). The body below is a Site object as getSite returns one, trimmed to a few
// fields.
const SITE_ID = '3d9f1c2e-5b7a-4e8f-9a1b-2c3d4e5f6a7b';
const TOKEN = 'nfp_the-owners-token';
const SITE_BODY = Object.freeze({
  id: SITE_ID, site_id: SITE_ID, name: SITE, state: 'current', account_slug: 'owner',
  url: 'https://maketherightmove.fabiodamico.xyz', ssl_url: 'https://maketherightmove.fabiodamico.xyz',
  admin_url: `https://app.netlify.com/sites/${SITE}`, custom_domain: 'maketherightmove.fabiodamico.xyz',
  created_at: '2026-09-30T10:12:45.118Z', updated_at: '2026-10-24T18:03:11.402Z',
  published_deploy: Object.freeze({
    id: PUBLISHED_ID, site_id: SITE_ID, state: 'ready', name: SITE, context: 'production', branch: 'main',
    commit_ref: '0d436be5c0ffee0123456789abcdef0123456789', title: 'Merge pull request #12',
    url: 'https://maketherightmove.fabiodamico.xyz', ssl_url: 'https://maketherightmove.fabiodamico.xyz',
    deploy_url: `http://${PUBLISHED_ID}--${SITE}.netlify.app`, deploy_ssl_url: `https://${PUBLISHED_ID}--${SITE}.netlify.app`,
    admin_url: `https://app.netlify.com/sites/${SITE}`, error_message: null, skipped: null, locked: null,
    created_at: '2026-10-24T18:01:52.007Z', updated_at: '2026-10-24T18:03:11.399Z', published_at: '2026-10-24T18:03:11.391Z',
  }),
  build_settings: Object.freeze({ provider: 'github', repo_branch: 'main', cmd: 'npm run build', dir: 'dist' }),
});
const GET_SITE = `https://api.netlify.com/api/v1/sites/${SITE_ID}`;
const without = (object, field) => Object.fromEntries(Object.entries(object).filter(([key]) => key !== field));
const withPublishedDeploy = deploy => ({ ...SITE_BODY, published_deploy: deploy });

// Netlify's API, as a double of the network port: getSite answers `site` to the owner's token for this site, and 404 to
// anything else. It records what it was asked.
function netlifyApi(site) {
  const requests = [];
  const fetch = async (url, { headers = {}, redirect } = {}) => {
    requests.push({ url, authorization: headers.authorization, redirect });
    const isGetSite = url === GET_SITE && headers.authorization === `Bearer ${TOKEN}`;
    return isGetSite ? Response.json(site) : Response.json({ code: 404, message: 'Not Found' }, { status: 404 });
  };
  return { fetch, requests: () => [...requests] };
}
const unpublishedCheck = (url, publishedId) => decidePost({ site: SITE, url, unpublished: { publishedId }, firstAnswer: EMPTY_TABLE });

// bypass: one Site object as Netlify's reference describes it, pinned field for field; the property below varies its
// published_deploy.
test('the published deploy\'s ID is read from published_deploy.id in the site getSite returns, and only its permalink is refused', async () => {
  const api = netlifyApi(SITE_BODY);
  const publishedId = await publishedIdFromApi({ token: TOKEN, siteId: SITE_ID, fetch: api.fetch });
  expect(publishedId).toBe(PUBLISHED_ID);
  expect(api.requests()).toEqual([{ url: GET_SITE, authorization: `Bearer ${TOKEN}`, redirect: 'manual' }]);
  expect(unpublishedCheck(PERMALINK, publishedId)).toEqual({ allowed: true });
  expect(unpublishedCheck(scoresAt(`${PUBLISHED_ID}--${SITE}.netlify.app`), publishedId)).toEqual({ allowed: false, reason: Refusal.PUBLISHED_DEPLOY });
});

// Every site whose published_deploy isn't a Deploy with a 24-hex-digit id: none (nothing published yet), null, not an
// object, no id, an id that isn't a string, or a string of any other shape.
const notTheDeployIdShape = fc.oneof(fc.string(), deployId.map(id => id.toUpperCase()), deployId.map(id => `${id}0`), deployId.map(id => id.slice(1)))
  .filter(id => !/^[0-9a-f]{24}$/.test(id));
const withoutAPublishedId = fc.oneof(
  fc.constant(without(SITE_BODY, 'published_deploy')),
  fc.jsonValue().filter(deploy => deploy === null || typeof deploy !== 'object' || Array.isArray(deploy)).map(withPublishedDeploy),
  fc.constant(withPublishedDeploy(without(SITE_BODY.published_deploy, 'id'))),
  fc.jsonValue().filter(id => typeof id !== 'string').map(id => withPublishedDeploy({ ...SITE_BODY.published_deploy, id })),
  notTheDeployIdShape.map(id => withPublishedDeploy({ ...SITE_BODY.published_deploy, id })),
);

test('a site without a published deploy ID of the deploy-ID shape gives no ID, and the unpublished check refuses', async () => {
  await fc.assert(fc.asyncProperty(withoutAPublishedId, async site => {
    const publishedId = await publishedIdFromApi({ token: TOKEN, siteId: SITE_ID, fetch: netlifyApi(site).fetch });
    expect(publishedId).toBeNull();
    expect(unpublishedCheck(PERMALINK, publishedId)).toEqual({ allowed: false, reason: Refusal.PUBLISHED_UNKNOWN });
  }));
});

// The client's network is a port: a double that records each request and answers as a fresh deploy store would.
function fakeNetwork() {
  const requests = [];
  const fetch = async (url, { method }) => {
    requests.push(`${method} ${url}`);
    return Response.json(method === 'GET' ? { scores: [], listedAt: 1 } : { scores: [], id: 'a1', listedAt: 2 });
  };
  return { fetch, state: () => ({ 'network.requests': [...requests] }) };
}
const UNIVERSE = ['network.requests'];
const SIGNATURE = Object.freeze({ initials: 'SMK', score: 50 });

test('a POST the guard refuses sends nothing, and one it allows is sent once, after the first GET', async () => {
  await fc.assert(fc.asyncProperty(withOutsideHost, async ([name, host]) => {
    const network = fakeNetwork();
    const client = createSmokeClient({ site: name, fetch: network.fetch });
    await client.get(scoresAt(host));
    const before = network.state();
    await expect(client.post(scoresAt(host), SIGNATURE)).rejects.toMatchObject({ reason: expect.any(String) });
    assertStateDelta(before, network.state(), { universe: UNIVERSE });
  }));
  await fc.assert(fc.asyncProperty(site, previewOrBranch, async (name, prefix) => {
    const network = fakeNetwork();
    const client = createSmokeClient({ site: name, fetch: network.fetch });
    const url = scoresAt(`${prefix}--${name}.netlify.app`);
    const untouched = network.state();
    await expect(client.post(url, SIGNATURE)).rejects.toMatchObject({ reason: Refusal.NO_EMPTY_FIRST_GET });
    assertStateDelta(untouched, network.state(), { universe: UNIVERSE });
    await client.get(url);
    const before = network.state();
    expect((await client.post(url, SIGNATURE)).status).toBe(200);
    assertStateDelta(before, network.state(), { universe: UNIVERSE, expected: { 'network.requests': appendedWith(`POST ${url}`) } });
  }));
});
