import type { Flag, SuspiciousBehavior } from "../shared/types";

/**
 * idle      no report in progress
 * feed      step 1: pick the camera feed showing the activity
 * person    step 2: pick the person on that feed
 * incident  step 3: pick what they are doing, then send
 * follow-up step 4: dispatch has the report and needs a spoken description
 */
export type ReportStep = "idle" | "feed" | "person" | "incident" | "follow-up";

export interface PendingReport {
  cameraId: string;
  npcId: string;
  behavior: SuspiciousBehavior;
  /** Shift seconds when the report was sent. */
  t: number;
}

/**
 * The report-for-investigation loop, kept free of Phaser so it can be tested.
 * A report only becomes a Flag (and counts for scoring) once the player has
 * radioed in a description.
 */
export class ReportFlow {
  step: ReportStep = "idle";
  cameraId: string | null = null;
  npcId: string | null = null;
  behavior: SuspiciousBehavior | null = null;
  pending: PendingReport | null = null;
  /** People already reported this shift (including the one awaiting follow-up). */
  readonly reported = new Set<string>();
  /** Short feedback for the last rejected action, cleared on the next step. */
  notice = "";

  start(): void {
    if (this.step === "follow-up") return;
    this.reset();
    this.step = "feed";
  }

  cancel(): void {
    if (this.step === "follow-up") return;
    this.reset();
  }

  back(): void {
    this.notice = "";
    if (this.step === "incident") {
      this.npcId = null;
      this.behavior = null;
      this.step = "person";
    } else if (this.step === "person") {
      this.cameraId = null;
      this.step = "feed";
    }
  }

  chooseFeed(cameraId: string): boolean {
    if (this.step !== "feed") return false;
    this.notice = "";
    this.cameraId = cameraId;
    this.step = "person";
    return true;
  }

  /** A click on a person. During step 1 it picks their feed instead. */
  choosePerson(cameraId: string, npcId: string): boolean {
    if (this.step === "feed") return this.chooseFeed(cameraId);
    if (this.step !== "person") return false;
    if (cameraId !== this.cameraId) {
      this.notice = "Pick someone on the feed you chose.";
      return false;
    }
    if (this.reported.has(npcId)) {
      this.notice = "Already reported. Pick someone else.";
      return false;
    }
    this.notice = "";
    this.npcId = npcId;
    this.step = "incident";
    return true;
  }

  chooseBehavior(behavior: SuspiciousBehavior): boolean {
    if (this.step !== "incident") return false;
    this.behavior = behavior;
    return true;
  }

  /** Sends the report to dispatch. Returns it, or null if it isn't complete. */
  send(t: number): PendingReport | null {
    if (
      this.step !== "incident" ||
      !this.cameraId ||
      !this.npcId ||
      !this.behavior
    ) {
      return null;
    }
    this.pending = {
      cameraId: this.cameraId,
      npcId: this.npcId,
      behavior: this.behavior,
      t,
    };
    this.reported.add(this.npcId);
    this.step = "follow-up";
    return this.pending;
  }

  /** Attaches the spoken description and files the report for scoring. */
  completeFollowUp(note: string): Flag | null {
    const text = note.trim();
    if (this.step !== "follow-up" || !this.pending || !text) return null;
    const flag: Flag = { ...this.pending, note: text };
    this.reset();
    return flag;
  }

  private reset(): void {
    this.step = "idle";
    this.cameraId = null;
    this.npcId = null;
    this.behavior = null;
    this.pending = null;
    this.notice = "";
  }
}
