import type { GazeFeatures } from "./gazeFeatures";
import type { GazePoint } from "./index";

export const GAZE_FEATURE_KEYS = [
  "eyeX",
  "eyeY",
  "openness",
  "yaw",
  "pitch",
  "faceX",
  "faceY",
] as const satisfies readonly (keyof GazeFeatures)[];

// Smallest spread assumed for each feature. A feature that barely moved during
// calibration would otherwise be amplified wildly when it changes later.
const FEATURE_SCALE_FLOOR = [0.01, 0.005, 0.02, 0.02, 0.02, 0.01, 0.01];
const MAX_STANDARD_SCORE = 5;
const RIDGE_ALPHAS = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1];
// eyeX, eyeY, openness: the features most disturbed by saccades and half-blinks.
const OUTLIER_FEATURES = [0, 1, 2];
const OUTLIER_LIMIT = 3;
const STORAGE_KEY = "night-watch:gaze-model:v2";

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

export interface GazeModel {
  features: string[];
  mean: number[];
  scale: number[];
  /** Bias followed by one weight per feature. */
  weightsX: number[];
  weightsY: number[];
  alpha: number;
  validation: GazeValidationPoint[];
}

interface RidgeFit {
  mean: number[];
  scale: number[];
  weightsX: number[];
  weightsY: number[];
}

interface PointGroup {
  target: GazePoint;
  rows: number[][];
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function featureVector(features: GazeFeatures): number[] {
  return GAZE_FEATURE_KEYS.map((key) => features[key]);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
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
  targets: GazePoint[],
  alpha: number,
): RidgeFit | null {
  const count = rows.length;
  const featureCount = GAZE_FEATURE_KEYS.length;
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
  const sumX = new Array<number>(size).fill(0);
  const sumY = new Array<number>(size).fill(0);

  rows.forEach((row, index) => {
    const z = [1, ...row.map((value, j) => (value - mean[j]) / scale[j])];
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) normal[r][c] += z[r] * z[c];
      sumX[r] += z[r] * targets[index].x;
      sumY[r] += z[r] * targets[index].y;
    }
  });
  // Penalize feature weights but not the bias.
  for (let j = 1; j < size; j += 1) normal[j][j] += alpha * count;

  const weightsX = solveLinearSystem(normal, sumX);
  const weightsY = solveLinearSystem(normal, sumY);
  return weightsX && weightsY ? { mean, scale, weightsX, weightsY } : null;
}

function predictVector(fit: RidgeFit, vector: number[]): GazePoint {
  let x = fit.weightsX[0];
  let y = fit.weightsY[0];
  vector.forEach((value, j) => {
    const z = clamp(
      (value - fit.mean[j]) / fit.scale[j],
      -MAX_STANDARD_SCORE,
      MAX_STANDARD_SCORE,
    );
    x += fit.weightsX[j + 1] * z;
    y += fit.weightsY[j + 1] * z;
  });
  return { x, y };
}

/** Drops frames whose eye measurements sit far from the rest of that point's frames. */
function rejectOutliers(rows: number[][]): number[][] {
  const limits = OUTLIER_FEATURES.map((j) => {
    const values = rows.map((row) => row[j]);
    const center = median(values);
    const spread = median(values.map((value) => Math.abs(value - center)));
    return {
      center,
      limit: OUTLIER_LIMIT * Math.max(1.4826 * spread, FEATURE_SCALE_FLOOR[j]),
    };
  });
  const kept = rows.filter((row) =>
    OUTLIER_FEATURES.every(
      (j, index) =>
        Math.abs(row[j] - limits[index].center) <= limits[index].limit,
    ),
  );
  return kept.length >= 3 ? kept : rows;
}

function groupSamples(samples: CalibrationSample[]): PointGroup[] {
  const groups = new Map<string, PointGroup>();
  for (const { features, target } of samples) {
    const row = featureVector(features);
    if (
      features.blink ||
      !row.every(Number.isFinite) ||
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y)
    ) {
      continue;
    }
    const key = `${target.x.toFixed(4)},${target.y.toFixed(4)}`;
    const group = groups.get(key) ?? { target: { ...target }, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    target: group.target,
    rows: rejectOutliers(group.rows),
  }));
}

function flatten(groups: PointGroup[]): {
  rows: number[][];
  targets: GazePoint[];
} {
  return {
    rows: groups.flatMap((group) => group.rows),
    targets: groups.flatMap((group) => group.rows.map(() => group.target)),
  };
}

/**
 * Fits a ridge regression from gaze features to screen position. The ridge
 * strength is chosen by leaving out one calibration point at a time, which also
 * yields an honest estimate of accuracy at points the model has not seen.
 */
export function fitGazeModel(samples: CalibrationSample[]): GazeModel | null {
  const groups = groupSamples(samples);
  if (groups.length < MIN_CALIBRATION_POINTS) return null;

  let best: {
    alpha: number;
    error: number;
    validation: GazeValidationPoint[];
  } | null = null;

  for (const alpha of RIDGE_ALPHAS) {
    const validation: GazeValidationPoint[] = [];
    let error = 0;
    for (const held of groups) {
      const training = flatten(groups.filter((group) => group !== held));
      const fit = fitRidge(training.rows, training.targets, alpha);
      if (!fit) break;
      const predictions = held.rows.map((row) => predictVector(fit, row));
      const predicted = {
        x: predictions.reduce((sum, p) => sum + p.x, 0) / predictions.length,
        y: predictions.reduce((sum, p) => sum + p.y, 0) / predictions.length,
      };
      validation.push({ target: held.target, predicted });
      error +=
        (predicted.x - held.target.x) ** 2 + (predicted.y - held.target.y) ** 2;
    }
    if (validation.length === groups.length && (!best || error < best.error)) {
      best = { alpha, error, validation };
    }
  }
  if (!best) return null;

  const all = flatten(groups);
  const fit = fitRidge(all.rows, all.targets, best.alpha);
  if (!fit) return null;
  return {
    features: [...GAZE_FEATURE_KEYS],
    ...fit,
    alpha: best.alpha,
    validation: best.validation,
  };
}

/** Screen position (0..1 of the canvas, may fall slightly outside) for one frame. */
export function predictGaze(
  model: GazeModel,
  features: GazeFeatures,
): GazePoint {
  return predictVector(model, featureVector(features));
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

export function parseGazeModel(value: unknown): GazeModel | null {
  if (!value || typeof value !== "object") return null;
  const model = value as Partial<GazeModel>;
  const featureCount = GAZE_FEATURE_KEYS.length;
  if (
    !Array.isArray(model.features) ||
    model.features.join() !== GAZE_FEATURE_KEYS.join() ||
    !isNumberArray(model.mean, featureCount) ||
    !isNumberArray(model.scale, featureCount) ||
    !model.scale.every((entry) => entry > 0) ||
    !isNumberArray(model.weightsX, featureCount + 1) ||
    !isNumberArray(model.weightsY, featureCount + 1) ||
    typeof model.alpha !== "number" ||
    !Array.isArray(model.validation) ||
    !model.validation.every(
      (point) => isPoint(point?.target) && isPoint(point?.predicted),
    )
  ) {
    return null;
  }
  return model as GazeModel;
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
