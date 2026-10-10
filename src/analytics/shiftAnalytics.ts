import type {
  ClassifiedEvent,
  FeedStats,
  Flag,
  GazeDistanceSample,
  GazeSample,
  GazeSegment,
  ShiftEnd,
  ShiftReport,
  ShiftStart,
  Vec2,
  WorldEvent,
  WorldSnapshot,
} from "../shared/types";

/** A flag this long after a behavior ends still counts as catching it. */
export const FLAG_GRACE_SECONDS = 5;
/** Watching the suspect at least this long, without flagging, is "missed while looking". */
export const LOOKED_SECONDS = 1;
/** Points taken off the score for each innocent person flagged. */
export const FALSE_FLAG_PENALTY = 5;
/** Gaps between gaze samples longer than this (e.g. a paused tab) are not counted. */
const MAX_SAMPLE_GAP = 0.5;
/** Gaze-to-suspect distance is logged at most this often (4 Hz). */
export const DISTANCE_SAMPLE_SECONDS = 0.25;

interface OpenEvent {
  id: string;
  npcId: string;
  behavior: ClassifiedEvent["behavior"];
  start: number;
  end: number | null;
  cameraIds: Set<string>;
  watchedSeconds: number;
  flaggedAt: number | null;
}

export interface ShiftAnalytics {
  startShift(start: ShiftStart): void;
  recordSnapshot(snapshot: WorldSnapshot): void;
  recordGaze(sample: GazeSample): void;
  recordEventStart(event: WorldEvent): void;
  recordEventEnd(event: WorldEvent): void;
  recordFlag(flag: Flag): void;
  endShift(end: ShiftEnd): ShiftReport;
}

/**
 * Logs gaze, world events, and flags on one shift timeline and classifies each
 * suspicious event as caught, missed while looking, or missed because the
 * player was not looking. Only events that appeared on a feed shown this shift
 * are scored; the player had no way to see the rest.
 */
export function createShiftAnalytics(): ShiftAnalytics {
  let shift: ShiftStart = { level: 1, shiftSeconds: 0, cameraIds: [] };
  let events = new Map<string, OpenEvent>();
  let falseFlags: Flag[] = [];
  let timeline: GazeSegment[] = [];
  let dwell = new Map<string, number>();
  let trackerSeconds = 0;
  let lastGaze: GazeSample | null = null;
  let visibleOn = new Map<string, string[]>();
  let positions = new Map<string, Vec2>();
  let gazeDistance: GazeDistanceSample[] = [];

  const shown = (cameraId: string) => shift.cameraIds.includes(cameraId);
  const openEvents = () =>
    [...events.values()].filter((event) => event.end === null);

  /** Logs how far the gaze is from the nearest suspect a shown feed sees. */
  const recordDistance = (sample: GazeSample) => {
    const last = gazeDistance.at(-1);
    if (last && sample.t - last.t < DISTANCE_SAMPLE_SECONDS) return;
    const suspects = openEvents()
      .map((event) => event.npcId)
      .filter((npcId) => visibleOn.get(npcId)?.some(shown))
      .flatMap((npcId) => {
        const at = positions.get(npcId);
        return at ? [{ npcId, at }] : [];
      });
    if (suspects.length === 0) return;
    const gaze = sample.world;
    if (!gaze) {
      gazeDistance.push({ t: sample.t, tiles: null, npcId: suspects[0].npcId });
      return;
    }
    const nearest = suspects
      .map(({ npcId, at }) => ({
        npcId,
        tiles: Math.hypot(at.x - gaze.x, at.y - gaze.y),
      }))
      .reduce((a, b) => (b.tiles < a.tiles ? b : a));
    gazeDistance.push({
      t: sample.t,
      tiles: round(nearest.tiles),
      npcId: nearest.npcId,
    });
  };

  return {
    startShift(start) {
      shift = { ...start, cameraIds: [...start.cameraIds] };
      events = new Map();
      falseFlags = [];
      timeline = [];
      dwell = new Map();
      trackerSeconds = 0;
      lastGaze = null;
      visibleOn = new Map();
      positions = new Map();
      gazeDistance = [];
    },

    recordSnapshot(snapshot) {
      visibleOn = new Map(snapshot.npcs.map((npc) => [npc.id, npc.cameraIds]));
      positions = new Map(
        snapshot.npcs.map((npc) => [npc.id, { x: npc.x, y: npc.y }]),
      );
      for (const event of openEvents()) {
        for (const id of visibleOn.get(event.npcId) ?? []) {
          if (shown(id)) event.cameraIds.add(id);
        }
      }
    },

    recordGaze(sample) {
      const previous = lastGaze;
      lastGaze = sample;
      const last = timeline.at(-1);
      if (last && last.cameraId === sample.cameraId) {
        last.end = sample.t;
      } else {
        if (last) last.end = sample.t;
        timeline.push({
          cameraId: sample.cameraId,
          start: sample.t,
          end: sample.t,
        });
      }

      recordDistance(sample);

      // Credit the time since the previous sample to what was watched then.
      const dt = previous ? sample.t - previous.t : 0;
      if (!previous || dt <= 0 || dt > MAX_SAMPLE_GAP) return;
      if (previous.source === "tracker") trackerSeconds += dt;
      const watched = previous.cameraId;
      if (!watched) return;
      dwell.set(watched, (dwell.get(watched) ?? 0) + dt);
      for (const event of openEvents()) {
        if (visibleOn.get(event.npcId)?.includes(watched)) {
          event.watchedSeconds += dt;
        }
      }
    },

    recordEventStart(event) {
      events.set(event.id, {
        id: event.id,
        npcId: event.npcId,
        behavior: event.behavior,
        start: event.t,
        end: null,
        cameraIds: new Set(event.cameraIds.filter(shown)),
        watchedSeconds: 0,
        flaggedAt: null,
      });
    },

    recordEventEnd(event) {
      const open = events.get(event.id);
      if (!open) return;
      open.end = event.t;
      for (const id of event.cameraIds) if (shown(id)) open.cameraIds.add(id);
    },

    recordFlag(flag) {
      const matches = [...events.values()].filter(
        (event) =>
          event.npcId === flag.npcId &&
          flag.t >= event.start &&
          (event.end === null || flag.t <= event.end + FLAG_GRACE_SECONDS),
      );
      if (matches.some((event) => event.flaggedAt !== null)) return; // repeat click
      if (matches.length === 0) {
        falseFlags.push({ ...flag });
        return;
      }
      for (const event of matches) event.flaggedAt = flag.t;
    },

    endShift(end) {
      const duration = Math.max(end.t, 0);
      const classified: ClassifiedEvent[] = [...events.values()]
        .filter((event) => event.cameraIds.size > 0)
        .map((event) => ({
          id: event.id,
          npcId: event.npcId,
          behavior: event.behavior,
          start: event.start,
          end: event.end,
          cameraIds: [...event.cameraIds],
          outcome:
            event.flaggedAt !== null
              ? "caught"
              : event.watchedSeconds >= LOOKED_SECONDS
                ? "missed-looking"
                : "missed-not-looking",
          watchedSeconds: round(event.watchedSeconds),
          flaggedAt: event.flaggedAt,
        }));

      const feeds: FeedStats[] = shift.cameraIds.map((cameraId) => {
        const onFeed = classified.filter((e) => e.cameraIds.includes(cameraId));
        const watchedSeconds = dwell.get(cameraId) ?? 0;
        return {
          cameraId,
          watchedSeconds: round(watchedSeconds),
          share: duration > 0 ? round(watchedSeconds / duration) : 0,
          events: onFeed.length,
          caught: onFeed.filter((e) => e.outcome === "caught").length,
          missed: onFeed.filter((e) => e.outcome !== "caught").length,
        };
      });

      const caught = classified.filter((e) => e.outcome === "caught").length;
      const total = classified.length;
      // Catching nobody scores 0 (even if nobody suspicious appeared), ending
      // early or not; otherwise it's the share caught minus false flags.
      const score =
        caught === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                100,
                Math.round((100 * caught) / total) -
                  FALSE_FLAG_PENALTY * falseFlags.length,
              ),
            );
      const passed =
        end.completed &&
        caught >= Math.ceil(total / 2) &&
        falseFlags.length <= caught;

      return {
        level: shift.level,
        duration: round(duration),
        completed: end.completed,
        passed,
        score,
        events: classified,
        falseFlags: [...falseFlags],
        feeds,
        timeline: timeline.map((segment) => ({ ...segment })),
        gazeDistance: gazeDistance.map((sample) => ({ ...sample })),
        trackerSeconds: round(trackerSeconds),
      };
    },
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
