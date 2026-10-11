import type { GazeFeatures } from "./gazeFeatures";
import type { GazePoint } from "./gazeController";
import type { HeadPosition } from "./headAlignment";

/*
 * Gaze geometry. The webcam sits at the screen, roughly in its plane. The
 * player's line of sight starts at their head and points along the head's
 * direction plus the eyes' turn within the head. Where it meets the screen
 * plane is, per axis and in units of the calibration distance:
 *
 *   P = headOffset + depth * tan(headAngle + eyeGain * irisOffset)
 *
 * and screen position is close to linear in P. Head offset and depth come
 * from where the face sits in the frame and how big it is, so moving, turning
 * or leaning is accounted for by construction rather than learned from scratch.
 *
 * Only the eye gain (how far the eye turns per unit of iris offset) differs
 * much between players. It is chosen by how well each candidate predicts
 * calibration points the fit has not seen, which works best when calibration
 * includes some head movement; with none, a typical value wins.
 */

/** 2 * tan(horizontal field of view / 2) for a typical ~60° webcam. */
const FOV_FACTOR = 1.15;
const DEFAULT_ASPECT = 9 / 16;
const MAX_ANGLE = 1.2;
const DEPTH_LIMITS = [0.4, 2.5] as const;
const EYE_GAINS = [1.5, 2, 2.5, 3, 3.5, 4, 5, 6];
const PRIOR_EYE_GAIN = 3.5;
/** Relative error added per unit of |log(gain / prior)|, to break near-ties. */
const EYE_GAIN_PRIOR_WEIGHT = 0.15;

// Each axis is a ridge regression on the geometric estimate plus raw eye
// terms that soak up what the geometry misses (uneven eyes, eyelid cues).
// The geometric term is barely penalized, so when they agree (as they do in
// a still-head calibration) the fit credits the geometry, which keeps working
// when the head moves.
export const DESIGN_KEYS = ["geometry", "eyeX", "eyeY", "openness"] as const;
const GEOMETRY_PENALTY = 1e-4;
const RIDGE_ALPHAS = [0.03, 0.1, 0.3, 1];
// Smallest spread assumed for each design term, so a term that barely moved
// during calibration is not amplified wildly later.
const FEATURE_SCALE_FLOOR = [0.01, 0.01, 0.005, 0.02];
const MAX_STANDARD_SCORE = 5;
// eyeX, eyeY, openness: the features most disturbed by saccades and half-blinks.
const OUTLIER_LIMIT = 3;
const STORAGE_KEY = "night-watch:gaze-model:v3";
// Click corrections: only the most recent count, since the head drifts over
// a session. The prior keeps a few clustered clicks to a plain shift.
const MAX_CORRECTION_POINTS = 12;
const CORRECTION_PRIOR = 0.02;
const CORRECTION_SCALE_LIMITS = [0.5, 2] as const;

export const MIN_CALIBRATION_POINTS = 4;

export interface CalibrationSample {
  features: GazeFeatures;
  target: GazePoint;
}

export interface GazeValidationPoint {
  target: GazePoint;
  /** Where the model predicts this point when fitted without it. */
  predicted: GazePoint;
}

/** One screen axis: a ridge fit over DESIGN_KEYS. */
export interface GazeAxisModel {
  /** Radians of eye turn per eye-width of iris offset. */
  eyeGain: number;
  alpha: number;
  mean: number[];
  scale: number[];
  /** Bias followed by one weight per design term. */
  weights: number[];
}

export interface GazeModel {
  version: 3;
  /** Yaw-corrected face scale at the calibration distance (depth 1). */
  refScale: number;
  /**
   * Where the head sat while calibrating. The face is kept in view relative
   * to this, so it works at whatever distance the camera is (a phone held
   * close, a laptop at arm's length). Older calibrations lack it.
   */
  head?: HeadPosition;
  x: GazeAxisModel;
  y: GazeAxisModel;
  validation: GazeValidationPoint[];
  /** Fine-tuning from the player's clicks, applied after the fitted model. */
  correction?: GazeCorrection;
}

export interface GazeCorrection {
  /** Each click: where the model put the gaze, and where the player looked. */
  points: GazeValidationPoint[];
  /** Per axis: corrected = scale * predicted + offset. */
  x: { scale: number; offset: number };
  y: { scale: number; offset: number };
}

type Axis = "x" | "y";

interface RidgeFit {
  mean: number[];
  scale: number[];
  weights: number[];
}

interface PointGroup {
  target: GazePoint;
  frames: GazeFeatures[];
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Eye distance in the frame, undoing the narrowing from a turned head. */
function frontalScale(features: GazeFeatures): number {
  return features.faceScale / Math.max(Math.cos(features.yaw), 0.5);
}

/** Distance from the camera relative to calibration (1 = same distance). */
function depthOf(features: GazeFeatures, refScale: number): number {
  return clamp(
    refScale / Math.max(frontalScale(features), 1e-4),
    ...DEPTH_LIMITS,
  );
}

/**
 * Where the line of sight meets the screen plane along one axis, in units of
 * the calibration distance and image directions (x right, y down).
 */
export function gazeGeometry(
  features: GazeFeatures,
  axis: Axis,
  eyeGain: number,
  refScale: number,
): number {
  const depth = depthOf(features, refScale);
  const angle = clamp(
    axis === "x"
      ? features.yaw + eyeGain * features.eyeX
      : features.pitch + eyeGain * features.eyeY,
    -MAX_ANGLE,
    MAX_ANGLE,
  );
  const offset =
    axis === "x"
      ? (features.faceX - 0.5) * FOV_FACTOR
      : (features.faceY - 0.5) *
        FOV_FACTOR *
        (features.frameAspect ?? DEFAULT_ASPECT);
  return depth * (offset + Math.tan(angle));
}

function designRow(
  features: GazeFeatures,
  axis: Axis,
  eyeGain: number,
  refScale: number,
): number[] {
  return [
    gazeGeometry(features, axis, eyeGain, refScale),
    features.eyeX,
    features.eyeY,
    features.openness,
  ];
}

function solveLinearSystem(
  matrix: number[][],
  values: number[],
): number[] | null {
  const size = values.length;
  const rows = matrix.map((row, index) => [...row, values[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(rows[pivot][column]) < 1e-10) return null;

    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let entry = column; entry <= size; entry += 1) {
      rows[column][entry] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let entry = column; entry <= size; entry += 1) {
        rows[row][entry] -= factor * rows[column][entry];
      }
    }
  }

  return rows.map((row) => row[size]);
}

function fitRidge(
  rows: number[][],
  targets: number[],
  alpha: number,
): RidgeFit | null {
  const count = rows.length;
  const featureCount = DESIGN_KEYS.length;
  if (count === 0) return null;

  const mean = Array.from(
    { length: featureCount },
    (_, j) => rows.reduce((sum, row) => sum + row[j], 0) / count,
  );
  const scale = mean.map((average, j) => {
    const variance =
      rows.reduce((sum, row) => sum + (row[j] - average) ** 2, 0) / count;
    return Math.max(Math.sqrt(variance), FEATURE_SCALE_FLOOR[j]);
  });

  const size = featureCount + 1;
  const normal = Array.from({ length: size }, () =>
    new Array<number>(size).fill(0),
  );
  const sums = new Array<number>(size).fill(0);
  rows.forEach((row, index) => {
    const z = [1, ...row.map((value, j) => (value - mean[j]) / scale[j])];
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) normal[r][c] += z[r] * z[c];
      sums[r] += z[r] * targets[index];
    }
  });
  // Penalize the raw eye terms, barely the geometry, and never the bias.
  normal[1][1] += GEOMETRY_PENALTY * count;
  for (let j = 2; j < size; j += 1) normal[j][j] += alpha * count;

  const weights = solveLinearSystem(normal, sums);
  return weights ? { mean, scale, weights } : null;
}

function predictRow(fit: RidgeFit, row: number[]): number {
  let value = fit.weights[0];
  row.forEach((entry, j) => {
    const z = clamp(
      (entry - fit.mean[j]) / fit.scale[j],
      -MAX_STANDARD_SCORE,
      MAX_STANDARD_SCORE,
    );
    value += fit.weights[j + 1] * z;
  });
  return value;
}

/** Drops frames whose eye measurements sit far from the rest of that point's frames. */
function rejectOutliers(frames: GazeFeatures[]): GazeFeatures[] {
  const checks = (["eyeX", "eyeY", "openness"] as const).map((key, j) => {
    const values = frames.map((f) => f[key]);
    const center = median(values);
    const spread = median(values.map((value) => Math.abs(value - center)));
    const floor = FEATURE_SCALE_FLOOR[j + 1];
    return {
      key,
      center,
      limit: OUTLIER_LIMIT * Math.max(1.4826 * spread, floor),
    };
  });
  const kept = frames.filter((f) =>
    checks.every(
      ({ key, center, limit }) => Math.abs(f[key] - center) <= limit,
    ),
  );
  return kept.length >= 3 ? kept : frames;
}

function groupSamples(samples: CalibrationSample[]): PointGroup[] {
  const groups = new Map<string, PointGroup>();
  for (const { features, target } of samples) {
    if (
      features.blink ||
      ![
        features.eyeX,
        features.eyeY,
        features.openness,
        features.yaw,
        features.pitch,
        features.faceX,
        features.faceY,
        features.faceScale,
      ].every(Number.isFinite) ||
      !(features.faceScale > 0) ||
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y)
    ) {
      continue;
    }
    const key = `${target.x.toFixed(4)},${target.y.toFixed(4)}`;
    const group = groups.get(key) ?? { target: { ...target }, frames: [] };
    group.frames.push(features);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    target: group.target,
    frames: rejectOutliers(group.frames),
  }));
}

interface AxisChoice {
  model: GazeAxisModel;
  /** Held-out mean prediction for each group, in group order. */
  heldOut: number[];
}

/**
 * Picks the eye gain and ridge strength for one axis by leaving out one
 * calibration point at a time, then fits on everything. Errors are averaged
 * over each held-out point's frames, so a head-sweep point whose frames the
 * fit cannot follow counts against that gain.
 */
function fitAxis(
  groups: PointGroup[],
  axis: Axis,
  refScale: number,
): AxisChoice | null {
  let best: {
    eyeGain: number;
    alpha: number;
    score: number;
    heldOut: number[];
  } | null = null;

  for (const eyeGain of EYE_GAINS) {
    const rowsByGroup = groups.map((group) =>
      group.frames.map((f) => designRow(f, axis, eyeGain, refScale)),
    );
    const prior =
      1 + EYE_GAIN_PRIOR_WEIGHT * Math.abs(Math.log(eyeGain / PRIOR_EYE_GAIN));
    for (const alpha of RIDGE_ALPHAS) {
      const heldOut: number[] = [];
      let error = 0;
      for (let held = 0; held < groups.length; held += 1) {
        const rows: number[][] = [];
        const targets: number[] = [];
        groups.forEach((group, g) => {
          if (g === held) return;
          for (const row of rowsByGroup[g]) {
            rows.push(row);
            targets.push(group.target[axis]);
          }
        });
        const fit = fitRidge(rows, targets, alpha);
        if (!fit) break;
        const goal = groups[held].target[axis];
        const predictions = rowsByGroup[held].map((row) =>
          predictRow(fit, row),
        );
        heldOut.push(
          predictions.reduce((sum, p) => sum + p, 0) / predictions.length,
        );
        error +=
          predictions.reduce((sum, p) => sum + (p - goal) ** 2, 0) /
          predictions.length;
      }
      if (heldOut.length !== groups.length) continue;
      const score = (error / groups.length) * prior;
      if (!best || score < best.score) {
        best = { eyeGain, alpha, score, heldOut };
      }
    }
  }
  if (!best) return null;

  const rows: number[][] = [];
  const targets: number[] = [];
  for (const group of groups) {
    for (const f of group.frames) {
      rows.push(designRow(f, axis, best.eyeGain, refScale));
      targets.push(group.target[axis]);
    }
  }
  const fit = fitRidge(rows, targets, best.alpha);
  if (!fit) return null;
  return {
    model: { eyeGain: best.eyeGain, alpha: best.alpha, ...fit },
    heldOut: best.heldOut,
  };
}

/**
 * Fits the gaze model from calibration frames. Each held-out point's
 * prediction is kept as an honest estimate of accuracy at unseen points.
 */
export function fitGazeModel(samples: CalibrationSample[]): GazeModel | null {
  const groups = groupSamples(samples);
  if (groups.length < MIN_CALIBRATION_POINTS) return null;

  const refScale = median(
    groups.flatMap((group) => group.frames.map(frontalScale)),
  );
  if (!(refScale > 0)) return null;
  const x = fitAxis(groups, "x", refScale);
  const y = fitAxis(groups, "y", refScale);
  if (!x || !y) return null;
  const frames = groups.flatMap((group) => group.frames);
  const typical = (read: (f: GazeFeatures) => number) =>
    median(frames.map(read));
  return {
    version: 3,
    refScale,
    head: {
      x: typical((f) => f.faceX),
      y: typical((f) => f.faceY),
      scale: typical((f) => f.faceScale),
      yaw: typical((f) => f.yaw),
      pitch: typical((f) => f.pitch),
    },
    x: x.model,
    y: y.model,
    validation: groups.map((group, i) => ({
      target: group.target,
      predicted: { x: x.heldOut[i], y: y.heldOut[i] },
    })),
  };
}

/** The fitted model's estimate, before any click corrections. */
export function predictUncorrectedGaze(
  model: GazeModel,
  features: GazeFeatures,
): GazePoint {
  return {
    x: predictRow(
      model.x,
      designRow(features, "x", model.x.eyeGain, model.refScale),
    ),
    y: predictRow(
      model.y,
      designRow(features, "y", model.y.eyeGain, model.refScale),
    ),
  };
}

/** Screen position (0..1 of the canvas, may fall slightly outside) for one frame. */
export function predictGaze(
  model: GazeModel,
  features: GazeFeatures,
): GazePoint {
  const point = predictUncorrectedGaze(model, features);
  const correction = model.correction;
  if (!correction) return point;
  return {
    x: correction.x.scale * point.x + correction.x.offset,
    y: correction.y.scale * point.y + correction.y.offset,
  };
}

/**
 * Fits corrected = scale * predicted + offset for one axis, pulling the scale
 * toward 1. One click gives a pure shift; clicks spread across the screen
 * can also stretch or shrink the range.
 */
function fitCorrectionAxis(
  predicted: number[],
  actual: number[],
): { scale: number; offset: number } {
  const n = predicted.length;
  const meanP = predicted.reduce((a, b) => a + b, 0) / n;
  const meanT = actual.reduce((a, b) => a + b, 0) / n;
  let spread = 0;
  let covariance = 0;
  predicted.forEach((p, i) => {
    spread += (p - meanP) ** 2;
    covariance += (p - meanP) * (actual[i] - meanT);
  });
  const scale = clamp(
    (covariance + CORRECTION_PRIOR) / (spread + CORRECTION_PRIOR),
    ...CORRECTION_SCALE_LIMITS,
  );
  return { scale, offset: meanT - scale * meanP };
}

/**
 * Adds one click correction: the player looked at `target` while the model
 * (before corrections) estimated `predicted`. Returns the updated model.
 */
export function refineGazeModel(
  model: GazeModel,
  point: GazeValidationPoint,
): GazeModel {
  const points = [...(model.correction?.points ?? []), point].slice(
    -MAX_CORRECTION_POINTS,
  );
  return {
    ...model,
    correction: {
      points,
      x: fitCorrectionAxis(
        points.map((p) => p.predicted.x),
        points.map((p) => p.target.x),
      ),
      y: fitCorrectionAxis(
        points.map((p) => p.predicted.y),
        points.map((p) => p.target.y),
      ),
    },
  };
}

/** The model without any click corrections. */
export function clearGazeCorrection(model: GazeModel): GazeModel {
  const rest = { ...model };
  delete rest.correction;
  return rest;
}

/** Mean held-out calibration error in pixels for a canvas of the given size. */
export function validationErrorPx(
  model: GazeModel,
  width: number,
  height: number,
): number {
  if (!model.validation.length) return Infinity;
  const total = model.validation.reduce(
    (sum, { target, predicted }) =>
      sum +
      Math.hypot(
        (predicted.x - target.x) * width,
        (predicted.y - target.y) * height,
      ),
    0,
  );
  return total / model.validation.length;
}

function isNumberArray(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

function isPoint(value: unknown): value is GazePoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<GazePoint>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isAxisModel(value: unknown): value is GazeAxisModel {
  if (!value || typeof value !== "object") return false;
  const axis = value as Partial<GazeAxisModel>;
  const count = DESIGN_KEYS.length;
  return (
    Number.isFinite(axis.eyeGain) &&
    axis.eyeGain! > 0 &&
    Number.isFinite(axis.alpha) &&
    isNumberArray(axis.mean, count) &&
    isNumberArray(axis.scale, count) &&
    axis.scale.every((entry) => entry > 0) &&
    isNumberArray(axis.weights, count + 1)
  );
}

export function parseGazeModel(value: unknown): GazeModel | null {
  if (!value || typeof value !== "object") return null;
  const model = value as Partial<GazeModel>;
  if (
    model.version !== 3 ||
    !Number.isFinite(model.refScale) ||
    !(model.refScale! > 0) ||
    !isAxisModel(model.x) ||
    !isAxisModel(model.y) ||
    !Array.isArray(model.validation) ||
    !model.validation.every(
      (point) => isPoint(point?.target) && isPoint(point?.predicted),
    )
  ) {
    return null;
  }
  // The head position and corrections are optional extras: drop them if
  // malformed rather than losing the whole calibration.
  const { head, correction, ...core } = model as GazeModel;
  return {
    ...core,
    ...(isHeadPosition(head) ? { head } : {}),
    ...(isCorrection(correction) ? { correction } : {}),
  };
}

function isHeadPosition(value: unknown): value is HeadPosition {
  if (!value || typeof value !== "object") return false;
  const head = value as Partial<HeadPosition>;
  return (
    [head.x, head.y, head.yaw, head.pitch].every(Number.isFinite) &&
    Number.isFinite(head.scale) &&
    head.scale! > 0
  );
}

function isCorrection(value: unknown): value is GazeCorrection {
  if (!value || typeof value !== "object") return false;
  const correction = value as Partial<GazeCorrection>;
  const isAxis = (axis: unknown) =>
    !!axis &&
    typeof axis === "object" &&
    Number.isFinite((axis as GazeCorrection["x"]).scale) &&
    Number.isFinite((axis as GazeCorrection["x"]).offset);
  return (
    Array.isArray(correction.points) &&
    correction.points.every(
      (point) => isPoint(point?.target) && isPoint(point?.predicted),
    ) &&
    isAxis(correction.x) &&
    isAxis(correction.y)
  );
}

export function loadGazeModel(): GazeModel | null {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return stored ? parseGazeModel(JSON.parse(stored)) : null;
  } catch (error) {
    console.error("Could not load gaze calibration.", error);
    return null;
  }
}

export function saveGazeModel(model: GazeModel | null): boolean {
  try {
    if (model) {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
    } else {
      globalThis.localStorage.removeItem(STORAGE_KEY);
    }
    return true;
  } catch (error) {
    console.error("Could not save gaze calibration.", error);
    return false;
  }
}
