export const LEVEL_KEY = "level";
export const LEVEL_COMPLETED_KEY = "levelCompleted";

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
