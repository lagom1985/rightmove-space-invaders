// The game is laid out in these logical units and scaled to fit the window.
export const W = 960, H = 720;
export const PX = 3;            // screen pixels per sprite pixel
export const GROUND = H - 34;

export const STEP = 1 / 120;    // fixed simulation step (s), so speed is the same at 60, 100 or 120 Hz
export const MAX_FRAME = 0.25;  // clamp after a hidden tab so the game doesn't jump ahead
