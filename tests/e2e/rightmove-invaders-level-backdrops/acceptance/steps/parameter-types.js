import { defineParameterType } from 'playwright-bdd';
import { Neighbourhood, Wave, BackdropSize, ScreenTrouble, ForegroundUse, ContrastNeed, Shown, layerOf } from './domain-types.js';

// Business phrases in the level backdrops' .feature files -> typed domain values. Parameter types are global to the
// whole suite, so their names differ from the other features' (screen, seconds, duration, ...).
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternatives = phrases => [...phrases].sort((a, b) => b.length - a.length).map(escape).join('|');
const phraseType = (name, phrases) => defineParameterType({ name, regexp: new RegExp(alternatives(Object.keys(phrases))), transformer: s => phrases[s] });

const PLACE = `(?:${alternatives(Object.keys(Neighbourhood))})`;
const placeNamed = name => Neighbourhood[name.trim()];

// "Terraced streets in the morning" -> its theme entry.
defineParameterType({ name: 'neighbourhood', regexp: new RegExp(PLACE), transformer: placeNamed });
// "City centre at dawn", or "City centre at dawn and Suburbs at midday", or "A, B and C" -> their entries, in order.
defineParameterType({
  name: 'neighbourhoods',
  regexp: new RegExp(`${PLACE}(?:(?:, ${PLACE})* and ${PLACE})?`),
  transformer: text => Object.freeze(text.split(/, | and (?=[A-Z])/).map(placeNamed)),
});
// "the second wave" is written "second" -> level 1.
phraseType('wave', Wave);
// What fades in over the neighbourhood: "nothing fading in" -> { next: null, mix: 0 }, or
// "Suburbs at midday faded in to 50%" -> { next: its entry, mix: 0.5 }.
defineParameterType({
  name: 'fade',
  regexp: new RegExp(`nothing fading in|${PLACE} faded in to \\d+(?:\\.\\d+)?%`),
  transformer: text => {
    if (text === 'nothing fading in') return Object.freeze({ next: null, mix: 0, text });
    const [, name, percent] = /^(.+) faded in to ([\d.]+)%$/.exec(text);
    return Object.freeze({ next: placeNamed(name), mix: Number(percent) / 100, text });
  },
});
// One layer of what I see: "Terraced streets in the morning's backdrop" or "...'s plain background", at full strength.
const LAYER = `${PLACE}'s (?:backdrop|plain background)`;
const layerNamed = text => {
  const [, name, kind] = /^(.+)'s (backdrop|plain background)$/.exec(text);
  return layerOf(placeNamed(name), kind === 'backdrop' ? Shown.BACKDROP : Shown.PLAIN);
};
defineParameterType({ name: 'layer', regexp: new RegExp(LAYER), transformer: layerNamed });
// What I see over it: "nothing over it" -> null, or "Terraced streets in the morning's plain background over it at 50%"
// -> that layer at strength 0.5.
defineParameterType({
  name: 'overlay',
  regexp: new RegExp(`nothing over it|${LAYER} over it at \\d+(?:\\.\\d+)?%`),
  transformer: text => {
    if (text === 'nothing over it') return null;
    const [, layer, percent] = /^(.+) over it at ([\d.]+)%$/.exec(text);
    return Object.freeze({ ...layerNamed(layer), strength: Number(percent) / 100 });
  },
});
phraseType('backdropSize', BackdropSize);
phraseType('screenTrouble', Object.fromEntries(Object.values(ScreenTrouble).map(trouble => [trouble, trouble])));
phraseType('foregroundUse', Object.fromEntries(Object.values(ForegroundUse).map(use => [use.phrase, use])));
phraseType('contrastNeed', Object.fromEntries(Object.values(ContrastNeed).map(need => [need, need])));
