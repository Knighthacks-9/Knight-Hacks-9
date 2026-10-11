// NightwatchService backed by this repo's own modules: the world sim
// (src/world), analytics (src/analytics), and the gaze controller
// (src/vision), all reached through their public index.ts and the event bus.
//
// INTEGRATION POINTS (search for "INTEGRATION"): to move a piece to a remote
// backend, replace the marked call and keep the NightwatchService contract.
import type { Emitter } from "mitt";
import { FLAG_GRACE_SECONDS, loadHistory } from "../../analytics";
import { debriefInput } from "../../audio";
import { eventBus } from "../../shared/eventBus";
import type {
  AppEvents,
  ShiftReport,
  SuspiciousBehavior,
  WorldEvent,
  WorldMap,
  WorldSnapshot,
} from "../../shared/types";
import {
  DEFAULT_GAZE_SETTINGS,
  gazeController,
  mediaPipeGazeTracker,
  validationErrorPx,
} from "../../vision";
import { buildMap, startWorld, type WorldHandle } from "../../world";
import { buildShiftResult } from "./shiftResult";
import type {
  AnomalyReport,
  CalibrationSettings,
  CameraFeed,
  LevelConfig,
  NightwatchService,
  ReportReceipt,
  ShiftConfig,
  ShiftFrame,
  ShiftResult,
  ShiftSession,
} from "./types";

export const LEVELS: readonly LevelConfig[] = [
  { level: 1, cameraCount: 4, expectedAnomalies: 3 },
  { level: 2, cameraCount: 6, expectedAnomalies: 5 },
  // Same six cameras as level 2 (the world has six), with more anomalies.
  { level: 3, cameraCount: 6, expectedAnomalies: 8 },
];

export function levelConfig(level: number): LevelConfig {
  return LEVELS[Math.min(Math.max(Math.round(level), 1), LEVELS.length) - 1];
}

const BEHAVIORS: SuspiciousBehavior[] = [
  "loitering",
  "revisitingDoors",
  "restrictedZone",
  "avoidingCameras",
];

/**
 * How many suspicious events the world schedules on its own. Mirrors
 * WorldSim.buildSchedule in src/world/sim.ts; the adapter tops up to the
 * level's expected count with the world's public spawnSuspicious().
 */
function worldEventCount(shiftSeconds: number): number {
  return Math.max(3, Math.round(shiftSeconds / 40));
}

const SETTINGS_KEY = "night-watch:gaze-settings";
const POINTER_ERROR_KEY = "night-watch:pointer-calibration-error";
const LAST_RESULT_KEY = "night-watch:last-debrief";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function feedLabel(index: number): string {
  return `CAM_${String(index + 1).padStart(2, "0")}`;
}

function camerasFor(map: WorldMap, count: number): CameraFeed[] {
  return map.cameras.slice(0, count).map((camera, i) => ({
    id: camera.id,
    label: feedLabel(i),
    location: camera.name,
    online: true,
    source: camera,
  }));
}

function trackerActive(): boolean {
  const phase = mediaPipeGazeTracker.getStatus().phase;
  return phase === "running" || phase === "no-face" || phase === "no-eyes";
}

interface TrackedEvent {
  npcId: string;
  behavior: SuspiciousBehavior;
  start: number;
  end: number | null;
  /** Last shift second each camera saw the suspect. */
  seenOn: Map<string, number>;
  reported: boolean;
}

interface LocalShift extends ShiftSession {
  world: WorldHandle;
  t: number;
  snapshot: WorldSnapshot | null;
  events: Map<string, TrackedEvent>;
  extraSpawns: number[];
  reportCount: number;
  report: ShiftReport | null;
  stop(): void;
}

function readJson(key: string): unknown {
  try {
    const stored = globalThis.localStorage?.getItem(key);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Could not save ${key}.`, error);
  }
}

export function createLocalNightwatchService(
  bus: Emitter<AppEvents> = eventBus,
): NightwatchService {
  let active: LocalShift | null = null;
  let nextShift = 1;

  function requireShift(shiftId: string): LocalShift {
    if (!active || active.shiftId !== shiftId) {
      throw new Error(`Shift ${shiftId} is not running.`);
    }
    return active;
  }

  function stopActive(): void {
    active?.stop();
    active = null;
  }

  /** Picks the suspect a camera report refers to, if any. */
  function resolveReport(shift: LocalShift, cameraId: string, t: number) {
    let best: [string, TrackedEvent] | null = null;
    let duplicate: TrackedEvent | null = null;
    for (const entry of shift.events) {
      const event = entry[1];
      const active =
        t >= event.start &&
        (event.end === null || t <= event.end + FLAG_GRACE_SECONDS);
      const seen = event.seenOn.get(cameraId);
      if (!active || seen === undefined || t - seen > FLAG_GRACE_SECONDS) {
        continue;
      }
      if (event.reported) duplicate ??= event;
      else if (!best || event.start > best[1].start) best = entry;
    }
    return best?.[1] ?? duplicate;
  }

  return {
    getLevels: () => LEVELS,

    async getCameras(level) {
      // INTEGRATION: camera list. A remote backend would return stream URLs.
      return camerasFor(buildMap(), levelConfig(level).cameraCount);
    },

    async startShift(config: ShiftConfig) {
      stopActive();
      const shiftId = `shift-${Date.now().toString(36)}-${nextShift++}`;
      const events = new Map<string, TrackedEvent>();
      let map: WorldMap | null = null;
      const stops: (() => void)[] = [];
      const listen = <K extends keyof AppEvents>(
        type: K,
        handler: (payload: AppEvents[K]) => void,
      ) => {
        bus.on(type, handler);
        stops.push(() => bus.off(type, handler));
      };

      // INTEGRATION: the local world sim. startWorld emits world:map
      // synchronously, so listen before starting it.
      const onMap = (m: WorldMap) => (map = m);
      bus.on("world:map", onMap);
      const world = startWorld({ shiftSeconds: config.durationSeconds, bus });
      bus.off("world:map", onMap);
      if (!map) throw new Error("The world did not publish its map.");
      const cameras = camerasFor(map, config.cameraCount);

      const extra = Math.max(
        0,
        config.expectedAnomalies - worldEventCount(config.durationSeconds),
      );
      const from = config.durationSeconds * 0.1;
      const to = Math.max(
        from + 1,
        config.durationSeconds -
          Math.min(
            45,
            Math.max(config.durationSeconds - 45, config.durationSeconds * 0.3),
          ),
      );
      const extraSpawns = Array.from(
        { length: extra },
        (_, i) =>
          from + ((i + 0.2 + Math.random() * 0.6) / extra) * (to - from),
      );

      const shift: LocalShift = {
        shiftId,
        config: { ...config },
        cameras,
        map,
        world,
        t: 0,
        snapshot: null,
        events,
        extraSpawns,
        reportCount: 0,
        report: null,
        tick(dt) {
          while (shift.extraSpawns.length && shift.extraSpawns[0] <= shift.t) {
            shift.extraSpawns.shift();
            world.spawnSuspicious(
              BEHAVIORS[Math.floor(Math.random() * BEHAVIORS.length)],
            );
          }
          shift.t += dt;
          bus.emit("sim:tick", { dt, t: shift.t }); // world replies with world:snapshot
          return { t: shift.t, snapshot: shift.snapshot } satisfies ShiftFrame;
        },
        recordGaze(observation) {
          bus.emit("gaze:sample", { t: shift.t, ...observation });
        },
        stop() {
          world.stop();
          stops.forEach((stop) => stop());
        },
      };

      listen("world:snapshot", (snapshot) => {
        shift.snapshot = snapshot;
        const where = new Map(snapshot.npcs.map((n) => [n.id, n.cameraIds]));
        for (const event of events.values()) {
          if (event.end !== null && snapshot.t > event.end + FLAG_GRACE_SECONDS)
            continue;
          for (const id of where.get(event.npcId) ?? [])
            event.seenOn.set(id, snapshot.t);
        }
      });
      const onEvent = (event: WorldEvent) => {
        const tracked = events.get(event.id);
        if (tracked) {
          tracked.end = event.t;
        } else {
          events.set(event.id, {
            npcId: event.npcId,
            behavior: event.behavior,
            start: event.t,
            end: null,
            seenOn: new Map(),
            reported: false,
          });
        }
        const record = events.get(event.id)!;
        for (const id of event.cameraIds) record.seenOn.set(id, event.t);
      };
      listen("world:suspiciousStart", onEvent);
      listen("world:suspiciousEnd", onEvent);
      listen("analytics:report", (report) => (shift.report = report));

      active = shift;
      bus.emit("shift:start", {
        level: config.level,
        shiftSeconds: config.durationSeconds,
        cameraIds: cameras.map((c) => c.id),
      });
      return shift;
    },

    async submitReport(shiftId, report: AnomalyReport) {
      const shift = requireShift(shiftId);
      const t = report.timestamp;
      // INTEGRATION: report submission. The analytics module scores flags by
      // suspect, so a camera report is matched to the suspect that camera saw.
      const event = resolveReport(shift, report.cameraId, t);
      // The only suspect on that feed was already reported: don't file it
      // again, so the same anomaly can't be reported over and over.
      if (event?.reported) {
        return {
          reportNumber: shift.reportCount,
          cameraId: report.cameraId,
          duplicate: true,
        } satisfies ReportReceipt;
      }
      if (event) event.reported = true;
      bus.emit("flag:created", {
        t,
        cameraId: report.cameraId,
        // No suspect on that feed: a sentinel id analytics files as a false report.
        npcId: event?.npcId ?? `none:${report.cameraId}`,
        note: report.transcript,
      });
      shift.reportCount += 1;
      return {
        reportNumber: shift.reportCount,
        cameraId: report.cameraId,
        duplicate: false,
        suspect: event
          ? { npcId: event.npcId, behavior: event.behavior }
          : null,
      } satisfies ReportReceipt;
    },

    loadCalibration() {
      const stored = readJson(SETTINGS_KEY) as {
        sensitivity?: unknown;
        smoothing?: unknown;
        useMouseFallback?: unknown;
      } | null;
      const num = (
        value: unknown,
        fallback: number,
        min: number,
        max: number,
      ) =>
        typeof value === "number" && Number.isFinite(value)
          ? clamp(value, min, max)
          : fallback;
      const model = gazeController.getModel();
      const pointerError = readJson(POINTER_ERROR_KEY);
      return {
        sensitivity: num(
          stored?.sensitivity,
          DEFAULT_GAZE_SETTINGS.sensitivity,
          0.5,
          2,
        ),
        smoothing: num(
          stored?.smoothing,
          DEFAULT_GAZE_SETTINGS.smoothing,
          0,
          0.9,
        ),
        mouseFallback:
          typeof stored?.useMouseFallback === "boolean"
            ? stored.useMouseFallback
            : DEFAULT_GAZE_SETTINGS.useMouseFallback,
        webcamEnabled: trackerActive(),
        estimatedErrorPx: model
          ? validationErrorPx(model, innerWidth, innerHeight)
          : typeof pointerError === "number"
            ? pointerError
            : undefined,
      } satisfies CalibrationSettings;
    },

    async saveCalibration(settings) {
      // INTEGRATION: calibration storage. Same key the classic Phaser scene uses.
      const gaze = {
        sensitivity: settings.sensitivity,
        smoothing: settings.smoothing,
        useMouseFallback: settings.mouseFallback,
      };
      gazeController.setSettings(gaze);
      writeJson(SETTINGS_KEY, gaze);
      if (
        settings.estimatedErrorPx !== undefined &&
        !gazeController.getModel()
      ) {
        writeJson(POINTER_ERROR_KEY, Math.round(settings.estimatedErrorPx));
      }
    },

    async completeShift(shiftId, outcome) {
      const shift = requireShift(shiftId);
      // Analytics answers shift:end synchronously with analytics:report.
      bus.emit("shift:end", { t: shift.t, completed: outcome.completed });
      const report = shift.report;
      stopActive();
      if (!report) throw new Error("Analytics did not return a shift report.");
      // appendHistory already stored this shift; compare against earlier ones.
      const history = loadHistory().slice(0, -1);
      const result = buildShiftResult({
        shiftId,
        report,
        cameras: shift.cameras,
        expectedAnomalies: shift.config.expectedAnomalies,
        telemetry: outcome.telemetry,
        history,
      });
      result.dispatcherDebrief = debriefInput(report, shift.cameras);
      writeJson(LAST_RESULT_KEY, result);
      return result;
    },

    abandonShift(shiftId) {
      if (active?.shiftId === shiftId) stopActive();
    },

    async getLastResult() {
      const stored = readJson(LAST_RESULT_KEY) as ShiftResult | null;
      return stored &&
        typeof stored.grade === "string" &&
        Array.isArray(stored.perFeedAttention) &&
        Array.isArray(stored.timeline)
        ? stored
        : null;
    },
  };
}
