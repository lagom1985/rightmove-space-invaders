import { readFileSync } from 'node:fs';

// A minimal stand-in for the page's status section (index.html's #status), for the status mirror (src/view/status.js)
// in the unit project, which has no browser. Its fields are the page's own data-hud fields and its High scores list,
// read from index.html. It offers only the DOM calls the mirror makes and refuses any other, so a mirror that reached for
// something the page doesn't have fails here too. Every write to the live region is recorded: that is what a screen
// reader hears.
const PAGE = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const HUD_FIELDS = [...PAGE.matchAll(/data-hud="([a-z]+)"/g)].map(match => match[1]);
const LIVE_REGION = 'announcement';

if (!HUD_FIELDS.includes(LIVE_REGION) || !/<ol\b[^>]*\bdata-leaderboard\b/.test(PAGE)) {
  throw new Error('index.html no longer has the live region or the High scores list the status mirror writes to');
}

class FakeElement {
  #text = '';
  #attributes = new Map();
  #children = [];

  constructor(tagName, { hud, onWrite = () => {} } = {}) {
    this.tagName = tagName;
    this.dataset = hud ? { hud } : {};
    this.onWrite = onWrite;
  }

  get textContent() { return this.#text; }

  set textContent(value) {
    this.#text = String(value);
    this.onWrite(this.#text);
  }

  setAttribute(name, value) { this.#attributes.set(name, String(value)); }

  getAttribute(name) { return this.#attributes.get(name) ?? null; }

  replaceChildren(...nodes) {
    if (!nodes.every(node => node instanceof FakeElement && node.tagName === 'LI')) throw new TypeError('the High scores list holds list items only');
    this.#children = nodes;
  }

  get children() { return [...this.#children]; }
}

const refuse = what => { throw new Error(`the fake status root doesn't offer ${what}`); };

// -> { root (what createStatus takes), heard() -> every text written to the live region, in order,
//      list() -> the High scores items, [{ text, current }], current being aria-current="true" }
export function createFakeStatusRoot() {
  const heard = [];
  const fields = HUD_FIELDS.map(hud => new FakeElement('DD', { hud, onWrite: hud === LIVE_REGION ? text => heard.push(text) : undefined }));
  const list = new FakeElement('OL');
  const root = {
    ownerDocument: { createElement: tag => (tag === 'li' ? new FakeElement('LI') : refuse(`createElement('${tag}')`)) },
    querySelectorAll: selector => (selector === '[data-hud]' ? fields : refuse(`querySelectorAll('${selector}')`)),
    querySelector: selector => (selector === '[data-leaderboard]' ? list : refuse(`querySelector('${selector}')`)),
  };
  return {
    root,
    heard: () => [...heard],
    list: () => list.children.map(item => ({ text: item.textContent, current: item.getAttribute('aria-current') === 'true' })),
  };
}
