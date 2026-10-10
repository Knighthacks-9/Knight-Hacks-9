import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHIFT_SECONDS,
  LEVELS,
  MAX_SHIFT_SECONDS,
  MIN_SHIFT_SECONDS,
  clampShiftSeconds,
  getLevelConfig,
} from "./levels";

describe("shift length", () => {
  it("snaps to the slider step and stays in range", () => {
    expect(clampShiftSeconds(130)).toBe(120);
    expect(clampShiftSeconds(10)).toBe(MIN_SHIFT_SECONDS);
    expect(clampShiftSeconds(9999)).toBe(MAX_SHIFT_SECONDS);
    expect(clampShiftSeconds(Number.NaN)).toBe(DEFAULT_SHIFT_SECONDS);
  });
});

describe("level ramp", () => {
  it("adds screens each level and caps at 16", () => {
    const screens = LEVELS.map((l) => l.screens);
    expect(screens).toEqual([...screens].sort((a, b) => a - b));
    expect(getLevelConfig(1).screens).toBe(1);
    expect(getLevelConfig(99).screens).toBe(16);
  });
});
