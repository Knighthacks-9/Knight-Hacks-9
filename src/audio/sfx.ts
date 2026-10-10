// Short UI sound effects, synthesized with the Web Audio API so no asset files
// are needed. Silently does nothing where Web Audio is unavailable (tests).

export type SfxName =
  | "click"
  | "start"
  | "tick"
  | "capture"
  | "success"
  | "error"
  | "cancel"
  | "warning"
  | "blip"
  | "select"
  | "deny"
  | "send"
  | "talkOn"
  | "talkOff";

interface Tone {
  /** Seconds after the effect starts. */
  at: number;
  duration: number;
  frequency: number;
  /** Frequency to glide to by the end of the tone. */
  slideTo?: number;
  type: OscillatorType;
  gain: number;
}

const MASTER_GAIN = 0.2;

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;

const EFFECTS: Record<SfxName, Tone[]> = {
  click: [
    { at: 0, duration: 0.03, frequency: 1200, type: "square", gain: 0.15 },
  ],
  start: [
    { at: 0, duration: 0.12, frequency: 440, type: "sine", gain: 0.6 },
    { at: 0.12, duration: 0.18, frequency: 660, type: "sine", gain: 0.6 },
  ],
  tick: [{ at: 0, duration: 0.05, frequency: 880, type: "sine", gain: 0.35 }],
  capture: [
    { at: 0, duration: 0.09, frequency: 1320, type: "sine", gain: 0.5 },
  ],
  success: [
    { at: 0, duration: 0.12, frequency: C5, type: "triangle", gain: 0.6 },
    { at: 0.1, duration: 0.12, frequency: E5, type: "triangle", gain: 0.6 },
    { at: 0.2, duration: 0.12, frequency: G5, type: "triangle", gain: 0.6 },
    { at: 0.3, duration: 0.35, frequency: C6, type: "triangle", gain: 0.6 },
  ],
  error: [
    { at: 0, duration: 0.12, frequency: 160, type: "square", gain: 0.3 },
    { at: 0.17, duration: 0.18, frequency: 160, type: "square", gain: 0.3 },
  ],
  cancel: [
    { at: 0, duration: 0.12, frequency: 520, type: "sine", gain: 0.5 },
    {
      at: 0.12,
      duration: 0.2,
      frequency: 440,
      slideTo: 330,
      type: "sine",
      gain: 0.5,
    },
  ],
  warning: [
    { at: 0, duration: 0.25, frequency: 300, type: "triangle", gain: 0.6 },
    { at: 0.4, duration: 0.25, frequency: 300, type: "triangle", gain: 0.6 },
  ],
  blip: [{ at: 0, duration: 0.04, frequency: 700, type: "sine", gain: 0.2 }],
  select: [
    { at: 0, duration: 0.05, frequency: 880, type: "sine", gain: 0.4 },
    { at: 0.05, duration: 0.07, frequency: 1175, type: "sine", gain: 0.4 },
  ],
  deny: [
    {
      at: 0,
      duration: 0.12,
      frequency: 220,
      slideTo: 170,
      type: "square",
      gain: 0.2,
    },
  ],
  send: [
    { at: 0, duration: 0.08, frequency: 660, type: "triangle", gain: 0.5 },
    { at: 0.08, duration: 0.14, frequency: 990, type: "triangle", gain: 0.5 },
  ],
  // Radio key-up and roger-beep chirps for push-to-talk.
  talkOn: [
    { at: 0, duration: 0.04, frequency: 1800, type: "square", gain: 0.12 },
    { at: 0.05, duration: 0.04, frequency: 2400, type: "square", gain: 0.12 },
  ],
  talkOff: [
    { at: 0, duration: 0.04, frequency: 2400, type: "square", gain: 0.12 },
    { at: 0.05, duration: 0.06, frequency: 1600, type: "square", gain: 0.12 },
  ],
};

let context: AudioContext | null = null;
let master: GainNode | null = null;
let unavailable = false;

function output(): { ctx: AudioContext; out: GainNode } | null {
  if (unavailable) return null;
  if (!context || !master) {
    if (typeof AudioContext === "undefined") {
      unavailable = true;
      return null;
    }
    try {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(context.destination);
    } catch (error) {
      console.warn("[sfx] Web Audio unavailable.", error);
      unavailable = true;
      return null;
    }
  }
  // Browsers start the context suspended until a user gesture.
  if (context.state === "suspended") void context.resume().catch(() => {});
  return { ctx: context, out: master };
}

/** Plays a short synthesized sound effect. Never throws. */
export function playSfx(name: SfxName): void {
  const audio = output();
  if (!audio) return;
  const { ctx, out } = audio;
  const start = ctx.currentTime + 0.005;
  try {
    for (const tone of EFFECTS[name]) {
      const begin = start + tone.at;
      const end = begin + tone.duration;
      const oscillator = ctx.createOscillator();
      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.frequency, begin);
      if (tone.slideTo) {
        oscillator.frequency.exponentialRampToValueAtTime(tone.slideTo, end);
      }
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, begin);
      envelope.gain.exponentialRampToValueAtTime(tone.gain, begin + 0.005);
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(envelope).connect(out);
      oscillator.start(begin);
      oscillator.stop(end + 0.02);
    }
  } catch (error) {
    console.warn(`[sfx] Could not play "${name}".`, error);
  }
}
