import { test, expect } from '@playwright/test';
import fc from 'fast-check';
import './support/seed.js';
import { loadSettings, saveSetting } from '../../src/storage.js';

// The saved sound and music choices (US-02, US-07): only a saved "off" turns a setting off. Nothing saved,
// anything else saved, or saved settings that cannot be read at all, all mean the setting is on.

const KEYS = { sound: 'make-the-right-move:sound', music: 'make-the-right-move:music' };
const SETTINGS = ['sound', 'music'];

// What a browser could hand back for a saved setting, including near-misses of "off".
const nearMisses = fc.constantFrom('on', 'ON', 'OFF', 'Off', ' off', 'off ', 'off\n', 'false', '0', '');
const savedValue = fc.oneof({ weight: 3, arbitrary: fc.constant('off') }, nearMisses, fc.string(), fc.constant(null));
const isOff = saved => saved === 'off';

// The unit project runs in Node, which has no localStorage: stand one in for the duration of one check.
function withStorage(storage, check) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try { return check(); } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage;
  }
}

const storageHolding = saved => {
  const items = new Map(Object.entries(saved).filter(([, value]) => value !== null));
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)) };
};

const blockedStorage = failure => ({
  getItem() { throw failure; },
  setItem() { throw failure; },
});

test('a setting is off exactly when "off" was saved for it, whatever is saved for the other', () => {
  fc.assert(fc.property(savedValue, savedValue, (sound, music) => {
    const settings = withStorage(storageHolding({ [KEYS.sound]: sound, [KEYS.music]: music }), loadSettings);
    expect(settings).toEqual({ sound: !isOff(sound), music: !isOff(music) });
  }));
});

test('both settings are on when saved settings are blocked, whatever the browser throws', () => {
  fc.assert(fc.property(fc.anything(), failure => {
    expect(withStorage(blockedStorage(failure), loadSettings)).toEqual({ sound: true, music: true });
  }));
});

test('a choice saved for one setting is what loads next time and leaves the other setting alone', () => {
  const choice = fc.record({ name: fc.constantFrom(...SETTINGS), on: fc.boolean(), other: savedValue });
  fc.assert(fc.property(choice, ({ name, on, other }) => {
    const otherName = SETTINGS.find(setting => setting !== name);
    const storage = storageHolding({ [KEYS[otherName]]: other });
    const settings = withStorage(storage, () => { saveSetting(name, on); return loadSettings(); });
    expect(settings).toEqual({ [name]: on, [otherName]: !isOff(other) });
  }));
});

test('choosing a setting does not fail when saved settings are blocked', () => {
  fc.assert(fc.property(fc.constantFrom(...SETTINGS), fc.boolean(), fc.anything(), (name, on, failure) => {
    withStorage(blockedStorage(failure), () => saveSetting(name, on));
  }));
});
