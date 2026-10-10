// Screen 2: GAZE_CALIBRATION.EXE. Pointer tuning, webcam control, the
// nine-point calibration, a gaze test, and a debug overlay.
//
// Calibration uses the real eye-tracking pipeline (src/vision) when the
// webcam is tracking. Without a webcam it runs a pointer calibration: the
// player clicks each target, which measures pointer accuracy only.
import { playSfx } from "../../audio";
import {
  fitGazeModel,
  gazeController,
  mediaPipeGazeTracker,
  saveGazeModel,
  validationErrorPx,
  type CalibrationSample,
  type GazePoint,
  type TrackerPhase,
} from "../../vision";
import type { AppContext, Screen } from "../context";
import { clamp, h } from "../dom";
import type { CalibrationSettings } from "../service";
import { openFloatingWindow } from "../window";

// The nine targets, center first, then around the edge so the eyes never
// cross the whole screen (same order as the vision module's calibration).
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
];
const INTRO_MS = 1800;
const MOVE_MS = 500;
const SETTLE_MS = 500;
const COLLECT_MS = 1000;
const MIN_POINT_SAMPLES = 12;
const STALL_WARNING_MS = 3000;

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
          class: "btn-dark",
          "aria-label": `Decrease ${name}`,
          onclick: () => onStep(-1),
        },
        "-",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn-dark",
          "aria-label": `Increase ${name}`,
          onclick: () => onStep(1),
        },
        "+",
      ),
    );
  const webcamButton = h("button", {
    type: "button",
    class: "btn-dark calib-webcam",
    onclick: () => toggleWebcam(),
  });
  const webcamInfo = h("p", { class: "calib-small", "aria-live": "polite" });
  const previewButton = h("button", {
    type: "button",
    class: "btn-dark btn-small",
    onclick: () => {
      playSfx("click");
      mediaPipeGazeTracker.setPreviewHidden(
        !mediaPipeGazeTracker.isPreviewHidden(),
      );
    },
  });
  const calibInfo = h("p", { class: "calib-small calib-info" });
  const debugButton = h("button", {
    type: "button",
    class: "btn-dark",
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
          h(
            "div",
            null,
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
          { class: "calib-panel" },
          h("h3", { class: "calib-panel-title" }, "POINTER TUNING"),
          h(
            "div",
            { class: "calib-grid" },
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
                    class: "btn-dark calib-toggle",
                    onclick: () => toggleFallback(),
                  },
                  "TOGGLE",
                ),
              ),
            ),
            h(
              "div",
              { class: "calib-camera" },
              webcamButton,
              webcamInfo,
              previewButton,
            ),
          ),
        ),
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
              class: "btn-dark btn-wide",
              onclick: () => startCalibration(),
            },
            "START 9-POINT CALIBRATION",
          ),
          h(
            "button",
            { type: "button", class: "btn-dark", onclick: () => startTest() },
            "TEST GAZE",
          ),
        ),
        calibInfo,
        h(
          "div",
          { class: "calib-foot" },
          debugButton,
          h(
            "button",
            {
              type: "button",
              class: "btn-dark btn-go",
              onclick: () => {
                playSfx("start");
                ctx.go("watch");
              },
            },
            "Continue to shift",
          ),
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
    calibInfo.textContent = model
      ? `Eye calibration · est. error ≈ ${Math.round(validationErrorPx(model, innerWidth, innerHeight))} px (${quality(validationErrorPx(model, innerWidth, innerHeight)).toLowerCase()})`
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
// Nine-point calibration overlay
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
      : "Follow the dot with your eyes. Look at it the way you normally look at the screen.",
  );
  const warning = h(
    "p",
    { class: "calib-warning", hidden: true },
    "Can't see your eyes clearly. Face the camera, keep your eyes open, and add light if you can.",
  );
  const cancel = h(
    "button",
    {
      type: "button",
      class: "btn-dark calib-cancel",
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
      "aria-label": "Nine-point calibration",
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

  function stop(cancelled: boolean): void {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
    if (cancelled) {
      playSfx("cancel");
      onCancel();
    }
  }
  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      stop(true);
    }
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

  // Webcam: each point glides in, settles, then records about a second of frames.
  let phase: "intro" | "move" | "settle" | "collect" = "intro";
  let phaseStart = performance.now();
  let pointSamples = 0;
  let lastFrame = -1;
  const samples: CalibrationSample[] = [];
  target.hidden = true;
  progress.textContent = "ESC to cancel";
  const enter = (next: typeof phase, now: number) => {
    phase = next;
    phaseStart = now;
    pointSamples = 0;
    target.style.setProperty("--collect", "0");
    warning.hidden = true;
  };

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const elapsed = now - phaseStart;
    const goal = TARGETS[index];
    if (phase === "intro") {
      if (elapsed < INTRO_MS) return;
      instructions.hidden = true;
      target.hidden = false;
      place(goal);
      showProgress();
      playSfx("tick");
      enter("settle", now);
    } else if (phase === "move") {
      const prev = TARGETS[index - 1];
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
      if (elapsed >= SETTLE_MS) enter("collect", now);
    } else {
      const features = gazeController.getTrackerFeatures();
      if (
        features &&
        !features.blink &&
        features.timestamp >= phaseStart &&
        features.timestamp !== lastFrame
      ) {
        lastFrame = features.timestamp;
        samples.push({ features, target: { x: goal.x, y: goal.y } });
        pointSamples += 1;
      }
      const k = Math.min(
        elapsed / COLLECT_MS,
        pointSamples / MIN_POINT_SAMPLES,
        1,
      );
      target.style.setProperty("--collect", k.toFixed(2));
      const stalled =
        elapsed > STALL_WARNING_MS && pointSamples < MIN_POINT_SAMPLES;
      if (stalled && warning.hidden) playSfx("warning");
      warning.hidden = !stalled;
      if (elapsed >= COLLECT_MS && pointSamples >= MIN_POINT_SAMPLES) {
        index += 1;
        if (index >= TARGETS.length) {
          stop(false);
          finishWebcam();
          return;
        }
        playSfx("capture");
        showProgress();
        enter("move", now);
      }
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
    { type: "button", class: "btn-dark btn-go", onclick: () => actions.done() },
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
      { class: "calib-result-box" },
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
          ? `${result.mode === "webcam" ? "Estimated gaze error" : "Pointer error"} ≈ ${Math.round(result.errorPx)} px · 9 / 9 points`
          : "The calibration could not be fitted. Add light, sit centered, and try again.",
      ),
      result.mode === "pointer"
        ? h(
            "p",
            { class: "calib-small" },
            "Pointer calibration measures click accuracy only. Enable the webcam for eye tracking.",
          )
        : null,
      map,
      h(
        "div",
        { class: "calib-actions" },
        h(
          "button",
          { type: "button", class: "btn-dark", onclick: () => actions.test() },
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
// ---------------------------------------------------------------------------

function runGazeTest(
  ctx: AppContext,
  actions: { back(): void; shift(): void; debug(): boolean },
): () => void {
  const panels = Array.from({ length: 6 }, (_, i) =>
    h("div", { class: "test-panel" }, h("span", null, `CAM ${i + 1}`)),
  );
  const hint = h("p", { class: "calib-small", "aria-live": "polite" });
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
    { type: "button", class: "btn-dark", onclick: () => actions.back() },
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
    h(
      "div",
      { class: "calib-actions" },
      back,
      h(
        "button",
        {
          type: "button",
          class: "btn-dark btn-go",
          onclick: () => actions.shift(),
        },
        "CONTINUE TO SHIFT",
      ),
    ),
  );
  ctx.overlay.append(overlay);
  back.focus();

  let active = -1;
  let raf = 0;
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    const point = gazeController.getPoint(now);
    const source = gazeController.getSource(now);
    hint.textContent =
      source === "tracker"
        ? "Eye tracking active."
        : source === "mouse"
          ? "Using the mouse as gaze (eyes not tracked)."
          : "No gaze source. Turn on mouse fallback or enable the webcam.";
    markers.hidden = !actions.debug();
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
