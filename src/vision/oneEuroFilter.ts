/**
 * One Euro filter (Casiez et al., 2012): heavy smoothing while the signal is
 * still, light smoothing while it moves fast. Suits gaze, which jitters during
 * fixations and jumps during saccades.
 */
export class OneEuroFilter {
  private value: number | null = null;
  private derivative = 0;
  private lastTime = 0;

  constructor(
    public minCutoff = 1,
    public beta = 0.5,
    public derivativeCutoff = 1,
  ) {}

  filter(value: number, timeMs: number): number {
    if (this.value === null) {
      this.value = value;
      this.derivative = 0;
      this.lastTime = timeMs;
      return value;
    }
    // Repeated reads within one frame must not count as an instant jump.
    if (timeMs <= this.lastTime) return this.value;

    const dt = (timeMs - this.lastTime) / 1000;
    this.lastTime = timeMs;
    const rawDerivative = (value - this.value) / dt;
    this.derivative +=
      smoothingFactor(dt, this.derivativeCutoff) *
      (rawDerivative - this.derivative);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    this.value += smoothingFactor(dt, cutoff) * (value - this.value);
    return this.value;
  }

  reset(): void {
    this.value = null;
    this.derivative = 0;
  }
}

function smoothingFactor(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}
