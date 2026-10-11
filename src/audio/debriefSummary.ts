// The dispatcher's end-of-shift summary. Built from the analytics report
// (ground truth), so the AI only words what actually happened; the default
// lines (./defaultLines.ts) say the same thing when the AI is unavailable.
import type {
  ClassifiedEvent,
  ShiftReport,
  SuspiciousBehavior,
} from "../shared/types";
import { fillLine } from "./defaultLines";
import { BEHAVIOR_PHRASES } from "./investigation";

export interface DebriefSuspect {
  behavior: SuspiciousBehavior;
  /** 1-based feed that first showed them, or null if none is known. */
  camera: number | null;
  location: string | null;
  /** For a missed suspect: whether the player was watching a feed that showed them. */
  watched: boolean;
}

/** Everything the dispatcher may mention at the debrief. */
export interface DebriefInput {
  completed: boolean;
  caught: DebriefSuspect[];
  missed: DebriefSuspect[];
  falseReports: number;
}

/** What a missed suspect led to, by behavior. */
export const MISSED_CONSEQUENCES: Readonly<Record<SuspiciousBehavior, string>> =
  {
    loitering: "a break-in later that night",
    restrictedZone: "unauthorized access to the server room",
    revisitingDoors: "a door found propped open",
    avoidingCameras: "a theft discovered in the morning",
  };

/** Picks out the dispatcher-relevant facts. `feeds` are the shown feeds, in grid order. */
export function debriefInput(
  report: ShiftReport,
  feeds: readonly { id: string; location: string }[],
): DebriefInput {
  const suspect = (event: ClassifiedEvent): DebriefSuspect => {
    // cameraIds are in the order the feeds first saw the person.
    const index = event.cameraIds
      .map((id) => feeds.findIndex((f) => f.id === id))
      .find((i) => i >= 0);
    return {
      behavior: event.behavior,
      camera: index === undefined ? null : index + 1,
      location: index === undefined ? null : feeds[index].location,
      watched: event.outcome !== "missed-not-looking",
    };
  };
  return {
    completed: report.completed,
    caught: report.events.filter((e) => e.outcome === "caught").map(suspect),
    missed: report.events.filter((e) => e.outcome !== "caught").map(suspect),
    falseReports: report.falseFlags.length,
  };
}

const at = (s: DebriefSuspect) =>
  s.camera === null ? "" : ` on camera ${s.camera}, ${s.location}`;

/** The facts the AI may use for the summary, including what tone to take. */
export function debriefFacts(input: DebriefInput): string {
  const { caught, missed, falseReports } = input;
  const lines = [
    input.completed ? "The shift is over." : "Control ended the shift early.",
    caught.length
      ? `Suspects caught: ${caught.length} (${caught.map((s) => BEHAVIOR_PHRASES[s.behavior] + at(s)).join("; ")}).`
      : "Suspects caught: none.",
    missed.length
      ? `Suspects missed: ${missed.length}.`
      : "Suspects missed: none.",
    ...missed.map(
      (s) =>
        `Missed: ${BEHAVIOR_PHRASES[s.behavior]}${at(s)}. Consequence: ${MISSED_CONSEQUENCES[s.behavior]}.` +
        (!s.watched && s.camera !== null
          ? ` Control was not watching camera ${s.camera}.`
          : ""),
    ),
    `False reports (innocent people reported): ${falseReports}.`,
  ];
  if (caught.length && !missed.length) {
    lines.push("Tone: congratulate control and name what was caught.");
  } else if (missed.length) {
    lines.push("Tone: state the consequence of the miss plainly.");
  }
  if (falseReports) lines.push("Mention the false reports gently.");
  return lines.join("\n");
}

/** The summary used when the AI is unavailable, built from default line clips. */
export function debriefTemplate(
  input: DebriefInput,
  random: () => number = Math.random,
): string {
  const { caught, missed, falseReports } = input;
  const parts: string[] = [];
  if (!caught.length && !missed.length) {
    parts.push(fillLine("debrief_quiet", {}, random));
  } else if (!missed.length) {
    // Each kind of behavior once, so the line stays short.
    const kinds = [...new Set(caught.map((s) => s.behavior))];
    parts.push(
      fillLine(
        "debrief_all_caught",
        { BEHAVIOR: list(kinds.map((b) => BEHAVIOR_PHRASES[b])) },
        random,
      ),
    );
  } else if (caught.length) {
    parts.push(fillLine("debrief_some_caught", {}, random));
  } else {
    parts.push(fillLine("debrief_none_caught", {}, random));
  }
  // Name the first two misses; more than that would be a speech.
  for (const s of missed.slice(0, 2)) {
    const cam = s.camera === null ? undefined : String(s.camera);
    parts.push(
      fillLine(
        `debrief_missed_${s.behavior}`,
        {
          BEHAVIOR: BEHAVIOR_PHRASES[s.behavior],
          CAM: cam,
          ROOM: s.location ?? undefined,
        },
        random,
      ),
    );
    if (!s.watched && cam) {
      parts.push(fillLine("debrief_unwatched", { CAM: cam }, random));
    }
  }
  if (missed.length > 2)
    parts.push(fillLine("debrief_more_missed", {}, random));
  if (falseReports) {
    parts.push(
      fillLine(
        falseReports === 1 ? "debrief_false_one" : "debrief_false_many",
        {},
        random,
      ),
    );
  }
  return parts.join(" ");
}

function list(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
