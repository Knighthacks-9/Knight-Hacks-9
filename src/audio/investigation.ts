// The investigation dispatch sends after the player files a report:
// acknowledged → en_route → on_scene → resolved → closed.
//
// The game decides WHAT happens: where the report was, whether the person was
// really suspicious (ground truth from the world), and where they are now.
// The AI dispatcher (writeDispatchLine) only decides HOW it's said, and every
// stage has default lines (./defaultLines.ts) for when the AI is unavailable.
import { FLAG_GRACE_SECONDS } from "../analytics";
import type {
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

/** The facts the AI may use for one stage. `now` is the person's location at on_scene. */
export function investigationFacts(
  stage: InvestigationStage,
  c: InvestigationCase,
  now: Whereabouts | null,
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
      return `A security unit is now heading to ${where(c)} to check the report of ${reported}.`;
    case "on_scene":
      if (!c.npcId) {
        return `The unit has arrived at ${where(c)}. Nobody there matches the report.`;
      }
      return [
        now === null
          ? `The unit has arrived at ${where(c)}. The subject has left the monitored area.`
          : moved(c, now)
            ? `The unit has arrived at ${where(c)}, but the subject has moved to ${place(now)}. The unit is following.`
            : `The unit has arrived at ${where(c)} and has eyes on the subject.`,
        c.suspect
          ? `The subject is ${BEHAVIOR_PHRASES[c.suspect]}.`
          : "The subject appears to be going about normal business.",
      ].join("\n");
    case "resolved":
      if (c.suspect) {
        return `Outcome: the subject was detained${now ? ` at ${place(now)}` : ""}. Confirmed: they were ${BEHAVIOR_PHRASES[c.suspect]}.`;
      }
      return c.npcId
        ? "Outcome: false report. The subject was not doing anything suspicious and has been cleared."
        : `Outcome: false report. Nothing suspicious was found at ${where(c)}. Area cleared.`;
    case "closed":
      return `The incident at ${where(c)} is closed. Result: ${c.suspect ? "subject detained" : "false report, cleared"}. Tell control to stay on the feeds.`;
  }
}

/** The line used when the AI is unavailable: one of the default variants. */
export function investigationTemplate(
  stage: InvestigationStage,
  c: InvestigationCase,
  now: Whereabouts | null,
  random: () => number = Math.random,
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
}

export interface InvestigationDeskOptions {
  shiftSeconds: number;
  /** Where the reported person is right now. */
  locate(npcId: string): Whereabouts | null;
  /** Show and speak a line (called in stage order per investigation). */
  deliver(line: InvestigationLine): void;
  /** Swappable for tests. */
  write?: (stage: string, facts: string, template: string) => Promise<string>;
}

interface OpenInvestigation {
  case: InvestigationCase;
  times: number[];
  next: number;
  /** The next stage's line, being written. */
  pending: Promise<string> | null;
  delivering: boolean;
  /** Where the person was when the unit arrived. */
  seen: Whereabouts | null;
}

/**
 * Runs every open investigation on the shift clock. Call update(t) each frame.
 * Each stage's line is written ahead of time (prefetched while the previous
 * one plays) so it's ready the moment the stage is due.
 */
export class InvestigationDesk {
  private open: OpenInvestigation[] = [];
  private destroyed = false;
  private readonly write: NonNullable<InvestigationDeskOptions["write"]>;

  constructor(private readonly options: InvestigationDeskOptions) {
    this.write = options.write ?? writeDispatchLine;
  }

  /** Starts investigating a report filed at shift time t. */
  start(c: InvestigationCase, t: number): void {
    if (this.destroyed) return;
    const times = planStageTimes(t, this.options.shiftSeconds);
    if (!times) {
      const { facts, template } = lateReportLine(c);
      void this.write("late", facts, template).then((text) => {
        if (!this.destroyed)
          this.options.deliver({ stage: "late", camera: c.camera, text });
      });
      return;
    }
    this.open.push({
      case: c,
      times,
      next: 0,
      pending: null,
      delivering: false,
      seen: null,
    });
    this.update(t);
  }

  update(t: number): void {
    if (this.destroyed) return;
    for (const inv of this.open) {
      const stage = STAGES[inv.next];
      const due = inv.times[inv.next];
      if (!inv.pending && t >= due - PREFETCH_LEAD_SECONDS) {
        if (stage === "on_scene" && inv.case.npcId) {
          inv.seen = this.options.locate(inv.case.npcId);
        }
        inv.pending = this.write(
          stage,
          investigationFacts(stage, inv.case, inv.seen),
          investigationTemplate(stage, inv.case, inv.seen),
        );
      }
      if (inv.pending && !inv.delivering && t >= due) {
        inv.delivering = true;
        void inv.pending.then((text) => {
          if (this.destroyed) return;
          this.options.deliver({ stage, camera: inv.case.camera, text });
          inv.next += 1;
          inv.pending = null;
          inv.delivering = false;
          if (inv.next >= STAGES.length) {
            this.open = this.open.filter((other) => other !== inv);
          }
        });
      }
    }
  }

  /** Drops every open investigation (the shift is over). */
  destroy(): void {
    this.destroyed = true;
    this.open = [];
  }
}
