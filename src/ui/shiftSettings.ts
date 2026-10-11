// The player's shift customization (Shift Setup window). Difficulty and timer
// live in AppState (level, shiftSeconds); everything here is layered on top of
// the chosen level. No DOM in this file, so it can be unit tested.
import type { LevelConfig, ShiftConfig } from "./service/types";

export type Rate = "low" | "normal" | "high";
export type DistractionRate = "off" | Rate;

/**
 * When an effect on a person doing an anomaly shows: for the whole anomaly,
 * for its first seconds, or never.
 */
export type AuraMode = "always" | "timed" | "off";

export interface ShiftSettings {
  /**
   * True when the player picked Custom and set the options by hand. False
   * runs the difficulty's own preset and ignores the fields below.
   */
  custom: boolean;
  /** Feeds on screen. */
  cameraCount: number;
  /** Anomalies in the shift. */
  anomalies: number;
  /** How fast ordinary people walk in, and how crowded the building gets. */
  npcRate: Rate;
  /** How often pop-ups cover the feeds. */
  distractions: DistractionRate;
  /** Whether feeds glitch now and then. */
  glitches: boolean;
  /** Whether the Watch Station shows how many sightings were reported. */
  reportCounter: boolean;
  /** Red tint on the sprite of a person doing an anomaly. */
  highlight: AuraMode;
  /** How long a timed highlight lasts after the anomaly starts. */
  highlightSeconds: number;
  /** Red embers rising around a person doing an anomaly. */
  aura: AuraMode;
  /** How long a timed aura lasts after the anomaly starts. */
  auraSeconds: number;
  /**
   * Advanced: a report counts if the suspect was on that feed this many
   * seconds ago or less. Not part of any difficulty preset.
   */
  reportWindowSeconds: number;
}

export const DEFAULT_SHIFT_SETTINGS: ShiftSettings = {
  custom: false,
  cameraCount: 4,
  anomalies: 5,
  npcRate: "normal",
  distractions: "normal",
  glitches: true,
  reportCounter: true,
  highlight: "timed",
  highlightSeconds: 1,
  aura: "off",
  auraSeconds: 3,
  reportWindowSeconds: 5,
};

/** The world has six cameras. */
export const CAMERA_OPTIONS = [2, 4, 6] as const;
export const MIN_ANOMALIES = 1;
export const MAX_ANOMALIES = 12;
export const MIN_AURA_SECONDS = 0.5;
export const MAX_AURA_SECONDS = 15;
export const MIN_REPORT_WINDOW = 3;
export const MAX_REPORT_WINDOW = 15;
export const AURA_MODES: readonly AuraMode[] = ["always", "timed", "off"];
export const RATES: readonly Rate[] = ["low", "normal", "high"];
export const DISTRACTION_RATES: readonly DistractionRate[] = ["off", ...RATES];

/** Multipliers on the world's walk-in pace and crowd size. */
const NPC_SPAWN_RATE: Record<Rate, number> = {
  low: 0.5,
  normal: 1,
  high: 1.75,
};
/** Multipliers on how often pop-ups appear; 0 turns them off. */
const DISTRACTION_FREQUENCY: Record<DistractionRate, number> = {
  off: 0,
  low: 0.5,
  normal: 1,
  high: 2,
};

const STORAGE_KEY = "night-watch:shift-settings";

function auraMode(value: unknown, fallback: AuraMode): AuraMode {
  return AURA_MODES.includes(value as AuraMode)
    ? (value as AuraMode)
    : fallback;
}

/** Effect lengths are 0.5s, then whole seconds up to MAX_AURA_SECONDS. */
function snapAuraSeconds(value: number): number {
  return value < 1
    ? MIN_AURA_SECONDS
    : Math.min(MAX_AURA_SECONDS, Math.round(value));
}

function auraSeconds(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? snapAuraSeconds(value)
    : fallback;
}

/** The next effect length up (dir 1) or down (dir -1): 0.5s, 1s, 2s, ... */
export function stepAuraSeconds(current: number, dir: number): number {
  if (dir < 0 && current <= 1) return MIN_AURA_SECONDS;
  if (dir > 0 && current < 1) return 1;
  return snapAuraSeconds(current + dir);
}

/** Fills in anything missing or invalid from the defaults. */
export function sanitizeShiftSettings(value: unknown): ShiftSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const d = DEFAULT_SHIFT_SETTINGS;
  return {
    custom: v.custom === true,
    cameraCount: (CAMERA_OPTIONS as readonly unknown[]).includes(v.cameraCount)
      ? (v.cameraCount as number)
      : d.cameraCount,
    anomalies:
      typeof v.anomalies === "number" && Number.isFinite(v.anomalies)
        ? Math.min(
            MAX_ANOMALIES,
            Math.max(MIN_ANOMALIES, Math.round(v.anomalies)),
          )
        : d.anomalies,
    npcRate: RATES.includes(v.npcRate as Rate)
      ? (v.npcRate as Rate)
      : d.npcRate,
    distractions: DISTRACTION_RATES.includes(v.distractions as DistractionRate)
      ? (v.distractions as DistractionRate)
      : d.distractions,
    glitches: typeof v.glitches === "boolean" ? v.glitches : d.glitches,
    reportCounter:
      typeof v.reportCounter === "boolean" ? v.reportCounter : d.reportCounter,
    highlight: auraMode(v.highlight, d.highlight),
    highlightSeconds: auraSeconds(v.highlightSeconds, d.highlightSeconds),
    aura: auraMode(v.aura, d.aura),
    auraSeconds: auraSeconds(v.auraSeconds, d.auraSeconds),
    reportWindowSeconds:
      typeof v.reportWindowSeconds === "number" &&
      Number.isFinite(v.reportWindowSeconds)
        ? Math.min(
            MAX_REPORT_WINDOW,
            Math.max(MIN_REPORT_WINDOW, Math.round(v.reportWindowSeconds)),
          )
        : d.reportWindowSeconds,
  };
}

export function loadShiftSettings(): ShiftSettings {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return sanitizeShiftSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_SHIFT_SETTINGS };
  }
}

export function saveShiftSettings(settings: ShiftSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Could not save the shift settings.", error);
  }
}

/** True when the player's own options apply, not a difficulty preset. */
export function isCustomized(settings: ShiftSettings): boolean {
  return settings.custom;
}

/**
 * Crowd, pop-ups, glitches, report counter and anomaly effects each
 * difficulty starts from. The effects mirror the level's own: a steady tint
 * on Easy, a 1s flash on Normal and Hard, and embers on Hard.
 */
const LEVEL_PRESETS: Record<
  number,
  Omit<
    ShiftSettings,
    | "custom"
    | "cameraCount"
    | "anomalies"
    | "auraSeconds"
    | "reportWindowSeconds"
  >
> = {
  1: {
    npcRate: "low",
    distractions: "low",
    glitches: false,
    reportCounter: true,
    highlight: "always",
    highlightSeconds: 1,
    aura: "off",
  },
  2: {
    npcRate: "normal",
    distractions: "normal",
    glitches: true,
    reportCounter: false,
    highlight: "timed",
    highlightSeconds: 1,
    aura: "off",
  },
  3: {
    npcRate: "high",
    distractions: "high",
    glitches: true,
    reportCounter: false,
    highlight: "timed",
    highlightSeconds: 1,
    aura: "always",
  },
};

/** The options a difficulty level selects on its own. */
export function presetSettings(level: LevelConfig): ShiftSettings {
  return {
    ...DEFAULT_SHIFT_SETTINGS,
    cameraCount: level.cameraCount,
    anomalies: level.expectedAnomalies,
    ...(LEVEL_PRESETS[level.level] ?? LEVEL_PRESETS[2]),
  };
}

/**
 * The options in force: the player's when Custom, else the level's preset.
 * The report window is always the player's (it's not part of a preset).
 */
export function effectiveSettings(
  level: LevelConfig,
  settings: ShiftSettings,
): ShiftSettings {
  return settings.custom
    ? settings
    : {
        ...presetSettings(level),
        reportWindowSeconds: settings.reportWindowSeconds,
      };
}

/**
 * Switches to Custom starting from the options currently in force, so
 * nothing on screen changes until the player changes it.
 */
export function toCustom(
  level: LevelConfig,
  settings: ShiftSettings,
): ShiftSettings {
  return { ...effectiveSettings(level, settings), custom: true };
}

/**
 * The player's choice for one anomaly effect, for the feed renderer: on for
 * the whole anomaly (Infinity), for its first `seconds`, or never (0).
 */
export interface AuraOverride {
  seconds: number;
}

function override(mode: AuraMode, seconds: number): AuraOverride {
  return {
    seconds: mode === "always" ? Infinity : mode === "timed" ? seconds : 0,
  };
}

export interface ShiftPlan {
  config: ShiftConfig;
  /** Multiplier on pop-up frequency; 0 means none. */
  distractionFrequency: number;
  glitches: boolean;
  /** Show the sightings count and meter in the Watch Station. */
  reportCounter: boolean;
  /** Sprite tint (green, red on Hard); null (a difficulty preset) keeps the level's own. */
  highlight: AuraOverride | null;
  /** Rising embers; null (a difficulty preset) keeps the level's own. */
  aura: AuraOverride | null;
}

/** What a shift will actually run with: the level plus the player's settings. */
export function planShift(
  level: LevelConfig,
  durationSeconds: number,
  chosen: ShiftSettings,
): ShiftPlan {
  const settings = effectiveSettings(level, chosen);
  return {
    config: {
      level: level.level,
      cameraCount: settings.cameraCount as LevelConfig["cameraCount"],
      expectedAnomalies: settings.anomalies,
      durationSeconds,
      // Only a count the player set is exact; presets keep the level's.
      fixedAnomalies: chosen.custom,
      npcSpawnRate: NPC_SPAWN_RATE[settings.npcRate],
      reportWindowSeconds: settings.reportWindowSeconds,
    },
    distractionFrequency: DISTRACTION_FREQUENCY[settings.distractions],
    glitches: settings.glitches,
    reportCounter: settings.reportCounter,
    // Presets keep the renderer's per-level effects (the Normal and Hard
    // flash is not a steady tint); Custom applies the player's choices.
    highlight: chosen.custom
      ? override(settings.highlight, settings.highlightSeconds)
      : null,
    aura: chosen.custom ? override(settings.aura, settings.auraSeconds) : null,
  };
}
