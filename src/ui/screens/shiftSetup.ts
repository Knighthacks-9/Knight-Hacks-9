// SHIFT_SETUP.CFG: a floating window where the player customizes the next
// shift (difficulty, timer, cameras, crowd, anomalies, distractions).
import { playSfx } from "../../audio";
import {
  MAX_SHIFT_SECONDS,
  MIN_SHIFT_SECONDS,
  SHIFT_SECONDS_STEP,
  clampShiftSeconds,
  saveShiftSeconds,
} from "../../game/levels";
import type { AppContext } from "../context";
import { h, mmss } from "../dom";
import { LEVELS, levelConfig } from "../service";
import {
  AURA_MODES,
  CAMERA_OPTIONS,
  DEFAULT_SHIFT_SETTINGS,
  DISTRACTION_RATES,
  MAX_ANOMALIES,
  MAX_AURA_SECONDS,
  MIN_ANOMALIES,
  MIN_AURA_SECONDS,
  RATES,
  effectiveSettings,
  isCustomized,
  planShift,
  saveShiftSettings,
} from "../shiftSettings";
import { bringToFront, openFloatingWindow } from "../window";

/** Fired on the app root whenever the level, timer or settings change. */
export const SHIFT_SETTINGS_EVENT = "nw:shift-settings";

export function notifyShiftSettings(ctx: AppContext): void {
  ctx.root.dispatchEvent(new CustomEvent(SHIFT_SETTINGS_EVENT));
}

const DIFFICULTY = ["EASY", "NORMAL", "HARD"];
/** Difficulty choice that unlocks every other option. */
const CUSTOM = "custom";
const DIFFICULTY_NOTE = [
  "Anomalies stay tinted red.",
  "Anomalies flash red for 2 seconds, then blend in.",
  "Anomalies flash red for 1 second, then blend in.",
];

let openWindow: { root: HTMLElement; destroy(): void } | null = null;

/** Opens the Shift Setup window, or brings it forward if it is already open. */
export function openShiftSetup(ctx: AppContext): void {
  if (openWindow?.root.isConnected) {
    openWindow.root.hidden = false;
    bringToFront(openWindow.root);
    return;
  }
  const { state } = ctx;
  let rowIds = 0;
  /** Re-reads the state into every control. */
  const refreshers: (() => void)[] = [];

  const changed = (sound: "blip" | "deny" = "blip") => {
    playSfx(sound);
    saveShiftSettings(state.settings);
    notifyShiftSettings(ctx);
  };

  /** A difficulty preset is in force: the options below it are read-only. */
  const locked = () => !state.settings.custom;
  /** What the controls show: the player's options, or the preset's. */
  const view = () =>
    effectiveSettings(levelConfig(state.level), state.settings);

  function row(
    label: string,
    control: HTMLElement,
    note?: HTMLElement,
    lockable = true,
  ) {
    const id = `setup-row-${++rowIds}`;
    control.setAttribute("role", "group");
    control.setAttribute("aria-labelledby", id);
    return h(
      "div",
      { class: lockable ? "setup-row is-lockable" : "setup-row" },
      h("span", { class: "setup-label", id }, label),
      control,
      note,
    );
  }

  /** A row of buttons where exactly one is pressed. */
  function choice<T>(
    options: readonly (readonly [T, string])[],
    get: () => T,
    set: (value: T) => void,
    lockable = true,
  ): HTMLElement {
    const buttons = options.map(([value, label]) =>
      h(
        "button",
        {
          type: "button",
          class: "btn95 setup-option",
          onclick: () => {
            if (get() === value) return;
            set(value);
            changed();
          },
        },
        label,
      ),
    );
    refreshers.push(() =>
      buttons.forEach((button, i) => {
        button.setAttribute("aria-pressed", String(options[i][0] === get()));
        button.disabled = lockable && locked();
      }),
    );
    return h("div", { class: "setup-choice" }, ...buttons);
  }

  /** An LCD readout with - and + buttons. */
  function stepper(
    name: string,
    text: () => string,
    step: (dir: number) => boolean,
    lockable = true,
  ): HTMLElement {
    const value = h("output", {
      class: "menu-shift-value",
      "aria-live": "polite",
    });
    const buttons: HTMLButtonElement[] = [];
    refreshers.push(() => {
      value.textContent = text();
      for (const b of buttons) b.disabled = lockable && locked();
    });
    const button = (dir: number, glyph: string, label: string) => {
      const b = h(
        "button",
        {
          type: "button",
          class: "btn95 btn-sq",
          "aria-label": `${label} ${name}`,
          onclick: () => changed(step(dir) ? "blip" : "deny"),
        },
        glyph,
      );
      buttons.push(b);
      return b;
    };
    return h(
      "div",
      { class: "menu-shift" },
      value,
      button(-1, "-", "Less"),
      button(1, "+", "More"),
    );
  }

  const capitalize = (word: string) => word[0].toUpperCase() + word.slice(1);
  const difficultyNote = h("p", { class: "setup-note" });

  /**
   * An anomaly effect: when it shows, plus a length stepper that appears
   * while it is set to Timed.
   */
  function effect(
    label: string,
    what: string,
    mode: "highlight" | "aura",
    seconds: "highlightSeconds" | "auraSeconds",
  ): HTMLElement {
    const length = stepper(
      `${label} time`,
      () => `${view()[seconds]}s`,
      (dir) => {
        const next = Math.min(
          MAX_AURA_SECONDS,
          Math.max(MIN_AURA_SECONDS, state.settings[seconds] + dir),
        );
        if (next === state.settings[seconds]) return false;
        state.settings[seconds] = next;
        return true;
      },
    );
    const note = h("p", { class: "setup-note" });
    refreshers.push(() => {
      const value = view()[mode];
      length.hidden = value !== "timed";
      note.textContent =
        value === "auto"
          ? "Follows the difficulty."
          : value === "always"
            ? `${what} for as long as the anomaly lasts.`
            : value === "timed"
              ? `${what} for the first ${view()[seconds]}s of each anomaly.`
              : `No ${label.toLowerCase()}.`;
    });
    return row(
      label,
      h(
        "div",
        { class: "setup-effect" },
        choice(
          AURA_MODES.map((m) => [m, capitalize(m)] as const),
          () => view()[mode],
          (value) => (state.settings[mode] = value),
        ),
        length,
      ),
      note,
    );
  }
  const summary = h("p", { class: "setup-summary", role: "status" });
  refreshers.push(() => {
    const level = levelConfig(state.level);
    const { config } = planShift(level, state.shiftSeconds, state.settings);
    difficultyNote.textContent = locked()
      ? (DIFFICULTY_NOTE[level.level - 1] ?? "")
      : `Set every option yourself. Auto options follow ${DIFFICULTY[level.level - 1]}.`;
    rowsEl.classList.toggle("is-locked", locked());
    summary.textContent =
      `NEXT SHIFT: ${mmss(config.durationSeconds)} · ${config.cameraCount} cameras · ` +
      `${config.expectedAnomalies} anomalies` +
      (isCustomized(state.settings) ? " · CUSTOM" : "");
  });

  const rows = [
    row(
      "Difficulty",
      choice<number | typeof CUSTOM>(
        [
          ...LEVELS.map((l) => [l.level, DIFFICULTY[l.level - 1]] as const),
          [CUSTOM, "CUSTOM"],
        ],
        () => (state.settings.custom ? CUSTOM : state.level),
        (value) => {
          // A level locks the options to its preset; Custom frees them.
          state.settings.custom = value === CUSTOM;
          if (value !== CUSTOM) state.level = value;
        },
        false,
      ),
      difficultyNote,
      false,
    ),
    row(
      "Timer",
      stepper(
        "time",
        () => mmss(state.shiftSeconds),
        (dir) => {
          const next = clampShiftSeconds(
            state.shiftSeconds + dir * SHIFT_SECONDS_STEP,
          );
          if (next === state.shiftSeconds) return false;
          state.shiftSeconds = next;
          saveShiftSeconds(next);
          return true;
        },
        false,
      ),
      h(
        "p",
        { class: "setup-note" },
        `${mmss(MIN_SHIFT_SECONDS)} to ${mmss(MAX_SHIFT_SECONDS)}.`,
      ),
      false,
    ),
    row(
      "Cameras",
      choice<number | null>(
        [[null, "Auto"], ...CAMERA_OPTIONS.map((n) => [n, String(n)] as const)],
        () => view().cameraCount,
        (count) => (state.settings.cameraCount = count),
      ),
    ),
    row(
      "Anomalies",
      stepper(
        "anomalies",
        () => String(view().anomalies ?? "AUTO"),
        (dir) => {
          // AUTO sits below the minimum: 1 then "-" goes back to AUTO.
          const current = state.settings.anomalies;
          const next =
            current === null
              ? dir > 0
                ? MIN_ANOMALIES
                : null
              : current + dir < MIN_ANOMALIES
                ? null
                : Math.min(MAX_ANOMALIES, current + dir);
          if (next === current) return false;
          state.settings.anomalies = next;
          return true;
        },
      ),
      h("p", { class: "setup-note" }, "Auto follows the difficulty."),
    ),
    effect(
      "Red highlight",
      "Sprite tinted red",
      "highlight",
      "highlightSeconds",
    ),
    effect("Anomaly aura", "Red embers rise", "aura", "auraSeconds"),
    row(
      "NPC spawn rate",
      choice(
        RATES.map((r) => [r, capitalize(r)] as const),
        () => view().npcRate,
        (rate) => (state.settings.npcRate = rate),
      ),
    ),
    row(
      "Pop-up distractions",
      choice(
        DISTRACTION_RATES.map((r) => [r, capitalize(r)] as const),
        () => view().distractions,
        (rate) => (state.settings.distractions = rate),
      ),
    ),
    row(
      "Feed glitches",
      choice(
        [
          [true, "On"],
          [false, "Off"],
        ] as const,
        () => view().glitches,
        (on) => (state.settings.glitches = on),
      ),
    ),
    row(
      "Report counter",
      choice(
        [
          [true, "On"],
          [false, "Off"],
        ] as const,
        () => view().reportCounter,
        (on) => (state.settings.reportCounter = on),
      ),
      h(
        "p",
        { class: "setup-note" },
        "Shows how many sightings you have reported.",
      ),
    ),
  ];

  const rowsEl = h("div", { class: "setup-rows" }, ...rows);
  const refresh = () => refreshers.forEach((run) => run());
  const close = () => {
    ctx.root.removeEventListener(SHIFT_SETTINGS_EVENT, refresh);
    win.destroy();
    openWindow = null;
  };
  const win = openFloatingWindow(
    ctx.layer,
    {
      title: "SHIFT_SETUP.CFG",
      className: "setup",
      role: "dialog",
      onClose: close,
      closeLabel: "Close Shift Setup",
    },
    (body) =>
      body.append(
        rowsEl,
        summary,
        h(
          "div",
          { class: "popup-actions" },
          h(
            "button",
            {
              type: "button",
              class: "btn95",
              onclick: () => {
                state.settings = { ...DEFAULT_SHIFT_SETTINGS };
                changed();
              },
            },
            "RESET TO DEFAULTS",
          ),
          h(
            "button",
            {
              type: "button",
              class: "btn95 is-default",
              onclick: () => {
                playSfx("click");
                close();
              },
            },
            "OK",
          ),
        ),
      ),
    { x: 40, y: 10 },
  );
  openWindow = win;
  // Also follows changes made elsewhere (the main menu's shift length).
  ctx.root.addEventListener(SHIFT_SETTINGS_EVENT, refresh);
  refresh();
  win.body.querySelector<HTMLElement>("button")?.focus();
}
