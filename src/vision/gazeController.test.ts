import { describe, expect, it } from "vitest";
import type { GazeFeatures } from "./gazeFeatures";
import { DESIGN_KEYS, type GazeModel } from "./gazeModel";
import {
  DEFAULT_GAZE_SETTINGS,
  GazeController,
  TRACKER_HOLD_MS,
} from "./gazeController";
import { OneEuroFilter } from "./oneEuroFilter";

// Screen x = 0.5 - eyeX and screen y = 0.5 + eyeY, with everything else ignored.
// Design terms: geometry, eyeX, eyeY, openness.
const axis = (weights: number[]) => ({
  eyeGain: 3,
  alpha: 0.1,
  mean: DESIGN_KEYS.map(() => 0),
  scale: DESIGN_KEYS.map(() => 1),
  weights,
});
const MODEL: GazeModel = {
  version: 3,
  refScale: 0.12,
  x: axis([0.5, 0, -1, 0, 0]),
  y: axis([0.5, 0, 0, 1, 0]),
  validation: [],
};

function features(overrides: Partial<GazeFeatures> = {}): GazeFeatures {
  return {
    eyeX: 0,
    eyeY: 0,
    openness: 0.3,
    yaw: 0,
    pitch: 0,
    faceX: 0.5,
    faceY: 0.5,
    faceScale: 0.12,
    blink: false,
    timestamp: 1000,
    ...overrides,
  };
}

function unsmoothed(): GazeController {
  return new GazeController({ ...DEFAULT_GAZE_SETTINGS, smoothing: 0 });
}

describe("gaze controller", () => {
  it("uses the mouse until a calibration exists", () => {
    const controller = unsmoothed();
    controller.setMousePoint({ x: 0.2, y: 0.3 });
    controller.setTrackerFeatures(features({ eyeX: -0.3 }));

    expect(controller.getSource(1000)).toBe("mouse");
    expect(controller.getTrackerFeatures()?.eyeX).toBe(-0.3);
    expect(controller.getPoint(1000)).toEqual({ x: 0.2, y: 0.3 });
  });

  it("prefers calibrated tracker gaze and drops to none without a fallback", () => {
    const controller = unsmoothed();
    controller.setModel(MODEL);
    controller.setMousePoint({ x: 0.2, y: 0.3 });
    controller.setTrackerFeatures(features({ eyeX: -0.3, eyeY: -0.2 }));

    expect(controller.getSource(1000)).toBe("tracker");
    expect(controller.getPoint(1000)).toEqual({
      x: expect.closeTo(0.8),
      y: expect.closeTo(0.3),
    });

    controller.clearTracker();
    controller.setSettings({
      ...controller.getSettings(),
      useMouseFallback: false,
    });
    expect(controller.getSource(1000)).toBe("none");
    expect(controller.getPoint(1000)).toBeNull();
  });

  it("holds the last gaze through blinks and brief dropouts", () => {
    const controller = unsmoothed();
    controller.setModel(MODEL);
    controller.setMousePoint({ x: 0.2, y: 0.3 });
    controller.setTrackerFeatures(features({ eyeX: -0.3, timestamp: 1000 }));
    controller.setTrackerFeatures(
      features({ eyeX: 0.4, blink: true, timestamp: 1100 }),
    );

    expect(controller.isBlinking()).toBe(true);
    expect(controller.getRawPoint(1100)?.x).toBeCloseTo(0.8);

    controller.setTrackerFeatures(null);
    expect(controller.getSource(1000 + TRACKER_HOLD_MS)).toBe("tracker");
    expect(controller.getSource(1001 + TRACKER_HOLD_MS)).toBe("mouse");
  });

  it("smooths jitter, converges on steady gaze, and resets on source change", () => {
    const controller = new GazeController({
      ...DEFAULT_GAZE_SETTINGS,
      smoothing: 0.5,
    });
    controller.setMousePoint({ x: 0.2, y: 0.4 });
    expect(controller.getPoint(0)).toEqual({ x: 0.2, y: 0.4 });

    controller.setMousePoint({ x: 0.8, y: 0.6 });
    const first = controller.getPoint(16)!;
    expect(first.x).toBeGreaterThan(0.2);
    expect(first.x).toBeLessThan(0.8);

    let point = first;
    for (let time = 32; time <= 3000; time += 16) {
      point = controller.getPoint(time)!;
    }
    expect(point.x).toBeCloseTo(0.8, 2);
    expect(point.y).toBeCloseTo(0.6, 2);

    controller.setModel(MODEL);
    controller.setTrackerFeatures(features({ eyeX: 0.3, timestamp: 3000 }));
    expect(controller.getPoint(3016)?.x).toBeCloseTo(0.2);
  });
});

describe("one euro filter", () => {
  it("ignores repeated reads at the same timestamp", () => {
    const filter = new OneEuroFilter(1, 0.5);
    filter.filter(0, 0);
    const moved = filter.filter(1, 16);
    expect(filter.filter(5, 16)).toBe(moved);
  });
});
