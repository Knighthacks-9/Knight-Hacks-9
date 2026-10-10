import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAZE_SETTINGS,
  GazeController,
  applyCalibration,
  fitCalibration,
  type CalibrationSample,
} from "./index";

describe("gaze calibration", () => {
  const samples: CalibrationSample[] = [
    { input: { x: 0, y: 0 }, target: { x: 0.1, y: 0.2 } },
    { input: { x: 1, y: 0 }, target: { x: 0.9, y: 0.2 } },
    { input: { x: 0, y: 1 }, target: { x: 0.1, y: 0.8 } },
    { input: { x: 1, y: 1 }, target: { x: 0.9, y: 0.8 } },
  ];

  it("fits a two-axis affine mapping from multiple samples", () => {
    const transform = fitCalibration(samples);

    expect(transform).not.toBeNull();
    expect(applyCalibration(transform!, { x: 0.5, y: 0.5 })).toEqual({
      x: expect.closeTo(0.5),
      y: expect.closeTo(0.5),
    });
  });

  it("rejects too few or collinear calibration samples", () => {
    expect(fitCalibration(samples.slice(0, 2))).toBeNull();
    expect(
      fitCalibration([
        { input: { x: 0, y: 0 }, target: { x: 0, y: 0 } },
        { input: { x: 0.5, y: 0.5 }, target: { x: 0.5, y: 0.5 } },
        { input: { x: 1, y: 1 }, target: { x: 1, y: 1 } },
      ]),
    ).toBeNull();
  });
});

describe("gaze controller", () => {
  it("uses a tracker sample first and the mouse only as an enabled fallback", () => {
    const controller = new GazeController();
    controller.setMousePoint({ x: 0.2, y: 0.3 });
    expect(controller.getSource()).toBe("mouse");
    expect(controller.getTrackerPoint()).toBeNull();

    controller.setTrackerPoint({ x: 0.8, y: 0.7 });
    expect(controller.getSource()).toBe("tracker");
    expect(controller.getTrackerPoint()).toEqual({ x: 0.8, y: 0.7 });
    expect(controller.getPoint()).toEqual({ x: 0.8, y: 0.7 });

    controller.setTrackerPoint(null);
    controller.setSettings({
      ...DEFAULT_GAZE_SETTINGS,
      useMouseFallback: false,
    });
    expect(controller.getSource()).toBe("none");
  });

  it("applies smoothing to output while preserving the raw sample", () => {
    const controller = new GazeController({
      ...DEFAULT_GAZE_SETTINGS,
      smoothing: 0.5,
    });
    controller.setMousePoint({ x: 0.2, y: 0.4 });
    expect(controller.getPoint()).toEqual({ x: 0.2, y: 0.4 });

    controller.setMousePoint({ x: 0.8, y: 0.6 });
    expect(controller.getRawPoint()).toEqual({ x: 0.8, y: 0.6 });
    expect(controller.getPoint()).toEqual({ x: 0.5, y: 0.5 });
  });

  it("resets smoothing when the active gaze source changes", () => {
    const controller = new GazeController({
      ...DEFAULT_GAZE_SETTINGS,
      smoothing: 0.8,
    });
    controller.setMousePoint({ x: 0.2, y: 0.4 });
    controller.getPoint();

    controller.setTrackerPoint({ x: 0.8, y: 0.6 });
    expect(controller.getPoint()).toEqual({ x: 0.8, y: 0.6 });
  });
});
