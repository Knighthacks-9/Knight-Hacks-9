// Person 1: webcam, eye tracking, calibration, and mouse fallback.
// Public API for other modules. The calibration screen is a Phaser scene, so
// main.ts imports it from ./CalibrationScene directly (this index stays free of
// Phaser and can be loaded in tests).
export {
  DEFAULT_GAZE_SETTINGS,
  GazeController,
  TRACKER_HOLD_MS,
  gazeController,
  type GazePoint,
  type GazeSettings,
  type GazeSource,
} from "./gazeController";
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
export {
  mediaPipeGazeTracker,
  type TrackerPhase,
  type TrackerStatus,
} from "./MediaPipeGazeTracker";
export { attachMouseFallback } from "./mouseFallback";
