// The player's shift customization (Shift Setup window). Difficulty and timer
// live in AppState (level, shiftSeconds); everything here is layered on top of
// the chosen level. No DOM in this file, so it can be unit tested.
import type { LevelConfig, ShiftConfig } from "./service/types";

export type Rate = "low" | "normal" | "high";
export type DistractionRate = "off" | Rate;

/**
 * When an effect on a person doing an anomaly shows: per the difficulty
 * level, for the whole anomaly, for its first seconds, or never.
 */
export type AuraMode = "auto" | "always" | "timed" | "off";

export interface ShiftSettings {
  /**
   * True when the player picked Custom and set the options by hand. False
   * runs the difficulty's own preset and ignores the fields below.
   */
  custom: boolean;
  /** Feeds on screen; null follows the difficulty level. */
  cameraCount: number | null;
  /** Anomalies in the shift; null follows the difficulty level. */
  anomalies: number | null;
  /** How fast ordinary people walk in, and how crowded the building gets. */
  npcRate: Rate;
  /** How often pop-ups cover the feeds. */
  distractions: DistractionRate;
  /** Whether feeds glitch now and then. */
  glitches: boolean;
  /** Red tint on the sprite of a person doing an anomaly. */
  highlight: AuraMode;
  /** How long a timed highlight lasts after the anomaly starts. */
  highlightSeconds: number;
  /** Red embers rising around a person doing an anomaly. */
  aura: AuraMode;
  /** How long a timed aura lasts after the anomaly starts. */
  auraSeconds: number;
}

export const DEFAULT_SHIFT_SETTINGS: ShiftSettings = {
  custom: false,
  cameraCount: null,
  anomalies: null,
  npcRate: "normal",
  distractions: "normal",
  glitches: true,
  highlight: "auto",
  highlightSeconds: 3,
  aura: "auto",
  auraSeconds: 3,
};

/** The world has six cameras. */
export const CAMERA_OPTIONS = [2, 4, 6] as const;
export const MIN_ANOMALIES = 1;
export const MAX_ANOMALIES = 12;
export const MIN_AURA_SECONDS = 1;
export const MAX_AURA_SECONDS = 15;
export const AURA_MODES: readonly AuraMode[] = [
  "auto",
  "always",
  "timed",
  "off",
];
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

function auraSeconds(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_AURA_SECONDS, Math.max(MIN_AURA_SECONDS, Math.round(value)))
    : fallback;
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
      : null,
    anomalies:
      typeof v.anomalies === "number" && Number.isFinite(v.anomalies)
        ? Math.min(
            MAX_ANOMALIES,
            Math.max(MIN_ANOMALIES, Math.round(v.anomalies)),
          )
        : null,
    npcRate: RATES.includes(v.npcRate as Rate)
      ? (v.npcRate as Rate)
      : d.npcRate,
    distractions: DISTRACTION_RATES.includes(v.distractions as DistractionRate)
      ? (v.distractions as DistractionRate)
      : d.distractions,
    glitches: typeof v.glitches === "boolean" ? v.glitches : d.glitches,
    highlight: auraMode(v.highlight, d.highlight),
    highlightSeconds: auraSeconds(v.highlightSeconds, d.highlightSeconds),
    aura: auraMode(v.aura, d.aura),
    auraSeconds: auraSeconds(v.auraSeconds, d.auraSeconds),
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

/** Crowd, pop-ups and glitches each difficulty level starts from. */
const LEVEL_PRESETS: Record<
  number,
  Pick<ShiftSettings, "npcRate" | "distractions" | "glitches">
> = {
  1: { npcRate: "low", distractions: "low", glitches: false },
  2: { npcRate: "normal", distractions: "normal", glitches: true },
  3: { npcRate: "high", distractions: "high", glitches: true },
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

/** The options in force: the player's when Custom, else the level's preset. */
export function effectiveSettings(
  level: LevelConfig,
  settings: ShiftSettings,
): ShiftSettings {
  return settings.custom ? settings : presetSettings(level);
}

/**
 * The player's choice for one anomaly effect, for the feed renderer: on for
 * the whole anomaly (Infinity), for its first `seconds`, or never (0).
 */
export interface AuraOverride {
  seconds: number;
}

function override(mode: AuraMode, seconds: number): AuraOverride | null {
  if (mode === "auto") return null;
  return {
    seconds: mode === "always" ? Infinity : mode === "timed" ? seconds : 0,
  };
}

export interface ShiftPlan {
  config: ShiftConfig;
  /** Multiplier on pop-up frequency; 0 means none. */
  distractionFrequency: number;
  glitches: boolean;
  /** Red sprite tint; null keeps the level's own. */
  highlight: AuraOverride | null;
  /** Rising embers; null keeps the level's own. */
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
      cameraCount: (settings.cameraCount ??
        level.cameraCount) as LevelConfig["cameraCount"],
      expectedAnomalies: settings.anomalies ?? level.expectedAnomalies,
      durationSeconds,
      // Only a count the player typed in is exact; presets keep the level's.
      fixedAnomalies: chosen.custom && chosen.anomalies !== null,
      npcSpawnRate: NPC_SPAWN_RATE[settings.npcRate],
    },
    distractionFrequency: DISTRACTION_FREQUENCY[settings.distractions],
    glitches: settings.glitches,
    highlight: override(settings.highlight, settings.highlightSeconds),
    aura: override(settings.aura, settings.auraSeconds),
  };
}
