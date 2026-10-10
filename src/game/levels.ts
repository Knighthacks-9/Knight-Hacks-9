// Phaser registry keys shared by the game scenes.
export const LEVEL_KEY = "level";
/** ShiftReport from analytics for the shift that just ended. */
export const REPORT_KEY = "shiftReport";
/** How many camera feeds the world provides (caps screens per level). */
export const FEED_LIMIT_KEY = "feedLimit";

/** Shift length chosen on the title screen, in seconds. */
export const SHIFT_SECONDS_KEY = "shiftSeconds";
export const DEFAULT_SHIFT_SECONDS = 120;
// The world shrinks its end-of-shift margins on short shifts, so events
// still spread out even at the minimum.
export const MIN_SHIFT_SECONDS = 30;
export const MAX_SHIFT_SECONDS = 600;
export const SHIFT_SECONDS_STEP = 30;
const SHIFT_STORAGE_KEY = "night-watch:shift-seconds";

/** Snaps to the slider step and keeps the value in range. */
export function clampShiftSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SHIFT_SECONDS;
  const snapped = Math.round(value / SHIFT_SECONDS_STEP) * SHIFT_SECONDS_STEP;
  return Math.min(MAX_SHIFT_SECONDS, Math.max(MIN_SHIFT_SECONDS, snapped));
}

export function loadShiftSeconds(): number {
  try {
    const stored = globalThis.localStorage?.getItem(SHIFT_STORAGE_KEY);
    return stored ? clampShiftSeconds(Number(stored)) : DEFAULT_SHIFT_SECONDS;
  } catch {
    return DEFAULT_SHIFT_SECONDS;
  }
}

export function saveShiftSeconds(seconds: number): void {
  try {
    localStorage.setItem(SHIFT_STORAGE_KEY, String(seconds));
  } catch (error) {
    console.error("Could not save the shift length.", error);
  }
}

interface LevelConfig {
  screens: number;
  columns: number;
}

/** Difficulty ramp: each completed level adds screens, up to 16. */
export const LEVELS: readonly LevelConfig[] = [
  { screens: 1, columns: 1 },
  { screens: 2, columns: 2 },
  { screens: 4, columns: 2 },
  { screens: 6, columns: 3 },
  { screens: 9, columns: 3 },
  { screens: 12, columns: 4 },
  { screens: 16, columns: 4 },
];

/** Levels are 1-based; anything past the last level stays at 16 screens. */
export function getLevelConfig(level: number): LevelConfig {
  return LEVELS[Math.min(Math.max(level, 1), LEVELS.length) - 1];
}

/**
 * Screens actually shown: the level's count, capped by the cameras the world
 * has. When capped, the grid is re-laid out to stay roughly square.
 */
export function getFeedLayout(level: number, cameraCount: number): LevelConfig {
  const config = getLevelConfig(level);
  const screens = Math.max(1, Math.min(config.screens, cameraCount));
  return screens === config.screens
    ? config
    : { screens, columns: Math.ceil(Math.sqrt(screens)) };
}
