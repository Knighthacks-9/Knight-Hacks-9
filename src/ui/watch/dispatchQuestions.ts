// Dispatch check-ins: now and then the dispatcher asks the operator about the
// feeds ("how many people on camera 2?"), answered over push-to-talk. Answers
// are graded against every frame seen while the question was open, so someone
// walking in or out mid-answer doesn't make a right answer wrong. No DOM in
// this file, so it can be unit tested.
import type { WorldSnapshot } from "../../shared/types";
import { parseCameraCommand, parseNumber } from "./voiceCommand";

export type QuestionKind = "count" | "occupied" | "busiest" | "empty";

export interface QuestionFeed {
  location: string;
}

export interface DispatchQuestion {
  kind: QuestionKind;
  /** 1-based camera the question is about (count and occupied only). */
  camera: number | null;
  /** Short LCD headline. */
  headline: string;
  text: string;
}

export type Answer =
  | { kind: "number"; value: number }
  | { kind: "yesno"; value: boolean }
  | { kind: "camera"; value: number };

export interface Verdict {
  correct: boolean;
  /** What dispatch says back. */
  reply: string;
}

const pick = <T>(items: readonly T[], random: () => number): T =>
  items[Math.min(Math.floor(random() * items.length), items.length - 1)];

const people = (n: number) =>
  n === 0 ? "nobody" : `${n} ${n === 1 ? "person" : "people"}`;

/** People on each feed this frame, in feed order (index = camera - 1). */
export function feedCounts(
  snapshot: WorldSnapshot | null,
  feeds: readonly { id: string }[],
): number[] {
  return feeds.map(
    (feed) =>
      snapshot?.npcs.filter((npc) => npc.cameraIds.includes(feed.id)).length ??
      0,
  );
}

/** Picks a question that makes sense for what the feeds show right now. */
export function pickQuestion(
  feeds: readonly QuestionFeed[],
  counts: readonly number[],
  random: () => number = Math.random,
): DispatchQuestion {
  const kinds: QuestionKind[] = ["count", "count", "occupied"];
  const max = Math.max(0, ...counts);
  if (feeds.length >= 2 && max > 0) kinds.push("busiest");
  if (feeds.length >= 2 && max > 0 && counts.includes(0)) kinds.push("empty");
  const kind = pick(kinds, random);

  if (kind === "busiest") {
    return {
      kind,
      camera: null,
      headline: "CHECK-IN: BUSIEST CAM",
      text: pick(
        [
          "Control, which camera has the most people on it right now?",
          "Control, where's the crowd? Which camera is busiest?",
        ],
        random,
      ),
    };
  }
  if (kind === "empty") {
    return {
      kind,
      camera: null,
      headline: "CHECK-IN: EMPTY CAM",
      text: pick(
        [
          "Control, give me a camera with nobody on it.",
          "Control, which camera is empty right now?",
        ],
        random,
      ),
    };
  }
  const index = Math.floor(random() * feeds.length) % feeds.length;
  const cam = index + 1;
  const room = feeds[index].location;
  return {
    kind,
    camera: cam,
    headline: `CHECK-IN: CAM ${cam}`,
    text:
      kind === "count"
        ? pick(
            [
              `Control, head count on camera ${cam}, ${room}. How many people do you see?`,
              `Control, how many people are on camera ${cam} right now?`,
              `Dispatch to control. I need a head count on camera ${cam}, ${room}.`,
            ],
            random,
          )
        : pick(
            [
              `Control, is anyone on camera ${cam}, ${room}, right now?`,
              `Control, quick check. Do you see anyone on camera ${cam}?`,
            ],
            random,
          ),
  };
}

/** True when the transcript is a sighting report, not an answer. */
export function isSightingReport(transcript: string): boolean {
  return /\b(sighting|report|suspicious|suspect)\b/i.test(transcript);
}

const YES =
  /\b(yes|yeah|yep|yup|affirmative|correct|someone|somebody|people|person)\b/i;
const NO = /\b(no|nope|negative|nobody|none|empty|clear|zero|nothing)\b/i;

/** Reads the player's answer to `question`, or null if it can't be understood. */
export function parseAnswer(
  question: DispatchQuestion,
  transcript: string,
  cameraCount: number,
): Answer | null {
  if (question.kind === "busiest" || question.kind === "empty") {
    const camera = parseCameraCommand(transcript, cameraCount);
    return camera === null ? null : { kind: "camera", value: camera };
  }
  // "Camera 2 has three": the camera named isn't the count. "No one" is
  // nobody, not one.
  const spoken = transcript
    .replace(/\b(camera|cam|feed)\s+(number\s+)?\w+/gi, " ")
    .replace(/\bno[\s-]+one\b/gi, "nobody");
  const n = parseNumber(spoken);
  if (question.kind === "count") {
    if (n !== null) return { kind: "number", value: n };
    return NO.test(spoken) ? { kind: "number", value: 0 } : null;
  }
  // Occupied: "no" wins over words like "people" in "no people".
  if (NO.test(spoken) || n === 0) return { kind: "yesno", value: false };
  if (YES.test(spoken) || (n !== null && n > 0)) {
    return { kind: "yesno", value: true };
  }
  return null;
}

/** An open question: collects what the feeds showed until it is answered. */
export class QuestionWindow {
  /** Every head count seen on each feed while the question was open. */
  private readonly seen: Set<number>[];
  /** Cameras that were (tied for) busiest, or empty, at some point. */
  private readonly busiest = new Set<number>();
  private readonly empty = new Set<number>();
  private latest: readonly number[] = [];

  constructor(
    readonly question: DispatchQuestion,
    feedCount: number,
  ) {
    this.seen = Array.from({ length: feedCount }, () => new Set<number>());
  }

  observe(counts: readonly number[]): void {
    this.latest = counts;
    const max = Math.max(0, ...counts);
    counts.forEach((n, i) => {
      this.seen[i]?.add(n);
      if (n === max && max > 0) this.busiest.add(i + 1);
      if (n === 0) this.empty.add(i + 1);
    });
  }

  grade(answer: Answer): Verdict {
    const { question } = this;
    const cam = question.camera ?? 0;
    const now = this.latest[cam - 1] ?? 0;
    const seen = this.seen[cam - 1] ?? new Set<number>();
    switch (question.kind) {
      case "count": {
        const value = answer.kind === "number" ? answer.value : -1;
        return seen.has(value)
          ? {
              correct: true,
              reply: `Copy, ${people(value)} on camera ${cam}. Thanks, control.`,
            }
          : {
              correct: false,
              reply: `Negative, control. I count ${people(now)} on camera ${cam}. Look again.`,
            };
      }
      case "occupied": {
        const yes = answer.kind === "yesno" && answer.value;
        const fits = [...seen].some((n) => n > 0 === yes);
        return fits
          ? {
              correct: true,
              reply: yes
                ? `Copy, someone's on camera ${cam}. Thanks, control.`
                : `Copy, camera ${cam} is clear. Thanks, control.`,
            }
          : {
              correct: false,
              reply: `Negative, control. I've got ${people(now)} on camera ${cam}.`,
            };
      }
      case "busiest":
      case "empty": {
        const named = answer.kind === "camera" ? answer.value : 0;
        const pool = question.kind === "busiest" ? this.busiest : this.empty;
        if (pool.has(named)) {
          return {
            correct: true,
            reply:
              question.kind === "busiest"
                ? `Copy, camera ${named} is the busy one. Thanks, control.`
                : `Copy, camera ${named} is empty. Thanks, control.`,
          };
        }
        if (question.kind === "empty") {
          return {
            correct: false,
            reply: `Negative, control. I've got ${people(this.latest[named - 1] ?? 0)} on camera ${named}.`,
          };
        }
        const max = Math.max(0, ...this.latest);
        const best = this.latest.indexOf(max) + 1;
        return {
          correct: false,
          reply:
            best > 0
              ? `Negative, control. Camera ${best} has more people right now.`
              : "Negative, control. Look again.",
        };
      }
    }
  }
}

export const TIMEOUT_REPLY =
  "No answer, control. Keep an ear on the radio and answer when I call.";
