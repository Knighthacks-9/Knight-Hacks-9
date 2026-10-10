import mitt from "mitt";
import { describe, expect, it } from "vitest";
import type {
  AppEvents,
  GazeSample,
  ShiftReport,
  WorldEvent,
  WorldSnapshot,
} from "../shared/types";
import { startWorld } from "../world";
import { buildDebriefMarkup, createShiftAnalytics, installAnalytics } from ".";

const event = (
  id: string,
  npcId: string,
  t: number,
  cameraIds: string[] = ["cam1"],
): WorldEvent => ({
  id,
  npcId,
  behavior: "loitering",
  t,
  x: 0,
  y: 0,
  cameraIds,
});

const snapshot = (
  t: number,
  npcs: Record<string, string[]>,
): WorldSnapshot => ({
  t,
  npcs: Object.entries(npcs).map(([id, cameraIds]) => ({
    id,
    x: 0,
    y: 0,
    facingDeg: 0,
    moving: false,
    color: 0,
    cameraIds,
  })),
});

const gaze = (t: number, cameraId: string | null): GazeSample => ({
  t,
  x: 0.5,
  y: 0.5,
  source: "tracker",
  cameraId,
});

/** Feeds gaze at 10 Hz on one camera from `from` to `to` seconds. */
function look(
  analytics: ReturnType<typeof createShiftAnalytics>,
  cameraId: string | null,
  from: number,
  to: number,
) {
  for (let t = from; t <= to + 1e-9; t += 0.1)
    analytics.recordGaze(gaze(t, cameraId));
}

describe("shift analytics", () => {
  it("classifies caught, missed while looking, missed while not looking, and false flags", () => {
    const analytics = createShiftAnalytics();
    analytics.startShift({
      level: 2,
      shiftSeconds: 60,
      cameraIds: ["cam1", "cam2"],
    });
    analytics.recordSnapshot(
      snapshot(0, {
        caughtNpc: ["cam1"],
        lookedNpc: ["cam2"],
        ignoredNpc: ["cam1"],
      }),
    );
    analytics.recordEventStart(event("ev1", "caughtNpc", 1));
    analytics.recordEventStart(event("ev2", "lookedNpc", 1, ["cam2"]));
    analytics.recordEventStart(event("ev3", "ignoredNpc", 20));

    look(analytics, "cam2", 0, 5); // watches lookedNpc for 5 s but never flags
    analytics.recordFlag({ t: 6, npcId: "caughtNpc", cameraId: "cam1" });
    analytics.recordFlag({ t: 7, npcId: "caughtNpc", cameraId: "cam1" }); // repeat click
    analytics.recordFlag({ t: 8, npcId: "innocent", cameraId: "cam1" });
    look(analytics, null, 5.1, 30);
    analytics.recordEventEnd(event("ev1", "caughtNpc", 10));

    const report = analytics.endShift({ t: 60, completed: true });
    const outcome = (id: string) =>
      report.events.find((e) => e.id === id)?.outcome;
    expect(outcome("ev1")).toBe("caught");
    expect(outcome("ev2")).toBe("missed-looking");
    expect(outcome("ev3")).toBe("missed-not-looking");
    expect(report.falseFlags).toHaveLength(1);
    expect(report.score).toBe(23); // 1 of 3 caught, minus 10 for the false flag
    expect(report.passed).toBe(false);

    const cam2 = report.feeds.find((f) => f.cameraId === "cam2")!;
    expect(cam2.watchedSeconds).toBeCloseTo(5.1, 1);
    expect(cam2.missed).toBe(1);
    expect(report.trackerSeconds).toBeCloseTo(30, 0);
    expect(report.timeline.map((s) => s.cameraId)).toEqual(["cam2", null]);
  });

  it("only scores events that appeared on a feed shown this shift", () => {
    const analytics = createShiftAnalytics();
    analytics.startShift({ level: 1, shiftSeconds: 60, cameraIds: ["cam1"] });
    analytics.recordEventStart(event("offscreen", "npc1", 2, ["cam5"]));
    analytics.recordSnapshot(snapshot(3, { npc1: ["cam5"] }));
    analytics.recordEventStart(event("later", "npc2", 4, []));
    analytics.recordSnapshot(snapshot(5, { npc1: ["cam5"], npc2: ["cam1"] }));

    const report = analytics.endShift({ t: 60, completed: true });
    expect(report.events.map((e) => e.id)).toEqual(["later"]);
    expect(report.events[0].cameraIds).toEqual(["cam1"]);
  });

  it("accepts a flag shortly after the behavior ends", () => {
    const analytics = createShiftAnalytics();
    analytics.startShift({ level: 1, shiftSeconds: 60, cameraIds: ["cam1"] });
    analytics.recordEventStart(event("ev1", "npc1", 1));
    analytics.recordEventEnd(event("ev1", "npc1", 10));
    analytics.recordFlag({ t: 13, npcId: "npc1", cameraId: "cam1" });

    const report = analytics.endShift({ t: 60, completed: true });
    expect(report.events[0].outcome).toBe("caught");
    expect(report.passed).toBe(true);
    expect(buildDebriefMarkup(report)).toContain("Caught");
  });
});

describe("analytics on the event bus", () => {
  it("scores a simulated shift from the real world module", () => {
    const bus = mitt<AppEvents>();
    const stop = installAnalytics({ bus });
    const reports: ShiftReport[] = [];
    bus.on("analytics:report", (r) => reports.push(r));
    let latest: WorldSnapshot | null = null;
    bus.on("world:snapshot", (s) => (latest = s));

    // Play the game's role: start the world, tick it, watch cam1, flag on sight.
    const world = startWorld({ bus, seed: 7, shiftSeconds: 180 });
    bus.emit("shift:start", {
      level: 4,
      shiftSeconds: 180,
      cameraIds: ["cam1", "cam2", "cam3", "cam4", "cam5", "cam6"],
    });
    // NPCs that are behaving suspiciously right now.
    const suspects = new Set<string>();
    bus.on("world:suspiciousStart", (e) => suspects.add(e.npcId));
    bus.on("world:suspiciousEnd", (e) => suspects.delete(e.npcId));
    const flagged = new Set<string>();
    const dt = 1 / 20;
    for (let t = dt; t <= 180; t += dt) {
      bus.emit("sim:tick", { dt, t });
      bus.emit("gaze:sample", gaze(t, "cam2"));
      for (const npc of latest!.npcs) {
        if (
          suspects.has(npc.id) &&
          npc.cameraIds.includes("cam2") &&
          !flagged.has(npc.id)
        ) {
          flagged.add(npc.id);
          bus.emit("flag:created", { t, npcId: npc.id, cameraId: "cam2" });
        }
      }
    }
    bus.emit("shift:end", { t: 180, completed: true });
    world.stop();
    stop();

    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(report.falseFlags).toHaveLength(0);
    expect(
      report.feeds.find((f) => f.cameraId === "cam2")!.share,
    ).toBeGreaterThan(0.95);
    const outcomes = new Set(report.events.map((e) => e.outcome));
    expect(outcomes.has("caught")).toBe(true);
    for (const e of report.events) {
      // Watching only cam2: anything seen there was caught, anything else missed.
      expect(e.outcome === "caught").toBe(
        e.cameraIds.includes("cam2") && e.flaggedAt !== null,
      );
    }
  });
});
