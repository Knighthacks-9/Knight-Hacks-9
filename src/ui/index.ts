// KNIGHT'S EYE desktop UI: a late-90s desktop that hosts the four screens
// (Desktop/Main Menu → Gaze Calibration → Watch Station → Shift Debrief).
// Screens are switched by a small state-driven controller; game state comes
// from the NightwatchService adapter in ./service.
import { playSfx } from "../audio";
import { loadShiftSeconds } from "../game/levels";
import { attachMouseFallback, gazeController, loadGazeModel } from "../vision";
import type { AppContext, Screen, ScreenName, ScreenParams } from "./context";
import { h } from "./dom";
import { runBootSequence, runShutdown } from "./screens/boot";
import { mountCalibration } from "./screens/calibration";
import { mountDebrief } from "./screens/debrief";
import { buildDesktop, mountMainMenu, type PowerMode } from "./screens/desktop";
import { mountWatchStation } from "./screens/watchStation";
import { levelConfig, nightwatchService } from "./service";
import { openFloatingWindow } from "./window";
import "./nightwatch.css";

const SCREENS: Record<ScreenName, Screen> = {
  desktop: mountMainMenu,
  calibration: mountCalibration,
  watch: mountWatchStation,
  debrief: mountDebrief,
};

/** A faint pixel-noise texture shared by the wallpaper and camera feeds. */
function installNoiseTexture(): void {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 96;
  const g = canvas.getContext("2d");
  if (!g) return;
  const image = g.createImageData(96, 96);
  for (let i = 0; i < image.data.length; i += 4) {
    // Light and dark specks with low alpha, so it overlays without blend modes.
    const v = Math.random() < 0.5 ? 0 : 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = Math.random() * 28;
  }
  g.putImageData(image, 0, 0);
  document.documentElement.style.setProperty(
    "--noise",
    `url(${canvas.toDataURL()})`,
  );
}

export function startNightwatchUi(root: HTMLElement): void {
  const service = nightwatchService;
  document.body.classList.add("nw");
  root.classList.add("nw-root");
  installNoiseTexture();

  // Saved gaze tuning and calibration, shared with the classic scenes.
  void service.saveCalibration(service.loadCalibration());
  if (!gazeController.isCalibrated()) gazeController.setModel(loadGazeModel());
  // The mouse stands in for gaze anywhere in the app.
  attachMouseFallback(root);

  const query = new URLSearchParams(location.search);
  const requestedLevel = Number(query.get("level"));
  let cleanup: (() => void) | null = null;
  let switching = false;

  const desktop = buildDesktop(
    root,
    (screen) => ctx.go(screen),
    () => void openLastDebrief(),
    (mode) => void powerCycle(mode),
  );

  const ctx: AppContext = {
    service,
    root,
    layer: desktop.layer,
    overlay: desktop.overlay,
    state: {
      level: levelConfig(
        Number.isFinite(requestedLevel) && requestedLevel > 0
          ? requestedLevel
          : 1,
      ).level,
      shiftSeconds: loadShiftSeconds(),
    },
    go(screen: ScreenName, params: ScreenParams = {}) {
      if (switching) return;
      switching = true;
      try {
        cleanup?.();
        cleanup = null;
        ctx.setTask(null);
        root.dataset.screen = screen;
        cleanup = SCREENS[screen](ctx, params);
      } finally {
        switching = false;
      }
    },
    setTask: desktop.setTask,
  };

  /** Closes whatever is running, then boots back to the desktop. */
  async function powerCycle(mode: PowerMode): Promise<void> {
    if (switching) return;
    cleanup?.();
    cleanup = null;
    ctx.setTask(null);
    desktop.reset();
    desktop.layer.replaceChildren();
    delete root.dataset.screen;
    if (mode === "shutdown") await runShutdown(root);
    await runBootSequence(root);
    ctx.go("desktop");
  }

  async function openLastDebrief(): Promise<void> {
    const result = await service.getLastResult();
    if (result) return ctx.go("debrief", { result });
    playSfx("error");
    const note = openFloatingWindow(
      ctx.layer,
      {
        title: "LAST_DEBRIEF",
        className: "msgbox",
        role: "alertdialog",
        onClose: () => note.destroy(),
      },
      (body) =>
        body.append(
          h(
            "div",
            { class: "msgbox-body" },
            h("p", null, "No debrief on file."),
            h("p", null, "Complete a shift at the Watch Station first."),
          ),
          h(
            "div",
            { class: "popup-actions" },
            h(
              "button",
              {
                type: "button",
                class: "btn95 is-default",
                onclick: () => note.destroy(),
              },
              "OK",
            ),
          ),
        ),
      { x: 60, y: 60 },
    );
    note.body.querySelector("button")?.focus();
  }

  // Dev shortcut: ?screen=calibration|watch|debrief opens that screen directly.
  const start = query.get("screen") as ScreenName | null;
  if (start === "debrief") void openLastDebrief();
  else if (start && start in SCREENS) ctx.go(start);
  // The boot intro teaches the game; ?boot=0 skips it.
  else if (query.get("boot") === "0") ctx.go("desktop");
  else void runBootSequence(root).then(() => ctx.go("desktop"));
}
