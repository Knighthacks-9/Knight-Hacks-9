import type { GazeFeatures } from "./gazeFeatures";
import { predictGaze, type GazeModel } from "./gazeModel";
import { OneEuroFilter } from "./oneEuroFilter";

export type { GazeFeatures } from "./gazeFeatures";
export {
  MIN_CALIBRATION_POINTS,
  fitGazeModel,
  loadGazeModel,
  predictGaze,
  saveGazeModel,
  validationErrorPx,
  type CalibrationSample,
  type GazeModel,
  type GazeValidationPoint,
} from "./gazeModel";

/** A point on the game canvas: 0..1 from left to right and top to bottom. */
export interface GazePoint {
  x: number;
  y: number;
}

export type GazeSource = "tracker" | "mouse" | "none";

export interface GazeSettings {
  sensitivity: number;
  smoothing: number;
  useMouseFallback: boolean;
}

export const DEFAULT_GAZE_SETTINGS: GazeSettings = {
  sensitivity: 1,
  smoothing: 0.5,
  useMouseFallback: true,
};

/** How long the last tracked gaze is held through blinks and dropped frames. */
export const TRACKER_HOLD_MS = 350;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Maps the 0..0.9 smoothing setting to a One Euro cutoff from 4 Hz down to 0.25 Hz. */
function minCutoffFor(smoothing: number): number {
  return 4 * Math.pow(1 / 16, smoothing / 0.9);
}

export class GazeController {
  private mousePoint: GazePoint | null = null;
  private features: GazeFeatures | null = null;
  private model: GazeModel | null = null;
  private trackerPoint: GazePoint | null = null;
  private trackerTime = -Infinity;
  private filterX = new OneEuroFilter();
  private filterY = new OneEuroFilter();
  private lastSource: GazeSource = "none";

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

  setModel(model: GazeModel | null): void {
    this.model = model;
    this.trackerPoint = null;
    this.trackerTime = -Infinity;
    if (model && this.features) this.setTrackerFeatures(this.features);
  }

  getModel(): GazeModel | null {
    return this.model;
  }

  isCalibrated(): boolean {
    return this.model !== null;
  }

  setMousePoint(point: GazePoint | null): void {
    this.mousePoint = point;
  }

  /** Latest camera frame, or null when no usable face is visible. */
  setTrackerFeatures(features: GazeFeatures | null): void {
    this.features = features;
    if (!features || features.blink || !this.model) return;
    const point = predictGaze(this.model, features);
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
      this.trackerPoint = point;
      this.trackerTime = features.timestamp;
    }
  }

  /** Forgets all tracker data immediately, e.g. when the camera stops. */
  clearTracker(): void {
    this.features = null;
    this.trackerPoint = null;
    this.trackerTime = -Infinity;
  }

  getTrackerFeatures(): GazeFeatures | null {
    return this.features ? { ...this.features } : null;
  }

  isBlinking(): boolean {
    return this.features?.blink ?? false;
  }

  getSource(now = performance.now()): GazeSource {
    if (
      this.model &&
      this.trackerPoint &&
      now - this.trackerTime <= TRACKER_HOLD_MS
    ) {
      return "tracker";
    }
    if (this.settings.useMouseFallback && this.isValidPoint(this.mousePoint)) {
      return "mouse";
    }
    return "none";
  }

  /** Unsmoothed point from the active source. */
  getRawPoint(now = performance.now()): GazePoint | null {
    const source = this.getSource(now);
    const point =
      source === "tracker"
        ? this.trackerPoint
        : source === "mouse"
          ? this.mousePoint
          : null;
    return point ? { ...point } : null;
  }

  /** Smoothed point on the canvas (0..1), or null when nothing is tracked. */
  getPoint(now = performance.now()): GazePoint | null {
    const source = this.getSource(now);
    if (source !== this.lastSource) {
      this.filterX.reset();
      this.filterY.reset();
      this.lastSource = source;
    }

    const raw = this.getRawPoint(now);
    if (!raw) return null;

    const { sensitivity, smoothing } = this.settings;
    const x = clamp(0.5 + (raw.x - 0.5) * sensitivity, 0, 1);
    const y = clamp(0.5 + (raw.y - 0.5) * sensitivity, 0, 1);
    if (smoothing <= 0) return { x, y };

    this.filterX.minCutoff = this.filterY.minCutoff = minCutoffFor(smoothing);
    return { x: this.filterX.filter(x, now), y: this.filterY.filter(y, now) };
  }

  private isValidPoint(point: GazePoint | null): point is GazePoint {
    return (
      point !== null && Number.isFinite(point.x) && Number.isFinite(point.y)
    );
  }
}

export const gazeController = new GazeController();
