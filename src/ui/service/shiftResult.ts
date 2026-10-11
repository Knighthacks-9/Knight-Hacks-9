// Turns the analytics ShiftReport plus UI-only telemetry into the debrief.
// Pure, so it can be tested without a DOM.
import {
  ATTENTION_LAPSE_PENALTY,
  ATTENTION_LAPSE_SECONDS,
  attentionSpans,
  type ShiftSummary,
} from "../../analytics";
import type {
  ClassifiedEvent,
  GazeSegment,
  ShiftReport,
  SuspiciousBehavior,
} from "../../shared/types";
import type {
  CameraFeed,
  FeedAttention,
  ShiftResult,
  ShiftTelemetry,
  TimeSpan,
  TimelineRow,
} from "./types";

/** A feed counts as covered once it got this much attention. */
export const COVERAGE_SECONDS = 1;

export interface ShiftResultInput {
  shiftId: string;
  report: ShiftReport;
  cameras: Pick<CameraFeed, "id" | "label" | "location">[];
  expectedAnomalies: number;
  telemetry: ShiftTelemetry;
  /** Earlier shifts (not including this one). */
  history: ShiftSummary[];
  finishedAt?: number;
}

export function gradeFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const mean = (values: number[]) =>
  values.length ? sum(values) / values.length : null;
const round1 = (value: number) => Math.round(value * 10) / 10;

function overlap(a: TimeSpan, b: TimeSpan): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** Merges touching spans of the same kind so the timeline stays light. */
function compact<T extends TimeSpan>(spans: T[], minGap = 0.05): T[] {
  const out: T[] = [];
  for (const span of spans) {
    if (span.end <= span.start) continue;
    const last = out.at(-1);
    if (last && span.start - last.end <= minGap) last.end = span.end;
    else out.push({ ...span });
  }
  return out;
}

export function buildShiftResult(input: ShiftResultInput): ShiftResult {
  const { report, cameras, telemetry } = input;
  const duration = Math.max(report.duration, 0.001);
  const label = new Map(cameras.map((c) => [c.id, c]));
  const name = (id: string) => {
    const cam = label.get(id);
    return cam ? `${cam.label} ${cam.location}` : id;
  };

  const caughtEvents = report.events.filter((e) => e.outcome === "caught");
  const caught = caughtEvents.length;
  const escaped = caughtEvents.filter((e) => e.escaped).length;
  const total = report.events.length;
  const missedWhileLooking = report.events.filter(
    (e) => e.outcome === "missed-looking",
  ).length;
  const reportsFiled = telemetry.reports.length;
  const falseFlags = report.falseFlags.length;

  const perFeedAttention: FeedAttention[] = report.feeds.map((feed) => ({
    cameraId: feed.cameraId,
    label: label.get(feed.cameraId)?.label ?? feed.cameraId,
    location: label.get(feed.cameraId)?.location ?? "",
    attentionPercent: Math.round(feed.share * 100),
    watchedSeconds: feed.watchedSeconds,
    missedEvents: feed.missed,
    caughtEvents: feed.caught,
    totalEvents: feed.events,
  }));
  const watched = perFeedAttention.filter((f) => f.watchedSeconds > 0);
  const byAttention = [...perFeedAttention].sort(
    (a, b) => b.watchedSeconds - a.watchedSeconds,
  );
  const covered = perFeedAttention.filter(
    (f) => f.watchedSeconds >= COVERAGE_SECONDS,
  ).length;

  const spans = attentionSpans(report.timeline);
  const longest = Math.max(0, ...spans.map((s) => s.seconds));

  const reportTimes = caughtEvents.map(
    (e) => Math.max(0, e.flaggedAt! - e.start) * 1000,
  );

  // Time spent on a feed that showed an anomaly, while it was happening.
  let anomalySeconds = 0;
  let anomalyWatched = 0;
  for (const event of report.events) {
    const window = { start: event.start, end: event.end ?? report.duration };
    anomalySeconds += Math.max(0, window.end - window.start);
    for (const segment of report.timeline) {
      if (segment.cameraId && event.cameraIds.includes(segment.cameraId)) {
        anomalyWatched += overlap(window, segment);
      }
    }
  }

  const trackerUsed = telemetry.webcamUsed || report.trackerSeconds > 0;
  const popupReadingMs =
    sum(telemetry.popupGaze.map((s) => s.end - s.start)) * 1000;
  const levelHistory = input.history.filter((h) => h.level === report.level);
  const personalBest = levelHistory.length
    ? Math.max(...levelHistory.map((h) => h.score))
    : null;

  const result: ShiftResult = {
    shiftId: input.shiftId,
    finishedAt: input.finishedAt ?? Date.now(),
    level: report.level,
    completed: report.completed,
    passed: report.passed,
    durationSeconds: report.duration,
    score: report.score,
    grade: gradeFor(report.score),
    personalBest,
    caught,
    escaped,
    totalAnomalies: total,
    expectedAnomalies: input.expectedAnomalies,
    missed: total - caught,
    missedWhileLooking,
    falseFlags,
    attentionLapses: report.attentionLapses,
    reportsFiled,
    detectionRate: total ? Math.round((100 * caught) / total) : 0,
    falsePositiveRate: reportsFiled
      ? Math.round((100 * falseFlags) / reportsFiled)
      : 0,
    eyeTrackedPercent: Math.round((100 * report.trackerSeconds) / duration),
    eyeTrackedSeconds: report.trackerSeconds,
    trackingLostSeconds: trackerUsed
      ? round1(Math.max(0, report.duration - report.trackerSeconds))
      : null,
    averageReportTimeMs: mean(reportTimes),
    fastestReportTimeMs: reportTimes.length ? Math.min(...reportTimes) : null,
    longestFocusStreakMs: longest * 1000,
    cameraCoveragePercent: perFeedAttention.length
      ? Math.round((100 * covered) / perFeedAttention.length)
      : 0,
    focusSwitches: Math.max(0, spans.length - 1),
    focusModeUses: telemetry.focusModeUses,
    popupsDisplayed: telemetry.popupsDisplayed,
    popupsDismissed: telemetry.popupsDismissed,
    popupReadingMs,
    dispatcherResponseTimeMs: mean(telemetry.unmuteDelaysMs),
    mostWatched: watched.length ? name(byAttention[0].cameraId) : null,
    leastWatched: watched.length ? name(byAttention.at(-1)!.cameraId) : null,
    anomalyAttentionPercent:
      anomalySeconds > 0
        ? Math.round((100 * anomalyWatched) / anomalySeconds)
        : null,
    perFeedAttention,
    timeline: buildTimeline(report, cameras, telemetry.popupGaze),
    coaching: [],
  };
  result.coaching = [
    ...coachingNotes(result),
    ...missedAnomalyNotes(report, cameras),
  ];
  return result;
}

function buildTimeline(
  report: ShiftReport,
  cameras: Pick<CameraFeed, "id" | "label" | "location">[],
  popupGaze: TimeSpan[],
): TimelineRow[] {
  const caughtIds = new Set(
    report.events.filter((e) => e.outcome === "caught").map((e) => e.id),
  );
  const gazeOn = (cameraId: string | null) =>
    compact(
      report.timeline
        .filter((s: GazeSegment) => s.cameraId === cameraId)
        .map((s) => ({ start: s.start, end: s.end })),
    );

  const rows: TimelineRow[] = cameras.map((cam) => ({
    id: cam.id,
    label: `${cam.label} ${cam.location}`,
    kind: "camera",
    segments: [
      ...report.events
        .filter((e) => e.cameraIds.includes(cam.id))
        .map((e) => ({
          start: e.start,
          end: e.end ?? report.duration,
          kind: "anomaly" as const,
        })),
      ...gazeOn(cam.id).map((s) => ({ ...s, kind: "gaze" as const })),
    ],
    reports: [
      ...report.events
        .filter(
          (e) =>
            caughtIds.has(e.id) &&
            e.flaggedAt !== null &&
            e.cameraIds.includes(cam.id),
        )
        .map((e) => ({ t: e.flaggedAt!, correct: true })),
      ...report.falseFlags
        .filter((f) => f.cameraId === cam.id)
        .map((f) => ({ t: f.t, correct: false })),
    ],
  }));
  rows.push({
    id: "off-feed",
    label: "OFF-FEED",
    kind: "off-feed",
    segments: gazeOn(null).map((s) => ({ ...s, kind: "off" as const })),
    reports: [],
  });
  rows.push({
    id: "pop-ups",
    label: "POP-UPS",
    kind: "popup",
    segments: compact(popupGaze).map((s) => ({ ...s, kind: "popup" as const })),
    reports: [],
  });
  return rows;
}

/** Coaching lines that name a missed anomaly start with this. */
export const MISSED_PREFIX = "MISSED: ";
/** At most this many missed anomalies are listed one by one. */
const MAX_MISSED_NOTES = 6;

const BEHAVIOR_LABEL: Record<SuspiciousBehavior, string> = {
  loitering: "Loitering",
  revisitingDoors: "Revisiting doors",
  restrictedZone: "Entering a restricted room",
  avoidingCameras: "Avoiding the cameras",
};

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** One line per anomaly the player did not report: what, where, when, why. */
export function missedAnomalyNotes(
  report: ShiftReport,
  cameras: Pick<CameraFeed, "id" | "label" | "location">[],
): string[] {
  const missed = report.events
    .filter((e) => e.outcome !== "caught")
    .sort((a, b) => a.start - b.start);
  const describe = (event: ClassifiedEvent) => {
    // Only feeds that were on screen this shift.
    const shown = cameras.filter((c) => event.cameraIds.includes(c.id));
    const where = shown.length
      ? `on ${shown.map((c) => `${c.label} ${c.location}`).join(" and ")}`
      : "outside your feeds";
    const when =
      event.end === null
        ? `from ${clock(event.start)}`
        : `at ${clock(event.start)}-${clock(event.end)}`;
    const watched = Math.round(event.watchedSeconds);
    const why =
      event.outcome === "missed-looking"
        ? `You watched it for ${Math.max(1, watched)}s but did not report it.`
        : shown.length
          ? "You were not looking at that feed."
          : "No camera you had on screen showed it.";
    return `${MISSED_PREFIX}${BEHAVIOR_LABEL[event.behavior]} ${where} ${when}. ${why}`;
  };
  const notes = missed.slice(0, MAX_MISSED_NOTES).map(describe);
  const rest = missed.length - notes.length;
  if (rest > 0) {
    notes.push(
      `${MISSED_PREFIX}${rest} more ${rest === 1 ? "anomaly" : "anomalies"}. See the timeline.`,
    );
  }
  return notes;
}

/** Two or three short, specific recommendations. */
export function coachingNotes(r: ShiftResult): string[] {
  const notes: string[] = [];
  const least = r.leastWatched;
  if (r.cameraCoveragePercent >= 75) {
    notes.push(
      least && r.perFeedAttention.length > 1
        ? `Strong coverage overall. ${least} received the least attention.`
        : "Strong coverage overall.",
    );
  } else if (r.perFeedAttention.some((f) => f.watchedSeconds > 0)) {
    notes.push(
      `Coverage was narrow (${r.cameraCoveragePercent}% of feeds). Sweep every feed${least ? `, especially ${least}` : ""}.`,
    );
  } else {
    notes.push(
      "No gaze was recorded. Enable mouse fallback or the webcam so attention can be measured.",
    );
  }

  if (r.attentionLapses > 0) {
    notes.push(
      `Your eyes left the feeds ${r.attentionLapses} ${r.attentionLapses === 1 ? "time" : "times"} for ${ATTENTION_LAPSE_SECONDS}s or more (-${ATTENTION_LAPSE_PENALTY * r.attentionLapses} points). Keep your gaze on the cameras.`,
    );
  }
  if (r.popupReadingMs > 4000 || r.popupsDisplayed - r.popupsDismissed > 1) {
    notes.push(
      "Avoid lingering on investigation pop-ups during active anomaly windows. Close or move them aside.",
    );
  }
  if (r.falseFlags > r.caught) {
    notes.push(
      "More false reports than catches. Make sure someone is acting suspicious before reporting.",
    );
  } else if (r.missedWhileLooking > 0) {
    notes.push(
      `You watched ${r.missedWhileLooking} ${r.missedWhileLooking === 1 ? "anomaly" : "anomalies"} without reporting. Trust what you see and report sooner.`,
    );
  } else if (r.totalAnomalies > 0 && r.caught === 0) {
    notes.push(
      "No anomalies were caught. Look for people loitering, revisiting doors, or entering restricted rooms.",
    );
  }
  if (r.escaped > 0) {
    notes.push(
      `${r.escaped} ${r.escaped === 1 ? "suspect" : "suspects"} got out before the knight arrived. Report as soon as you see the behavior.`,
    );
  } else if (r.averageReportTimeMs !== null && r.averageReportTimeMs > 10000) {
    notes.push(
      `Reports took ${Math.round(r.averageReportTimeMs / 1000)}s on average. Report as soon as behavior looks wrong.`,
    );
  }
  if (
    r.dispatcherResponseTimeMs !== null &&
    r.dispatcherResponseTimeMs > 8000
  ) {
    notes.push("Unmute dispatch sooner; transmissions waited a while.");
  }
  if (r.trackingLostSeconds === null && notes.length < 3) {
    notes.push(
      "This shift used mouse input. Calibrate the webcam for an eye-tracked debrief.",
    );
  }
  return notes.slice(0, 3);
}
