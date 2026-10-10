import { describe, expect, it } from "vitest";
import type { ShiftReport } from "../../shared/types";
import { buildShiftResult, gradeFor } from "./shiftResult";
import type { ShiftTelemetry } from "./types";

const cameras = [
  { id: "cam1", label: "CAM_01", location: "Lobby" },
  { id: "cam2", label: "CAM_02", location: "Hall West" },
];

const telemetry: ShiftTelemetry = {
  reports: [
    { cameraId: "cam1", timestamp: 14, source: "manual" },
    { cameraId: "cam2", timestamp: 30, source: "voice" },
  ],
  popupsDisplayed: 3,
  popupsDismissed: 2,
  popupGaze: [{ start: 40, end: 43 }],
  unmuteDelaysMs: [2000, 4000],
  focusModeUses: 1,
  webcamUsed: false,
};

const report: ShiftReport = {
  level: 1,
  duration: 60,
  completed: true,
  passed: true,
  score: 45,
  events: [
    {
      id: "ev1",
      npcId: "npc1",
      behavior: "loitering",
      start: 10,
      end: 20,
      cameraIds: ["cam1"],
      outcome: "caught",
      watchedSeconds: 6,
      flaggedAt: 14,
      reportedBehavior: null,
      reportNote: null,
    },
    {
      id: "ev2",
      npcId: "npc2",
      behavior: "restrictedZone",
      start: 40,
      end: 50,
      cameraIds: ["cam2"],
      outcome: "missed-looking",
      watchedSeconds: 2,
      flaggedAt: null,
      reportedBehavior: null,
      reportNote: null,
    },
  ],
  falseFlags: [{ t: 30, npcId: "none:cam2", cameraId: "cam2" }],
  feeds: [
    {
      cameraId: "cam1",
      watchedSeconds: 40,
      share: 0.67,
      events: 1,
      caught: 1,
      missed: 0,
    },
    {
      cameraId: "cam2",
      watchedSeconds: 12,
      share: 0.2,
      events: 1,
      caught: 0,
      missed: 1,
    },
  ],
  timeline: [
    { cameraId: "cam1", start: 0, end: 30 },
    { cameraId: "cam2", start: 30, end: 42 },
    { cameraId: null, start: 42, end: 50 },
    { cameraId: "cam1", start: 50, end: 60 },
  ],
  gazeDistance: [],
  trackerSeconds: 0,
};

describe("buildShiftResult", () => {
  const result = buildShiftResult({
    shiftId: "s1",
    report,
    cameras,
    expectedAnomalies: 3,
    telemetry,
    history: [
      {
        at: 1,
        level: 1,
        score: 30,
        passed: false,
        completed: true,
        caught: 1,
        total: 3,
        falseFlags: 1,
        duration: 60,
        avgSpan: null,
        avgDistance: null,
      },
      {
        at: 2,
        level: 2,
        score: 90,
        passed: true,
        completed: true,
        caught: 3,
        total: 3,
        falseFlags: 0,
        duration: 60,
        avgSpan: null,
        avgDistance: null,
      },
    ],
    finishedAt: 1000,
  });

  it("summarizes detection and reports", () => {
    expect(result).toMatchObject({
      grade: "F",
      caught: 1,
      totalAnomalies: 2,
      missed: 1,
      missedWhileLooking: 1,
      falseFlags: 1,
      reportsFiled: 2,
      detectionRate: 50,
      falsePositiveRate: 50,
      averageReportTimeMs: 4000,
      fastestReportTimeMs: 4000,
      dispatcherResponseTimeMs: 3000,
      popupReadingMs: 3000,
      personalBest: 30,
      cameraCoveragePercent: 100,
      mostWatched: "CAM_01 Lobby",
      leastWatched: "CAM_02 Hall West",
    });
  });

  it("measures attention", () => {
    expect(result.longestFocusStreakMs).toBe(30000);
    expect(result.focusSwitches).toBe(2);
    // ev1: 10 of 10 s on cam1; ev2: 2 of 10 s on cam2.
    expect(result.anomalyAttentionPercent).toBe(60);
    expect(result.trackingLostSeconds).toBeNull();
    expect(result.eyeTrackedPercent).toBe(0);
  });

  it("builds a timeline row per camera plus off-feed and pop-up rows", () => {
    expect(result.timeline.map((row) => row.id)).toEqual([
      "cam1",
      "cam2",
      "off-feed",
      "pop-ups",
    ]);
    const cam2 = result.timeline[1];
    expect(cam2.segments).toContainEqual({
      start: 40,
      end: 50,
      kind: "anomaly",
    });
    expect(cam2.reports).toEqual([{ t: 30, correct: false }]);
    expect(result.timeline[0].reports).toEqual([{ t: 14, correct: true }]);
  });

  it("writes coaching notes", () => {
    expect(result.coaching.length).toBeGreaterThan(0);
    expect(result.coaching.length).toBeLessThanOrEqual(3);
    expect(result.coaching[0]).toContain("CAM_02 Hall West");
  });
});

describe("gradeFor", () => {
  it("maps scores to letters", () => {
    expect([95, 85, 75, 65, 10].map(gradeFor)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "F",
    ]);
  });
});
