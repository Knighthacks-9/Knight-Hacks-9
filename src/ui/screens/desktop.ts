// Screen 1: the desktop. Wallpaper, shortcuts, taskbar and Start menu are
// permanent; the NIGHTWATCH main-menu window is the "desktop" screen.
import { playSfx } from "../../audio";
import {
  MAX_SHIFT_SECONDS,
  MIN_SHIFT_SECONDS,
  SHIFT_SECONDS_STEP,
  clampShiftSeconds,
  saveShiftSeconds,
} from "../../game/levels";
import type { AppContext, Screen, ScreenName } from "../context";
import { h, icon, mmss, pad2 } from "../dom";
import { ICONS } from "../icons";
import { openFloatingWindow } from "../window";

const README = [
  "NIGHTWATCH v1.04 - ATTENTION TRAINING",
  "======================================",
  "",
  "1. GAZE SETUP",
  "   Tune sensitivity and smoothing. Enable the webcam and run the",
  "   9-point calibration for eye tracking, or keep mouse fallback on",
  "   and let the pointer stand in for your gaze.",
  "",
  "2. WATCH STATION",
  "   Watch 4 or 6 feeds (LEVEL_1-3). Look for people loitering,",
  "   revisiting doors, entering restricted rooms, or avoiding cameras.",
  "   Click the corner button on a feed to focus it; ESC restores.",
  "",
  "3. REPORTING",
  "   Press REPORT SIGHTING (or R), then click the feed. Or hold SPACE",
  '   / PUSH TO TALK and say "Camera 3, sighting".',
  "   Dispatch answers on the radio - press UNMUTE DISPATCH to listen.",
  "",
  "4. DISTRACTIONS",
  "   Pop-ups will cover your feeds. Drag them aside or close them.",
  "   Feeds glitch now and then. Keep watching.",
  "",
  "5. DEBRIEF",
  "   END SHIFT / DEBRIEF shows where your attention went.",
  "",
  "Classic version: add ?ui=classic to the address.",
].join("\n");

export type PowerMode = "restart" | "shutdown";

interface Shortcut {
  label: string;
  icon: keyof typeof ICONS;
  open(): void;
}

/** Builds the permanent desktop; returns helpers the app uses. */
export function buildDesktop(
  root: HTMLElement,
  open: (screen: ScreenName) => void,
  openLastDebrief: () => void,
  power: (mode: PowerMode) => void,
) {
  const layer = h("div", { class: "desk-layer" });
  const overlay = h("div", { class: "app-overlay" });
  let readme: { destroy(): void; root: HTMLElement } | null = null;

  const openReadme = () => {
    if (readme?.root.isConnected) {
      readme.root.hidden = false;
      return;
    }
    readme = openFloatingWindow(
      layer,
      {
        title: "Readme.txt - Viewer",
        className: "textview",
        onClose: () => {
          readme?.destroy();
          readme = null;
          renderTasks();
        },
      },
      (body) =>
        body.append(
          h("pre", { class: "textview-text", tabindex: "0" }, README),
        ),
      { x: 140, y: 40 },
    );
    renderTasks();
  };

  const shortcuts: Shortcut[] = [
    { label: "Gaze Setup", icon: "gaze", open: () => open("calibration") },
    { label: "Watch Station", icon: "watch", open: () => open("watch") },
    { label: "Last Debrief", icon: "debrief", open: openLastDebrief },
    { label: "Readme.txt", icon: "readme", open: openReadme },
  ];

  const iconButtons = shortcuts.map((s) => {
    const button = h(
      "button",
      {
        type: "button",
        class: "desk-icon",
        title: `${s.label} (double-click to open)`,
        ondblclick: () => {
          playSfx("click");
          s.open();
        },
        onkeydown: (event: KeyboardEvent) => {
          if (event.key === "Enter") {
            event.preventDefault();
            playSfx("click");
            s.open();
          }
        },
        onpointerup: (event: PointerEvent) => {
          // Touch has no double-click: open on tap.
          if (event.pointerType === "touch") s.open();
        },
        onfocus: () => select(button),
        onclick: () => select(button),
      },
      icon(ICONS[s.icon], "desk-icon-img"),
      h("span", { class: "desk-icon-label" }, s.label),
    );
    return button;
  });
  const select = (button: HTMLElement) =>
    iconButtons.forEach((b) => b.classList.toggle("is-selected", b === button));

  // --- Taskbar -----------------------------------------------------------------
  const clock = h("time", { class: "tray-clock" });
  const tickClock = () => {
    const now = new Date();
    const hours = now.getHours() % 12 || 12;
    clock.textContent = `${pad2(hours)}:${pad2(now.getMinutes())} ${now.getHours() < 12 ? "AM" : "PM"}`;
    clock.dateTime = now.toISOString();
  };
  tickClock();
  window.setInterval(tickClock, 10_000);

  const tasks = h("div", { class: "task-list" });
  let current: { label: string; toggle?: () => void } | null = null;
  function renderTasks(): void {
    tasks.replaceChildren();
    if (current) {
      const c = current;
      tasks.append(
        h(
          "button",
          {
            type: "button",
            class: "task-btn is-active",
            title: c.toggle ? "Minimize or restore" : c.label,
            onclick: () => {
              playSfx("click");
              c.toggle?.();
            },
          },
          icon(ICONS.app, "task-icon"),
          c.label,
        ),
      );
    }
    if (readme) {
      tasks.append(
        h(
          "button",
          {
            type: "button",
            class: "task-btn",
            onclick: () => {
              if (readme) readme.root.hidden = !readme.root.hidden;
            },
          },
          icon(ICONS.readme, "task-icon"),
          "Readme.txt",
        ),
      );
    }
  }

  const menu = h(
    "nav",
    { class: "start-menu", hidden: true, "aria-label": "Start menu" },
    h("div", { class: "start-side", "aria-hidden": "true" }, "NIGHTWATCH 98"),
    h(
      "ul",
      null,
      ...[
        ["Begin Shift", () => open("calibration")],
        ["Gaze Setup", () => open("calibration")],
        ["Watch Station", () => open("watch")],
        ["Last Debrief", openLastDebrief],
        ["Readme.txt", openReadme],
        ["Main Menu", () => open("desktop")],
      ].map(([label, run]) =>
        h(
          "li",
          null,
          h(
            "button",
            {
              type: "button",
              class: "start-item",
              onclick: () => {
                playSfx("click");
                closeMenu();
                (run as () => void)();
              },
            },
            label as string,
          ),
        ),
      ),
      h("li", { class: "start-sep", role: "separator" }),
      h(
        "li",
        null,
        h("a", { class: "start-item", href: "?ui=classic" }, "Classic Mode..."),
      ),
      h("li", { class: "start-sep", role: "separator" }),
      ...(
        [
          ["Restart", "restart"],
          ["Shut Down", "shutdown"],
        ] as const
      ).map(([label, mode]) =>
        h(
          "li",
          null,
          h(
            "button",
            {
              type: "button",
              class: "start-item",
              onclick: () => {
                playSfx("click");
                closeMenu();
                power(mode);
              },
            },
            label,
          ),
        ),
      ),
    ),
  );
  const startButton = h(
    "button",
    {
      type: "button",
      class: "start-btn",
      "aria-expanded": "false",
      "aria-haspopup": "true",
      onclick: () => (menu.hidden ? openMenu() : closeMenu()),
    },
    h("span", { class: "start-mark", "aria-hidden": "true" }),
    "START",
  );
  function openMenu(): void {
    playSfx("click");
    menu.hidden = false;
    startButton.setAttribute("aria-expanded", "true");
    menu.querySelector<HTMLElement>(".start-item")?.focus();
  }
  function closeMenu(): void {
    menu.hidden = true;
    startButton.setAttribute("aria-expanded", "false");
  }
  document.addEventListener("pointerdown", (event) => {
    if (
      !menu.hidden &&
      !(event.target as Element).closest(".start-menu, .start-btn")
    )
      closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      closeMenu();
      startButton.focus();
    }
  });

  const taskbar = h(
    "footer",
    { class: "taskbar" },
    startButton,
    tasks,
    h(
      "div",
      { class: "tray" },
      h("span", {
        class: "tray-net",
        title: "Network: connected",
        "aria-label": "Network connected",
      }),
      clock,
    ),
  );

  root.append(
    h(
      "nav",
      { class: "desk-icons", "aria-label": "Desktop shortcuts" },
      ...iconButtons,
    ),
    layer,
    menu,
    taskbar,
    overlay,
  );

  return {
    layer,
    overlay,
    /** Closes everything the desktop itself opened (power off). */
    reset() {
      closeMenu();
      readme?.destroy();
      readme = null;
      renderTasks();
    },
    setTask(label: string | null, toggle?: () => void) {
      current = label ? { label, toggle } : null;
      renderTasks();
    },
  };
}

/** The NIGHTWATCH main-menu window. */
export const mountMainMenu: Screen = (ctx: AppContext) => {
  let minimized = false;
  const shiftValue = h("output", {
    class: "menu-shift-value",
    "aria-live": "polite",
  });
  const showShift = () => {
    shiftValue.textContent = mmss(ctx.state.shiftSeconds);
  };
  const stepShift = (dir: number) => {
    const next = clampShiftSeconds(
      ctx.state.shiftSeconds + dir * SHIFT_SECONDS_STEP,
    );
    playSfx(next === ctx.state.shiftSeconds ? "deny" : "blip");
    ctx.state.shiftSeconds = next;
    saveShiftSeconds(next);
    showShift();
  };
  const begin = h(
    "button",
    {
      type: "button",
      class: "btn95 btn-go menu-begin",
      onclick: () => {
        playSfx("start");
        ctx.go("calibration");
      },
    },
    "BEGIN SHIFT",
  );
  const win = openFloatingWindow(
    ctx.layer,
    {
      title: "NIGHTWATCH - ATTENTION TRAINING",
      className: "menu",
      onMinimize: () => setMinimized(true),
      onClose: () => setMinimized(true),
      closeLabel: "Close NIGHTWATCH window",
    },
    (body) =>
      body.append(
        h(
          "div",
          { class: "menu-logo" },
          h("span", { class: "menu-eye", "aria-hidden": "true" }),
          h("h1", { class: "pixel-title menu-title" }, "NIGHTWATCH"),
        ),
        h("p", { class: "menu-tagline" }, "TRAIN YOUR ATTENTION"),
        h("hr", { class: "menu-rule" }),
        h(
          "p",
          { class: "menu-copy" },
          "Monitor the camera feeds through the night.",
          h("br"),
          "Report suspicious activity to dispatch without losing focus.",
        ),
        h(
          "p",
          { class: "menu-label", id: "shift-length-label" },
          "SHIFT LENGTH",
        ),
        h(
          "div",
          {
            class: "menu-shift",
            role: "group",
            "aria-labelledby": "shift-length-label",
          },
          h(
            "button",
            {
              type: "button",
              class: "btn95 btn-sq",
              "aria-label": "Shorter shift",
              onclick: () => stepShift(-1),
            },
            "-",
          ),
          shiftValue,
          h(
            "button",
            {
              type: "button",
              class: "btn95 btn-sq",
              "aria-label": "Longer shift",
              onclick: () => stepShift(1),
            },
            "+",
          ),
        ),
        h(
          "p",
          { class: "sr-only" },
          `Between ${mmss(MIN_SHIFT_SECONDS)} and ${mmss(MAX_SHIFT_SECONDS)}.`,
        ),
        begin,
        h(
          "button",
          {
            type: "button",
            class: "link-btn",
            onclick: () => {
              playSfx("click");
              ctx.go("watch");
            },
          },
          "Skip calibration",
        ),
      ),
    { x: 0, y: -24 },
  );
  win.root.setAttribute("aria-label", "NIGHTWATCH main menu");
  showShift();
  begin.focus();

  function setMinimized(value: boolean): void {
    minimized = value;
    win.root.hidden = value;
    if (!value) begin.focus();
  }
  ctx.setTask("NIGHTWATCH", () => setMinimized(!minimized));
  return () => win.destroy();
};
