import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHIFT_SETTINGS,
  MAX_ANOMALIES,
  isCustomized,
  planShift,
  presetSettings,
  sanitizeShiftSettings,
  toCustom,
} from "./shiftSettings";

const LEVEL = { level: 2, cameraCount: 6, expectedAnomalies: 5 } as const;

describe("shift settings", () => {
  it("follows the level until the player overrides it", () => {
    const plan = planShift(LEVEL, 120, DEFAULT_SHIFT_SETTINGS);
    expect(plan.config).toMatchObject({
      level: 2,
      cameraCount: 6,
      expectedAnomalies: 5,
      durationSeconds: 120,
      fixedAnomalies: false,
      npcSpawnRate: 1,
    });
    expect(plan.distractionFrequency).toBe(1);
    expect(plan.highlight).toBeNull();
    expect(plan.aura).toBeNull();
    expect(isCustomized(DEFAULT_SHIFT_SETTINGS)).toBe(false);
  });

  it("applies the player's options when Custom is on", () => {
    const settings = {
      ...DEFAULT_SHIFT_SETTINGS,
      custom: true,
      cameraCount: 2,
      anomalies: 1,
      npcRate: "high",
      distractions: "off",
      glitches: false,
    } as const;
    const plan = planShift(LEVEL, 60, settings);
    expect(plan.config.cameraCount).toBe(2);
    expect(plan.config.expectedAnomalies).toBe(1);
    expect(plan.config.fixedAnomalies).toBe(true);
    expect(plan.config.npcSpawnRate).toBeGreaterThan(1);
    expect(plan.distractionFrequency).toBe(0);
    expect(plan.glitches).toBe(false);
    expect(isCustomized(settings)).toBe(true);
  });

  it("turns the highlight and aura choices into durations", () => {
    const plan = (mode: "always" | "timed" | "off") =>
      planShift(LEVEL, 120, {
        ...DEFAULT_SHIFT_SETTINGS,
        custom: true,
        aura: mode,
        auraSeconds: 5,
      });
    expect(plan("always").aura).toEqual({ seconds: Infinity });
    expect(plan("timed").aura).toEqual({ seconds: 5 });
    expect(plan("off").aura).toEqual({ seconds: 0 });
    // The two effects are set separately.
    expect(plan("off").highlight).toEqual({ seconds: 2 });
    expect(
      planShift(LEVEL, 120, {
        ...DEFAULT_SHIFT_SETTINGS,
        custom: true,
        highlight: "timed",
        highlightSeconds: 8,
      }),
    ).toMatchObject({ highlight: { seconds: 8 }, aura: { seconds: 0 } });
  });

  it("locks a difficulty to its preset until Custom is chosen", () => {
    const tweaked = {
      ...DEFAULT_SHIFT_SETTINGS,
      cameraCount: 2,
      anomalies: 1,
      distractions: "off",
    } as const;
    // Not custom: the tweaks are ignored and the level's preset runs.
    const plan = planShift(LEVEL, 120, tweaked);
    expect(plan.config.cameraCount).toBe(6);
    expect(plan.config.expectedAnomalies).toBe(5);
    expect(plan.config.fixedAnomalies).toBe(false);
    expect(plan.distractionFrequency).toBe(1);
  });

  it("gives each difficulty its own preset", () => {
    const easy = { level: 1, cameraCount: 4, expectedAnomalies: 3 } as const;
    const hard = { level: 3, cameraCount: 6, expectedAnomalies: 8 } as const;
    expect(presetSettings(easy)).toMatchObject({
      cameraCount: 4,
      anomalies: 3,
      npcRate: "low",
      distractions: "low",
      glitches: false,
      reportCounter: true,
    });
    expect(presetSettings(hard)).toMatchObject({
      npcRate: "high",
      distractions: "high",
      glitches: true,
      reportCounter: false,
    });
    // Normal hides the count too; Custom follows the player's choice.
    expect(planShift(LEVEL, 120, DEFAULT_SHIFT_SETTINGS).reportCounter).toBe(
      false,
    );
    expect(
      planShift(LEVEL, 120, { ...DEFAULT_SHIFT_SETTINGS, custom: true })
        .reportCounter,
    ).toBe(true);
    expect(planShift(easy, 120, DEFAULT_SHIFT_SETTINGS).glitches).toBe(false);
  });

  it("switches to Custom from the preset on screen", () => {
    const hard = { level: 3, cameraCount: 6, expectedAnomalies: 8 } as const;
    const custom = toCustom(hard, {
      ...DEFAULT_SHIFT_SETTINGS,
      npcRate: "low",
    });
    expect(custom).toEqual({ ...presetSettings(hard), custom: true });
    // Already Custom: the player's options carry over unchanged.
    expect(toCustom(hard, custom)).toEqual(custom);
  });

  it("repairs stored values", () => {
    expect(sanitizeShiftSettings(null)).toEqual(DEFAULT_SHIFT_SETTINGS);
    expect(
      sanitizeShiftSettings({
        cameraCount: 5,
        anomalies: 999,
        npcRate: "fast",
        distractions: "off",
        glitches: "yes",
        highlight: "auto",
      }),
    ).toEqual({
      ...DEFAULT_SHIFT_SETTINGS,
      anomalies: MAX_ANOMALIES,
      distractions: "off",
    });
  });
});
