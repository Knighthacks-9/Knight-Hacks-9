import { describe, expect, it } from "vitest";
import type { GazeFeatures } from "./gazeFeatures";
import {
  clearGazeCorrection,
  fitGazeModel,
  parseGazeModel,
  predictGaze,
  predictUncorrectedGaze,
  refineGazeModel,
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

  it("needs at least four distinct calibration points", () => {
    expect(fitGazeModel(calibrationSamples(GRID.slice(0, 3)))).toBeNull();
    expect(fitGazeModel([])).toBeNull();
  });

  it("round-trips through JSON and rejects malformed data", () => {
    const model = fitGazeModel(calibrationSamples())!;
    expect(parseGazeModel(JSON.parse(JSON.stringify(model)))).toEqual(model);
    expect(parseGazeModel({ ...model, version: 2 })).toBeNull();
    expect(
      parseGazeModel({
        ...model,
        x: { ...model.x, weights: model.x.weights.slice(1) },
      }),
    ).toBeNull();
    expect(
      parseGazeModel({
        ...model,
        y: { ...model.y, scale: model.y.scale.map(() => 0) },
      }),
    ).toBeNull();
    expect(parseGazeModel(null)).toBeNull();
  });
});

// A player simulated with real geometry: the screen sits below a webcam,
// and the line of sight runs from the head along head angle + eye turn.
// Distances are in units of the calibration distance.
const SCREEN_WIDTH = 0.6;
const SCREEN_TOP = 0.05;
const SCREEN_HEIGHT = 0.34;
const FOV_FACTOR = 1.15;
const ASPECT = 9 / 16;
const EYE_DISTANCE = 0.1;

interface Head {
  faceX: number;
  faceY: number;
  depth: number;
  yaw: number;
  pitch: number;
}

const STILL: Head = { faceX: 0.5, faceY: 0.42, depth: 1, yaw: 0, pitch: 0.1 };

function lookFrom(
  head: Head,
  target: GazePoint,
  eyeGain: number,
  noise: () => number = () => 0,
): GazeFeatures {
  // Screen x grows to the player's right, which is the camera image's left.
  const px = -(target.x - 0.5) * SCREEN_WIDTH;
  const py = SCREEN_TOP + target.y * SCREEN_HEIGHT;
  const hx = (head.faceX - 0.5) * FOV_FACTOR * head.depth;
  const hy = (head.faceY - 0.5) * FOV_FACTOR * ASPECT * head.depth;
  const angleX = Math.atan((px - hx) / head.depth);
  const angleY = Math.atan((py - hy) / head.depth);
  return {
    eyeX: (angleX - head.yaw) / eyeGain + noise() * 0.004,
    eyeY: (angleY - head.pitch) / eyeGain + noise() * 0.003,
    openness: 0.3 - 0.15 * (angleY - head.pitch) + noise() * 0.005,
    yaw: head.yaw,
    pitch: head.pitch,
    faceX: head.faceX,
    faceY: head.faceY,
    faceScale: (EYE_DISTANCE / head.depth) * Math.cos(head.yaw),
    frameAspect: ASPECT,
    blink: false,
    timestamp: 0,
  };
}

const TARGETS: GazePoint[] = [
  ...GRID,
  { x: 0.3, y: 0.3 },
  { x: 0.7, y: 0.3 },
  { x: 0.7, y: 0.7 },
  { x: 0.3, y: 0.7 },
];
const SWEEPS: GazePoint[] = [
  { x: 0.5, y: 0.45 },
  { x: 0.25, y: 0.62 },
  { x: 0.75, y: 0.62 },
];

function simulatedCalibration(eyeGain: number, sweep: boolean) {
  const noise = makeNoise(11);
  const samples: CalibrationSample[] = TARGETS.flatMap((target) =>
    Array.from({ length: 25 }, () => ({
      features: lookFrom(STILL, target, eyeGain, noise),
      target,
    })),
  );
  if (sweep) {
    // Eyes on the dot while the head turns, nods, and drifts a little.
    for (const target of SWEEPS) {
      for (let i = 0; i < 60; i += 1) {
        const t = (i / 60) * Math.PI * 2;
        const head: Head = {
          faceX: 0.5 + 0.04 * Math.sin(t),
          faceY: 0.42 + 0.02 * Math.cos(t),
          depth: 1 + 0.05 * Math.sin(2 * t),
          yaw: 0.17 * Math.sin(t),
          pitch: 0.1 + 0.1 * Math.sin(2 * t),
        };
        samples.push({
          features: lookFrom(head, target, eyeGain, noise),
          target,
        });
      }
    }
  }
  return samples;
}

const MOVED_HEADS: Head[] = [
  { ...STILL, yaw: 0.2, faceX: 0.58 },
  { ...STILL, depth: 1.25, pitch: 0.22 },
  { faceX: 0.4, faceY: 0.5, depth: 0.85, yaw: -0.15, pitch: 0 },
];
const PROBES: GazePoint[] = [
  { x: 0.2, y: 0.2 },
  { x: 0.5, y: 0.5 },
  { x: 0.8, y: 0.3 },
  { x: 0.35, y: 0.85 },
];

function worstErrorWithMovedHead(
  model: NonNullable<ReturnType<typeof fitGazeModel>>,
  eyeGain: number,
): number {
  let worst = 0;
  for (const head of MOVED_HEADS) {
    for (const target of PROBES) {
      const p = predictGaze(model, lookFrom(head, target, eyeGain));
      worst = Math.max(worst, Math.hypot(p.x - target.x, p.y - target.y));
    }
  }
  return worst;
}

describe("head movement", () => {
  it("keeps up when the head turns, moves, and leans after a head sweep", () => {
    const model = fitGazeModel(simulatedCalibration(3, true))!;
    expect(worstErrorWithMovedHead(model, 3)).toBeLessThan(0.05);
  });

  it("learns an unusual eye gain from the head sweep", () => {
    const model = fitGazeModel(simulatedCalibration(2, true))!;
    expect(model.x.eyeGain).toBeCloseTo(2, 0);
    expect(worstErrorWithMovedHead(model, 2)).toBeLessThan(0.05);
  });

  it("still compensates for head movement without a sweep", () => {
    // A still-head calibration cannot measure the eye gain; a typical value
    // stands in, which is close for most players.
    const model = fitGazeModel(simulatedCalibration(3.5, false))!;
    expect(worstErrorWithMovedHead(model, 3.5)).toBeLessThan(0.06);
  });
});

describe("click corrections", () => {
  const model = fitGazeModel(calibrationSamples())!;
  const lookAt = (point: GazePoint) => playerFeatures(point);

  it("shifts the gaze by a single click's error", () => {
    const refined = refineGazeModel(model, {
      target: { x: 0.5, y: 0.5 },
      predicted: { x: 0.4, y: 0.62 },
    });
    const before = predictGaze(model, lookAt({ x: 0.5, y: 0.5 }));
    const after = predictGaze(refined, lookAt({ x: 0.5, y: 0.5 }));
    expect(after.x - before.x).toBeCloseTo(0.1, 5);
    expect(after.y - before.y).toBeCloseTo(-0.12, 5);
    // The uncorrected estimate is unchanged, for further clicks.
    expect(predictUncorrectedGaze(refined, lookAt({ x: 0.5, y: 0.5 }))).toEqual(
      before,
    );
  });

  it("stretches a squashed range with clicks across the screen", () => {
    // The model reaches only 0.3..0.7 when the player looks 0.1..0.9.
    let refined = model;
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      refined = refineGazeModel(refined, {
        target: { x: t, y: t },
        predicted: { x: 0.5 + (t - 0.5) / 2, y: 0.5 + (t - 0.5) / 2 },
      });
    }
    expect(refined.correction!.x.scale).toBeGreaterThan(1.6);
    expect(
      refined.correction!.x.scale * 0.3 + refined.correction!.x.offset,
    ).toBeCloseTo(0.1, 1);
  });

  it("keeps only recent clicks, can be cleared, and survives JSON", () => {
    let refined = model;
    for (let i = 0; i < 20; i += 1) {
      refined = refineGazeModel(refined, {
        target: { x: 0.5, y: 0.5 },
        predicted: { x: 0.45, y: 0.5 },
      });
    }
    expect(refined.correction!.points).toHaveLength(12);
    expect(parseGazeModel(JSON.parse(JSON.stringify(refined)))).toEqual(
      refined,
    );
    expect(clearGazeCorrection(refined).correction).toBeUndefined();
    // A malformed correction is dropped, not the calibration.
    expect(parseGazeModel({ ...refined, correction: { points: "x" } })).toEqual(
      clearGazeCorrection(refined),
    );
  });
});
