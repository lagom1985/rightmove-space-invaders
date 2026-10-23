// Drives the probe in three engines and prints frame-time / input stats as JSON.
const { chromium, firefox, webkit } = require(process.env.PW);
const URL = 'http://localhost:8765/';
const OUT = process.env.OUT;
const WINDOW_MS = 20000;

async function run(page, mode) {
  await page.goto(URL + '?' + mode);
  await page.waitForTimeout(2000);
  await page.evaluate(() => __probe.reset());
  await page.waitForTimeout(WINDOW_MS);
  return page.evaluate(() => ({ ...__probe.report(), shields: __probe.shieldCellsLeft() }));
}

(async () => {
  const results = {};
  for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await type.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    // Keyboard through the browser's real input pipeline: instant taps, then held keys.
    await page.goto(URL);
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await page.evaluate(() => __probe.reset());
    const x0 = await page.evaluate(() => player.x);
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    const x1 = await page.evaluate(() => player.x);
    const shotBefore = await page.evaluate(() => !!shot);
    await page.keyboard.press('Space');
    await page.waitForTimeout(50);
    const tapFired = !shotBefore && await page.evaluate(() => !!shot);
    for (let i = 0; i < 16; i++) {
      const key = i % 2 ? 'ArrowLeft' : 'KeyD';
      await page.keyboard.down(key);
      await page.keyboard.down('Space');            // move + fire together
      await page.waitForTimeout(120);
      await page.keyboard.up('Space');
      await page.keyboard.up(key);
      await page.waitForTimeout(60);
    }
    const keyboard = await page.evaluate(() => __probe.report());
    results[name] = {
      keyboard: { tapMovedPx: +(x1 - x0).toFixed(1), tapFired, latency: keyboard.inputLatencyMs, frames: keyboard.frameIntervalMs },
      bot: await run(page, 'bot'),
      stress: await run(page, 'stress'),
    };
    if (name === 'chromium') {
      await page.screenshot({ path: OUT + '/stress-chromium.png' });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      results[name].stressCpu4x = await run(page, 'stress');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
    results[name].errors = errors;
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 1));
})();
