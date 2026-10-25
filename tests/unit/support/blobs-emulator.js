import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';

// A real Blobs emulator (BlobsServer) in a temporary directory of its own, for the unit tests that run the Score API
// over the real @netlify/blobs client (DDD-19). Started before a file's tests, stopped after them.
// -> { context: what the Blobs client needs to find it ({ edgeURL, uncachedEdgeURL, siteID, token }),
//      freshStore() -> a strongly consistent store no other run has used, stop() }
export async function startBlobsEmulator(name) {
  const directory = await mkdtemp(join(tmpdir(), `make-the-right-move-${name}-`));
  const token = randomUUID();
  const server = new BlobsServer({ directory, token });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  const context = Object.freeze({ edgeURL: url, uncachedEdgeURL: url, siteID: 'local', token });
  return {
    context,
    freshStore: () => getStore({ name: `leaderboard-${randomUUID()}`, ...context, consistency: 'strong' }),
    async stop() {
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
