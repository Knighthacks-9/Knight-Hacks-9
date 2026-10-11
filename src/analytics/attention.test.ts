import { describe, expect, it } from "vitest";
import type { GazeSource } from "../shared/types";
import { ATTENTION_LAPSE_SECONDS, AttentionWatch } from "./attention";

/** Feeds samples every 0.1 s; returns the times a lapse fired. */
function run(
  watch: AttentionWatch,
  cameraId: string | null,
  from: number,
  to: number,
  source: GazeSource = "mouse",
): number[] {
  const fired: number[] = [];
  for (let i = 0; from + i * 0.1 <= to + 1e-9; i++) {
    const t = from + i * 0.1;
    if (watch.update({ t, source, cameraId })) fired.push(t);
  }
  return fired;
}

describe("AttentionWatch", () => {
  it("fires once the gaze has been off the feeds for the lapse time", () => {
    const watch = new AttentionWatch();
    run(watch, "cam1", 0, 2);
    const fired = run(watch, null, 2.1, 6.9);
    expect(fired).toEqual([]);
    expect(run(watch, null, 7, 7.2)).toHaveLength(1);
    expect(watch.lapses).toBe(1);
  });

  it("fires again for every further lapse period off the feeds", () => {
    const watch = new AttentionWatch();
    run(watch, "cam1", 0, 1);
    run(watch, null, 1.1, 1 + 3 * ATTENTION_LAPSE_SECONDS + 0.2);
    expect(watch.lapses).toBe(3);
  });

  it("starts over when the gaze returns to a feed", () => {
    const watch = new AttentionWatch();
    run(watch, null, 0, 4);
    run(watch, "cam2", 4.1, 4.5);
    run(watch, null, 4.6, 8.5);
    expect(watch.lapses).toBe(0);
  });

  it("ignores pauses between samples, like a backgrounded tab", () => {
    const watch = new AttentionWatch();
    run(watch, null, 0, 3);
    run(watch, null, 30, 31);
    expect(watch.lapses).toBe(0);
  });

  it("does not count before any gaze source has worked", () => {
    const watch = new AttentionWatch();
    run(watch, null, 0, 20, "none");
    expect(watch.lapses).toBe(0);
    run(watch, "cam1", 20.1, 21);
    run(watch, null, 21.1, 27, "none"); // tracking lost after it worked
    expect(watch.lapses).toBe(1);
  });
});
