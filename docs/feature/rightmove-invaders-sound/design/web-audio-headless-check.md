# Check: Web Audio runs in headless Playwright browsers

**Date**: 2026-10-23 · **Machine**: Apple M4 Pro, macOS · **Playwright**: 1.62.1 (Chromium, Firefox and WebKit builds bundled with it)

**Why**: ADR-003 and the DISTILL policy rely on real Web Audio running in the headless browsers the acceptance tests use.

**Script** (run once from the project root, then deleted):

```js
import { chromium, firefox, webkit } from '@playwright/test';
for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await type.launch();
  const page = await browser.newPage();
  await page.setContent('<p>audio</p>');
  await page.evaluate(() => addEventListener('keydown', () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    ctx.resume();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.05);
    window.result = { created: true };
    setTimeout(() => { window.result.state = ctx.state; window.result.time = ctx.currentTime; }, 300);
  }, { once: true }));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  console.log(name.padEnd(9), JSON.stringify(await page.evaluate(() => window.result)));
  await browser.close();
}
```

**Output**:

```
chromium  {"created":true,"state":"running","time":0.272}
firefox   {"created":true,"state":"running","time":0.2613333333333333}
webkit    {"created":true,"state":"running","time":0.272}
```

**Result**: after a key press, all three engines create a running AudioContext, start an oscillator, and advance the audio clock on real time.

## Follow-up: the audio clock under Playwright's fake clock (2026-10-23, revision 3)

**Why**: the DESIGN claims the audio clock runs on real time even when tests fast-forward page time.

**Method**: same browsers. `page.clock.install()` then `pauseAt()`; a key press creates an AudioContext; then `page.clock.runFor(10_000)` (10 s of fake time, almost no real time); then a 0.5 s real wait.

**Output**:

```
chromium  after runFor(10 s): {"audio":0,"page":10000}  after 0.5 s real wait: {"audio":0.469,"page":10000,"state":"running"}
firefox   after runFor(10 s): {"audio":0,"page":10000}  after 0.5 s real wait: {"audio":0.464,"page":10000,"state":"running"}
webkit    after runFor(10 s): {"audio":0,"page":10000}  after 0.5 s real wait: {"audio":0.477,"page":10000,"state":"running"}
```

**Result**: page time (`performance.now`) follows the fake clock; the audio clock follows real time only. So tests assert on what started (journal), never on audio durations, and the music scheduler can't build a backlog when its timer is fast-forwarded (DDD-14).
