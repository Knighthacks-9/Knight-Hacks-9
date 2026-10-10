export interface GazePoint {
  x: number;
  y: number;
}

export interface CalibrationSample {
  input: GazePoint;
  target: GazePoint;
}

export interface CalibrationTransform {
  x: [number, number, number];
  y: [number, number, number];
}

export interface GazeSettings {
  sensitivity: number;
  smoothing: number;
  useMouseFallback: boolean;
}

export const DEFAULT_GAZE_SETTINGS: GazeSettings = {
  sensitivity: 1,
  smoothing: 0.2,
  useMouseFallback: true,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function solve3x3(
  matrix: number[][],
  values: number[],
): [number, number, number] | null {
  const rows = matrix.map((row, index) => [...row, values[index]]);

  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) {
        pivot = row;
      }
    }

    if (Math.abs(rows[pivot][column]) < 1e-10) {
      return null;
    }

    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let entry = column; entry < 4; entry += 1) {
      rows[column][entry] /= divisor;
    }

    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let entry = column; entry < 4; entry += 1) {
        rows[row][entry] -= factor * rows[column][entry];
      }
    }
  }

  return [rows[0][3], rows[1][3], rows[2][3]];
}

export function fitCalibration(
  samples: CalibrationSample[],
): CalibrationTransform | null {
  if (samples.length < 3) return null;

  const matrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const targetX = [0, 0, 0];
  const targetY = [0, 0, 0];

  for (const { input, target } of samples) {
    if (![input.x, input.y, target.x, target.y].every(Number.isFinite)) {
      return null;
    }
    const row = [input.x, input.y, 1];
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        matrix[r][c] += row[r] * row[c];
      }
      targetX[r] += row[r] * target.x;
      targetY[r] += row[r] * target.y;
    }
  }

  const x = solve3x3(matrix, targetX);
  const y = solve3x3(matrix, targetY);
  return x && y ? { x, y } : null;
}

export function applyCalibration(
  transform: CalibrationTransform,
  point: GazePoint,
): GazePoint {
  return {
    x: transform.x[0] * point.x + transform.x[1] * point.y + transform.x[2],
    y: transform.y[0] * point.x + transform.y[1] * point.y + transform.y[2],
  };
}

export class GazeController {
  private mousePoint: GazePoint | null = null;
  private trackerPoint: GazePoint | null = null;
  private smoothedPoint: GazePoint | null = null;
  private transform: CalibrationTransform | null = null;

  constructor(private settings: GazeSettings = { ...DEFAULT_GAZE_SETTINGS }) {}

  setSettings(settings: GazeSettings): void {
    this.settings = {
      sensitivity: clamp(
        Number.isFinite(settings.sensitivity)
          ? settings.sensitivity
          : DEFAULT_GAZE_SETTINGS.sensitivity,
        0.5,
        2,
      ),
      smoothing: clamp(
        Number.isFinite(settings.smoothing)
          ? settings.smoothing
          : DEFAULT_GAZE_SETTINGS.smoothing,
        0,
        0.9,
      ),
      useMouseFallback: settings.useMouseFallback,
    };
  }

  getSettings(): GazeSettings {
    return { ...this.settings };
  }

  setCalibration(transform: CalibrationTransform | null): void {
    this.transform = transform;
  }

  setMousePoint(point: GazePoint | null): void {
    this.mousePoint = point;
  }

  setTrackerPoint(point: GazePoint | null): void {
    this.trackerPoint = point;
  }

  getSource(): "tracker" | "mouse" | "none" {
    if (this.isValidPoint(this.trackerPoint)) return "tracker";
    if (this.settings.useMouseFallback && this.isValidPoint(this.mousePoint)) {
      return "mouse";
    }
    return "none";
  }

  getRawPoint(): GazePoint | null {
    const source = this.getSource();
    const point = source === "tracker" ? this.trackerPoint : this.mousePoint;
    return point ? { ...point } : null;
  }

  getPoint(): GazePoint | null {
    const rawPoint = this.getRawPoint();
    if (!rawPoint) return null;

    const calibrated = this.transform
      ? applyCalibration(this.transform, rawPoint)
      : rawPoint;
    const target = {
      x: clamp(0.5 + (calibrated.x - 0.5) * this.settings.sensitivity, 0, 1),
      y: clamp(0.5 + (calibrated.y - 0.5) * this.settings.sensitivity, 0, 1),
    };
    const smoothing = this.settings.smoothing;

    this.smoothedPoint = this.smoothedPoint
      ? {
          x:
            this.smoothedPoint.x +
            (target.x - this.smoothedPoint.x) * (1 - smoothing),
          y:
            this.smoothedPoint.y +
            (target.y - this.smoothedPoint.y) * (1 - smoothing),
        }
      : target;

    return { ...this.smoothedPoint };
  }

  private isValidPoint(point: GazePoint | null): point is GazePoint {
    return (
      point !== null && Number.isFinite(point.x) && Number.isFinite(point.y)
    );
  }
}

export const gazeController = new GazeController();
