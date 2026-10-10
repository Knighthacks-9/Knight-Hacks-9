import { describe, expect, it } from "vitest";
import type { GazeFeatures } from "./gazeFeatures";
import {
  fitGazeModel,
  parseGazeModel,
  predictGaze,
  validationErrorPx,
  type CalibrationSample,
} from "./gazeModel";
import type { GazePoint } from "./gazeController";

const GRID: GazePoint[] = [0.1, 0.5, 0.9].flatMap((y) =>
  [0.08, 0.5, 0.92].map((x) => ({ x, y })),
);

/** Deterministic noise in -1..1. */
function makeNoise(seed = 7): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return (state / 2 ** 32) * 2 - 1;
  };
}

/**
 * A plausible player: gaze is split between eye and head movement, and the
 * camera is unmirrored, so looking right moves the iris and nose image-left.
 */
function playerFeatures(
  target: GazePoint,
  noise: () => number = () => 0,
): GazeFeatures {
  return {
    eyeX: -0.12 * (target.x - 0.5) + noise() * 0.01,
    eyeY: 0.06 * (target.y - 0.5) + noise() * 0.005,
    openness: 0.3 - 0.06 * (target.y - 0.5) + noise() * 0.01,
    yaw: -0.25 * (target.x - 0.5) + noise() * 0.01,
    pitch: 0.2 * (target.y - 0.5) + noise() * 0.01,
    faceX: 0.5 + noise() * 0.002,
    faceY: 0.45 + noise() * 0.002,
    faceScale: 0.12,
    blink: false,
    timestamp: 0,
  };
}

function calibrationSamples(
  targets: GazePoint[] = GRID,
  perPoint = 25,
): CalibrationSample[] {
  const noise = makeNoise();
  return targets.flatMap((target) =>
    Array.from({ length: perPoint }, () => ({
      features: playerFeatures(target, noise),
      target,
    })),
  );
}

describe("gaze model", () => {
  it("maps eye and head features to points it was not calibrated on", () => {
    const model = fitGazeModel(calibrationSamples());
    expect(model).not.toBeNull();

    for (const point of [
      { x: 0.3, y: 0.7 },
      { x: 0.75, y: 0.25 },
    ]) {
      const predicted = predictGaze(model!, playerFeatures(point));
      expect(predicted.x).toBeCloseTo(point.x, 1);
      expect(predicted.y).toBeCloseTo(point.y, 1);
    }
    expect(model!.validation).toHaveLength(GRID.length);
    expect(validationErrorPx(model!, 960, 540)).toBeLessThan(30);
  });

  it("ignores blink frames and stray samples", () => {
    const samples = calibrationSamples();
    for (const target of GRID) {
      const wild = { ...playerFeatures(target), eyeX: 0.4, eyeY: -0.3 };
      samples.push({ features: wild, target });
      samples.push({ features: { ...wild, eyeX: -0.4 }, target });
      samples.push({ features: { ...wild, blink: true }, target });
    }

    const model = fitGazeModel(samples);
    const predicted = predictGaze(model!, playerFeatures({ x: 0.3, y: 0.7 }));
    expect(predicted.x).toBeCloseTo(0.3, 1);
    expect(predicted.y).toBeCloseTo(0.7, 1);
  });

  it("does not overreact to a feature that never moved during calibration", () => {
    const samples = calibrationSamples().map((sample) => ({
      ...sample,
      features: { ...sample.features, faceX: 0.5 },
    }));
    const model = fitGazeModel(samples)!;
    const still = predictGaze(model, playerFeatures({ x: 0.5, y: 0.5 }));
    const shifted = predictGaze(model, {
      ...playerFeatures({ x: 0.5, y: 0.5 }),
      faceX: 0.7,
    });
    expect(Math.abs(shifted.x - still.x)).toBeLessThan(0.05);
    expect(Math.abs(shifted.y - still.y)).toBeLessThan(0.05);
  });

  it("needs at least four distinct calibration points", () => {
    expect(fitGazeModel(calibrationSamples(GRID.slice(0, 3)))).toBeNull();
    expect(fitGazeModel([])).toBeNull();
  });

  it("round-trips through JSON and rejects malformed data", () => {
    const model = fitGazeModel(calibrationSamples())!;
    expect(parseGazeModel(JSON.parse(JSON.stringify(model)))).toEqual(model);
    expect(parseGazeModel({ ...model, features: ["eyeX"] })).toBeNull();
    expect(
      parseGazeModel({ ...model, weightsX: model.weightsX.slice(1) }),
    ).toBeNull();
    expect(
      parseGazeModel({ ...model, scale: model.scale.map(() => 0) }),
    ).toBeNull();
    expect(parseGazeModel(null)).toBeNull();
  });
});
