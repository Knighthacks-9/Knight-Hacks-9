// Intro: the machine boots (BIOS self-test), then the operator briefing
// teaches the game one step at a time before the desktop appears.
import { playSfx } from "../../audio";
import { h, prefersReducedMotion } from "../dom";

const POST_LINES = [
  "KNIGHT SYSTEMS BIOS v1.04",
  "Night Shift Workstation NW-98",
  "",
  "Memory test ........ 65536K OK",
  "Camera bus ......... 16 feeds found",
  "Radio link ......... DISPATCH online",
  "Gaze sensor ........ standby",
  "",
  "Starting NIGHTWATCH 98 ...",
];

interface BriefingStep {
  title: string;
  lines: string[];
}

const BRIEFING: BriefingStep[] = [
  {
    title: "WATCH THE FEEDS",
    lines: [
      "You are the night operator. Monitor every camera feed.",
      "Look for people loitering, revisiting doors, entering",
      "restricted rooms, or avoiding the cameras.",
    ],
  },
  {
    title: "YOUR EYES ARE THE CONTROLLER",
    lines: [
      "Gaze Setup calibrates the webcam so NIGHTWATCH knows which",
      "feed you are looking at. No webcam? The mouse pointer stands",
      "in for your gaze.",
    ],
  },
  {
    title: "REPORT A SIGHTING",
    lines: [
      "Press REPORT SIGHTING (or R), then click the feed where you",
      "saw it. Number keys 1-9 pick a feed. ESC cancels.",
    ],
  },
  {
    title: "USE THE RADIO",
    lines: [
      'Hold SPACE to talk to dispatch: "Camera 3, sighting".',
      "Press UNMUTE DISPATCH to hear the replies.",
    ],
  },
  {
    title: "STAY FOCUSED",
    lines: [
      "Pop-ups will cover your feeds and feeds will glitch.",
      "Drag pop-ups aside or close them. Keep watching.",
    ],
  },
  {
    title: "READ YOUR DEBRIEF",
    lines: [
      "When the shift ends, the debrief shows where your attention",
      "went: what you caught, what you missed, and why.",
    ],
  },
];

const LINE_MS = 140;
const CHAR_MS = 14;

/** Plays the boot intro over the whole app; resolves when it is dismissed. */
export function runBootSequence(root: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const instant = prefersReducedMotion();
    const log = h("pre", { class: "boot-log", "aria-live": "polite" });
    // Always takes up its line, so showing it never covers the text.
    const prompt = h("p", { class: "boot-prompt" }, "\u00a0");
    const bar = h("div", { class: "boot-bar-fill" });
    const skip = h(
      "button",
      { type: "button", class: "boot-skip", onclick: () => finish() },
      "Skip intro (ESC)",
    );
    const screen = h(
      "section",
      { class: "boot", "aria-label": "System start-up and tutorial" },
      log,
      prompt,
      h(
        "div",
        { class: "boot-foot" },
        h("div", { class: "boot-bar", "aria-hidden": "true" }, bar),
        skip,
      ),
    );

    let done = false;
    /** Set while typing a line; a key press prints the rest at once. */
    let rush = false;
    /** Ends the wait in progress early (a key press or click). */
    let advance: (() => void) | null = null;

    const wait = (ms: number) =>
      new Promise<void>((next) => {
        const timer = window.setTimeout(next, ms);
        advance = () => {
          window.clearTimeout(timer);
          next();
        };
      });
    const waitForInput = () =>
      new Promise<void>((next) => {
        advance = next;
      });

    const print = (text: string) => {
      log.append(text);
      log.scrollTop = log.scrollHeight;
    };
    async function type(text: string): Promise<void> {
      for (const char of text) {
        if (done) return;
        print(char);
        if (!instant && !rush) await wait(CHAR_MS);
      }
    }
    const setProgress = (fraction: number) => {
      bar.style.width = `${Math.round(fraction * 100)}%`;
    };

    async function play(): Promise<void> {
      for (const line of POST_LINES) {
        if (done) return;
        print(`${line}\n`);
        if (line && !instant) playSfx("tick");
        if (!instant) await wait(LINE_MS);
      }
      print("\nLOADING OPERATOR BRIEFING ...\n");
      if (!instant) await wait(LINE_MS * 4);

      for (const [i, step] of BRIEFING.entries()) {
        if (done) return;
        setProgress(i / BRIEFING.length);
        playSfx("blip");
        // One step per screen, so the text never runs into the prompt.
        log.replaceChildren(
          `OPERATOR BRIEFING  ${i + 1} / ${BRIEFING.length}\n\n`,
          h("strong", { class: "boot-step" }, step.title),
          "\n\n",
        );
        rush = false;
        for (const line of step.lines) await type(`${line}\n`);
        if (done) return;
        const last = i === BRIEFING.length - 1;
        prompt.textContent = last
          ? "Press any key to start your shift"
          : "Press any key to continue";
        prompt.classList.add("is-waiting");
        await waitForInput();
        prompt.classList.remove("is-waiting");
      }
      setProgress(1);
      finish();
    }

    function onInput(event: Event): void {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") return finish();
        // Leave Tab and modifier keys alone so the Skip button stays reachable.
        const printable = event.key.length === 1 || event.key === "Enter";
        if (!printable) return;
        event.preventDefault();
      } else if ((event.target as Element).closest(".boot-skip")) {
        return;
      }
      // Mid-line this finishes the line; at a prompt it moves on.
      rush = true;
      const next = advance;
      advance = null;
      next?.();
    }

    function finish(): void {
      if (done) return;
      done = true;
      window.removeEventListener("keydown", onInput, true);
      screen.remove();
      playSfx("start");
      advance?.();
      resolve();
    }

    window.addEventListener("keydown", onInput, true);
    screen.addEventListener("pointerdown", onInput);
    root.append(screen);
    skip.focus();
    void play();
  });
}
