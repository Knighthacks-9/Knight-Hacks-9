// The AI Dispatch Radio in the Watch Station side console: a desktop radio
// with an LCD, LEDs, waveform, an unmute button, an auto-play switch, and
// push-to-talk.
//
// idle      "CHANNEL OPEN", unmute disabled
// incoming  a transmission is waiting; RX flashes; audio stays muted
// playing   the player unmuted (or auto-play is on); dispatcher audio plays
// listening push-to-talk is open (or transcribing)
import {
  playSfx,
  startListening,
  stopSpeaking,
  voiceInputSupported,
  type Transmission,
} from "../../audio";
import type { VoiceProvider } from "../../shared/types";
import { h, prefersReducedMotion, randomBetween } from "../dom";

export type RadioState = "idle" | "incoming" | "playing" | "listening";

export interface RadioMessage {
  /** Short LCD headline, e.g. "RE: CAM_03". */
  headline: string;
  text: string;
  /** Plays the audio; resolves when it finishes. */
  play(): Promise<unknown>;
  /** Called as the player starts hearing this message. */
  onStart?(): void;
  /** Called when it finishes playing. */
  onEnd?(): void;
}

export interface RadioOptions {
  /** A finished push-to-talk transcript; returns the LCD line to show. */
  onTranscript(text: string, provider: VoiceProvider): string;
  /** The player unmuted a transmission this long after it arrived. */
  onUnmute(delayMs: number): void;
}

const BARS = 28;
const AUTO_PLAY_KEY = "night-watch:radio-autoplay";

function loadAutoPlay(): boolean {
  try {
    return globalThis.localStorage?.getItem(AUTO_PLAY_KEY) === "on";
  } catch {
    return false;
  }
}

function saveAutoPlay(on: boolean): void {
  try {
    localStorage.setItem(AUTO_PLAY_KEY, on ? "on" : "off");
  } catch {
    // Private mode or blocked storage: the switch just isn't remembered.
  }
}

/** True when some form of speech input could work in this browser. */
export function voiceInputAvailable(): boolean {
  return voiceInputSupported();
}

export class DispatchRadio {
  readonly root: HTMLElement;
  state: RadioState = "idle";
  private queue: (RadioMessage & { arrivedAt: number })[] = [];
  private current: RadioMessage | null = null;
  /** Messages received but still in their arrival delay. */
  private inbound = 0;
  /** The player's AUTO-PLAY switch. */
  private autoPlay = loadAutoPlay();
  /** Set by drain(): play everything regardless of the switch. */
  private draining = false;
  private transmission: Transmission | null = null;
  private transcribing = false;
  private pressedAt = 0;
  private notice = "";
  private noticeTimer = 0;
  private waveTimer = 0;
  private destroyed = false;
  private readonly reduced = prefersReducedMotion();

  private readonly lcdStatus: HTMLElement;
  private readonly lcdDetail: HTMLElement;
  private readonly wave: HTMLElement;
  private readonly bars: HTMLElement[];
  private readonly leds: Record<"link" | "rx" | "tx", HTMLElement>;
  private readonly unmuteButton: HTMLButtonElement;
  private readonly autoButton: HTMLButtonElement;
  private readonly autoState: HTMLElement;
  private readonly talkButton: HTMLButtonElement;
  private readonly talkHint: HTMLElement;

  constructor(private readonly options: RadioOptions) {
    const led = (name: string, label: string) =>
      h(
        "span",
        { class: `radio-led led-${name}` },
        h("i", { "aria-hidden": "true" }),
        label,
      );
    this.leds = {
      link: led("link", "LINK"),
      rx: led("rx", "RX"),
      tx: led("tx", "TX"),
    };
    this.bars = Array.from({ length: BARS }, () => h("i"));
    this.wave = h(
      "div",
      { class: "lcd-wave", "aria-hidden": "true" },
      ...this.bars,
    );
    this.lcdStatus = h("div", { class: "lcd-status" });
    this.lcdDetail = h("div", { class: "lcd-detail" });
    const signal = h(
      "span",
      { class: "lcd-signal", "aria-label": "Signal strength 4 of 5" },
      "SIGNAL ",
      ...[1, 2, 3, 4, 5].map((n) => h("i", { class: n <= 4 ? "on" : "" })),
    );

    this.unmuteButton = h(
      "button",
      {
        type: "button",
        class: "radio-btn radio-unmute",
        onclick: () => this.unmute(),
      },
      "NO INCOMING AUDIO",
    );
    this.autoState = h("span", { class: "radio-auto-state" });
    this.autoButton = h(
      "button",
      {
        type: "button",
        class: "radio-btn radio-auto",
        title: "Play each dispatch as it comes in, without unmuting",
        onclick: () => this.setAutoPlay(!this.autoPlay),
      },
      h("i", { class: "radio-auto-led", "aria-hidden": "true" }),
      h("span", null, "AUTO-PLAY DISPATCHES"),
      this.autoState,
    );
    this.talkHint = h(
      "span",
      { class: "radio-btn-sub" },
      'SAY "CAMERA 3, SIGHTING"',
    );
    this.talkButton = h(
      "button",
      {
        type: "button",
        class: "radio-btn radio-talk",
        "aria-describedby": "radio-talk-hint",
        onpointerdown: (event: PointerEvent) => this.onTalkDown(event),
        onpointerup: () => this.onTalkUp(),
        onpointercancel: () => this.onTalkUp(),
        onkeydown: (event: KeyboardEvent) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.toggleTalk();
          }
        },
      },
      h("span", { class: "radio-btn-main" }, "PUSH TO TALK"),
      this.talkHint,
    );
    this.talkHint.id = "radio-talk-hint";

    this.root = h(
      "div",
      { class: "radio" },
      h("div", { class: "radio-grille", "aria-hidden": "true" }),
      h(
        "div",
        { class: "radio-lcd", role: "status", "aria-live": "polite" },
        h(
          "div",
          { class: "lcd-top" },
          h("span", null, "CH 04"),
          h("span", { class: "lcd-freq" }, "148.65"),
        ),
        this.wave,
        this.lcdStatus,
        this.lcdDetail,
        signal,
      ),
      h(
        "div",
        { class: "radio-leds" },
        this.leds.link,
        this.leds.rx,
        this.leds.tx,
      ),
      this.unmuteButton,
      this.autoButton,
      this.talkButton,
    );
    this.render();
  }

  /** True while any transmission is arriving, waiting, or playing. */
  get busy(): boolean {
    return this.inbound > 0 || this.queue.length > 0 || this.current !== null;
  }

  /** Queues a dispatcher transmission; it arrives after a short delay. */
  receive(message: RadioMessage, delayMs = randomBetween(500, 900)): void {
    this.inbound += 1;
    window.setTimeout(() => {
      this.inbound -= 1;
      if (this.destroyed) return;
      this.queue.push({ ...message, arrivedAt: performance.now() });
      playSfx("blip");
      if (this.state === "idle") this.state = "incoming";
      this.render();
      this.autoPlayNext();
    }, delayMs);
  }

  /** Plays every waiting transmission, auto-play or not (the shift is over). */
  drain(): void {
    this.draining = true;
    this.render();
    this.autoPlayNext();
  }

  setAutoPlay(on: boolean): void {
    if (this.destroyed || on === this.autoPlay) return;
    this.autoPlay = on;
    saveAutoPlay(on);
    playSfx(on ? "select" : "cancel");
    this.render();
    this.autoPlayNext();
  }

  /** Space bar push-to-talk (hold). */
  spaceDown(): void {
    if (!this.transmission) this.startTalk();
  }

  spaceUp(): void {
    if (this.transmission) void this.stopTalk();
  }

  destroy(): void {
    this.destroyed = true;
    window.clearInterval(this.waveTimer);
    window.clearTimeout(this.noticeTimer);
    void this.transmission?.stop();
    this.transmission = null;
    stopSpeaking();
  }

  private unmute(): void {
    if (this.state !== "incoming" || !this.queue.length) return playSfx("deny");
    playSfx("click");
    this.playNext(true);
  }

  /** With auto-play on, plays the next transmission once the radio is free. */
  private autoPlayNext(): void {
    if (
      (this.autoPlay || this.draining) &&
      this.state === "incoming" &&
      !this.transcribing &&
      this.queue.length
    ) {
      this.playNext(false);
    }
  }

  private playNext(unmuted: boolean): void {
    const next = this.queue.shift();
    if (!next) return;
    // Only a player's unmute counts toward their response time.
    if (unmuted) this.options.onUnmute(performance.now() - next.arrivedAt);
    this.current = next;
    this.state = "playing";
    this.render();
    next.onStart?.();
    void next
      .play()
      .catch(() => undefined)
      .then(() => {
        if (this.destroyed) return;
        next.onEnd?.();
        this.current = null;
        this.state = this.transmission
          ? "listening"
          : this.queue.length
            ? "incoming"
            : "idle";
        this.render();
        this.autoPlayNext();
      });
  }

  private onTalkDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    if (this.transmission) {
      void this.stopTalk();
      return;
    }
    this.pressedAt = performance.now();
    this.startTalk();
  }

  /** Releasing after a hold sends; a quick click leaves the mic open until clicked again. */
  private onTalkUp(): void {
    if (
      this.transmission &&
      this.pressedAt &&
      performance.now() - this.pressedAt > 400
    ) {
      void this.stopTalk();
    }
    this.pressedAt = 0;
  }

  private toggleTalk(): void {
    if (this.transmission) void this.stopTalk();
    else this.startTalk();
  }

  private startTalk(): void {
    if (this.destroyed || this.transcribing) return;
    if (this.state === "playing") {
      playSfx("deny");
      return this.flash("WAIT FOR DISPATCH TO FINISH");
    }
    if (!voiceInputAvailable()) {
      playSfx("error");
      return this.flash("ERR: NO VOICE INPUT. REPORT MANUALLY.");
    }
    playSfx("talkOn");
    this.transmission = startListening();
    this.state = "listening";
    this.render();
  }

  private async stopTalk(): Promise<void> {
    const transmission = this.transmission;
    if (!transmission) return;
    playSfx("talkOff");
    this.transmission = null;
    this.transcribing = true;
    this.render();
    let text = "";
    try {
      text = await transmission.stop();
    } catch (error) {
      console.warn("[radio] Push-to-talk failed.", error);
    }
    if (this.destroyed) return;
    this.transcribing = false;
    this.state = this.queue.length ? "incoming" : "idle";
    this.flash(
      text
        ? this.options.onTranscript(text, transmission.provider ?? "browser")
        : "NOTHING HEARD. TRY AGAIN OR REPORT MANUALLY.",
    );
    this.autoPlayNext();
  }

  /** Shows a line on the LCD for a few seconds. */
  private flash(text: string): void {
    this.notice = text;
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.notice = "";
      this.render();
    }, 4500);
    this.render();
  }

  private render(): void {
    const { state } = this;
    this.root.dataset.state = state;
    const listening = state === "listening";
    const status = this.transcribing
      ? "TRANSCRIBING..."
      : {
          idle: "CHANNEL OPEN",
          incoming: "INCOMING TRANSMISSION",
          playing: "DISPATCHER SPEAKING",
          listening: "TRANSMITTING",
        }[state];
    this.lcdStatus.textContent = status;
    this.lcdDetail.textContent =
      this.notice ||
      (state === "incoming"
        ? `${this.queue[0]?.headline ?? ""} · AUDIO MUTED`
        : state === "playing"
          ? (this.current?.text ?? "")
          : listening
            ? "SPEAK NOW. RELEASE OR CLICK TO SEND."
            : "");

    this.leds.link.classList.toggle("on", true);
    this.leds.rx.classList.toggle(
      "on",
      state === "incoming" || state === "playing",
    );
    this.leds.rx.classList.toggle("blink", state === "incoming");
    this.leds.tx.classList.toggle("on", listening);

    this.unmuteButton.textContent =
      state === "incoming"
        ? this.queue.length > 1
          ? `UNMUTE DISPATCH (${this.queue.length})`
          : "UNMUTE DISPATCH"
        : state === "playing"
          ? "DISPATCHER SPEAKING"
          : "NO INCOMING AUDIO";
    this.unmuteButton.disabled = state !== "incoming";
    this.unmuteButton.classList.toggle("is-alert", state === "incoming");

    const auto = this.autoPlay || this.draining;
    this.autoButton.classList.toggle("is-on", auto);
    this.autoButton.setAttribute("aria-pressed", String(auto));
    this.autoButton.disabled = this.draining;
    this.autoState.textContent = auto ? "ON" : "OFF";

    this.talkButton.classList.toggle("is-live", listening);
    this.talkButton.setAttribute("aria-pressed", String(listening));
    this.talkButton.disabled = this.transcribing;
    (this.talkButton.firstChild as HTMLElement).textContent = this.transcribing
      ? "TRANSCRIBING"
      : listening
        ? "RELEASE TO SEND"
        : "PUSH TO TALK";

    const animate = state !== "idle" || this.transcribing;
    window.clearInterval(this.waveTimer);
    if (animate) {
      this.waveTimer = window.setInterval(
        () => this.animateWave(),
        this.reduced ? 600 : 90,
      );
      this.animateWave();
    } else {
      for (const bar of this.bars) bar.style.height = "";
    }
  }

  private animateWave(): void {
    const loud =
      this.state === "playing" || this.state === "listening" ? 1 : 0.45;
    this.bars.forEach((bar, i) => {
      const shape = Math.sin((i / BARS) * Math.PI);
      const level = this.reduced
        ? 0.5 * shape
        : (0.15 + Math.random() * 0.85) * shape;
      bar.style.height = `${Math.max(8, Math.round(level * loud * 100))}%`;
    });
  }
}
