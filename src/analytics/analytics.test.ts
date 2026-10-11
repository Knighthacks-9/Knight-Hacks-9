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
import {
  MAX_HISTORY,
  appendHistory,
  attentionSpans,
  buildDebriefMarkup,
  clearHistory,
  createShiftAnalytics,
  installAnalytics,
  loadHistory,
  summarize,
  type HistoryStorage,
  type ShiftSummary,
} from ".";

/** In-memory stand-in for localStorage. */
function memoryStorage(): HistoryStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const summary = (overrides: Partial<ShiftSummary> = {}): ShiftSummary => ({
  at: 0,
  level: 1,
  score: 50,
  passed: true,
  completed: true,
  caught: 1,
  total: 2,
  falseFlags: 0,
  duration: 120,
  avgSpan: null,
  avgDistance: null,
  ...overrides,
});

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
    // 1 of 3 caught (33), minus 5 for the false flag and 5 for each of the
    // five 5 s attention lapses in the 25 s spent off the feeds.
    expect(report.attentionLapses).toBe(5);
    expect(report.score).toBe(3);
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

  it("scores 0 when nobody was caught, even if nobody appeared", () => {
    const analytics = createShiftAnalytics();
    analytics.startShift({ level: 1, shiftSeconds: 60, cameraIds: ["cam1"] });
    expect(analytics.endShift({ t: 60, completed: true }).score).toBe(0);

    analytics.startShift({ level: 1, shiftSeconds: 60, cameraIds: ["cam1"] });
    analytics.recordEventStart(event("ev1", "npc1", 1));
    expect(analytics.endShift({ t: 1, completed: false }).score).toBe(0);
  });

  it("still scores catches when the shift is ended early, but doesn't pass", () => {
    const analytics = createShiftAnalytics();
    analytics.startShift({ level: 1, shiftSeconds: 60, cameraIds: ["cam1"] });
    analytics.recordEventStart(event("ev1", "npc1", 1));
    analytics.recordEventStart(event("ev2", "npc2", 2));
    analytics.recordFlag({ t: 3, npcId: "npc1", cameraId: "cam1" });
    analytics.recordFlag({ t: 4, npcId: "innocent", cameraId: "cam1" });

    const report = analytics.endShift({ t: 5, completed: false });
    expect(report.score).toBe(45); // 1 of 2 caught, minus 5 for the false flag
    expect(report.passed).toBe(false);
  });

  it("counts an escaped suspect as caught but worth half the points", () => {
    const analytics = createShiftAnalytics();
    analytics.startShift({ level: 1, shiftSeconds: 60, cameraIds: ["cam1"] });
    analytics.recordEventStart(event("ev1", "npc1", 1));
    analytics.recordEventStart(event("ev2", "npc2", 2));
    analytics.recordFlag({ t: 3, npcId: "npc1", cameraId: "cam1" });
    analytics.recordFlag({ t: 4, npcId: "npc2", cameraId: "cam1" });
    analytics.recordCapture({
      knightId: "knight1",
      npcId: "npc1",
      t: 10,
      outcome: "caught",
    });
    analytics.recordCapture({
      knightId: "knight2",
      npcId: "npc2",
      t: 12,
      outcome: "escaped",
    });

    const report = analytics.endShift({ t: 60, completed: true });
    expect(report.events.map((e) => [e.outcome, e.escaped])).toEqual([
      ["caught", false],
      ["caught", true],
    ]);
    expect(report.score).toBe(75); // 1.5 of 2
    expect(report.passed).toBe(true);
  });

  it("ignores behaviors that start after the watch ended", () => {
    const analytics = createShiftAnalytics();
    analytics.startShift({ level: 1, shiftSeconds: 60, cameraIds: ["cam1"] });
    analytics.recordEventStart(event("ev1", "npc1", 1));
    analytics.recordFlag({ t: 3, npcId: "npc1", cameraId: "cam1" });
    // Dispatch is still wrapping up when another behavior starts.
    analytics.recordEventStart(event("ev2", "npc2", 65));

    const report = analytics.endShift({ t: 60, completed: true });
    expect(report.events.map((e) => e.id)).toEqual(["ev1"]);
    expect(report.score).toBe(100);
  });

  it("uses the shift's report window", () => {
    const run = (reportWindowSeconds: number) => {
      const analytics = createShiftAnalytics();
      analytics.startShift({
        level: 1,
        shiftSeconds: 60,
        cameraIds: ["cam1"],
        reportWindowSeconds,
      });
      analytics.recordEventStart(event("ev1", "npc1", 1));
      analytics.recordEventEnd(event("ev1", "npc1", 10));
      analytics.recordFlag({ t: 18, npcId: "npc1", cameraId: "cam1" });
      return analytics.endShift({ t: 60, completed: true });
    };
    expect(run(5).events[0].outcome).not.toBe("caught");
    expect(run(10).events[0].outcome).toBe("caught");
  });
});

describe("attention spans", () => {
  it("merges across brief glances and splits on real switches", () => {
    const spans = attentionSpans([
      { cameraId: "cam1", start: 0, end: 4 },
      { cameraId: "cam2", start: 4, end: 4.1 }, // glance, ignored
      { cameraId: "cam1", start: 4.1, end: 6 },
      { cameraId: null, start: 6, end: 8 }, // looked away: ends the span
      { cameraId: "cam2", start: 8, end: 11 },
    ]);
    expect(spans).toEqual([
      { cameraId: "cam1", start: 0, seconds: 6 },
      { cameraId: "cam2", start: 8, seconds: 3 },
    ]);
  });

  it("charts spans in the debrief", () => {
    const analytics = createShiftAnalytics();
    analytics.startShift({
      level: 1,
      shiftSeconds: 60,
      cameraIds: ["cam1", "cam2"],
    });
    look(analytics, "cam1", 0, 5);
    look(analytics, "cam2", 5.1, 9);
    look(analytics, "cam1", 9.1, 20);

    const markup = buildDebriefMarkup(
      analytics.endShift({ t: 20, completed: true }),
    );
    expect(markup).toContain("Attention span");
    expect(markup.match(/class="chart-point"/g)).toHaveLength(3);
  });
});

describe("gaze distance from suspects", () => {
  it("logs distance to the nearest visible suspect, null when off the feeds", () => {
    const analytics = createShiftAnalytics();
    analytics.startShift({ level: 1, shiftSeconds: 60, cameraIds: ["cam1"] });
    analytics.recordGaze({ ...gaze(0.5, "cam1"), world: { x: 0, y: 0 } }); // no suspect yet
    analytics.recordEventStart(event("ev1", "npc1", 1));
    analytics.recordSnapshot({
      t: 1,
      npcs: [
        {
          id: "npc1",
          x: 5,
          y: 5,
          facingDeg: 0,
          moving: false,
          color: 0,
          cameraIds: ["cam1"],
        },
        {
          id: "bystander",
          x: 2,
          y: 4,
          facingDeg: 0,
          moving: false,
          color: 0,
          cameraIds: ["cam1"],
        },
      ],
    });
    analytics.recordGaze({ ...gaze(1, "cam1"), world: { x: 5, y: 8 } });
    analytics.recordGaze({ ...gaze(1.1, "cam1"), world: { x: 5, y: 5 } }); // under 4 Hz, skipped
    analytics.recordGaze({ ...gaze(1.5, null), world: null });

    const report = analytics.endShift({ t: 60, completed: true });
    expect(report.gazeDistance).toEqual([
      { t: 1, tiles: 3, npcId: "npc1" },
      { t: 1.5, tiles: null, npcId: "npc1" },
    ]);
  });
});

describe("analytics on the event bus", () => {
  it("scores a simulated shift from the real world module", () => {
    const bus = mitt<AppEvents>();
    const storage = memoryStorage();
    const stop = installAnalytics({ bus, storage });
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
    expect(loadHistory(storage)).toHaveLength(1);
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

describe("shift history", () => {
  it("summarizes a report, with null averages when there is no gaze data", () => {
    const analytics = createShiftAnalytics();
    analytics.startShift({ level: 3, shiftSeconds: 60, cameraIds: ["cam1"] });
    analytics.recordEventStart(event("ev1", "npc1", 1));
    analytics.recordFlag({ t: 2, npcId: "npc1", cameraId: "cam1" });
    const empty = summarize(analytics.endShift({ t: 60, completed: true }), 5);
    expect(empty).toMatchObject({
      at: 5,
      level: 3,
      caught: 1,
      total: 1,
      score: 100,
    });
    expect(empty.avgSpan).toBeNull();
    expect(empty.avgDistance).toBeNull();

    analytics.startShift({
      level: 1,
      shiftSeconds: 60,
      cameraIds: ["cam1", "cam2"],
    });
    look(analytics, "cam1", 0, 4);
    look(analytics, "cam2", 4.1, 6);
    const watched = summarize(analytics.endShift({ t: 6, completed: true }));
    expect(watched.avgSpan).toBeCloseTo(3, 0);
  });

  it("saves, caps, and clears history, surviving bad storage", () => {
    const storage = memoryStorage();
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      appendHistory(summary({ score: i }), storage);
    }
    const history = loadHistory(storage);
    expect(history).toHaveLength(MAX_HISTORY);
    expect(history[0].score).toBe(5);

    clearHistory(storage);
    expect(loadHistory(storage)).toEqual([]);

    storage.setItem("night-watch:shift-history", "not json");
    expect(loadHistory(storage)).toEqual([]);

    const broken: HistoryStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadHistory(broken)).toEqual([]);
    expect(() => clearHistory(broken)).not.toThrow();
  });

  it("charts progress over completed shifts only", () => {
    const analytics = createShiftAnalytics();
    analytics.startShift({ level: 1, shiftSeconds: 60, cameraIds: ["cam1"] });
    const report = analytics.endShift({ t: 60, completed: true });

    expect(buildDebriefMarkup(report)).not.toContain("Your progress");
    expect(buildDebriefMarkup(report, new Map(), [summary()])).toContain(
      "Play another full shift",
    );

    const markup = buildDebriefMarkup(report, new Map(), [
      summary({ score: 40 }),
      summary({ score: 0, completed: false, passed: false }),
      summary({ score: 80 }),
    ]);
    expect(markup).toContain("Your progress");
    expect(markup).toContain("+40 vs avg");
    expect(markup).toContain("Ended early");
    // Two completed shifts, each a point on the score and catch-rate charts.
    expect(markup.match(/Shift #\d+ · /g)).toHaveLength(4);
  });
});
