// Zero-dependency static build: copies what the browser needs into dist/ and nothing else.
// The game has no bundler or transpile step, so "build" means "publish only index.html and src/".
// Netlify publishes dist/ (netlify.toml); `npm run build` runs the light test gate first.
import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, 'index.html'), join(dist, 'index.html'));
await cp(join(root, 'src'), join(dist, 'src'), {
  recursive: true,
  filter: source => !source.endsWith('.DS_Store'),
});

const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile())
  .map(entry => join(entry.parentPath, entry.name).slice(dist.length + 1))
  .sort();
console.log(`Built dist/ (${files.length} files):\n  ${files.join('\n  ')}`);
