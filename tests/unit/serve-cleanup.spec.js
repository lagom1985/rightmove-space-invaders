import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import './support/seed.js';
import { startLocalServer } from './support/local-server.js';
import { assertStateDelta, setTo } from '../common/state-delta.js';

// The local server (scripts/serve.mjs) keeps its Blobs emulator in a temporary directory of its own, and deletes it when
// it is stopped (DDD-16): otherwise every `npm start`, `npm test` and `npm run build` leaves one behind. It deletes only
// its own: a start-up sweep could delete a side-by-side checkout's live directory. It is started and stopped the way
// Playwright's webServer and a terminal do it: `npm start` in a process group of its own, and the signal sent to the
// whole group, so the server hears it twice (once directly, once relayed by npm). Each run gets a spare port and a
// TMPDIR of its own (os.tmpdir() honours it), so the directories seen are this server's alone.
// The universe of the state delta: the emulator directories in the server's TMPDIR.

const UNIVERSE = ['tmpdir.blobs'];

const blobsDirectories = async directory => ({ 'tmpdir.blobs': (await readdir(directory)).filter(name => name.startsWith('make-the-right-move-blobs-')) });

// bypass: a process lifecycle, not a property: one start and one stop per signal says it.
for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`stopped with ${signal}, the local server deletes its emulator directory`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'make-the-right-move-serve-cleanup-'));
    let server;
    try {
      server = await startLocalServer(directory);
      const before = await blobsDirectories(directory);
      expect(before['tmpdir.blobs'], 'the server keeps its emulator in a directory of its own').toHaveLength(1);
      const exited = once(server.process, 'exit');
      server.signal(signal);
      await exited;
      assertStateDelta(before, await blobsDirectories(directory), { universe: UNIVERSE, expected: { 'tmpdir.blobs': setTo([]) } });
    } finally {
      server?.kill();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
