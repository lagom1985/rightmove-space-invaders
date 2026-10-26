import { W, H, PX, GROUND, BANNER_TIME } from './config.js';
import { COLORS, HURDLES, PIN_ART, DREAM_ART, DREAM_BONUSES, pounds } from '../theme/theme.js';
import { SW, makeShield, sweep, erode, clearRect } from './shields.js';
import { GameEvent } from './events.js';
import { INITIALS_LENGTH, makesTheTable, isAllowedInitials } from './high-scores.js';

// Sizes in logical units, derived from the pixel art.
export const IW = HURDLES[0].frames[0][0].length * PX, IH = HURDLES[0].frames[0].length * PX;
export const PW = PIN_ART[0].length * PX, PH = PIN_ART.length * PX;
export const DW = DREAM_ART[0].length * PX, DH = DREAM_ART.length * PX;
export const GX = 50, GY = 40;   // formation column and row spacing
export const SHOT_W = 3, SHOT_H = 12, BOLT_H = 12;

const ROWS = HURDLES.length, COLS = 11;
const FORMATION_SIZE = ROWS * COLS;
const SHIELD_Y = H - 190;
export const PLAYER_SPEED = 330;
export const RESPAWN_TIME = 1.4;   // seconds the pin is gone after losing a home
export { BANNER_TIME };   // declared in config.js, so view/backdrop.js can read it without the rules
const SHOT_SPEED = 720, LIVES = 3, MAX_PARTICLES = 2000;
const EDGE_MARGIN = 16;   // the gap the pin and the formation keep from the sides of the screen
const FORMATION_STRIDE = 9, FORMATION_DROP = 18;   // how far the formation steps sideways, and drops at an edge
const CEILING = 64;   // the top of the playfield, under the HUD

// The whole game state. The renderer and the status mirror read it; only this module writes it.
// state: 'title' | 'play' | 'dead' (respawning) | 'clear' (wave banner) | 'over'
// settings: the player's sound and music choices, loaded by main.js (applySettings) and flipped by M and N.
// best: the best score so far, loaded by main.js through the store it hands over (applyBestStore).
// table: the shared high-score table, { status: 'unknown' | 'available' | 'unavailable', rows: [{ initials, score, id }]
//   best first }, from the answers main.js hands over (tableAnswered, tableFailed). Unknown until the first answer,
//   unavailable only while no table has ever loaded (DDD-9): nobody is asked for initials unless it is available.
// lastListedAt: when the server listed the rows shown (DDD-12), null before any.
// initials: while a score that makes the table is being signed, { letters (0 to 3 capitals, in the order typed), notice
//   (null, or Enter's answer, { kind: 'too-few' | 'refused', n }, shown until the next key the entry acts on) }.
// skipped: this game over's signing was skipped with Esc (DDD-T7); a new game clears it. A skip isn't a signing: it
//   sends nothing, publishes nothing, and leaves the current signing, its mark, settled, the table and the best as they are.
// signing: the current signing, { n, initials, status: 'pending' | 'confirmed' | 'off-table' | 'unconfirmed', id, rank },
//   id and rank set once confirmed; null before the first. A new game keeps it: only the next signing replaces it (DDD-8).
// signedThisGame: the current signing was made at this game over (the game-over screen describes no earlier one).
// settled: the latest settled outcome, { n, initials, outcome, rank }, a replaced signing's included; the status mirror
//   announces each one once.
export const g = {
  state: 'title', paused: false, t: 0, settings: { sound: true, music: true },
  score: 0, best: 0, newBest: false, lives: LIVES, level: 0,
  table: { status: 'unknown', rows: [] }, lastListedAt: null, initials: null,
  signing: null, signedThisGame: false, skipped: false, settled: null,
  player: { x: W / 2 - PW / 2, y: H - 80 },
  shot: null, bolts: [], particles: [], texts: [], shields: [], invaders: [],
  formation: { x: 0, y: 0, dir: 1, timer: 0, frame: 0 },
  dream: null, dreamTimer: 0, fireTimer: 0, respawn: 0, banner: 0, overT: 0, overReason: '',
};

// Moments the sound system reacts to. The rules publish them here; main.js takes them once per frame.
const outbox = [];
const emit = (type, detail) => outbox.push({ type, t: g.t, ...detail });
export const takeEvents = () => outbox.splice(0);

// The only way settings get in from outside: main.js applies what it loaded before the first frame.
export function applySettings({ sound, music }) {
  g.settings = { sound, music };
}

// The best score lives in a store main.js hands over ({ load() -> score, save(score) }), so the rules never touch
// storage. Until then nothing is kept, which is how the rules run on their own.
const NO_STORE = Object.freeze({ load: () => 0, save() {} });
let bestStore = NO_STORE;

export function applyBestStore(store) {
  bestStore = store;
  g.best = store.load();
}

// The rules' side of the table outcomes (DESIGN, "Rules operations"). main.js hands every outcome over between frames,
// from the promise callbacks (DDD-11); only these functions write the table state and settle a signing.
//   tableAnswered({ scores, listedAt })            a load answered (page load, or the refresh on every gameStarted)
//   tableFailed()                                  a load failed (not OK, network error, or the 5000 ms timeout)
//   signingAnswered(n, { scores, id, listedAt })   the answer to signing n (n is in initialsEntered's `signing`)
//   signingFailed(n)                               signing n failed (not OK, network error, or the 5000 ms timeout)
export function tableAnswered({ scores, listedAt }) {
  applyRows(scores, listedAt);
}

// Rows listed earlier than the ones shown are older news, and are ignored (DDD-12).
function applyRows(rows, listedAt) {
  if (g.lastListedAt !== null && listedAt < g.lastListedAt) return;
  g.table = { status: 'available', rows };
  g.lastListedAt = listedAt;
}

// Unavailable only while no table has ever loaded: a failed refresh keeps the last good table (DDD-9).
export function tableFailed() {
  if (g.table.status === 'unknown') g.table = { ...g.table, status: 'unavailable' };
}

// Signings on their way, n -> initials: a replaced one still needs its initials when it settles. Each settles once.
const onTheirWay = new Map();

// A signing's answer carries rows like any other table answer. Its outcome comes from those rows, even when they are
// too old to apply: confirmed at the new row's place, or off the table if the row isn't in them.
export function signingAnswered(n, { scores, id, listedAt }) {
  applyRows(scores, listedAt);
  const at = scores.findIndex(row => row.id === id);
  if (at < 0) settle(n, 'off-table');
  else settle(n, 'confirmed', { id, rank: at + 1 });
}

// A failed signing may still have been saved: the next refresh shows its row, unmarked. The table is unchanged.
export function signingFailed(n) {
  settle(n, 'unconfirmed');
}

// Every outcome is recorded for the status mirror; only the current signing's changes it, and so its row's mark.
function settle(n, outcome, { id = null, rank = null } = {}) {
  if (!onTheirWay.has(n)) return;
  const initials = onTheirWay.get(n);
  onTheirWay.delete(n);
  g.settled = { n, initials, outcome, rank };
  if (g.signing.n === n) g.signing = { ...g.signing, status: outcome, id, rank };   // on its way, so still pending
}

// The rules' read model for tests; the views read g directly. No production code calls it: the in-memory acceptance
// model (tier-b/signing-rules.js) and the unit properties read it (DISTILL, "WS strategy"), so they never reach into g.
// A fresh, frozen { screen: 'title' | 'play' | 'over', table: { status, rows }, entry: { letters: '' to 'ABC', notice:
// null or { kind, n } } or null, skipped, signing, settled, lastListedAt: number or null }.
const SCREENS = { title: 'title', play: 'play', dead: 'play', clear: 'play', over: 'over' };

const deepFreeze = value => {
  if (typeof value === 'object' && value !== null) Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

export function snapshot() {
  return deepFreeze({
    screen: SCREENS[g.state],
    table: { status: g.table.status, rows: g.table.rows.map(row => ({ ...row })) },
    entry: g.initials && { letters: g.initials.letters, notice: g.initials.notice && { ...g.initials.notice } },
    skipped: g.skipped,
    signing: g.signing && { ...g.signing }, settled: g.settled && { ...g.settled },
    lastListedAt: g.lastListedAt,
  });
}

export const invaderX = v => g.formation.x + v.c * GX;
export const houseCentreX = i => W / 4 * (i + 0.5);   // four houses, i = 0..3 from the left
export const invaderY = v => g.formation.y + v.r * GY;
const overlap = (ax, ay, aw, ah, bx, by, bw, bh) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const isPausable = () => ['play', 'dead', 'clear'].includes(g.state);

// The stray-key guard (D11): for 0.6 s after the game ends, a key is a stray from play. Enter starts no new game, and
// the entry drops the frame's presses, typed and positional alike, rather than queue them: a queue would type the very
// tap the guard exists to stop (DDD-T5). 0.6 s itself is still inside it.
const STRAY_KEY_GUARD_S = 0.6;
const pastTheGuard = () => g.overT > STRAY_KEY_GUARD_S;

// Enter plays again on a game-over screen with no entry open, once past the guard. The canvas asks for it only then.
export const canPlayAgain = () => g.state === 'over' && !g.initials && pastTheGuard();

const NO_PRESSES = Object.freeze([]);

// A frame's presses, handed over once a frame as plain data (DDD-T2): the positions pressed, a Set of codes, and the
// keys typed, in order, [{ key }]. A frame that starts with the initials entry open belongs to the entry: it takes the
// typed presses, once past the guard, and ignores the positions, so M, N and P are letters there, and the Enter that
// signs can't also start a game. Any other frame reads the positions only.
export function handlePresses(pressed, typed = NO_PRESSES) {
  if (g.initials) {
    if (pastTheGuard()) enterTyped(typed);
    return;
  }
  if (g.state === 'title' && (pressed.has('Enter') || pressed.has('Space'))) startGame();
  else if (canPlayAgain() && pressed.has('Enter')) startGame();
  else if (isPausable() && (pressed.has('KeyP') || pressed.has('Escape'))) setPaused(!g.paused);
  // M and N work on every screen but the initials entry, and never touch the game itself.
  if (pressed.has('KeyM')) toggleSetting('sound', GameEvent.SOUND_TOGGLED);
  if (pressed.has('KeyN')) toggleSetting('music', GameEvent.MUSIC_TOGGLED);
}

// The entry opens empty (D5).
const blankInitials = () => ({ letters: '', notice: null });

// Each typed press, in order, through the entry step. A press that closes the entry drops the rest of the frame.
function enterTyped(typed) {
  for (const press of typed) {
    applyPlan(entryStep(g.initials, press));
    if (!g.initials) return;
  }
}

// The entry step's shell (DDD-T6): it writes the entry, numbers a new notice, records a skip, and signs through sign().
function applyPlan({ letters, notice, skip, signing }) {
  g.initials = letters === null ? null : { letters, notice: numbered(notice) };
  if (skip) g.skipped = true;
  if (signing) sign(signing);
}

// Notices are numbered across games, outside g like the outbox, so the status mirror can tell each one from the last
// even when its words are the same. Nothing resets the count, neither a new entry (blankInitials) nor a new game
// (startGame). A notice the entry kept has its number already.
let noticesShown = 0;
const numbered = notice => (notice && notice.n === undefined ? { ...notice, n: ++noticesShown } : notice);

// A letter is a key that is exactly one character, A to Z or a to z as typed, checked before it is put in capitals:
// é, ß, ı (dotless i), ſ (long s) and K (the Kelvin sign) aren't letters, and none is turned into one (DDD-T3).
const isLetter = key => /^[A-Za-z]$/.test(key);

// The entry step (DDD-T6): what one typed press does to the entry { letters, notice }, as a plan for handlePresses to
// apply. Pure: it reads only its arguments and publishes nothing. The plan is { letters: the letters after the press,
// or null once it closes the entry; notice: the entry's own notice when the press leaves it be, a fresh one without a
// number for Enter's answer, else null; skip: true once Esc closes the entry, else false; signing: the initials to sign,
// or null }. Esc skips from any entry, whatever its letters and notice (DDD-T7). A fourth letter, Backspace on an empty
// entry and every key it doesn't name leave the entry as it is, its notice included (D14).
export function entryStep(entry, { key }) {
  if (isLetter(key)) return typeLetter(entry, key);
  if (key === 'Backspace') return takeBackLetter(entry);
  if (key === 'Enter') return enter(entry.letters);
  if (key === 'Escape') return skipSigning();
  return asItIs(entry);
}

const plan = (letters, notice = null, signing = null) => ({ letters, notice, skip: false, signing });
const asItIs = ({ letters, notice }) => plan(letters, notice);
const skipSigning = () => ({ letters: null, notice: null, skip: true, signing: null });

// A letter fills the next slot, in capitals; once all three are in, it leaves the entry as it is.
const typeLetter = (entry, key) => (entry.letters.length < INITIALS_LENGTH ? plan(entry.letters + key.toUpperCase()) : asItIs(entry));

// Backspace takes back the last letter; on an empty entry, it leaves the entry as it is.
const takeBackLetter = entry => (entry.letters ? plan(entry.letters.slice(0, -1)) : asItIs(entry));

// Enter signs three allowed letters. Initials on the word filter are refused here, before anything is sent (ADR-007):
// no signing and no event, and the entry is emptied for different ones. With fewer than three, a hint, and the letters
// are kept.
function enter(letters) {
  if (letters.length < INITIALS_LENGTH) return plan(letters, { kind: 'too-few' });
  if (!isAllowedInitials(letters)) return plan('', { kind: 'refused' });
  return plan(null, null, letters);
}

// A new signing n replaces any earlier one as the current signing. main.js takes it to the table once, and hands its
// answer or failure back (signingAnswered, signingFailed).
function sign(initials) {
  const n = (g.signing?.n ?? 0) + 1;
  g.initials = null;
  g.signing = { n, initials, status: 'pending', id: null, rank: null };
  g.signedThisGame = true;
  onTheirWay.set(n, initials);
  emit(GameEvent.INITIALS_ENTERED, { initials, score: g.score, signing: n });
}

function toggleSetting(name, event) {
  g.settings[name] = !g.settings[name];
  emit(event, { on: g.settings[name] });
}

export function pause() {
  if (isPausable()) setPaused(true);
}

// Publishes the change only when there is one, so the sound system never hears a pause twice.
function setPaused(paused) {
  if (g.paused === paused) return;
  g.paused = paused;
  emit(paused ? GameEvent.PAUSED : GameEvent.RESUMED);
}

function startGame() {
  g.score = 0; g.lives = LIVES; g.newBest = false;
  g.initials = null; g.signedThisGame = false; g.skipped = false;   // the signing is kept
  startWave(0);
  emit(GameEvent.GAME_STARTED);
}

function startWave(level) {
  g.level = level;
  g.invaders = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) g.invaders.push({ r, c, type: r, alive: true });
  g.formation = { x: (W - ((COLS - 1) * GX + IW)) / 2, y: 120 + Math.min(level, 4) * 18, dir: 1, timer: 0.6, frame: 0 };
  g.shields = [0, 1, 2, 3].map(i => makeShield(Math.round(houseCentreX(i) - SW * PX / 2), SHIELD_Y));
  g.player.x = W / 2 - PW / 2;
  g.shot = null; g.bolts = []; g.dream = null;
  g.dreamTimer = 12 + Math.random() * 10; g.fireTimer = 1;
  g.state = 'play';
}

// Advance the game by one fixed step of dt seconds. The keyboard, as the rules see it, is only which keys are down:
// keys.isDown(code) (DDD-T14).
export function update(dt, keys) {
  g.t += dt;
  updateParticles(dt);
  switch (g.state) {
    case 'title': return;
    case 'over': g.overT += dt; return;
    case 'clear':
      g.banner -= dt;
      moveShot(dt); moveBolts(dt);
      if (g.banner <= 0) startWave(g.level + 1);
      return;
    case 'dead':
      g.respawn -= dt;
      if (g.respawn > 0) break;
      if (g.lives === 0) return gameOver('Offer rejected');
      g.state = 'play'; g.player.x = W / 2 - PW / 2;
  }
  if (g.state === 'play') movePlayer(dt, keys);
  moveShot(dt);
  moveBolts(dt);
  moveDream(dt);
  if (g.state === 'play') { stepFormation(dt); enemyFire(dt); }
}

function movePlayer(dt, keys) {
  const right = keys.isDown('ArrowRight') || keys.isDown('KeyD');
  const left = keys.isDown('ArrowLeft') || keys.isDown('KeyA');
  g.player.x = clamp(g.player.x + (right - left) * PLAYER_SPEED * dt, EDGE_MARGIN, W - EDGE_MARGIN - PW);
  if (keys.isDown('Space') && !g.shot) {
    g.shot = { x: g.player.x + PW / 2 - SHOT_W / 2, y: g.player.y - 10 };
    emit(GameEvent.SHOT_FIRED);
  }
}

function formationInfo() {
  let minC = COLS, maxC = -1, maxR = -1, alive = 0;
  for (const v of g.invaders) if (v.alive) {
    alive++;
    minC = Math.min(minC, v.c); maxC = Math.max(maxC, v.c); maxR = Math.max(maxR, v.r);
  }
  return { minC, maxC, maxR, alive };
}

// Seconds between formation steps: shorter as hurdles fall, and shorter again with each wave.
const FASTEST_STEP = 0.03, EXTRA_STEP_WHEN_FULL = 0.5, WAVE_SPEEDUP = 0.12;
export const formationStepInterval = (hurdlesLeft, level) =>
  (FASTEST_STEP + EXTRA_STEP_WHEN_FULL * hurdlesLeft / FORMATION_SIZE) / (1 + level * WAVE_SPEEDUP);

// The formation moves in steps that get quicker as it thins out, dropping a row at each edge.
function stepFormation(dt) {
  const f = g.formation;
  f.timer -= dt;
  if (f.timer > 0) return;
  const { minC, maxC, maxR, alive } = formationInfo();
  if (!alive) return;
  f.timer = formationStepInterval(alive, g.level);
  f.frame ^= 1;
  const nx = f.x + f.dir * FORMATION_STRIDE;
  if (nx + minC * GX < EDGE_MARGIN || nx + maxC * GX + IW > W - EDGE_MARGIN) { f.y += FORMATION_DROP; f.dir = -f.dir; } else f.x = nx;
  emit(GameEvent.FORMATION_STEPPED, { alive });
  if (f.y + maxR * GY + IH >= SHIELD_Y) {
    for (const v of g.invaders) if (v.alive) clearRect(g.shields, invaderX(v), invaderY(v), IW, IH);
  }
  if (f.y + maxR * GY + IH >= g.player.y) gameOver('Gazumped!');
}

function enemyFire(dt) {
  g.fireTimer -= dt;
  if (g.fireTimer > 0 || g.bolts.length >= Math.min(3 + g.level, 7)) return;
  g.fireTimer = Math.max(0.3, 1.0 - g.level * 0.12) * (0.5 + Math.random());
  const bottom = [];   // lowest living invader in each column
  for (const v of g.invaders) if (v.alive && (!bottom[v.c] || v.r > bottom[v.c].r)) bottom[v.c] = v;
  const shooters = bottom.filter(Boolean);
  if (!shooters.length) return;
  let v = shooters[(Math.random() * shooters.length) | 0];
  if (Math.random() < 0.4) {   // sometimes aim at the player
    const px = g.player.x + PW / 2;
    v = shooters.reduce((a, b) => Math.abs(invaderX(b) - px) < Math.abs(invaderX(a) - px) ? b : a);
  }
  g.bolts.push({ x: invaderX(v) + IW / 2 - 1.5, y: invaderY(v) + IH, vy: 240 + g.level * 20, color: HURDLES[v.type].color });
}

function moveShot(dt) {
  const s = g.shot;
  if (!s) return;
  const y0 = s.y;
  s.y -= SHOT_SPEED * dt;
  const hit = sweep(g.shields, s.x + 1, y0, s.y);
  if (hit) { chipHouse(hit, 2.2, 'shot'); g.shot = null; return; }
  const b = g.bolts.findIndex(b => overlap(s.x, s.y, SHOT_W, SHOT_H, b.x - 2, b.y, 7, BOLT_H));
  if (b >= 0) { stopBolt(b); g.shot = null; return; }
  for (const v of g.invaders) {
    if (v.alive && overlap(s.x, s.y, SHOT_W, SHOT_H, invaderX(v), invaderY(v), IW, IH)) { killInvader(v); g.shot = null; return; }
  }
  if (g.dream && overlap(s.x, s.y, SHOT_W, SHOT_H, g.dream.x, g.dream.y, DW, DH)) { saveDream(); g.shot = null; return; }
  if (s.y < CEILING) { burst(s.x, CEILING, COLORS.green, 4, 60); g.shot = null; }
}

// A shot or a bolt chips a house; the sound system hears which of the two it was.
function chipHouse(hit, radius, source) {
  const p = erode(hit, radius);
  burst(p.x, p.y, COLORS.brick, 6, 90);
  emit(GameEvent.SHIELD_HIT, { source });
}

// The player's shot meets bolt number `index`: both are gone.
function stopBolt(index) {
  const bolt = g.bolts.splice(index, 1)[0];
  burst(bolt.x, bolt.y, COLORS.green, 8);
  emit(GameEvent.BOLT_STOPPED);
}

function killInvader(v) {
  const hurdle = HURDLES[v.type];
  v.alive = false;
  g.score += hurdle.value;
  emit(GameEvent.HURDLE_HIT, { value: hurdle.value });
  burst(invaderX(v) + IW / 2, invaderY(v) + IH / 2, hurdle.color, 14);
  if (!g.invaders.some(other => other.alive)) clearWave();
}

function clearWave() {
  g.state = 'clear'; g.banner = BANNER_TIME; g.bolts = [];
  dismissDream();
  emit(GameEvent.WAVE_CLEARED);
}

// The Dream Home leaves the screen without being saved (it flew off, the wave ended or the game did):
// the sound system hears it go, so the siren stops.
function dismissDream() {
  if (!g.dream) return;
  g.dream = null;
  emit(GameEvent.DREAM_GONE);
}

function saveDream() {
  const d = g.dream, bonus = DREAM_BONUSES[(Math.random() * DREAM_BONUSES.length) | 0];
  g.score += bonus;
  emit(GameEvent.DREAM_SAVED, { bonus });
  burst(d.x + DW / 2, d.y + DH / 2, COLORS.dream, 40, 220);
  g.texts.push({ text: 'Dream home saved +' + pounds(bonus), x: clamp(d.x + DW / 2, 150, W - 150), y: d.y + DH + 18, life: 1.8, color: COLORS.dream });
  g.dream = null; g.dreamTimer = 18 + Math.random() * 10;
}

function moveBolts(dt) {
  for (let i = g.bolts.length - 1; i >= 0; i--) {
    const b = g.bolts[i], y0 = b.y + BOLT_H;
    b.y += b.vy * dt;
    const hit = sweep(g.shields, b.x + 1, y0, b.y + BOLT_H);
    if (hit) { chipHouse(hit, 2.8, 'bolt'); g.bolts.splice(i, 1); continue; }
    if (g.state === 'play' && overlap(b.x, b.y, 3, BOLT_H, g.player.x + 4, g.player.y + 2, PW - 8, PH - 8)) { killPlayer(); return; }
    if (b.y + BOLT_H >= GROUND) { burst(b.x, GROUND, b.color, 5, 60); g.bolts.splice(i, 1); }
  }
}

function killPlayer() {
  g.lives--; g.state = 'dead'; g.respawn = RESPAWN_TIME; g.shot = null; g.bolts = [];
  emit(GameEvent.HOME_LOST, { livesLeft: g.lives });
  burst(g.player.x + PW / 2, g.player.y + PH / 2, COLORS.green, 50, 240);
}

function moveDream(dt) {
  if (g.state !== 'play') return;
  if (!g.dream) {
    g.dreamTimer -= dt;
    if (g.dreamTimer <= 0 && formationInfo().alive > 6) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      g.dream = { x: dir > 0 ? -DW : W, y: 66, vx: dir * 150 };
      emit(GameEvent.DREAM_APPEARED);
    }
    return;
  }
  g.dream.x += g.dream.vx * dt;
  if (g.dream.x < -DW - 4 || g.dream.x > W + 4) { dismissDream(); g.dreamTimer = 18 + Math.random() * 10; }
}

function gameOver(reason) {
  g.state = 'over'; g.overReason = reason; g.overT = 0;
  g.newBest = g.score > g.best;
  if (g.newBest) { g.best = g.score; bestStore.save(g.best); }
  if (makesTheTable(g.table, g.score)) g.initials = blankInitials();
  dismissDream();
  emit(GameEvent.GAME_OVER, { reason });
}

function burst(x, y, color, n, speed = 160) {
  for (let i = 0; i < n && g.particles.length < MAX_PARTICLES; i++) {
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random()), life = 0.4 + Math.random() * 0.4;
    g.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color });
  }
}

function updateParticles(dt) {
  const ps = g.particles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life -= dt;
    if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.985; p.vy = p.vy * 0.985 + 120 * dt;
  }
  for (let i = g.texts.length - 1; i >= 0; i--) {
    const m = g.texts[i];
    m.life -= dt; m.y -= 24 * dt;
    if (m.life <= 0) g.texts.splice(i, 1);
  }
}
