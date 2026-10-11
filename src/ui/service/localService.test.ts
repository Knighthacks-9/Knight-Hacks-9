import mitt from "mitt";
import { beforeEach, describe, expect, it } from "vitest";
import { installAnalytics, type HistoryStorage } from "../../analytics";
import type { AppEvents } from "../../shared/types";
import { createLocalNightwatchService, levelConfig } from "./localService";
import type { ShiftTelemetry } from "./types";

function memoryStorage(): HistoryStorage & Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  };
}

const telemetry = (reports: ShiftTelemetry["reports"]): ShiftTelemetry => ({
  reports,
  popupsDisplayed: 0,
  popupsDismissed: 0,
  popupGaze: [],
  unmuteDelaysMs: [],
  focusModeUses: 0,
  webcamUsed: false,
});

describe("local NightwatchService", () => {
  beforeEach(() => {
    globalThis.localStorage = memoryStorage();
  });

  it("maps levels to 2, 4 and 6 real cameras", async () => {
    const service = createLocalNightwatchService(mitt<AppEvents>());
    for (const [level, count] of [
      [1, 2],
      [2, 4],
      [3, 6],
    ]) {
      const cameras = await service.getCameras(level);
      expect(cameras).toHaveLength(count);
      expect(cameras[0].label).toBe("CAM_01");
      // Every feed is a real world camera; no placeholder feeds.
      expect(cameras.every((c) => c.source)).toBe(true);
    }
    expect(levelConfig(99).level).toBe(3);
  });

  it("runs a shift end to end through the event bus", async () => {
    const bus = mitt<AppEvents>();
    const stop = installAnalytics({
      bus,
      panelId: "none",
      storage: memoryStorage(),
    });
    const service = createLocalNightwatchService(bus);
    const flags: AppEvents["flag:created"][] = [];
    bus.on("flag:created", (flag) => flags.push(flag));

    const session = await service.startShift({
      ...levelConfig(2),
      durationSeconds: 120,
    });
    expect(session.cameras.map((c) => c.id)).toEqual([
      "cam1",
      "cam2",
      "cam3",
      "cam4",
    ]);
    for (let i = 0; i < 20; i++) {
      const frame = session.tick(0.05);
      session.recordGaze({
        x: 0.2,
        y: 0.2,
        source: "mouse",
        cameraId: "cam1",
        world: null,
      });
      expect(frame.t).toBeCloseTo((i + 1) * 0.05);
    }

    // Nobody suspicious has appeared yet, so this is a false report.
    const report = {
      cameraId: "cam2",
      timestamp: 1,
      source: "manual" as const,
    };
    const receipt = await service.submitReport(session.shiftId, report);
    expect(receipt).toEqual({
      reportNumber: 1,
      cameraId: "cam2",
      duplicate: false,
      suspect: null,
    });
    expect(flags).toHaveLength(1);
    expect(flags[0].npcId).toBe("none:cam2");

    const result = await service.completeShift(session.shiftId, {
      completed: false,
      telemetry: telemetry([report]),
    });
    expect(result.falseFlags).toBe(1);
    expect(result.reportsFiled).toBe(1);
    expect(result.perFeedAttention[0]).toMatchObject({
      cameraId: "cam1",
      location: "Lobby",
    });
    expect(result.perFeedAttention[0].watchedSeconds).toBeGreaterThan(0.8);
    expect(await service.getLastResult()).toMatchObject({
      shiftId: session.shiftId,
    });
    await expect(
      service.submitReport(session.shiftId, report),
    ).rejects.toThrow();
    stop();
  });

  it("files an anomaly only once when it is reported again", async () => {
    const bus = mitt<AppEvents>();
    const service = createLocalNightwatchService(bus);
    const flags: AppEvents["flag:created"][] = [];
    bus.on("flag:created", (flag) => flags.push(flag));
    const session = await service.startShift({
      ...levelConfig(1),
      durationSeconds: 120,
    });
    session.tick(0.5);
    // A suspect starts acting up in view of cam2.
    bus.emit("world:suspiciousStart", {
      id: "test-event",
      npcId: "test-npc",
      behavior: "loitering",
      t: 0.5,
      x: 0,
      y: 0,
      cameraIds: ["cam2"],
    });

    const report = {
      cameraId: "cam2",
      timestamp: 1,
      source: "manual" as const,
    };
    const first = await service.submitReport(session.shiftId, report);
    const again = await service.submitReport(session.shiftId, {
      ...report,
      timestamp: 2,
    });

    expect(first).toMatchObject({ reportNumber: 1, duplicate: false });
    expect(again).toMatchObject({ reportNumber: 1, duplicate: true });
    expect(flags.map((f) => f.npcId)).toEqual(["test-npc"]);
    service.abandonShift(session.shiftId);
  });
});
