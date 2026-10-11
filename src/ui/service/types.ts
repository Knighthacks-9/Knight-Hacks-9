// The boundary between the KNIGHT'S EYE desktop UI and whatever runs the game
// (today: the local world sim, gaze tracker, and analytics modules on the
// event bus). Screens only talk to a NightwatchService, never to those modules
// directly, so a remote backend can replace localService.ts without UI changes.
import type { DebriefInput } from "../../audio";
import type {
  CameraDef,
  GazeSource,
  KnightStatus,
  SuspiciousBehavior,
  Vec2,
  WorldMap,
  WorldSnapshot,
} from "../../shared/types";

export interface CameraFeed {
  /** Stable id; for world feeds this is the world camera id (e.g. "cam3"). */
  id: string;
  /** On-screen label, e.g. "CAM_03". */
  label: string;
  location: string;
  /** Live stream URL, when a backend provides one. Not used by the local sim. */
  streamUrl?: string;
  /** Still image for placeholder feeds (drawn with the CCTV treatment). */
  imageUrl?: string;
  online: boolean;
  /** World camera this feed shows. Absent for placeholder (mock) feeds. */
  source?: CameraDef;
}

export interface LevelConfig {
  level: number;
  cameraCount: 2 | 4 | 6 | 9;
  expectedAnomalies: number;
}

export interface ShiftConfig extends LevelConfig {
  durationSeconds: number;
  /**
   * True when the player chose the anomaly count: the shift has exactly
   * expectedAnomalies. Otherwise long shifts can add more.
   */
  fixedAnomalies?: boolean;
  /** Multiplier on how fast ordinary people arrive. Defaults to 1. */
  npcSpawnRate?: number;
  /**
   * A report counts if the suspect was on that feed this many seconds ago or
   * less. Defaults to the analytics FLAG_GRACE_SECONDS (5).
   */
  reportWindowSeconds?: number;
}

export interface AnomalyReport {
  cameraId: string;
  /** Shift seconds when the player reported. */
  timestamp: number;
  source: "manual" | "voice";
  /** What the player said, for voice reports. */
  transcript?: string;
}

export interface ReportReceipt {
  /** 1-based count of reports filed this shift. */
  reportNumber: number;
  cameraId: string;
  /**
   * True when the anomaly on that feed was already reported. Nothing is
   * filed and the report doesn't count.
   */
  duplicate: boolean;
  /**
   * Ground truth for the dispatcher's investigation: the suspect this report
   * matched, or null for a false report. Never shown to the player directly.
   */
  suspect?: { npcId: string; behavior: SuspiciousBehavior } | null;
}

export interface CalibrationSettings {
  /** Gaze multiplier, 0.5–2. */
  sensitivity: number;
  /** 0–0.9 (the gaze controller's limit). */
  smoothing: number;
  mouseFallback: boolean;
  webcamEnabled: boolean;
  /** Mean calibration error at the current window size, if calibrated. */
  estimatedErrorPx?: number;
}

/** One frame of player attention, sampled by the Watch Station. */
export interface GazeObservation {
  /** Viewport position 0..1, or null when nothing is tracked. */
  x: number | null;
  y: number | null;
  source: GazeSource;
  /** Feed under the gaze point, or null when off the feeds (or on a pop-up). */
  cameraId: string | null;
  world: Vec2 | null;
}

export interface ShiftFrame {
  /** Shift seconds. */
  t: number;
  snapshot: WorldSnapshot | null;
}

/** A running shift. Created by NightwatchService.startShift. */
export interface ShiftSession {
  readonly shiftId: string;
  readonly config: ShiftConfig;
  readonly cameras: CameraFeed[];
  /** Building layout the world feeds are drawn from; null without a world. */
  readonly map: WorldMap | null;
  /** Advances the shift clock by dt seconds and returns the latest world state. */
  tick(dt: number): ShiftFrame;
  recordGaze(observation: GazeObservation): void;
  /**
   * Sends a knight after a report: to catch `npcId`, or to check the
   * feed's area when the report pointed at nobody. Returns the knight's id,
   * or null for a backend without a world.
   */
  dispatchKnight?(npcId: string | null, cameraId: string): string | null;
  /** That knight's progress; null once they've left the building. */
  knightStatus?(knightId: string): KnightStatus | null;
  /**
   * The watch is over at shift time t: nobody new walks in, and the shift is
   * scored up to t, though tick() keeps the building moving while dispatch
   * wraps up.
   */
  endWatch?(t: number): void;
}

/** A span of shift time, in seconds. */
export interface TimeSpan {
  start: number;
  end: number;
}

/** What only the UI can observe during a shift; merged into the debrief. */
export interface ShiftTelemetry {
  reports: AnomalyReport[];
  popupsDisplayed: number;
  popupsDismissed: number;
  /** When the player's gaze rested on a distraction pop-up. */
  popupGaze: TimeSpan[];
  /** Delay between each incoming dispatch transmission and the player unmuting it. */
  unmuteDelaysMs: number[];
  /** Times the player expanded a single feed. */
  focusModeUses: number;
  /** True if the webcam tracker produced gaze at any point. */
  webcamUsed: boolean;
}

export interface FeedAttention {
  cameraId: string;
  label: string;
  location: string;
  attentionPercent: number;
  watchedSeconds: number;
  missedEvents: number;
  caughtEvents: number;
  totalEvents: number;
}

export type TimelineSegmentKind = "gaze" | "anomaly" | "popup" | "off";

export interface TimelineRow {
  id: string;
  label: string;
  kind: "camera" | "off-feed" | "popup";
  segments: (TimeSpan & { kind: TimelineSegmentKind })[];
  /** Report times on this camera; `correct` is false for false reports. */
  reports: { t: number; correct: boolean }[];
}

export interface ShiftResult {
  shiftId: string;
  /** ms since epoch. */
  finishedAt: number;
  level: number;
  completed: boolean;
  passed: boolean;
  durationSeconds: number;
  score: number;
  grade: string;
  /** Best earlier score on this level, or null if this was the first. */
  personalBest: number | null;
  caught: number;
  /** Caught, but they got out before the knight arrived (a late report). */
  escaped: number;
  totalAnomalies: number;
  expectedAnomalies: number;
  missed: number;
  missedWhileLooking: number;
  falseFlags: number;
  /** Times the gaze left every feed long enough to sound the alarm. */
  attentionLapses: number;
  reportsFiled: number;
  /** 0..100 */
  detectionRate: number;
  /** 0..100, share of reports that were false. */
  falsePositiveRate: number;
  eyeTrackedPercent: number;
  eyeTrackedSeconds: number;
  /** Null when the webcam tracker was never used this shift. */
  trackingLostSeconds: number | null;
  averageReportTimeMs: number | null;
  fastestReportTimeMs: number | null;
  longestFocusStreakMs: number;
  cameraCoveragePercent: number;
  /** Gaze moves from one feed to another. */
  focusSwitches: number;
  focusModeUses: number;
  popupsDisplayed: number;
  popupsDismissed: number;
  popupReadingMs: number;
  dispatcherResponseTimeMs: number | null;
  mostWatched: string | null;
  leastWatched: string | null;
  /** Share of anomaly time spent watching a feed that showed it; null with no anomalies. */
  anomalyAttentionPercent: number | null;
  perFeedAttention: FeedAttention[];
  timeline: TimelineRow[];
  coaching: string[];
  /** What the dispatcher's end-of-shift summary may mention. */
  dispatcherDebrief?: DebriefInput;
}

export interface ShiftOutcome {
  /** False when the player ended the shift early. */
  completed: boolean;
  telemetry: ShiftTelemetry;
}

export interface NightwatchService {
  getLevels(): readonly LevelConfig[];
  getCameras(level: number): Promise<CameraFeed[]>;
  startShift(config: ShiftConfig): Promise<ShiftSession>;
  submitReport(shiftId: string, report: AnomalyReport): Promise<ReportReceipt>;
  loadCalibration(): CalibrationSettings;
  saveCalibration(settings: CalibrationSettings): Promise<void>;
  completeShift(shiftId: string, outcome: ShiftOutcome): Promise<ShiftResult>;
  /** Drops a shift without scoring it (the player closed the Watch Station). */
  abandonShift(shiftId: string): void;
  getLastResult(): Promise<ShiftResult | null>;
}
