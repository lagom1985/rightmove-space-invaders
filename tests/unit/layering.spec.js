import { readdir, readFile } from 'node:fs/promises';
import { join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';

// The seven layering rules, ADR-006's five, ADR-009's one for the keyboard and ADR-010's one for the backdrops, checked by
// a hand-rolled import scan over src/** and netlify/** (no dependency-cruiser: seven rules don't need it). The scan recognises every import form an ES
// module has: import … from '…', bare import '…', export … from '…' and dynamic import('…'). It reads source text,
// not a syntax tree, so a comment or string that looks like an import counts as one: it can over-report, never miss.
// The token rule reads the same folders as text, every file in them, and finds no name that only the tests may use,
// comments included (the platform review, PL-2).

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCANNED = ['src', 'netlify'];
const MODULE = /\.(?:js|mjs)$/;

const FORMS = [
  /\bimport\s+[\w$*{}\s,]+?\s+from\s*(['"`])([^'"`]+)\1/g,     // import x from '…', import { a } from '…', import * as n from '…'
  /\bimport\s*(['"`])([^'"`]+)\1/g,                             // import '…'
  /\bexport\s+[\w$*{}\s,]+?\s+from\s*(['"`])([^'"`]+)\1/g,      // export { a } from '…', export * from '…'
  /\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g,                    // import('…')
];

// The specifiers a source imports, in the order they appear.
function importsOf(source) {
  return FORMS.flatMap(form => [...source.matchAll(form)].map(match => ({ at: match.index, specifier: match[2] })))
    .sort((a, b) => a.at - b.at)
    .map(({ specifier }) => specifier);
}

// What a specifier names, from the repository root: a path for a relative import (query and hash dropped), the
// specifier itself for a package or a built-in.
function target(file, specifier) {
  if (!specifier.startsWith('.')) return specifier;
  return posix.normalize(posix.join(posix.dirname(file), specifier.replace(/[?#].*$/, '')));
}

const inside = (path, folder) => path.startsWith(`${folder}/`);

const RULES = [
  { rule: 'game/ imports only from game/ and theme/', applies: file => inside(file, 'src/game'), allows: to => inside(to, 'src/game') || inside(to, 'src/theme') },
  { rule: 'theme/ imports nothing', applies: file => inside(file, 'src/theme'), allows: () => false },
  { rule: 'game/high-scores.js imports nothing', applies: file => file === 'src/game/high-scores.js', allows: () => false },
  { rule: 'src/** never imports netlify/** or @netlify/*', applies: file => inside(file, 'src'), allows: to => !inside(to, 'netlify') && !to.startsWith('@netlify/') },
  { rule: 'netlify/** imports only src/game/high-scores.js from src/', applies: file => inside(file, 'netlify'), allows: to => !inside(to, 'src') || to === 'src/game/high-scores.js' },
  { rule: 'platform/input.js imports nothing', applies: file => file === 'src/platform/input.js', allows: () => false },
  // A backdrop depends only on its neighbourhood, its scale and the layout, so it can never read g (ADR-010).
  { rule: 'view/backdrop.js imports only from theme/ and game/config.js', applies: file => file === 'src/view/backdrop.js', allows: to => inside(to, 'src/theme') || to === 'src/game/config.js' },
];

// Every import that breaks a rule, as "file -> specifier (rule)".
function violations(modules) {
  return modules.flatMap(({ file, source }) => importsOf(source).flatMap(specifier => RULES
    .filter(({ applies, allows }) => applies(file) && !allows(target(file, specifier)))
    .map(({ rule }) => `${file} -> ${specifier} (${rule})`)));
}

// The names only the tests may use (the platform review, PL-2): the local server's test cookies and test route, and the
// public test secret. Each one is plain text, so a file holds it wherever it is written, a comment or a string included.
const TEST_ONLY = ['test-clock', 'test-board', '__test', 'TEST_SECRET'];

// Every test-only name a file holds, as "file: name".
function testOnlyNames(files) {
  return files.flatMap(({ file, source }) => TEST_ONLY.filter(name => source.includes(name)).map(name => `${file}: ${name}`));
}

// Every file under a folder, read as text.
async function filesUnder(folder) {
  const entries = await readdir(join(ROOT, folder), { recursive: true, withFileTypes: true });
  const files = entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
  return Promise.all(files.map(async path => ({ file: relative(ROOT, path).split(/[\\/]/).join('/'), source: await readFile(path, 'utf8') })));
}

const modulesUnder = async folder => (await filesUnder(folder)).filter(({ file }) => MODULE.test(file));

// ---- the scanner ----
const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/);
const specifier = fc.oneof(
  fc.tuple(fc.constantFrom('./', '../', '../../'), fc.array(segment, { minLength: 1, maxLength: 3 })).map(([up, parts]) => `${up}${parts.join('/')}.js`),
  fc.tuple(segment, segment).map(([scope, name]) => `@${scope}/${name}`),
  segment.map(name => `node:${name}`),
);
const KEYWORDS = ['as', 'await', 'const', 'export', 'from', 'import'];
const name = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,8}$/).filter(word => !KEYWORDS.includes(word));
const names = fc.uniqueArray(name, { minLength: 1, maxLength: 3 });
const space = fc.constantFrom(' ', '  ', '\n', '\n  ');
const quote = fc.constantFrom("'", '"');
const statement = fc.oneof(
  fc.tuple(names, space).map(([[first], s]) => quoted => `import ${first}${s}from ${quoted};`),
  fc.tuple(names, space).map(([list, s]) => quoted => `import {${s}${list.join(`,${s}`)}${s}} from ${quoted};`),
  name.map(ns => quoted => `import * as ${ns} from ${quoted};`),
  fc.constant(quoted => `import ${quoted};`),
  fc.tuple(names, space).map(([list, s]) => quoted => `export {${s}${list.join(`,${s}`)}${s}} from ${quoted};`),
  fc.constant(quoted => `export * from ${quoted};`),
  name.map(ns => quoted => `export * as ${ns} from ${quoted};`),
  name.map(variable => quoted => `const ${variable} = await import(${quoted});`),
  fc.constant(quoted => `import( ${quoted} ).then(module => module.default);`),
);
const anImport = fc.record({ statement, quote, specifier });
const code = fc.constantFrom('const step = 1;', 'export const ready = true;', 'function play() { return 0; }', '');

test('the scan finds every import, in every ES module form, in the order the source has them', () => {
  fc.assert(fc.property(fc.array(fc.tuple(anImport, code), { maxLength: 6 }), lines => {
    const source = lines.map(([{ statement, quote, specifier }, other]) => `${statement(`${quote}${specifier}${quote}`)}\n${other}`).join('\n');
    expect(importsOf(source)).toEqual(lines.map(([{ specifier }]) => specifier));
  }));
});

// ---- the rules ----
// bypass: seven fixed rules, each shown broken once and kept once.
const BROKEN = [
  ['src/game/game.js', "import { createSynth } from '../sound/synth.js';", 'game/ imports only from game/ and theme/'],
  ['src/game/game.js', "const store = await import('../platform/storage.js');", 'game/ imports only from game/ and theme/'],
  ['src/theme/theme.js', "export { W } from '../game/config.js';", 'theme/ imports nothing'],
  ['src/game/high-scores.js', "import './config.js';", 'game/high-scores.js imports nothing'],
  ['src/platform/leaderboard.js', "import { handleScores } from '../../netlify/functions/scores.mjs';", 'src/** never imports netlify/** or @netlify/*'],
  ['src/main.js', "import { getStore } from '@netlify/blobs';", 'src/** never imports netlify/** or @netlify/*'],
  ['netlify/functions/scores.mjs', "import { g } from '../../src/game/game.js';", 'netlify/** imports only src/game/high-scores.js from src/'],
  ['src/platform/input.js', "import { W } from '../game/config.js';", 'platform/input.js imports nothing'],
  ['src/view/backdrop.js', "import { g, BANNER_TIME } from '../game/game.js';", 'view/backdrop.js imports only from theme/ and game/config.js'],
];
const KEPT = [
  ['src/game/game.js', "import { W } from './config.js';\nimport { COLORS } from '../theme/theme.js';"],
  ['src/main.js', "import { createSynth } from './sound/synth.js';\nimport { g } from './game/game.js';"],
  ['netlify/functions/scores.mjs', "import { getStore } from '@netlify/blobs';\nimport { randomUUID } from 'node:crypto';\nimport { TABLE_SIZE } from '../../src/game/high-scores.js';"],
  ['src/platform/input.js', "export function createKeyboard(target = window) {}"],
  ['src/view/backdrop.js', "import { W, H, GROUND } from '../game/config.js';\nimport { COLORS, NEIGHBOURHOODS } from '../theme/theme.js';"],
];

test('each of the seven rules reports an import that breaks it, and lets the allowed ones through', () => {
  for (const [file, source, rule] of BROKEN) expect(violations([{ file, source }]), `${file}: ${source}`).toContainEqual(expect.stringContaining(`(${rule})`));
  expect(violations(KEPT.map(([file, source]) => ({ file, source })))).toEqual([]);
});

// bypass: the repository is one fixed tree.
test('src and netlify keep the seven layering rules of ADR-006, ADR-009 and ADR-010', async () => {
  const modules = (await Promise.all(SCANNED.map(modulesUnder))).flat();
  expect(modules.map(({ file }) => file), 'the scan reads the rules module, the keyboard, the backdrops and the function').toEqual(expect.arrayContaining(['src/game/high-scores.js', 'src/platform/input.js', 'src/view/backdrop.js', 'netlify/functions/scores.mjs']));
  expect(violations(modules)).toEqual([]);
});

// ---- the token rule ----
// Code with no test-only name in it, and the places a name could be written into it.
const clean = fc.string({ maxLength: 40 }).filter(text => !TEST_ONLY.some(name => text.includes(name)));
const PLACES = [
  name => `// ${name}`,
  name => `/* the ${name} */`,
  name => `'${name}'`,
  name => `\`/${name}/rows\``,
  name => `import { ${name} } from './secrets.js';`,
  name => name,
];
const planted = fc.tuple(fc.constantFrom(...TEST_ONLY), fc.constantFrom(...PLACES), clean).map(([name, place, after]) => ({ name, text: `${place(name)}${after}` }));
const fileWithNames = fc.record({
  file: fc.constantFrom('src/main.js', 'src/platform/leaderboard.js', 'netlify/functions/scores.mjs', 'netlify/scores/sessions.mjs'),
  before: clean,
  names: fc.array(planted, { maxLength: 3 }),
});

test('the token scan reports each test-only name planted in a file, in code, a string or a comment, and nothing in a file without one', () => {
  fc.assert(fc.property(fc.uniqueArray(fileWithNames, { selector: ({ file }) => file, maxLength: 4 }), files => {
    const sources = files.map(({ file, before, names }) => ({ file, source: `${before}\n${names.map(({ text }) => text).join('\n')}` }));
    const report = testOnlyNames(sources);
    for (const { file, names } of files) {
      for (const { name } of names) expect(report).toContain(`${file}: ${name}`);
      if (names.length === 0) expect(report.filter(line => line.startsWith(`${file}: `))).toEqual([]);
    }
  }));
});

// bypass: the repository is one fixed tree.
test('no test-only name (test-clock, test-board, __test, TEST_SECRET) appears in src or netlify, comments included', async () => {
  const files = (await Promise.all(SCANNED.map(filesUnder))).flat();
  expect(files.map(({ file }) => file), 'the scan reads the game, the function and the signer').toEqual(expect.arrayContaining(['src/main.js', 'netlify/functions/scores.mjs', 'netlify/scores/sessions.mjs']));
  expect(testOnlyNames(files)).toEqual([]);
});
