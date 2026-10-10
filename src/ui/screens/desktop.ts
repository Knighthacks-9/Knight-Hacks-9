// Screen 1: the desktop. Wallpaper, shortcuts, taskbar and Start menu are
// permanent; the KNIGHT'S EYE main-menu window is the "desktop" screen.
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
  "KNIGHT'S EYE v1.04 - ATTENTION TRAINING",
  "=======================================",
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

const ATTRIBUTIONS = [
  "KNIGHT'S EYE - ATTRIBUTIONS",
  "===========================",
  "",
  "Character sprites were made by these artists.",
  "All artwork belongs to its creators.",
  "",
  '"Office Worker Sprite" by 0rdinarystrawberry',
  "   https://www.deviantart.com/0rdinarystrawberry/art/Office-Worker-Sprite-733836592",
  "",
  '"Malvia" by 0rdinarystrawberry',
  "   https://www.deviantart.com/0rdinarystrawberry/art/Malvia-794912205",
  "",
  '"ALOLA - Employe" by wergan',
  "   https://www.deviantart.com/wergan/art/ALOLA---Employe-1333454091",
].join("\n");

const CREDITS = [
  "KNIGHT'S EYE - CREDITS",
  "======================",
  "",
  "Developed by:",
  "",
  "Lilly Liu",
  "   University of Florida",
  "   3rd year, Computer Science",
  "   https://www.linkedin.com/in/lilly-x-liu/",
  "   Contributions:",
  "    - Computer Vision Eye Tracking",
  "    - AI Dispatcher",
  "    - User Interface Design",
  "    - Project Lead",
  "",
  "Karam Hack",
  "   University of Central Florida",
  "   Master's student, Cybersecurity",
  "   https://www.linkedin.com/in/karamhack/",
  "   Contributions:",
  "    - CCTV Gameplay",
  "    - Startup Sequence",
  "    - Website Hosting",
  "",
  "Dev Shill",
  "   University of Central Florida",
  "   1st year, Computer Science",
  "   https://www.linkedin.com/in/dev-shill-0a4ba4440/",
  "   Contributions:",
  "    - World & AI Gameplay",
  "    - Character Sprite Sourcing",
  "    - Mini Map",
  "",
  "Sanjana Metla",
  "   University of Central Florida",
  "   3rd year, Information Technology",
  "   https://www.linkedin.com/in/sanjana-metla",
  "   Contributions:",
  "    - Analytics & Feedback Statistics",
  "    - Debrief Interface",
  "    - Presentation Author",
].join("\n");

const TEXT_FILES = [
  { name: "Readme.txt", text: README },
  { name: "Credits.txt", text: CREDITS },
  { name: "Attributions.txt", text: ATTRIBUTIONS },
];
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
  const openFiles = new Map<string, { destroy(): void; root: HTMLElement }>();

  const openTextFile = (name: string, text: string, index: number) => {
    const existing = openFiles.get(name);
    if (existing?.root.isConnected) {
      existing.root.hidden = false;
      return;
    }
    openFiles.set(
      name,
      openFloatingWindow(
        layer,
        {
          title: `${name} - Viewer`,
          className: "textview",
          onClose: () => {
            openFiles.get(name)?.destroy();
            openFiles.delete(name);
            renderTasks();
          },
        },
        (body) =>
          body.append(
            h("pre", { class: "textview-text", tabindex: "0" }, text),
          ),
        { x: 140 + index * 28, y: 40 + index * 28 },
      ),
    );
    renderTasks();
  };
  const fileOpeners = TEXT_FILES.map(
    (f, i) => [f.name, () => openTextFile(f.name, f.text, i)] as const,
  );

  const shortcuts: Shortcut[] = [
    { label: "Gaze Setup", icon: "gaze", open: () => open("calibration") },
    { label: "Watch Station", icon: "watch", open: () => open("watch") },
    { label: "Last Debrief", icon: "debrief", open: openLastDebrief },
    ...fileOpeners.map(([label, run]) => ({
      label,
      icon: "readme" as const,
      open: run,
    })),
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
    for (const [name, file] of openFiles) {
      tasks.append(
        h(
          "button",
          {
            type: "button",
            class: "task-btn",
            onclick: () => {
              file.root.hidden = !file.root.hidden;
            },
          },
          icon(ICONS.readme, "task-icon"),
          name,
        ),
      );
    }
  }

  const startItem = (
    label: string,
    iconName: keyof typeof ICONS,
    run: () => void,
  ) =>
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
            run();
          },
        },
        icon(ICONS[iconName], "start-icon"),
        label,
      ),
    );

  const menu = h(
    "nav",
    { class: "start-menu", hidden: true, "aria-label": "Start menu" },
    h("div", { class: "start-side", "aria-hidden": "true" }, "KNIGHT'S EYE 98"),
    h(
      "ul",
      null,
      startItem("Begin Shift", "play", () => open("calibration")),
      startItem("Gaze Setup", "eye", () => open("calibration")),
      startItem("Watch Station", "cctv", () => open("watch")),
      startItem("Last Debrief", "chart", openLastDebrief),
      ...fileOpeners.map(([label, run]) => startItem(label, "note", run)),
      startItem("Main Menu", "window", () => open("desktop")),
      h("li", { class: "start-sep", role: "separator" }),
      h(
        "li",
        null,
        h(
          "a",
          { class: "start-item", href: "?ui=classic" },
          icon(ICONS.crt, "start-icon"),
          "Classic Mode...",
        ),
      ),
      h("li", { class: "start-sep", role: "separator" }),
      startItem("Restart", "restart", () => power("restart")),
      startItem("Shut Down", "power", () => power("shutdown")),
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
      for (const file of openFiles.values()) file.destroy();
      openFiles.clear();
      renderTasks();
    },
    setTask(label: string | null, toggle?: () => void) {
      current = label ? { label, toggle } : null;
      renderTasks();
    },
  };
}

/** The KNIGHT'S EYE main-menu window. */
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
      title: "KNIGHT'S EYE - ATTENTION TRAINING",
      className: "menu",
      onMinimize: () => setMinimized(true),
      onClose: () => setMinimized(true),
      closeLabel: "Close KNIGHT'S EYE window",
    },
    (body) =>
      body.append(
        h(
          "div",
          { class: "menu-logo" },
          h("span", { class: "menu-eye", "aria-hidden": "true" }),
          h("h1", { class: "pixel-title menu-title" }, "KNIGHT'S EYE"),
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
  win.root.setAttribute("aria-label", "KNIGHT'S EYE main menu");
  showShift();
  begin.focus();

  function setMinimized(value: boolean): void {
    minimized = value;
    win.root.hidden = value;
    if (!value) begin.focus();
  }
  ctx.setTask("KNIGHT'S EYE", () => setMinimized(!minimized));
  return () => win.destroy();
};
