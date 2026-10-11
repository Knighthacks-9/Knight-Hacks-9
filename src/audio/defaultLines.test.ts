import { describe, expect, it } from "vitest";
import {
  DEFAULT_LINES,
  REQUIRED_SLOTS,
  fillLine,
  placeholdersIn,
  type LineId,
  type LineSlots,
} from "./defaultLines";

const IDS = Object.keys(DEFAULT_LINES) as LineId[];

// The longest values the game can put in each slot.
const LONGEST: Required<LineSlots> = {
  CAM: "6",
  NEW_CAM: "6",
  ROOM: "an unmonitored area",
  BEHAVIOR: "entering a restricted area",
};
// All four behaviors, as the all-caught debrief lists them.
const ALL_BEHAVIORS =
  "loitering, repeatedly checking doors, entering a restricted area and avoiding the cameras";

const words = (line: string) => line.trim().split(/\s+/).length;

/** Every variant of an id, each picked by its index. */
function everyVariant(id: LineId, slots: LineSlots): string[] {
  const count = DEFAULT_LINES[id].length;
  return Array.from({ length: count }, (_, i) =>
    fillLine(id, slots, () => i / count),
  );
}

describe("default dispatcher lines", () => {
  it("has two or three variants for every id", () => {
    for (const id of IDS) {
      expect(DEFAULT_LINES[id].length, id).toBeGreaterThanOrEqual(2);
      expect(DEFAULT_LINES[id].length, id).toBeLessThanOrEqual(3);
    }
  });

  it("fills every placeholder and keeps every line to 25 words", () => {
    for (const id of IDS) {
      const slots =
        id === "debrief_all_caught"
          ? { ...LONGEST, BEHAVIOR: ALL_BEHAVIORS }
          : LONGEST;
      for (const line of everyVariant(id, slots)) {
        expect(line, id).not.toMatch(/[{}]/);
        expect(words(line), `${id}: ${line}`).toBeLessThanOrEqual(25);
      }
    }
  });

  it("has no digits outside placeholders", () => {
    for (const id of IDS) {
      for (const line of DEFAULT_LINES[id]) {
        expect(line.replace(/\{[A-Z_]+\}/g, ""), id).not.toMatch(/\d/);
      }
    }
  });

  it("only uses known placeholders", () => {
    for (const id of IDS) {
      for (const line of DEFAULT_LINES[id]) {
        const braces = line.match(/\{[^}]*\}/g) ?? [];
        expect(braces.length, line).toBe(placeholdersIn(line).length);
      }
    }
  });

  it("can always fill a line from just the slots the game guarantees", () => {
    for (const id of IDS) {
      const slots = Object.fromEntries(
        REQUIRED_SLOTS[id].map((p) => [p, LONGEST[p]]),
      ) as LineSlots;
      const fitting = DEFAULT_LINES[id].filter((line) =>
        placeholdersIn(line).every((p) => slots[p]),
      );
      expect(fitting.length, id).toBeGreaterThan(0);
      for (const line of everyVariant(id, slots)) {
        expect(line, id).not.toMatch(/[{}]/);
      }
    }
  });
});

describe("fillLine", () => {
  it("picks the variant at the random index and fills it", () => {
    const slots = { CAM: "4", ROOM: "Office B" };
    expect(fillLine("en_route", slots, () => 0)).toBe(
      "Unit en route to Office B, camera 4. Stand by.",
    );
    expect(fillLine("en_route", slots, () => 0.99)).toBe(
      DEFAULT_LINES.en_route[2]
        .replace("{ROOM}", "Office B")
        .replace("{CAM}", "4"),
    );
  });

  it("skips variants that need a slot it can't fill", () => {
    // Off camera: no NEW_CAM, so only the variant without it fits.
    for (const random of [0, 0.5, 0.99]) {
      const line = fillLine("on_scene_moved", { ROOM: "Lobby" }, () => random);
      expect(line).toContain("Lobby");
      expect(line).not.toContain("camera");
      expect(line).not.toMatch(/[{}]/);
    }
  });
});
