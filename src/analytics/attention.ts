// Attention lapses: the player's gaze stayed off every camera feed (on a
// pop-up, the side console, or nowhere at all) for too long. The Watch
// Station sounds an alarm on each lapse and analytics takes points off the
// score for it; both feed the same gaze samples through an AttentionWatch so
// they always agree.
import type { GazeSample } from "../shared/types";

/** Seconds of unbroken off-feed gaze that make one lapse. */
export const ATTENTION_LAPSE_SECONDS = 5;
/** Points taken off the score for each lapse. */
export const ATTENTION_LAPSE_PENALTY = 5;
/** Gaps between samples longer than this (e.g. a paused tab) are not counted. */
const MAX_SAMPLE_GAP = 0.5;

export class AttentionWatch {
  /** Lapses so far this shift. */
  lapses = 0;
  private lastT: number | null = null;
  private away = 0;
  /** Some gaze source has worked this shift, so "none" means looking away. */
  private tracked = false;

  /**
   * Logs one gaze sample. Returns true when it completes a lapse; staying
   * off the feeds completes another one every ATTENTION_LAPSE_SECONDS.
   */
  update(sample: Pick<GazeSample, "t" | "source" | "cameraId">): boolean {
    const dt = this.lastT === null ? 0 : sample.t - this.lastT;
    this.lastT = sample.t;
    if (sample.source !== "none") this.tracked = true;
    if (sample.cameraId !== null) {
      this.away = 0;
      return false;
    }
    if (!this.tracked || dt <= 0 || dt > MAX_SAMPLE_GAP) return false;
    this.away += dt;
    if (this.away < ATTENTION_LAPSE_SECONDS) return false;
    this.away -= ATTENTION_LAPSE_SECONDS;
    this.lapses += 1;
    return true;
  }
}
