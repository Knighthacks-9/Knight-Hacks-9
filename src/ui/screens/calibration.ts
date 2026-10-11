// Screen 2: GAZE_CALIBRATION.EXE. Pointer tuning, webcam control, the
// 13-point calibration, a gaze test with click-to-correct, and a debug overlay.
//
// Calibration uses the real eye-tracking pipeline (src/vision) when the
// webcam is tracking. Without a webcam it runs a pointer calibration: the
// player clicks each target, which measures pointer accuracy only.
import { playSfx } from "../../audio";
import {
  checkHeadAlignment,
  clearGazeCorrection,
  fitGazeModel,
  gazeController,
  headGuide,
  mediaPipeGazeTracker,
  predictUncorrectedGaze,
  refineGazeModel,
  saveGazeModel,
  validationErrorPx,
  type CalibrationSample,
  type GazePoint,
  type TrackerPhase,
} from "../../vision";
import type { AppContext, Screen } from "../context";
import { clamp, h, icon } from "../dom";
import { ICONS } from "../icons";
import type { CalibrationSettings } from "../service";
import { openFloatingWindow } from "../window";

// Center first, then around the edge so the eyes never cross the whole
// screen, then four inner points for the middle, where most feeds sit.
const TARGETS: (GazePoint & { name: string })[] = [
  { x: 0.5, y: 0.5, name: "Center" },
  { x: 0.08, y: 0.1, name: "Top-left" },
  { x: 0.5, y: 0.1, name: "Top-center" },
  { x: 0.92, y: 0.1, name: "Top-right" },
  { x: 0.92, y: 0.5, name: "Center-right" },
  { x: 0.92, y: 0.9, name: "Bottom-right" },
  { x: 0.5, y: 0.9, name: "Bottom-center" },
  { x: 0.08, y: 0.9, name: "Bottom-left" },
  { x: 0.08, y: 0.5, name: "Center-left" },
  { x: 0.3, y: 0.3, name: "Inner top-left" },
  { x: 0.7, y: 0.3, name: "Inner top-right" },
  { x: 0.7, y: 0.7, name: "Inner bottom-right" },
  { x: 0.3, y: 0.7, name: "Inner bottom-left" },
];
// Head sweep: eyes stay on each dot while the head turns and nods. Kept
// clear of TARGETS so each sweep is its own calibration point.
const SWEEPS: (GazePoint & { name: string })[] = [
  { x: 0.5, y: 0.45, name: "Sweep center" },
  { x: 0.25, y: 0.62, name: "Sweep left" },
  { x: 0.75, y: 0.62, name: "Sweep right" },
];
/** How long the face must stay in view before calibration starts by itself. */
const ALIGN_HOLD_MS = 1500;
const INTRO_MS = 1800;
const SWEEP_INTRO_MS = 3200;
/** Head movement wanted per sweep, in radians from one extreme to the other. */
const SWEEP_YAW = 0.3;
const SWEEP_PITCH = 0.18;
const SWEEP_MIN_MS = 3000;
const SWEEP_MAX_MS = 10000;
const MOVE_MS = 500;
const SETTLE_MS = 500;
const COLLECT_MS = 1200;
const MIN_POINT_SAMPLES = 15;
const STALL_WARNING_MS = 3000;
/** Click-to-correct: frames gathered while the player keeps looking. */
const REFINE_MS = 700;
const MIN_REFINE_FRAMES = 6;

const TRACKING: TrackerPhase[] = ["running", "no-face", "no-eyes"];
const STARTING: TrackerPhase[] = ["requesting", "loading"];

type Tone = "ok" | "warn" | "error" | "off";

function quality(errorPx: number): string {
  if (errorPx <= 60) return "GOOD";
  if (errorPx <= 110) return "FAIR";
  return "POOR";
}

export const mountCalibration: Screen = (ctx) => {
  const { service } = ctx;
  let settings: CalibrationSettings = service.loadCalibration();
  let debug = false;
  let notice: { text: string; tone: Tone } | null = null;
  let overlayCleanup: (() => void) | null = null;
  let raf = 0;
  let minimized = false;

  // --- Controls ---------------------------------------------------------------
  const badge = h("div", {
    class: "calib-badge",
    role: "status",
    "aria-live": "polite",
  });
  const value = () => h("output", { class: "calib-value" });
  const sensitivityValue = value();
  const smoothingValue = value();
  const fallbackValue = value();
  const stepper = (name: string, onStep: (dir: number) => void) =>
    h(
      "div",
      { class: "calib-stepper" },
      h(
        "button",
        {
          type: "button",
          class: "btn95",
          "aria-label": `Decrease ${name}`,
          onclick: () => onStep(-1),
        },
        "-",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn95",
          "aria-label": `Increase ${name}`,
          onclick: () => onStep(1),
        },
        "+",
      ),
    );
  const webcamButton = h("button", {
    type: "button",
    class: "btn95 calib-webcam",
    onclick: () => toggleWebcam(),
  });
  const webcamInfo = h("p", { class: "calib-small", "aria-live": "polite" });
  const previewButton = h("button", {
    type: "button",
    class: "btn95 btn-small",
    onclick: () => {
      playSfx("click");
      mediaPipeGazeTracker.setPreviewHidden(
        !mediaPipeGazeTracker.isPreviewHidden(),
      );
    },
  });
  const calibInfo = h("span", { class: "calib-info", "aria-live": "polite" });
  const debugButton = h("button", {
    type: "button",
    class: "btn95",
    "aria-pressed": "false",
    "aria-keyshortcuts": "D",
    onclick: () => toggleDebug(),
  });

  const row = (label: string, output: HTMLElement, control: HTMLElement) =>
    h(
      "div",
      { class: "calib-row" },
      h("span", { class: "calib-label" }, label),
      output,
      control,
    );
  const panel = (title: string, ...children: HTMLElement[]) =>
    h(
      "section",
      { class: "panel calib-panel" },
      h("div", { class: "panel-title" }, h("h3", null, title)),
      h("div", { class: "panel-body" }, ...children),
    );

  const win = openFloatingWindow(
    ctx.layer,
    {
      title: "GAZE_CALIBRATION.EXE",
      className: "calib",
      onMinimize: () => setMinimized(true),
      maximize: true,
      onClose: () => ctx.go("desktop"),
      closeLabel: "Close and return to desktop",
    },
    (body) =>
      body.append(
        h(
          "div",
          { class: "calib-head" },
          icon(ICONS.gaze, "calib-logo"),
          h(
            "div",
            { class: "calib-heading" },
            h("h1", { class: "pixel-title" }, "GAZE CALIBRATION"),
            h(
              "p",
              { class: "calib-sub" },
              "Tune your input before starting a shift.",
            ),
          ),
          badge,
        ),
        h(
          "div",
          { class: "calib-grid" },
          panel(
            "POINTER TUNING",
            h(
              "div",
              { class: "calib-rows" },
              row(
                "Sensitivity",
                sensitivityValue,
                stepper("sensitivity", (d) => adjust("sensitivity", d * 0.1)),
              ),
              row(
                "Smoothing",
                smoothingValue,
                stepper("smoothing", (d) => adjust("smoothing", d * 0.1)),
              ),
              row(
                "Mouse fallback",
                fallbackValue,
                h(
                  "button",
                  {
                    type: "button",
                    class: "btn95 calib-toggle",
                    onclick: () => toggleFallback(),
                  },
                  "TOGGLE",
                ),
              ),
            ),
          ),
          panel(
            "WEBCAM",
            h(
              "div",
              { class: "calib-camera" },
              h(
                "div",
                { class: "calib-monitor" },
                icon(ICONS.cctv, "calib-monitor-icon"),
                webcamInfo,
              ),
              webcamButton,
              previewButton,
            ),
          ),
        ),
        panel(
          "EYE CALIBRATION",
          h(
            "p",
            { class: "calib-note" },
            "Until you calibrate, or whenever your eyes are not tracked, the mouse can stand in for gaze.",
          ),
          h(
            "div",
            { class: "calib-actions" },
            h(
              "button",
              {
                type: "button",
                class: "btn95 is-default btn-wide",
                onclick: () => startCalibration(),
              },
              `START ${TARGETS.length}-POINT CALIBRATION`,
            ),
            h(
              "button",
              { type: "button", class: "btn95", onclick: () => startTest() },
              "TEST GAZE",
            ),
          ),
        ),
        h(
          "div",
          { class: "calib-foot" },
          debugButton,
          h(
            "button",
            {
              type: "button",
              class: "btn95 btn-go",
              onclick: () => {
                playSfx("start");
                ctx.go("watch");
              },
            },
            "CONTINUE TO SHIFT",
          ),
        ),
        h(
          "div",
          { class: "ws-statusbar calib-status" },
          h("i", { class: "status-led", "aria-hidden": "true" }),
          calibInfo,
          h("span", { class: "ws-version" }, "v1.04"),
        ),
      ),
  );
  win.root.setAttribute("aria-label", "Gaze calibration");

  function setMinimized(value: boolean): void {
    minimized = value;
    win.root.hidden = value;
  }
  ctx.setTask("GAZE_CALIBRATION.EXE", () => setMinimized(!minimized));

  const debugPanel = h("pre", {
    class: "debug-overlay",
    "aria-live": "off",
    hidden: true,
  });
  const cursor = h("div", {
    class: "gaze-cursor",
    "aria-hidden": "true",
    hidden: true,
  });
  ctx.overlay.append(debugPanel, cursor);

  // --- Settings ---------------------------------------------------------------
  function persist(): void {
    void service.saveCalibration(settings);
  }

  function adjust(key: "sensitivity" | "smoothing", amount: number): void {
    const [min, max] = key === "sensitivity" ? [0.5, 2] : [0, 0.9];
    const next = clamp(
      Math.round((settings[key] + amount) * 10) / 10,
      min,
      max,
    );
    playSfx(next === settings[key] ? "deny" : "click");
    settings = { ...settings, [key]: next };
    persist();
    render();
  }

  function toggleFallback(): void {
    playSfx("click");
    settings = { ...settings, mouseFallback: !settings.mouseFallback };
    persist();
    render();
  }

  function toggleDebug(): void {
    playSfx("click");
    debug = !debug;
    render();
  }

  function toggleWebcam(): void {
    playSfx("click");
    const phase = mediaPipeGazeTracker.getStatus().phase;
    if ([...TRACKING, ...STARTING].includes(phase)) {
      mediaPipeGazeTracker.stop();
      return;
    }
    notice = null;
    void mediaPipeGazeTracker.start().catch(() => render());
  }

  function badgeState(): { text: string; tone: Tone } {
    if (notice) return notice;
    const phase = mediaPipeGazeTracker.getStatus().phase;
    const source = gazeController.getSource();
    if (phase === "requesting")
      return { text: "REQUESTING CAMERA", tone: "warn" };
    if (phase === "loading")
      return { text: "LOADING FACE MODEL", tone: "warn" };
    if (phase === "error") return { text: "WEBCAM ERROR", tone: "error" };
    if (phase === "no-face") return { text: "FACE NOT DETECTED", tone: "warn" };
    if (phase === "no-eyes") return { text: "EYES NOT TRACKED", tone: "warn" };
    const alignment = mediaPipeGazeTracker.getAlignment();
    if (phase === "running" && !alignment.aligned) {
      return {
        text: `ALIGN HEAD · ${alignment.hint.toUpperCase()}`,
        tone: "warn",
      };
    }
    if (source === "tracker")
      return { text: "EYE TRACKING ACTIVE", tone: "ok" };
    if (phase === "running") {
      return {
        text: gazeController.isCalibrated()
          ? "EYES NOT TRACKED"
          : "WEBCAM READY · CALIBRATE",
        tone: "warn",
      };
    }
    return settings.mouseFallback
      ? { text: "MOUSE FALLBACK ENABLED", tone: "warn" }
      : { text: "MOUSE FALLBACK DISABLED", tone: "off" };
  }

  let lastBadge = "";
  function renderBadge(): void {
    const { text, tone } = badgeState();
    if (text + tone === lastBadge) return;
    lastBadge = text + tone;
    badge.dataset.tone = tone;
    badge.replaceChildren(
      h("i", { class: "badge-dot", "aria-hidden": "true" }),
      text,
    );
  }

  function render(): void {
    sensitivityValue.textContent = `${settings.sensitivity.toFixed(1)}×`;
    smoothingValue.textContent = `${Math.round(settings.smoothing * 100)}%`;
    fallbackValue.textContent = settings.mouseFallback ? "ON" : "OFF";
    fallbackValue.classList.toggle("is-off", !settings.mouseFallback);

    const status = mediaPipeGazeTracker.getStatus();
    webcamButton.textContent = STARTING.includes(status.phase)
      ? "Cancel start"
      : TRACKING.includes(status.phase)
        ? "Disable webcam"
        : "Enable webcam";
    webcamInfo.textContent = status.message;
    previewButton.textContent = `Camera preview: ${mediaPipeGazeTracker.isPreviewHidden() ? "HIDDEN" : "SHOWN"}`;
    previewButton.hidden = !TRACKING.includes(status.phase);

    const model = gazeController.getModel();
    const pointerError = model ? undefined : settings.estimatedErrorPx;
    const clicks = model?.correction?.points.length ?? 0;
    calibInfo.textContent = model
      ? `Eye calibration · est. error ≈ ${Math.round(validationErrorPx(model, innerWidth, innerHeight))} px (${quality(validationErrorPx(model, innerWidth, innerHeight)).toLowerCase()})${clicks ? ` · fine-tuned with ${clicks} click${clicks === 1 ? "" : "s"}` : " · fine-tune it in TEST GAZE"}`
      : pointerError !== undefined
        ? `Pointer calibration · error ≈ ${Math.round(pointerError)} px${settings.mouseFallback ? " · mouse fallback available" : ""}`
        : `Not calibrated${settings.mouseFallback ? " · mouse fallback available" : " · no gaze source"}`;

    debugButton.textContent = `Debug overlay: ${debug ? "ON" : "OFF"}`;
    debugButton.setAttribute("aria-pressed", String(debug));
    debugPanel.hidden = !debug;
    renderBadge();
  }

  // --- Overlays ---------------------------------------------------------------
  function closeOverlay(): void {
    overlayCleanup?.();
    overlayCleanup = null;
    mediaPipeGazeTracker.setPreviewVisible(true);
    render();
  }

  function startCalibration(): void {
    const phase = mediaPipeGazeTracker.getStatus().phase;
    if (
      phase === "no-face" ||
      phase === "no-eyes" ||
      STARTING.includes(phase)
    ) {
      playSfx("error");
      notice = { text: "WAIT UNTIL BOTH EYES ARE TRACKED", tone: "error" };
      render();
      window.setTimeout(() => {
        notice = null;
        render();
      }, 3500);
      return;
    }
    notice = null;
    closeOverlay();
    playSfx("start");
    overlayCleanup = runCalibration(
      ctx,
      phase === "running" ? "webcam" : "pointer",
      (result) => {
        overlayCleanup?.();
        overlayCleanup = showResult(ctx, result, {
          test: () => {
            closeOverlay();
            startTest();
          },
          done: () => closeOverlay(),
        });
        if (result.mode === "pointer" && result.errorPx !== null) {
          settings = { ...settings, estimatedErrorPx: result.errorPx };
          persist();
        }
        render();
      },
      () => {
        closeOverlay();
        notice = { text: "CALIBRATION CANCELLED", tone: "warn" };
        render();
        window.setTimeout(() => {
          notice = null;
          render();
        }, 2500);
      },
    );
  }

  function startTest(): void {
    closeOverlay();
    playSfx("click");
    overlayCleanup = runGazeTest(ctx, {
      back: () => closeOverlay(),
      shift: () => ctx.go("watch"),
      debug: () => debug,
    });
  }

  // --- Loop: live badge, debug overlay, gaze cursor ----------------------------
  function loop(now: number): void {
    raf = requestAnimationFrame(loop);
    renderBadge();
    const point = gazeController.getPoint(now);
    const source = gazeController.getSource(now);
    const box = ctx.root.getBoundingClientRect();
    cursor.hidden =
      !point || !(debug || source === "tracker") || overlayCleanup !== null;
    if (point)
      cursor.style.transform = `translate(${point.x * box.width}px, ${point.y * box.height}px)`;
    if (debug) {
      const f = gazeController.getTrackerFeatures();
      const fmt = (p: GazePoint | null) =>
        p ? `${p.x.toFixed(3)}, ${p.y.toFixed(3)}` : "—";
      const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(3)}`;
      debugPanel.textContent = [
        `source ${source}  calibrated ${gazeController.isCalibrated() ? "yes" : "no"}  blink ${f?.blink ? "yes" : "no"}`,
        f
          ? `eye ${signed(f.eyeX)} ${signed(f.eyeY)}  open ${f.openness.toFixed(2)}`
          : "eye —",
        f ? `head yaw ${signed(f.yaw)} pitch ${signed(f.pitch)}` : "head —",
        `raw ${fmt(gazeController.getRawPoint(now))}  out ${fmt(point)}`,
      ].join("\n");
    }
  }

  function onKey(event: KeyboardEvent): void {
    if (
      overlayCleanup ||
      (event.target as HTMLElement).closest?.("input, textarea")
    )
      return;
    if (event.key === "d" || event.key === "D") toggleDebug();
  }

  const stopTracker = mediaPipeGazeTracker.onStatusChange(() => render());
  const stopPreview = mediaPipeGazeTracker.onPreviewHiddenChange(() =>
    render(),
  );
  window.addEventListener("keydown", onKey);
  raf = requestAnimationFrame(loop);
  render();

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
    stopTracker();
    stopPreview();
    overlayCleanup?.();
    mediaPipeGazeTracker.setPreviewVisible(true);
    debugPanel.remove();
    cursor.remove();
    win.destroy();
  };
};

// ---------------------------------------------------------------------------
// Calibration overlay
// ---------------------------------------------------------------------------

interface CalibrationResult {
  mode: "webcam" | "pointer";
  ok: boolean;
  /** Mean error in px, null when the fit failed. */
  errorPx: number | null;
  /** Per target: where it was and where it landed (fractions of the screen). */
  points: { target: GazePoint; actual: GazePoint }[];
}

function runCalibration(
  ctx: AppContext,
  mode: "webcam" | "pointer",
  onDone: (result: CalibrationResult) => void,
  onCancel: () => void,
): () => void {
  let index = 0;
  let raf = 0;
  let ended = false;
  const pointer: { target: GazePoint; actual: GazePoint }[] = [];
  const target: HTMLElement = h(
    mode === "pointer" ? "button" : "div",
    { class: "calib-target", "aria-label": "Calibration target" },
    h("span", { class: "calib-target-ring" }),
    h("span", { class: "calib-target-dot" }),
  );
  const progress = h("p", { class: "calib-progress", "aria-live": "polite" });
  const instructions = h(
    "p",
    { class: "calib-instructions" },
    mode === "pointer"
      ? "No webcam: pointer calibration. Click each target as it appears."
      : "Follow the dot with your eyes. Sit naturally; small head movements are fine.",
  );
  const warning = h("p", { class: "calib-warning", hidden: true });
  const cancel = h(
    "button",
    {
      type: "button",
      class: "btn95 calib-cancel",
      onclick: () => stop(true),
    },
    "CANCEL (ESC)",
  );
  const overlay = h(
    "div",
    {
      class: "calib-overlay",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Gaze calibration",
    },
    instructions,
    warning,
    target,
    progress,
    cancel,
  );
  ctx.overlay.append(overlay);
  mediaPipeGazeTracker.setPreviewVisible(false);

  const place = (p: GazePoint) => {
    target.style.left = `${p.x * 100}%`;
    target.style.top = `${p.y * 100}%`;
  };
  const showProgress = () => {
    progress.textContent = `${Math.min(index + 1, TARGETS.length)} / ${TARGETS.length} · ${TARGETS[Math.min(index, TARGETS.length - 1)].name}`;
  };

  let releaseAlign = () => {};
  let onPhaseKey: ((event: KeyboardEvent) => void) | null = null;

  function stop(cancelled: boolean): void {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
    releaseAlign();
    if (cancelled) {
      playSfx("cancel");
      onCancel();
    }
  }
  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      stop(true);
      return;
    }
    onPhaseKey?.(event);
  }
  window.addEventListener("keydown", onKey);

  if (mode === "pointer") {
    place(TARGETS[0]);
    showProgress();
    target.focus();
    target.addEventListener("click", (event) => {
      const box = ctx.root.getBoundingClientRect();
      const goal = TARGETS[index];
      // Keyboard activation has no pointer position: count it as on target.
      const actual =
        event.detail === 0
          ? { x: goal.x, y: goal.y }
          : {
              x: (event.clientX - box.left) / box.width,
              y: (event.clientY - box.top) / box.height,
            };
      pointer.push({ target: { x: goal.x, y: goal.y }, actual });
      index += 1;
      if (index >= TARGETS.length) {
        stop(false);
        playSfx("success");
        const errors = pointer.map((p) =>
          Math.hypot(
            (p.actual.x - p.target.x) * box.width,
            (p.actual.y - p.target.y) * box.height,
          ),
        );
        onDone({
          mode,
          ok: true,
          errorPx: errors.reduce((a, b) => a + b, 0) / errors.length,
          points: pointer,
        });
        return;
      }
      playSfx("capture");
      place(TARGETS[index]);
      showProgress();
    });
    return () => {
      stop(false);
      overlay.remove();
    };
  }

  // Webcam: first the player gets their face in view (calibration starts by
  // itself once they hold still, or at once with SPACE). Each point then
  // glides in, settles, and records about a second of frames. Last, a head
  // sweep: eyes stay on a dot while the head turns and nods, which teaches
  // the model how this player's eyes and head share the work, so gaze keeps
  // up when the head moves later.
  const steps = [
    ...TARGETS.map((t) => ({ ...t, sweep: false })),
    ...SWEEPS.map((t) => ({ ...t, sweep: true })),
  ];
  let phase: "align" | "intro" | "sweep-intro" | "move" | "settle" | "collect" =
    "align";
  let phaseStart = performance.now();
  let alignedSince: number | null = null;
  let framed = false;
  let pointSamples = 0;
  let lastFrame = -1;
  let range = { yaw: [Infinity, -Infinity], pitch: [Infinity, -Infinity] };
  const samples: CalibrationSample[] = [];
  const sweepHint = h("p", {
    class: "calib-sweep-hint",
    "aria-live": "polite",
    hidden: true,
  });
  overlay.insertBefore(sweepHint, cancel);
  const begin = (now: number): boolean => {
    if (phase !== "align" || !gazeController.getTrackerFeatures()) return false;
    playSfx("capture");
    align.release();
    align.panel.remove();
    instructions.hidden = false;
    enter("intro", now);
    return true;
  };
  const align = createAlignMonitor(() => {
    if (!begin(performance.now())) playSfx("deny");
  });
  overlay.insertBefore(align.panel, cancel);
  releaseAlign = align.release;
  onPhaseKey = (event) => {
    if (phase !== "align" || event.key !== " ") return;
    event.preventDefault();
    if (!begin(performance.now())) playSfx("deny");
  };
  instructions.hidden = true;
  target.hidden = true;
  progress.textContent = "ESC to cancel";
  const showStep = () => {
    const step = steps[index];
    progress.textContent = step.sweep
      ? `Head sweep ${index - TARGETS.length + 1} / ${SWEEPS.length} · eyes on the dot`
      : `${index + 1} / ${TARGETS.length} · ${step.name}`;
  };
  const enter = (next: typeof phase, now: number) => {
    phase = next;
    phaseStart = now;
    pointSamples = 0;
    range = { yaw: [Infinity, -Infinity], pitch: [Infinity, -Infinity] };
    target.style.setProperty("--collect", "0");
    showWarning(null);
  };
  const showWarning = (text: string | null) => {
    if (text && warning.hidden) playSfx("warning");
    warning.hidden = !text;
    if (text && warning.textContent !== text) warning.textContent = text;
  };
  const showSweepHint = (text: string | null) => {
    sweepHint.hidden = !text;
    if (text && sweepHint.textContent !== text) sweepHint.textContent = text;
  };

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const elapsed = now - phaseStart;
    const goal = steps[index];
    const features = gazeController.getTrackerFeatures();
    // Only "is the face in view" matters now; the model handles movement.
    const framing = checkHeadAlignment(features, framed);
    framed = framing.aligned;

    if (phase === "align") {
      const tracking = mediaPipeGazeTracker.getStatus().phase;
      const ready = tracking === "running" && framed;
      alignedSince = ready ? (alignedSince ?? now) : null;
      const held =
        alignedSince === null
          ? 0
          : Math.min((now - alignedSince) / ALIGN_HOLD_MS, 1);
      align.update(
        features,
        ready,
        held,
        ready
          ? "Good · hold still"
          : tracking === "no-face"
            ? "Face not detected"
            : tracking === "no-eyes"
              ? "Keep both eyes visible"
              : framing.hint,
      );
      if (held >= 1) begin(now);
    } else if (phase === "intro" || phase === "sweep-intro") {
      if (elapsed < (phase === "intro" ? INTRO_MS : SWEEP_INTRO_MS)) return;
      instructions.hidden = true;
      target.hidden = false;
      place(goal);
      showStep();
      playSfx("tick");
      enter("settle", now);
    } else if (phase === "move") {
      const prev = steps[index - 1];
      const k = Math.min(elapsed / MOVE_MS, 1);
      const ease = 0.5 - Math.cos(Math.PI * k) / 2;
      place({
        x: prev.x + (goal.x - prev.x) * ease,
        y: prev.y + (goal.y - prev.y) * ease,
      });
      if (k >= 1) {
        playSfx("tick");
        enter("settle", now);
      }
    } else if (phase === "settle") {
      if (goal.sweep) {
        showSweepHint("Keep your eyes on the dot");
      }
      if (elapsed >= SETTLE_MS) enter("collect", now);
    } else {
      if (
        features &&
        framed &&
        !features.blink &&
        features.timestamp >= phaseStart &&
        features.timestamp !== lastFrame
      ) {
        lastFrame = features.timestamp;
        samples.push({ features, target: { x: goal.x, y: goal.y } });
        pointSamples += 1;
        range.yaw = [
          Math.min(range.yaw[0], features.yaw),
          Math.max(range.yaw[1], features.yaw),
        ];
        range.pitch = [
          Math.min(range.pitch[0], features.pitch),
          Math.max(range.pitch[1], features.pitch),
        ];
      }

      let k: number;
      let done: boolean;
      if (goal.sweep) {
        // Done once the head has turned and nodded enough; after a while,
        // move on with whatever movement there was.
        const turn = Math.max(0, range.yaw[1] - range.yaw[0]) / SWEEP_YAW;
        const nod = Math.max(0, range.pitch[1] - range.pitch[0]) / SWEEP_PITCH;
        k = Math.min(elapsed / SWEEP_MIN_MS, turn, nod, 1);
        done =
          pointSamples >= MIN_POINT_SAMPLES &&
          (k >= 1 || elapsed >= SWEEP_MAX_MS);
        showSweepHint(
          turn < 1
            ? "Eyes on the dot · slowly turn your head left and right ↔"
            : nod < 1
              ? "Eyes on the dot · now slowly nod up and down ↕"
              : "Good · keep looking at the dot",
        );
      } else {
        k = Math.min(elapsed / COLLECT_MS, pointSamples / MIN_POINT_SAMPLES, 1);
        done = elapsed >= COLLECT_MS && pointSamples >= MIN_POINT_SAMPLES;
      }
      target.style.setProperty("--collect", k.toFixed(2));
      const stalled =
        elapsed > STALL_WARNING_MS && pointSamples < MIN_POINT_SAMPLES;
      showWarning(
        features && !framed
          ? `Keep your face in view of the camera: ${framing.hint.toLowerCase()}.`
          : stalled
            ? "Can't see your eyes clearly. Face the camera, keep your eyes open, and add light if you can."
            : null,
      );
      if (!done) return;

      index += 1;
      showSweepHint(null);
      if (index >= steps.length) {
        stop(false);
        finishWebcam();
        return;
      }
      playSfx("capture");
      if (steps[index].sweep && !goal.sweep) {
        // Explain the head sweep before it starts.
        target.hidden = true;
        progress.textContent = "Head sweep";
        instructions.textContent =
          "Almost done. Keep your eyes on the dot while you slowly turn your head left and right, then nod up and down.";
        instructions.hidden = false;
        enter("sweep-intro", now);
        return;
      }
      showStep();
      enter("move", now);
    }
  };
  raf = requestAnimationFrame(tick);

  function finishWebcam(): void {
    const model = fitGazeModel(samples);
    if (!model) {
      playSfx("error");
      onDone({ mode, ok: false, errorPx: null, points: [] });
      return;
    }
    gazeController.setModel(model);
    saveGazeModel(model);
    playSfx("success");
    onDone({
      mode,
      ok: true,
      errorPx: validationErrorPx(model, innerWidth, innerHeight),
      points: model.validation.map((v) => ({
        target: v.target,
        actual: v.predicted,
      })),
    });
  }

  return () => {
    stop(false);
    overlay.remove();
  };
}

// ---------------------------------------------------------------------------
// Head alignment monitor: a large mirrored camera view with the head guide and
// a marker for where the player's eyes are now.
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

function createAlignMonitor(onLock: () => void) {
  const svg = <K extends keyof SVGElementTagNameMap>(tag: K, cls: string) => {
    const element = document.createElementNS(SVG_NS, tag);
    element.setAttribute("class", cls);
    return element;
  };
  const stream = mediaPipeGazeTracker.getStream();
  const video = h("video", {
    class: "calib-align-video",
    "aria-hidden": "true",
  });
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  void video.play().catch(() => {});

  const overlay = svg("svg", "calib-align-overlay");
  overlay.setAttribute("aria-hidden", "true");
  const guide = svg("ellipse", "calib-align-guide");
  const eyeLine = svg("line", "calib-align-eyes");
  const trail = svg("line", "calib-align-trail");
  const marker = svg("circle", "calib-align-marker");
  marker.setAttribute("r", "12");
  overlay.append(guide, eyeLine, trail, marker);

  const monitor = h("div", { class: "calib-align-monitor" }, video, overlay);
  const hint = h("p", {
    class: "calib-align-hint",
    role: "status",
    "aria-live": "polite",
  });
  const meter = h(
    "div",
    { class: "calib-align-meter", "aria-hidden": "true" },
    h("i"),
  );
  const panel = h(
    "div",
    { class: "calib-align" },
    h("h2", { class: "pixel-title" }, "GET COMFORTABLE"),
    h(
      "p",
      { class: "calib-sub" },
      "Sit the way you will play, facing the screen. The outline is only a guide: calibration starts once your face is in view and still. You can move your head naturally afterwards.",
    ),
    monitor,
    hint,
    meter,
    h(
      "button",
      {
        type: "button",
        class: "btn95",
        onclick: () => onLock(),
      },
      "START NOW (SPACE)",
    ),
  );

  const settings = stream?.getVideoTracks()[0]?.getSettings();
  let width = settings?.width ?? 1280;
  let height = settings?.height ?? 720;
  let target = headGuide(width, height);
  const layout = () => {
    target = headGuide(width, height);
    monitor.style.aspectRatio = `${width} / ${height}`;
    overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    guide.setAttribute("cx", String(target.cx));
    guide.setAttribute("cy", String(target.cy));
    guide.setAttribute("rx", String(target.rx));
    guide.setAttribute("ry", String(target.ry));
    eyeLine.setAttribute("x1", String(target.cx - target.rx * 0.75));
    eyeLine.setAttribute("x2", String(target.cx + target.rx * 0.75));
    eyeLine.setAttribute("y1", String(target.eyeY));
    eyeLine.setAttribute("y2", String(target.eyeY));
  };
  video.addEventListener("loadedmetadata", () => {
    if (!video.videoWidth || !video.videoHeight) return;
    width = video.videoWidth;
    height = video.videoHeight;
    layout();
  });
  layout();

  return {
    panel,
    update(
      features: { faceX: number; faceY: number } | null,
      aligned: boolean,
      held: number,
      text: string,
    ): void {
      monitor.dataset.aligned = String(aligned);
      hint.dataset.tone = aligned ? "ok" : "warn";
      if (hint.textContent !== text) hint.textContent = text;
      meter.style.setProperty("--hold", held.toFixed(2));
      const shown = features !== null;
      marker.setAttribute("visibility", shown ? "visible" : "hidden");
      trail.setAttribute("visibility", shown ? "visible" : "hidden");
      if (!features) return;
      const x = String(features.faceX * width);
      const y = String(features.faceY * height);
      marker.setAttribute("cx", x);
      marker.setAttribute("cy", y);
      trail.setAttribute("x1", x);
      trail.setAttribute("y1", y);
      trail.setAttribute("x2", String(target.cx));
      trail.setAttribute("y2", String(target.eyeY));
    },
    release(): void {
      video.pause();
      video.srcObject = null;
    },
  };
}

function showResult(
  ctx: AppContext,
  result: CalibrationResult,
  actions: { test(): void; done(): void },
): () => void {
  const map = h("div", { class: "calib-map", "aria-hidden": "true" });
  for (const p of result.points) {
    const dot = (cls: string, at: GazePoint) =>
      h("i", {
        class: cls,
        style: `left:${clamp(at.x, 0, 1) * 100}%;top:${clamp(at.y, 0, 1) * 100}%`,
      });
    map.append(dot("map-target", p.target), dot("map-actual", p.actual));
  }
  const grade = result.errorPx === null ? "FAILED" : quality(result.errorPx);
  const done = h(
    "button",
    { type: "button", class: "btn95 btn-go", onclick: () => actions.done() },
    "DONE",
  );
  const overlay = h(
    "div",
    {
      class: "calib-overlay calib-result",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "calib-result-title",
    },
    h(
      "div",
      { class: "panel calib-result-box" },
      h("div", { class: "panel-title" }, h("h3", null, "CALIBRATION_RESULT")),
      h(
        "h2",
        { class: "pixel-title", id: "calib-result-title" },
        result.ok ? "CALIBRATION COMPLETE" : "CALIBRATION FAILED",
      ),
      h(
        "p",
        { class: "calib-result-grade", "data-grade": grade },
        `QUALITY: ${grade}`,
      ),
      h(
        "p",
        { class: "calib-sub" },
        result.ok && result.errorPx !== null
          ? `${result.mode === "webcam" ? "Estimated gaze error" : "Pointer error"} ≈ ${Math.round(result.errorPx)} px · ${result.mode === "webcam" ? `${TARGETS.length} points + head sweep` : `${TARGETS.length} / ${TARGETS.length} points`}`
          : "The calibration could not be fitted. Add light, sit centered, and try again.",
      ),
      result.mode === "pointer"
        ? h(
            "p",
            { class: "calib-small" },
            "Pointer calibration measures click accuracy only. Enable the webcam for eye tracking.",
          )
        : result.ok
          ? h(
              "p",
              { class: "calib-small" },
              "Not quite where you look? In TEST GAZE, look at a spot and click it to fine-tune.",
            )
          : null,
      map,
      h(
        "div",
        { class: "calib-actions" },
        h(
          "button",
          { type: "button", class: "btn95", onclick: () => actions.test() },
          "TEST GAZE",
        ),
        done,
      ),
    ),
  );
  ctx.overlay.append(overlay);
  done.focus();
  const onKey = (event: KeyboardEvent) =>
    event.key === "Escape" && actions.done();
  window.addEventListener("keydown", onKey);
  return () => {
    window.removeEventListener("keydown", onKey);
    overlay.remove();
  };
}

// ---------------------------------------------------------------------------
// Gaze test: six stand-in feeds; the one under the gaze point lights up.
// With eye tracking on, a cursor shows the estimated gaze, and clicking a spot
// while looking at it fine-tunes the calibration (saved with it).
// ---------------------------------------------------------------------------

function runGazeTest(
  ctx: AppContext,
  actions: { back(): void; shift(): void; debug(): boolean },
): () => void {
  const panels = Array.from({ length: 6 }, (_, i) =>
    h("div", { class: "test-panel" }, h("span", null, `CAM ${i + 1}`)),
  );
  const hint = h("p", { class: "calib-small", "aria-live": "polite" });
  const cursor = h("div", {
    class: "gaze-cursor",
    "aria-hidden": "true",
    hidden: true,
  });
  const resetClicks = h(
    "button",
    {
      type: "button",
      class: "btn95",
      onclick: () => {
        const current = gazeController.getModel();
        if (!current?.correction) return;
        playSfx("click");
        gazeController.setModel(clearGazeCorrection(current));
        saveGazeModel(gazeController.getModel());
        note = "Click corrections cleared.";
      },
    },
    "RESET CLICKS",
  );
  let note = "";
  let capture: {
    target: GazePoint;
    start: number;
    lastFrame: number;
    predictions: GazePoint[];
    mark: HTMLElement;
  } | null = null;
  const markers = h("div", {
    class: "calib-map test-validation",
    "aria-hidden": "true",
  });
  const model = gazeController.getModel();
  if (model) {
    for (const v of model.validation) {
      markers.append(
        h("i", {
          class: "map-target",
          style: `left:${v.target.x * 100}%;top:${v.target.y * 100}%`,
        }),
        h("i", {
          class: "map-actual",
          style: `left:${clamp(v.predicted.x, 0, 1) * 100}%;top:${clamp(v.predicted.y, 0, 1) * 100}%`,
        }),
      );
    }
  }
  const back = h(
    "button",
    { type: "button", class: "btn95", onclick: () => actions.back() },
    "BACK (ESC)",
  );
  const overlay = h(
    "div",
    {
      class: "calib-overlay test-overlay",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Gaze test",
    },
    h(
      "p",
      { class: "calib-instructions" },
      "Look at each feed. The one you are watching lights up.",
    ),
    hint,
    h("div", { class: "test-grid" }, ...panels),
    markers,
    cursor,
    h(
      "div",
      { class: "calib-actions" },
      back,
      resetClicks,
      h(
        "button",
        {
          type: "button",
          class: "btn95 btn-go",
          onclick: () => actions.shift(),
        },
        "CONTINUE TO SHIFT",
      ),
    ),
  );
  ctx.overlay.append(overlay);
  back.focus();

  // Click-to-correct: the player looks at a spot and clicks it, then keeps
  // looking while a ring closes; the model's estimates over that time are
  // paired with the spot.
  overlay.addEventListener("click", (event) => {
    if ((event.target as Element).closest("button") || capture) return;
    if (!gazeController.getModel() || !gazeController.getTrackerFeatures()) {
      playSfx("deny");
      note = "Fine-tuning needs eye tracking: enable the webcam and calibrate.";
      return;
    }
    const box = ctx.root.getBoundingClientRect();
    const target = {
      x: clamp((event.clientX - box.left) / box.width, 0, 1),
      y: clamp((event.clientY - box.top) / box.height, 0, 1),
    };
    const mark = h("i", {
      class: "refine-mark",
      "aria-hidden": "true",
      style: `left:${target.x * 100}%;top:${target.y * 100}%;--refine-ms:${REFINE_MS}ms`,
    });
    overlay.append(mark);
    playSfx("tick");
    capture = {
      target,
      start: performance.now(),
      lastFrame: -1,
      predictions: [],
      mark,
    };
  });

  function updateCapture(now: number): void {
    if (!capture) return;
    const model = gazeController.getModel();
    const features = gazeController.getTrackerFeatures();
    if (
      model &&
      features &&
      !features.blink &&
      features.timestamp >= capture.start &&
      features.timestamp !== capture.lastFrame
    ) {
      capture.lastFrame = features.timestamp;
      capture.predictions.push(predictUncorrectedGaze(model, features));
    }
    if (now - capture.start < REFINE_MS) return;
    const { target, predictions, mark } = capture;
    capture = null;
    mark.remove();
    if (!model || predictions.length < MIN_REFINE_FRAMES) {
      playSfx("deny");
      note = "Couldn't see your eyes for that click. Try again.";
      return;
    }
    const predicted = {
      x: predictions.reduce((sum, p) => sum + p.x, 0) / predictions.length,
      y: predictions.reduce((sum, p) => sum + p.y, 0) / predictions.length,
    };
    const refined = refineGazeModel(model, { target, predicted });
    gazeController.setModel(refined);
    saveGazeModel(refined);
    playSfx("capture");
    const count = refined.correction?.points.length ?? 0;
    note = `Fine-tuned with ${count} click${count === 1 ? "" : "s"}. Clicks spread around the screen work best.`;
  }

  let active = -1;
  let raf = 0;
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    updateCapture(now);
    const point = gazeController.getPoint(now);
    const source = gazeController.getSource(now);
    const text =
      source === "tracker"
        ? note ||
          "Cursor off? Look at any spot, click it, and keep looking until the ring closes."
        : source === "mouse"
          ? "Using the mouse as gaze (eyes not tracked)."
          : "No gaze source. Turn on mouse fallback or enable the webcam.";
    if (hint.textContent !== text) hint.textContent = text;
    resetClicks.hidden = !gazeController.getModel()?.correction;
    markers.hidden = !actions.debug();
    const overlayBox = overlay.getBoundingClientRect();
    cursor.hidden = !point || source !== "tracker";
    if (point && source === "tracker") {
      cursor.style.transform = `translate(${point.x * overlayBox.width}px, ${point.y * overlayBox.height}px)`;
    }
    let next = -1;
    if (point) {
      const box = ctx.root.getBoundingClientRect();
      const x = box.left + point.x * box.width;
      const y = box.top + point.y * box.height;
      // Credit the nearest panel, as the game will, even in the gaps.
      let best = Infinity;
      panels.forEach((panel, i) => {
        const r = panel.getBoundingClientRect();
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        const d = Math.hypot(dx, dy);
        if (d < best) {
          best = d;
          next = i;
        }
      });
    }
    if (next !== active) {
      active = next;
      if (next >= 0) playSfx("blip");
      panels.forEach((panel, i) =>
        panel.classList.toggle("is-active", i === next),
      );
    }
  };
  raf = requestAnimationFrame(loop);
  const onKey = (event: KeyboardEvent) =>
    event.key === "Escape" && actions.back();
  window.addEventListener("keydown", onKey);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
    overlay.remove();
  };
}
