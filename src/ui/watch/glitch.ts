// Brief, occasional signal disruptions on the camera feeds.
import { prefersReducedMotion, randomBetween } from "../dom";
import type { GlitchKind } from "./feedRenderer";

const KINDS: GlitchKind[] = [
  "jitter",
  "split",
  "static",
  "contrast",
  "interference",
  "scan",
];
/** With reduced motion, only effects that hold still. */
const CALM_KINDS: GlitchKind[] = ["contrast", "interference"];
const FIRST_AT: [number, number] = [6, 10];
const EVERY: [number, number] = [9, 18];

export interface GlitchTarget {
  element: HTMLElement;
  setGlitch(kind: GlitchKind | null, reduced: boolean): void;
}

export class GlitchScheduler {
  private nextAt = randomBetween(...FIRST_AT);
  /** Running glitches: timer id → undo. */
  private readonly timers = new Map<number, () => void>();

  constructor(private readonly targets: () => GlitchTarget[]) {}

  update(t: number): void {
    if (t < this.nextAt) return;
    this.nextAt = t + randomBetween(...EVERY);
    const targets = this.targets();
    if (targets.length === 0) return;
    const reduced = prefersReducedMotion();
    const kinds = reduced ? CALM_KINDS : KINDS;
    // Usually one feed; sometimes a pair at once.
    const count = Math.random() < 0.25 ? 2 : 1;
    const picks = [...targets].sort(() => Math.random() - 0.5).slice(0, count);
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const duration = randomBetween(500, 1500);
    for (const target of picks) {
      target.setGlitch(kind, reduced);
      target.element.classList.add("is-glitching", `glitch-${kind}`);
      const undo = () => {
        target.setGlitch(null, reduced);
        target.element.classList.remove("is-glitching", `glitch-${kind}`);
      };
      const timer = window.setTimeout(() => {
        this.timers.delete(timer);
        undo();
      }, duration);
      this.timers.set(timer, undo);
    }
  }

  /** Stops scheduling and clears any glitch still showing. */
  destroy(): void {
    for (const [timer, undo] of this.timers) {
      window.clearTimeout(timer);
      undo();
    }
    this.timers.clear();
  }
}
