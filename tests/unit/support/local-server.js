import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

// The local server (scripts/serve.mjs), started the way Playwright's webServer and a terminal start it: `npm start` in a
// process group of its own, so a signal can go to the whole group as they send it (the server then hears it twice, once
// directly and once relayed by npm). Each start gets a spare port and the TMPDIR it is given (os.tmpdir() honours it),
// so the emulator directory it keeps is the only one there.

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const STARTS_WITHIN_MS = 10_000;

async function sparePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

async function untilServing(url, server) {
  const deadline = Date.now() + STARTS_WITHIN_MS;
  while (Date.now() < deadline) {
    expect(server.exitCode, 'the server stopped before it served').toBeNull();
    const answered = await fetch(url).then(response => response.ok, () => false);
    if (answered) return;
    await delay(50);
  }
  throw new Error(`the server did not serve ${url} within ${STARTS_WITHIN_MS} ms`);
}

// -> once it serves /api/scores: { process (npm's), url(path), signal(name) (to the whole group), stop() (SIGTERM, as
// Playwright stops it, and its exit), kill() (SIGKILL, if it is still running) }.
export async function startLocalServer(tmpdir) {
  const port = await sparePort();
  const server = spawn('npm', ['start'], { cwd: ROOT, detached: true, env: { ...process.env, PORT: String(port), TMPDIR: tmpdir }, stdio: 'ignore' });
  const isRunning = () => server.exitCode === null && server.signalCode === null;
  const local = {
    process: server,
    url: path => `http://127.0.0.1:${port}${path}`,
    signal: name => process.kill(-server.pid, name),
    async stop() {
      if (!isRunning()) return;
      const exited = once(server, 'exit');
      local.signal('SIGTERM');
      await exited;
    },
    kill() { if (isRunning()) local.signal('SIGKILL'); },
  };
  try {
    await untilServing(local.url('/api/scores'), server);
  } catch (error) {
    local.kill();
    throw error;
  }
  return local;
}
