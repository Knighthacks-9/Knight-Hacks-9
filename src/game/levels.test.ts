import { describe, expect, it } from "vitest";
import { LEVELS, getLevelConfig } from "./levels";

describe("level ramp", () => {
  it("adds screens each level and caps at 16", () => {
    const screens = LEVELS.map((l) => l.screens);
    expect(screens).toEqual([...screens].sort((a, b) => a - b));
    expect(getLevelConfig(1).screens).toBe(1);
    expect(getLevelConfig(99).screens).toBe(16);
  });
});
