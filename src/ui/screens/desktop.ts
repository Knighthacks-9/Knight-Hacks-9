// Screen 1: the desktop. Wallpaper, shortcuts, taskbar and Start menu are
// permanent; the KNIGHT'S EYE main-menu window is the "desktop" screen.
import { playSfx, premium, type PremiumFeature } from "../../audio";
import {
  MAX_SHIFT_SECONDS,
  MIN_SHIFT_SECONDS,
  SHIFT_SECONDS_STEP,
  clampShiftSeconds,
  saveShiftSeconds,
} from "../../game/levels";
import type { AppContext, Screen, ScreenName } from "../context";
import { h, icon, mmss, pad2, prefersReducedMotion } from "../dom";
import { ICONS } from "../icons";
import { bringToFront, openFloatingWindow } from "../window";
import {
  SHIFT_SETTINGS_EVENT,
  notifyShiftSettings,
  openShiftSetup,
} from "./shiftSetup";

const README = [
  "KNIGHT'S EYE v1.04 - ATTENTION TRAINING",
  "=======================================",
  "",
  "1. GAZE SETUP",
  "   Tune sensitivity and smoothing. Enable the webcam and run the",
  "   13-point calibration for eye tracking, or keep mouse fallback on",
  "   and let the pointer stand in for your gaze.",
  "",
  "2. WATCH STATION",
  "   Watch 2, 4 or 6 feeds (Easy to Hard). Look for people loitering,",
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
  "   Graduate student, Cybersecurity",
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
  "    - NPC Sprites",
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
/** Splits text into plain runs and clickable links for each URL in it. */
function linkify(text: string): (string | HTMLAnchorElement)[] {
  return text
    .split(/(https?:\/\/\S+)/)
    .map((part, i) =>
      i % 2
        ? h(
            "a",
            {
              class: "textview-link",
              href: part,
              target: "_blank",
              rel: "noopener noreferrer",
            },
            part,
          )
        : part,
    )
    .filter((part) => part !== "");
}

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
  shiftSetup: () => void,
) {
  const layer = h("div", { class: "desk-layer" });
  const overlay = h("div", { class: "app-overlay" });
  const openFiles = new Map<string, { destroy(): void; root: HTMLElement }>();

  const openTextFile = (name: string, text: string, index: number) => {
    const existing = openFiles.get(name);
    if (existing?.root.isConnected) {
      existing.root.hidden = false;
      activate(existing.root);
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
            h(
              "pre",
              { class: "textview-text", tabindex: "0" },
              ...linkify(text),
            ),
          ),
        { x: 140 + index * 28, y: 40 + index * 28 },
      ),
    );
    activate(openFiles.get(name)!.root);
  };
  const fileOpeners = TEXT_FILES.map(
    (f, i) => [f.name, () => openTextFile(f.name, f.text, i)] as const,
  );

  // Gaze Setup lives inside KNIGHT'S EYE: its shortcuts open that window, and
  // BEGIN SHIFT there starts the calibration.
  const openKnightsEye = () => open("desktop");
  const shortcuts: Shortcut[] = [
    { label: "Knight's Eye", icon: "gaze", open: openKnightsEye },
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

  // One button per open window. The button of the window in front looks
  // pressed; clicking another raises that window, and clicking the pressed
  // one minimizes it.
  interface Task {
    label: string;
    icon: keyof typeof ICONS;
    /** The window, when the taskbar can raise and track it. */
    root?: HTMLElement;
    /** Minimizes or restores a window that keeps its own minimized state. */
    toggle?: () => void;
  }
  const MINIMIZE_MS = 130;
  const tasks = h("div", { class: "task-list" });
  let current: Task | null = null;
  const extras = new Set<Task>();
  /** The window in front, if any. */
  let active: HTMLElement | null = null;
  /** Labels already shown, so only a new button plays its entrance. */
  let shown = new Set<string>();

  const allTasks = (): Task[] => [
    ...(current ? [current] : []),
    ...extras,
    ...[...openFiles].map(([name, file]): Task => ({
      label: name,
      icon: "readme",
      root: file.root,
    })),
  ];
  const visible = (root: HTMLElement) => root.isConnected && !root.hidden;
  const animate = (root: HTMLElement, name: string, ms: number) => {
    if (prefersReducedMotion()) return;
    root.classList.add(name);
    window.setTimeout(() => root.classList.remove(name), ms);
  };

  /** Brings a window to the front and marks its taskbar button. */
  function activate(root: HTMLElement | null): void {
    if (root) watch(root);
    active = root && visible(root) ? root : null;
    if (active) bringToFront(active);
    for (const task of allTasks()) {
      task.root?.classList.toggle("is-inactive", task.root !== active);
    }
    renderTasks();
  }

  /** After a window closes or minimizes, the next one down takes over. */
  function activateTopmost(): void {
    const open = allTasks()
      .map((task) => task.root)
      .filter((root): root is HTMLElement => !!root && visible(root));
    open.sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex));
    activate(open[0] ?? null);
  }

  function onTaskClick(task: Task): void {
    const { root } = task;
    if (!root) {
      playSfx("click");
      task.toggle?.();
      return;
    }
    if (!visible(root)) {
      // Minimized: bring it back.
      playSfx("blip");
      if (task.toggle) task.toggle();
      else root.hidden = false;
      animate(root, "is-restoring", 180);
      activate(root);
    } else if (root !== active) {
      // Behind another window: raise it.
      playSfx("select");
      animate(root, "is-raised", 220);
      activate(root);
    } else if (task.toggle || task !== current) {
      // Already in front: minimize it.
      playSfx("click");
      const minimize = () => {
        if (task.toggle) task.toggle();
        else root.hidden = true;
        activateTopmost();
      };
      if (prefersReducedMotion()) return minimize();
      root.classList.add("is-minimizing");
      window.setTimeout(() => {
        root.classList.remove("is-minimizing");
        minimize();
      }, MINIMIZE_MS);
    }
  }

  function renderTasks(): void {
    const list = allTasks();
    tasks.replaceChildren(
      ...list.map((task) => {
        // A window the taskbar cannot track (no root) always reads as active.
        const isActive = task.root ? task.root === active : true;
        return h(
          "button",
          {
            type: "button",
            class: [
              "task-btn",
              isActive && "is-active",
              !shown.has(task.label) && "is-new",
              task.root && !visible(task.root) && "is-minimized",
            ]
              .filter(Boolean)
              .join(" "),
            "aria-pressed": String(isActive),
            title: task.label,
            onclick: () => onTaskClick(task),
          },
          icon(ICONS[task.icon], "task-icon"),
          h("span", { class: "task-label" }, task.label),
        );
      }),
    );
    shown = new Set(list.map((task) => task.label));
  }

  // Clicking inside a window brings it forward, like its taskbar button.
  const onWindowPress = (event: Event) => {
    const hit = allTasks().find((task) =>
      task.root?.contains(event.target as Node),
    );
    if (hit?.root && hit.root !== active) activate(hit.root);
  };
  layer.addEventListener("pointerdown", onWindowPress, true);
  overlay.addEventListener("pointerdown", onWindowPress, true);

  // Windows also hide, show and close on their own (title-bar buttons, screen
  // changes); keep the taskbar in step with them.
  const watcher = new MutationObserver((records) => {
    for (const task of extras) {
      if (!task.root?.isConnected) extras.delete(task);
    }
    const reopened = records
      .map((record) => record.target)
      .find(
        (node): node is HTMLElement =>
          node instanceof HTMLElement &&
          visible(node) &&
          node !== active &&
          allTasks().some((task) => task.root === node),
      );
    if (reopened) activate(reopened);
    else if (active && !visible(active)) activateTopmost();
    else renderTasks();
  });
  // Only whole windows are watched, so busy screens don't redraw the taskbar.
  for (const host of [layer, overlay]) {
    watcher.observe(host, { childList: true });
  }
  const watch = (root: HTMLElement) =>
    watcher.observe(root, { attributes: true, attributeFilter: ["hidden"] });

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
      startItem("Shift Setup", "window", shiftSetup),
      startItem("Gaze Setup", "eye", openKnightsEye),
      startItem("Watch Station", "cctv", () => open("watch")),
      startItem("Last Debrief", "chart", openLastDebrief),
      ...fileOpeners.map(([label, run]) => startItem(label, "note", run)),
      startItem("Main Menu", "window", () => open("desktop")),
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
      extras.clear();
      activate(null);
    },
    setTask(label: string | null, toggle?: () => void, root?: HTMLElement) {
      current = label ? { label, icon: "app", toggle, root } : null;
      if (root) activate(root);
      else activateTopmost();
    },
    /** Adds a taskbar button for a window opened on top of the current app. */
    addTask(label: string, root: HTMLElement): () => void {
      const task: Task = { label, icon: "window", root };
      extras.add(task);
      activate(root);
      return () => {
        extras.delete(task);
        activateTopmost();
      };
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
    notifyShiftSettings(ctx);
  };
  // Shift Setup can change the length too.
  ctx.root.addEventListener(SHIFT_SETTINGS_EVENT, showShift);
  const premiumRows = [
    premiumSetting("voice", "Realistic voice"),
    premiumSetting("ai", "AI dispatcher"),
  ];
  const stopPremium = premium.onChange(() =>
    premiumRows.forEach((row) => row.render()),
  );
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
          { class: "menu-splash" },
          h(
            "div",
            { class: "menu-logo" },
            icon(ICONS.eye, "menu-eye"),
            h("h1", { class: "pixel-title menu-title" }, "KNIGHT'S EYE"),
          ),
          h("p", { class: "menu-tagline" }, "TRAIN YOUR ATTENTION"),
        ),
        h(
          "section",
          { class: "panel menu-panel" },
          h("div", { class: "panel-title" }, h("h3", null, "SHIFT ORDERS")),
          h(
            "div",
            { class: "panel-body" },
            h(
              "p",
              { class: "menu-copy" },
              "Monitor the camera feeds through the night.",
              h("br"),
              "Report suspicious activity to dispatch without losing focus.",
            ),
            h(
              "div",
              { class: "menu-shift-row" },
              h(
                "span",
                { class: "menu-label", id: "shift-length-label" },
                "Shift length",
              ),
              h(
                "div",
                {
                  class: "menu-shift",
                  role: "group",
                  "aria-labelledby": "shift-length-label",
                },
                shiftValue,
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
            ),
            h(
              "p",
              { class: "sr-only" },
              `Between ${mmss(MIN_SHIFT_SECONDS)} and ${mmss(MAX_SHIFT_SECONDS)}.`,
            ),
            ...premiumRows.map((row) => row.root),
          ),
        ),
        h(
          "div",
          { class: "menu-actions" },
          h(
            "button",
            {
              type: "button",
              class: "btn95",
              onclick: () => {
                playSfx("click");
                openShiftSetup(ctx);
              },
            },
            "SHIFT SETUP...",
          ),
          h(
            "button",
            {
              type: "button",
              class: "btn95",
              onclick: () => {
                playSfx("click");
                ctx.go("watch");
              },
            },
            "SKIP CALIBRATION",
          ),
          begin,
        ),
        h(
          "div",
          { class: "ws-statusbar" },
          h("i", { class: "status-led", "aria-hidden": "true" }),
          "SYSTEM READY",
          h("span", { class: "ws-version" }, "v1.04"),
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
  ctx.setTask("KNIGHT'S EYE", () => setMinimized(!minimized), win.root);
  return () => {
    ctx.root.removeEventListener(SHIFT_SETTINGS_EVENT, showShift);
    stopPremium();
    win.destroy();
  };
};

/**
 * An ON/OFF row for a paid feature. While the server is being asked it reads
 * CHECKING; once the feature stops working it is greyed out and says so.
 */
function premiumSetting(feature: PremiumFeature, label: string) {
  const id = `premium-${feature}-label`;
  const button = h("button", {
    type: "button",
    class: "btn95 menu-premium-toggle",
    "aria-labelledby": id,
    onclick: () => {
      const { status, preference } = premium.state(feature);
      if (status === "unsupported") return playSfx("deny");
      playSfx("click");
      premium.setPreference(feature, !preference);
    },
  });
  const note = h(
    "p",
    { class: "menu-premium-note", hidden: true },
    "This feature is no longer supported.",
  );
  const root = h(
    "div",
    { class: "menu-shift-row menu-premium-row" },
    h("span", { class: "menu-label", id }, label),
    button,
  );
  const wrapper = h("div", { class: "menu-premium" }, root, note);

  function render(): void {
    const { status, preference, forcedOff } = premium.state(feature);
    const unsupported = status === "unsupported";
    wrapper.classList.toggle("is-unsupported", unsupported);
    note.hidden = !unsupported;
    button.disabled = status !== "available";
    button.setAttribute("aria-disabled", String(status !== "available"));
    button.setAttribute(
      "aria-pressed",
      String(status === "available" && preference),
    );
    button.textContent =
      status === "checking"
        ? "CHECKING..."
        : unsupported
          ? "N/A"
          : preference && !forcedOff
            ? "ON"
            : "OFF";
    button.title = unsupported
      ? "This feature is no longer supported."
      : forcedOff
        ? "Turned off by the URL (?voice=free / ?ai=off)."
        : "";
  }
  render();
  return { root: wrapper, render };
}
