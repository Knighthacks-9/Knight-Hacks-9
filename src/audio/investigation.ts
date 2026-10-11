// The investigation dispatch sends after the player files a report:
// acknowledged → en_route → on_scene → resolved → closed.
//
// The Watch Station sends a knight (see InvestigationDeskOptions.unit): the
// stages then follow the knight through the building instead of a timer, and
// a suspect who gets out first is reported as escaped.
//
// The game decides WHAT happens: where the report was, whether the person was
// really suspicious (ground truth from the world), and where they are now.
// The AI dispatcher (writeDispatchLine) only decides HOW it's said, and every
// stage has default lines (./defaultLines.ts) for when the AI is unavailable.
import { FLAG_GRACE_SECONDS } from "../analytics";
import type {
  KnightOutcome,
  KnightStatus,
  SuspiciousBehavior,
  WorldEvent,
  WorldMap,
  WorldSnapshot,
} from "../shared/types";
import { fillLine } from "./defaultLines";
import { writeDispatchLine } from "./dispatchLine";

export type InvestigationStage =
  "acknowledged" | "en_route" | "on_scene" | "resolved" | "closed";

export const STAGES: readonly InvestigationStage[] = [
  "acknowledged",
  "en_route",
  "on_scene",
  "resolved",
  "closed",
];

/** Seconds after the previous stage, before compressing to fit the shift. */
export const STAGE_DELAYS: Readonly<Record<InvestigationStage, number>> = {
  acknowledged: 0,
  en_route: 6,
  on_scene: 10,
  resolved: 7,
  closed: 5,
};

/** Reports with this little shift left get a "log it for the next crew" line instead. */
export const LATE_CUTOFF_SECONDS = 10;
/** The closing line is scheduled at least this long before the shift ends. */
export const END_MARGIN_SECONDS = 2;
/** Start writing a line this long before it's due (the AI call times out at 2 s). */
export const PREFETCH_LEAD_SECONDS = 2.5;
/** With a knight: seconds from the acknowledgement to "knight on the way". */
export const KNIGHT_EN_ROUTE_SECONDS = 3;
/** With a knight: the case closes this long after the outcome at the latest. */
export const KNIGHT_CLOSE_SECONDS = 8;

/**
 * Shift times for each stage of an investigation opened at `now`, squeezed so
 * the last one lands before the shift ends. Null when the report came in the
 * last LATE_CUTOFF_SECONDS and no investigation should start.
 */
export function planStageTimes(
  now: number,
  shiftSeconds: number,
): number[] | null {
  const remaining = shiftSeconds - now;
  if (remaining <= LATE_CUTOFF_SECONDS) return null;
  const total = STAGES.reduce((sum, stage) => sum + STAGE_DELAYS[stage], 0);
  const scale = Math.min(1, (remaining - END_MARGIN_SECONDS) / total);
  let t = now;
  return STAGES.map((stage) => (t += STAGE_DELAYS[stage] * scale));
}

/** Where a person is right now, as the player would name it. */
export interface Whereabouts {
  /** 1-based feed number showing them, or null when no shown feed does. */
  camera: number | null;
  /** The feed's location, or the room they're in when off camera. */
  location: string;
}

/** A report under investigation. Everything here comes from game state. */
export interface InvestigationCase {
  /** 1-based number of the feed the player reported. */
  camera: number;
  /** That feed's location, e.g. "Hall West". */
  location: string;
  /** What the player said the person was doing, if they picked one. */
  reportedBehavior: SuspiciousBehavior | null;
  /** The player's spoken description, if any. */
  description: string | null;
  /**
   * Ground truth: the reported person's suspicious behavior, or null when
   * they were innocent (or nobody suspicious was on the feed).
   */
  suspect: SuspiciousBehavior | null;
  /** The person the report points at; null when there was nobody to check. */
  npcId: string | null;
}

export const BEHAVIOR_PHRASES: Readonly<Record<SuspiciousBehavior, string>> = {
  loitering: "loitering",
  revisitingDoors: "repeatedly checking doors",
  restrictedZone: "entering a restricted area",
  avoidingCameras: "avoiding the cameras",
};

const where = (c: InvestigationCase) => `${c.location} (camera ${c.camera})`;
const place = (w: Whereabouts) =>
  w.camera === null
    ? `${w.location}, off camera`
    : `${w.location} (camera ${w.camera})`;
const moved = (c: InvestigationCase, now: Whereabouts | null) =>
  now !== null && now.camera !== c.camera;

/**
 * The facts the AI may use for one stage. `now` is the person's location at
 * on_scene; `outcome` is how the knight's job ended, when one was sent.
 */
export function investigationFacts(
  stage: InvestigationStage,
  c: InvestigationCase,
  now: Whereabouts | null,
  outcome: KnightOutcome | null = null,
): string {
  const reported = c.reportedBehavior
    ? BEHAVIOR_PHRASES[c.reportedBehavior]
    : "suspicious activity";
  switch (stage) {
    case "acknowledged":
      return [
        `Control reported ${reported} at ${where(c)}.`,
        c.description
          ? `Control's description: "${c.description.slice(0, 160)}".`
          : null,
        "Acknowledge the report. Do not say what will happen next.",
      ]
        .filter(Boolean)
        .join("\n");
    case "en_route":
      return `The knight on duty is now heading to ${where(c)} to check the report of ${reported}.`;
    case "on_scene":
      if (!c.npcId) {
        return `The knight has arrived at ${where(c)}. Nobody there matches the report.`;
      }
      return [
        now === null
          ? `The knight has arrived at ${where(c)}. The subject has left the monitored area.`
          : moved(c, now)
            ? `The knight has arrived at ${where(c)}, but the subject has moved to ${place(now)}. The knight is following.`
            : `The knight has arrived at ${where(c)} and has eyes on the subject.`,
        c.suspect
          ? `The subject is ${BEHAVIOR_PHRASES[c.suspect]}.`
          : "The subject appears to be going about normal business.",
      ].join("\n");
    case "resolved":
      if (outcome === "escaped" && c.suspect) {
        return `Outcome: the subject left the building before the knight reached them. They were ${BEHAVIOR_PHRASES[c.suspect]}. The report was right but came too late.`;
      }
      if (c.suspect) {
        return `Outcome: the knight detained the subject${now ? ` at ${place(now)}` : ""}. Confirmed: they were ${BEHAVIOR_PHRASES[c.suspect]}.`;
      }
      return c.npcId
        ? "Outcome: false report. The subject was not doing anything suspicious and has been cleared."
        : `Outcome: false report. Nothing suspicious was found at ${where(c)}. Area cleared.`;
    case "closed":
      return `The incident at ${where(c)} is closed. Result: ${c.suspect ? (outcome === "escaped" ? "subject escaped" : "subject detained") : "false report, cleared"}. Tell control to stay on the feeds.`;
  }
}

/** The line used when the AI is unavailable: one of the default variants. */
export function investigationTemplate(
  stage: InvestigationStage,
  c: InvestigationCase,
  now: Whereabouts | null,
  random: () => number = Math.random,
  outcome: KnightOutcome | null = null,
): string {
  const at = { CAM: String(c.camera), ROOM: c.location };
  switch (stage) {
    case "acknowledged":
      return fillLine("acknowledged", at, random);
    case "en_route":
      return fillLine("en_route", at, random);
    case "on_scene":
      if (!c.npcId) return fillLine("on_scene_nobody", at, random);
      if (now === null) return fillLine("on_scene_gone", at, random);
      if (moved(c, now)) {
        return fillLine(
          "on_scene_moved",
          {
            ROOM: now.location,
            NEW_CAM: now.camera === null ? undefined : String(now.camera),
          },
          random,
        );
      }
      return fillLine("on_scene_still", at, random);
    case "resolved":
      if (outcome === "escaped" && c.suspect) {
        return fillLine(
          "resolved_escaped",
          { BEHAVIOR: BEHAVIOR_PHRASES[c.suspect] },
          random,
        );
      }
      if (c.suspect) {
        return fillLine(
          "resolved_suspect",
          { BEHAVIOR: BEHAVIOR_PHRASES[c.suspect] },
          random,
        );
      }
      return c.npcId
        ? fillLine("resolved_innocent", {}, random)
        : fillLine("resolved_nobody", at, random);
    case "closed":
      return fillLine("closed", at, random);
  }
}

/** Facts and template for a report that came in too late to investigate. */
export function lateReportLine(
  c: InvestigationCase,
  random: () => number = Math.random,
): {
  facts: string;
  template: string;
} {
  return {
    facts: `Control reported ${c.reportedBehavior ? BEHAVIOR_PHRASES[c.reportedBehavior] : "suspicious activity"} at ${where(c)} with under ${LATE_CUTOFF_SECONDS} seconds left in the shift. No unit can respond in time. Tell control to log it for the next crew.`,
    template: fillLine(
      "late",
      { CAM: String(c.camera), ROOM: c.location },
      random,
    ),
  };
}

/**
 * Where a person is, named the way the player sees it: the first shown feed
 * that sees them, else the room they're in. Null when they're not in the
 * building any more.
 */
export function locateNpc(
  snapshot: WorldSnapshot | null,
  map: WorldMap | null,
  feeds: readonly { id: string; location: string }[],
  npcId: string,
): Whereabouts | null {
  const npc = snapshot?.npcs.find((n) => n.id === npcId);
  if (!npc) return null;
  const index = feeds.findIndex((f) => npc.cameraIds.includes(f.id));
  if (index >= 0) return { camera: index + 1, location: feeds[index].location };
  const room = map?.rooms.find(
    (r) =>
      npc.x >= r.x && npc.x < r.x + r.w && npc.y >= r.y && npc.y < r.y + r.h,
  );
  return { camera: null, location: room?.name ?? "an unmonitored area" };
}

/**
 * Ground truth for the classic game: which people are (or just were) acting
 * suspicious. Same matching rule as analytics, so the dispatcher's verdict
 * agrees with the debrief.
 */
export class SuspectLedger {
  private readonly events = new Map<
    string,
    {
      npcId: string;
      behavior: SuspiciousBehavior;
      start: number;
      end: number | null;
    }
  >();

  record(event: WorldEvent, phase: "start" | "end"): void {
    const known = this.events.get(event.id);
    if (phase === "end" && known) known.end = event.t;
    else if (phase === "start") {
      this.events.set(event.id, {
        npcId: event.npcId,
        behavior: event.behavior,
        start: event.t,
        end: null,
      });
    }
  }

  /** The person's suspicious behavior at shift time t, or null if innocent. */
  behaviorAt(npcId: string, t: number): SuspiciousBehavior | null {
    for (const event of this.events.values()) {
      if (
        event.npcId === npcId &&
        t >= event.start &&
        (event.end === null || t <= event.end + FLAG_GRACE_SECONDS)
      ) {
        return event.behavior;
      }
    }
    return null;
  }
}

/** A dispatcher line the UI should show and speak. */
export interface InvestigationLine {
  stage: InvestigationStage | "late";
  /** Feed number the investigation is about. */
  camera: number;
  text: string;
  /** The report being investigated. */
  case: InvestigationCase;
  /** How the knight's job ended, on resolved and closed lines (knight mode). */
  outcome?: KnightOutcome;
}

/** The knight the desk sends for each report. */
export interface InvestigationUnit {
  /**
   * Sends a knight for the case; returns their id, or null when no knight
   * can go (that case then runs on STAGE_DELAYS).
   */
  dispatch(c: InvestigationCase): string | null;
  /** Where that knight's job stands; null once they've left the building. */
  status(unitId: string): KnightStatus | null;
}

export interface InvestigationDeskOptions {
  shiftSeconds: number;
  /**
   * True (the default) squeezes each investigation to close before the shift
   * ends, and gives late reports a "log it" line. False runs every report at
   * the normal pace, for a game that waits for dispatch after the shift.
   */
  fitToShift?: boolean;
  /** Where the reported person is right now. */
  locate(npcId: string): Whereabouts | null;
  /** Show and speak a line (called in stage order per investigation). */
  deliver(line: InvestigationLine): void;
  /**
   * Sends a knight for each report. The stages then follow the knight
   * (en route, arrived, outcome, gone) instead of STAGE_DELAYS.
   */
  unit?: InvestigationUnit;
  /** Swappable for tests. */
  write?: (stage: string, facts: string, template: string) => Promise<string>;
}

interface OpenInvestigation {
  case: InvestigationCase;
  /** Stages still to run, in order: all of STAGES unless hurry() cut some. */
  stages: InvestigationStage[];
  times: number[];
  next: number;
  /** The next stage's line, being written. */
  pending: Promise<string> | null;
  delivering: boolean;
  /** Where the person was when the unit arrived. */
  seen: Whereabouts | null;
  located: boolean;
  /** Knight mode: the knight sent, and what they last reported. */
  unitId: string | null;
  status: KnightStatus | null;
  startedAt: number;
  /** Shift time the outcome came in. */
  resolvedAt: number | null;
}

/**
 * Runs every open investigation on the shift clock. Call update(t) each frame.
 * Each stage's line is written ahead of time (prefetched while the previous
 * one plays) so it's ready the moment the stage is due.
 */
export class InvestigationDesk {
  private open: OpenInvestigation[] = [];
  private lateWrites = 0;
  private destroyed = false;
  private readonly write: NonNullable<InvestigationDeskOptions["write"]>;

  constructor(private readonly options: InvestigationDeskOptions) {
    this.write = options.write ?? writeDispatchLine;
  }

  /** True while any investigation still has lines to deliver. */
  get busy(): boolean {
    return !this.destroyed && (this.open.length > 0 || this.lateWrites > 0);
  }

  /** Lines still to be delivered across every open investigation. */
  get remainingLines(): number {
    return this.open.reduce(
      (sum, inv) => sum + inv.stages.length - inv.next,
      this.lateWrites,
    );
  }

  /** Starts investigating a report filed at shift time t. */
  start(c: InvestigationCase, t: number): void {
    if (this.destroyed) return;
    const { unit } = this.options;
    const end =
      this.options.fitToShift === false || unit
        ? Infinity
        : this.options.shiftSeconds;
    const times = planStageTimes(t, end);
    if (!times) {
      const { facts, template } = lateReportLine(c);
      this.lateWrites += 1;
      void this.write("late", facts, template).then((text) => {
        this.lateWrites -= 1;
        if (!this.destroyed)
          this.options.deliver({
            stage: "late",
            camera: c.camera,
            text,
            case: c,
          });
      });
      return;
    }
    this.open.push({
      case: c,
      stages: [...STAGES],
      times,
      next: 0,
      pending: null,
      delivering: false,
      seen: null,
      located: false,
      unitId: unit ? unit.dispatch(c) : null,
      status: null,
      startedAt: t,
      resolvedAt: null,
    });
    this.update(t);
  }

  /** Knight mode: true once the knight has got far enough for `stage`. */
  private unitReady(
    inv: OpenInvestigation,
    stage: InvestigationStage,
    t: number,
  ): boolean {
    const status = inv.status;
    switch (stage) {
      case "acknowledged":
        return true;
      case "en_route":
        return t >= inv.startedAt + KNIGHT_EN_ROUTE_SECONDS;
      case "on_scene":
        return status === null || status.phase !== "en_route";
      case "resolved":
        return status === null || status.outcome !== null;
      case "closed":
        return (
          status === null ||
          status.phase === "leaving" ||
          (inv.resolvedAt !== null &&
            t >= inv.resolvedAt + KNIGHT_CLOSE_SECONDS)
        );
    }
  }

  /** Knight mode: reads the knight's progress and drops stages it skipped. */
  private followUnit(inv: OpenInvestigation, t: number): void {
    const status = this.options.unit!.status(inv.unitId!);
    if (status) inv.status = status;
    else if (inv.status) {
      // They left the building, so the job is over either way.
      inv.status = {
        ...inv.status,
        phase: "leaving",
        outcome: inv.status.outcome ?? (inv.case.npcId ? "escaped" : "nothing"),
      };
    }
    if (inv.status?.outcome && inv.resolvedAt === null) inv.resolvedAt = t;
    // An escape means the knight never arrived: skip the arrival line.
    if (
      inv.status?.outcome === "escaped" &&
      inv.stages[inv.next] === "on_scene" &&
      !inv.pending
    ) {
      inv.stages = inv.stages.filter((stage) => stage !== "on_scene");
    }
  }

  update(t: number): void {
    if (this.destroyed) return;
    for (const inv of this.open) {
      if (inv.unitId) this.followUnit(inv, t);
      const stage = inv.stages[inv.next];
      const due = inv.times[inv.next];
      // Knight mode writes each line as the knight gets there; the AI call
      // is capped at 2 s, so it lands close behind.
      const ready = inv.unitId
        ? this.unitReady(inv, stage, t)
        : t >= due - PREFETCH_LEAD_SECONDS;
      if (!inv.pending && ready) {
        // The unit finds the person on arrival (or at the outcome, when
        // hurry() skipped the arrival).
        if (
          (stage === "on_scene" || stage === "resolved") &&
          !inv.located &&
          inv.case.npcId
        ) {
          inv.seen = this.options.locate(inv.case.npcId);
          inv.located = true;
        }
        const outcome = inv.status?.outcome ?? null;
        // A knight reaches the person wherever they are now: the line names
        // that place, and they haven't "moved" from it.
        let told = inv.case;
        let now = inv.seen;
        if (inv.unitId && stage === "on_scene" && inv.seen) {
          told = {
            ...inv.case,
            camera: inv.seen.camera ?? inv.case.camera,
            location: inv.seen.location,
          };
          now = { camera: told.camera, location: told.location };
        }
        inv.pending = this.write(
          stage,
          investigationFacts(stage, told, now, outcome),
          investigationTemplate(stage, told, now, Math.random, outcome),
        );
      }
      if (inv.pending && !inv.delivering && (inv.unitId || t >= due)) {
        inv.delivering = true;
        void inv.pending.then((text) => {
          if (this.destroyed) return;
          const outcome = inv.status?.outcome;
          this.options.deliver({
            stage,
            camera: inv.case.camera,
            text,
            case: inv.case,
            ...(outcome && (stage === "resolved" || stage === "closed")
              ? { outcome }
              : {}),
          });
          inv.next += 1;
          inv.pending = null;
          inv.delivering = false;
          if (inv.next >= inv.stages.length) {
            this.open = this.open.filter((other) => other !== inv);
          }
        });
      }
    }
  }

  /**
   * The shift is over and dispatch is short on time: each investigation goes
   * straight to its outcome (resolved) at shift time t, skipping the unit's
   * travel and the closing line. A line already being written still goes out.
   */
  hurry(t: number): void {
    if (this.destroyed) return;
    for (const inv of this.open) {
      const kept = inv.stages.slice(0, inv.next + (inv.pending ? 1 : 0));
      inv.stages = kept.includes("resolved") ? kept : [...kept, "resolved"];
      inv.times = inv.stages.map((_, i) =>
        i < inv.next ? inv.times[i] : Math.min(inv.times[i] ?? t, t),
      );
    }
    this.open = this.open.filter((inv) => inv.next < inv.stages.length);
  }

  /** Drops every open investigation (the shift is over). */
  destroy(): void {
    this.destroyed = true;
    this.open = [];
  }
}
