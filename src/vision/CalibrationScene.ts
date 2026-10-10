import Phaser from "phaser";
import {
  DEFAULT_GAZE_SETTINGS,
  fitGazeModel,
  gazeController,
  loadGazeModel,
  saveGazeModel,
  validationErrorPx,
  type CalibrationSample,
  type GazeModel,
  type GazePoint,
  type GazeSettings,
  type GazeSource,
  mediaPipeGazeTracker,
  type TrackerPhase,
  type TrackerStatus,
} from "./index";
import { eventBus } from "../shared/eventBus";

const SETTINGS_KEY = "night-watch:gaze-settings";

// Center first, then around the edge so the eyes never cross the whole screen.
const CALIBRATION_TARGETS: GazePoint[] = [
  { x: 0.5, y: 0.5 },
  { x: 0.08, y: 0.1 },
  { x: 0.5, y: 0.1 },
  { x: 0.92, y: 0.1 },
  { x: 0.92, y: 0.5 },
  { x: 0.92, y: 0.9 },
  { x: 0.5, y: 0.9 },
  { x: 0.08, y: 0.9 },
  { x: 0.08, y: 0.5 },
];
const INTRO_MS = 1800;
const MOVE_MS = 500;
const SETTLE_MS = 500;
const COLLECT_MS = 1000;
const MIN_POINT_SAMPLES = 12;
const STALL_WARNING_MS = 3000;

// Stand-in camera feeds for checking gaze after calibrating.
const TEST_GRID = {
  columns: 3,
  rows: 2,
  left: 40,
  top: 96,
  right: 920,
  bottom: 470,
  gap: 12,
};

type Mode = "setup" | "calibrating" | "testing";
type StatusTone = "ok" | "warn" | "error";

interface CalibrationRun {
  phase: "intro" | "move" | "settle" | "collect";
  phaseStart: number;
  index: number;
  pointSamples: number;
  lastFrameTime: number;
  samples: CalibrationSample[];
}

function readSettings(): GazeSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return { ...DEFAULT_GAZE_SETTINGS };
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object")
      return { ...DEFAULT_GAZE_SETTINGS };
    const value = parsed as Partial<GazeSettings>;
    return {
      sensitivity:
        typeof value.sensitivity === "number" &&
        Number.isFinite(value.sensitivity)
          ? Phaser.Math.Clamp(value.sensitivity, 0.5, 2)
          : DEFAULT_GAZE_SETTINGS.sensitivity,
      smoothing:
        typeof value.smoothing === "number" && Number.isFinite(value.smoothing)
          ? Phaser.Math.Clamp(value.smoothing, 0, 0.9)
          : DEFAULT_GAZE_SETTINGS.smoothing,
      useMouseFallback:
        typeof value.useMouseFallback === "boolean"
          ? value.useMouseFallback
          : DEFAULT_GAZE_SETTINGS.useMouseFallback,
    };
  } catch (error) {
    console.error("Could not load gaze settings.", error);
    return { ...DEFAULT_GAZE_SETTINGS };
  }
}

function accuracyLabel(errorPx: number): string {
  if (errorPx <= 60) return "good";
  if (errorPx <= 110) return "fair";
  return "poor";
}

export class CalibrationScene extends Phaser.Scene {
  private readonly gaze = gazeController;
  private settings: GazeSettings = { ...DEFAULT_GAZE_SETTINGS };
  private mode: Mode = "setup";
  private run: CalibrationRun | null = null;
  private debugVisible = false;
  private saveFailed = false;
  private lastSource: GazeSource = "none";
  private setupObjects: Phaser.GameObjects.GameObject[] = [];
  private calibrationObjects: Phaser.GameObjects.GameObject[] = [];
  private testObjects: Phaser.GameObjects.GameObject[] = [];
  private sensitivityText!: Phaser.GameObjects.Text;
  private smoothingText!: Phaser.GameObjects.Text;
  private fallbackText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private cameraInfoText!: Phaser.GameObjects.Text;
  private cameraButtonText!: Phaser.GameObjects.Text;
  private calibrationInfoText!: Phaser.GameObjects.Text;
  private debugButtonText!: Phaser.GameObjects.Text;
  private target!: Phaser.GameObjects.Container;
  private targetRing!: Phaser.GameObjects.Arc;
  private introText!: Phaser.GameObjects.Text;
  private progressText!: Phaser.GameObjects.Text;
  private warningText!: Phaser.GameObjects.Text;
  private testPanels: Phaser.GameObjects.Rectangle[] = [];
  private testHintText!: Phaser.GameObjects.Text;
  private validationGraphics!: Phaser.GameObjects.Graphics;
  private debugText!: Phaser.GameObjects.Text;
  private debugPanel!: Phaser.GameObjects.Rectangle;
  private cursor!: Phaser.GameObjects.Container;
  private removeTrackerListener: (() => void) | null = null;

  constructor() {
    super("Calibration");
  }

  create(): void {
    const { width, height } = this.scale;
    // Phaser reuses the scene instance, so reset state from any earlier visit.
    this.mode = "setup";
    this.run = null;
    this.debugVisible = false;
    this.lastSource = "none";
    this.testPanels = [];
    this.settings = readSettings();
    this.gaze.setSettings(this.settings);
    if (!this.gaze.isCalibrated()) this.gaze.setModel(loadGazeModel());

    this.setupObjects = this.collectObjects(() =>
      this.createSetupUi(width, height),
    );
    this.calibrationObjects = this.collectObjects(() =>
      this.createCalibrationUi(width, height),
    );
    this.testObjects = this.collectObjects(() =>
      this.createTestUi(width, height),
    );
    this.createOverlayUi();

    this.input.keyboard?.on("keydown-ESC", () => {
      if (this.mode === "calibrating") {
        this.cancelCalibration("Calibration cancelled.");
      } else if (this.mode === "testing") {
        this.setMode("setup");
      }
    });
    this.input.keyboard?.on("keydown-D", () => this.toggleDebug());

    this.setMode("setup");
    this.updateSettingsLabels();
    this.updateCalibrationInfo();
    this.removeTrackerListener = mediaPipeGazeTracker.onStatusChange((status) =>
      this.updateTrackerStatus(status),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.removeTrackerListener?.();
      this.removeTrackerListener = null;
      this.run = null;
      mediaPipeGazeTracker.setPreviewVisible(true);
    });
  }

  update(): void {
    const now = performance.now();
    if (this.mode === "calibrating") this.updateCalibration(now);

    const source = this.gaze.getSource(now);
    if (source !== this.lastSource) {
      this.lastSource = source;
      this.updateStatus();
      this.updateTestHint();
    }

    const { width, height } = this.scale;
    const point = this.gaze.getPoint(now);
    if (point) this.cursor.setPosition(point.x * width, point.y * height);
    this.cursor.setVisible(
      point !== null &&
        (source === "tracker" || this.debugVisible) &&
        this.mode !== "calibrating",
    );
    if (this.mode === "testing") {
      this.highlightPanel(source === "tracker" ? point : null);
    }
    if (this.debugVisible && this.mode !== "calibrating") {
      this.debugText.setText(this.debugReport(source, point, now));
    }
  }

  private collectObjects(build: () => void): Phaser.GameObjects.GameObject[] {
    const start = this.children.list.length;
    build();
    return this.children.list.slice(start);
  }

  private createSetupUi(width: number, height: number): void {
    this.add.rectangle(width / 2, height / 2, width, height, 0x10131b);
    this.add.text(52, 38, "GAZE CALIBRATION", {
      color: "#f3f4f6",
      fontFamily: "Arial, sans-serif",
      fontSize: "30px",
      fontStyle: "bold",
    });
    this.add.text(54, 78, "Tune your input before starting a shift.", {
      color: "#9ca3af",
      fontFamily: "Arial, sans-serif",
      fontSize: "16px",
    });

    this.statusText = this.add
      .text(width / 2, 126, "", {
        color: "#8ee5bd",
        backgroundColor: "#1c302b",
        fontFamily: "Arial, sans-serif",
        fontSize: "15px",
        padding: { x: 14, y: 9 },
      })
      .setOrigin(0.5);

    this.add
      .rectangle(width / 2, 262, 650, 200, 0x1b202b)
      .setStrokeStyle(1, 0x343c4b);
    this.add.text(180, 178, "POINTER TUNING", {
      color: "#c5cbd5",
      fontFamily: "Arial, sans-serif",
      fontSize: "14px",
      fontStyle: "bold",
    });
    this.add.text(180, 214, "Sensitivity", {
      color: "#f3f4f6",
      fontFamily: "Arial, sans-serif",
      fontSize: "17px",
    });
    this.sensitivityText = this.add.text(414, 214, "", this.valueStyle());
    this.add.text(180, 266, "Smoothing", {
      color: "#f3f4f6",
      fontFamily: "Arial, sans-serif",
      fontSize: "17px",
    });
    this.smoothingText = this.add.text(414, 266, "", this.valueStyle());
    this.add.text(180, 318, "Mouse fallback", {
      color: "#f3f4f6",
      fontFamily: "Arial, sans-serif",
      fontSize: "17px",
    });
    this.fallbackText = this.add.text(414, 318, "", this.valueStyle());

    this.addButton(520, 225, "−", () =>
      this.adjustSetting("sensitivity", -0.1),
    );
    this.addButton(574, 225, "+", () => this.adjustSetting("sensitivity", 0.1));
    this.addButton(520, 277, "−", () => this.adjustSetting("smoothing", -0.1));
    this.addButton(574, 277, "+", () => this.adjustSetting("smoothing", 0.1));
    this.addButton(547, 329, "Toggle", () => this.toggleFallback(), 100);
    this.cameraButtonText = this.addButton(
      710,
      225,
      "Enable webcam",
      () => this.toggleWebcam(),
      160,
    );
    this.cameraInfoText = this.add
      .text(710, 262, "", {
        color: "#9ca3af",
        fontFamily: "Arial, sans-serif",
        fontSize: "12px",
        align: "center",
        wordWrap: { width: 160 },
        lineSpacing: 2,
      })
      .setOrigin(0.5, 0);

    this.add
      .text(
        width / 2,
        374,
        "Until you calibrate, or whenever your eyes are not tracked, the mouse can stand in for gaze.",
        {
          color: "#9ca3af",
          fontFamily: "Arial, sans-serif",
          fontSize: "13px",
        },
      )
      .setOrigin(0.5, 0);
    this.addButton(
      width / 2 - 95,
      424,
      "START 9-POINT CALIBRATION",
      () => this.startCalibration(),
      260,
    );
    this.addButton(
      width / 2 + 150,
      424,
      "TEST GAZE",
      () => this.startTest(),
      150,
    );
    this.debugButtonText = this.addButton(
      200,
      height - 42,
      "Debug overlay: OFF",
      () => this.toggleDebug(),
      190,
    );
    this.addButton(
      width - 125,
      height - 42,
      "Continue to shift",
      () => eventBus.emit("scene:navigate", "Shift"),
      190,
    );
    this.calibrationInfoText = this.add
      .text(width / 2, height - 82, "", {
        color: "#727b8b",
        fontFamily: "Arial, sans-serif",
        fontSize: "13px",
      })
      .setOrigin(0.5);
  }

  private createCalibrationUi(width: number, height: number): void {
    this.introText = this.add
      .text(
        width / 2,
        height / 2,
        "Follow the dot with your eyes.\nLook at it the way you normally look at the screen.",
        {
          color: "#d7dce5",
          fontFamily: "Arial, sans-serif",
          fontSize: "22px",
          align: "center",
          lineSpacing: 12,
        },
      )
      .setOrigin(0.5);
    this.progressText = this.add
      .text(width / 2, height * 0.7, "", {
        color: "#6b7383",
        fontFamily: "Arial, sans-serif",
        fontSize: "13px",
      })
      .setOrigin(0.5);
    this.warningText = this.add
      .text(
        width / 2,
        height * 0.3,
        "Can't see your eyes clearly.\nFace the camera, keep your eyes open, and add light if you can.",
        {
          color: "#ffd166",
          backgroundColor: "#332b1d",
          fontFamily: "Arial, sans-serif",
          fontSize: "15px",
          align: "center",
          padding: { x: 14, y: 9 },
          lineSpacing: 4,
        },
      )
      .setOrigin(0.5);
    this.targetRing = this.add
      .circle(0, 0, 24, 0x68e0ad, 0.15)
      .setStrokeStyle(2, 0x68e0ad);
    this.target = this.add.container(0, 0, [
      this.targetRing,
      this.add.circle(0, 0, 6, 0x68e0ad),
      this.add.circle(0, 0, 2, 0xffffff),
    ]);
  }

  private createTestUi(width: number, height: number): void {
    this.add
      .text(
        width / 2,
        30,
        "Look at each feed. The one you are watching lights up.",
        {
          color: "#d7dce5",
          fontFamily: "Arial, sans-serif",
          fontSize: "18px",
        },
      )
      .setOrigin(0.5);
    this.testHintText = this.add
      .text(width / 2, 62, "", {
        color: "#9ca3af",
        fontFamily: "Arial, sans-serif",
        fontSize: "13px",
      })
      .setOrigin(0.5);

    const { columns, rows, left, top, right, bottom, gap } = TEST_GRID;
    const cellWidth = (right - left - gap * (columns - 1)) / columns;
    const cellHeight = (bottom - top - gap * (rows - 1)) / rows;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = left + column * (cellWidth + gap);
        const y = top + row * (cellHeight + gap);
        this.testPanels.push(
          this.add
            .rectangle(x, y, cellWidth, cellHeight, 0x1b202b)
            .setOrigin(0)
            .setStrokeStyle(1, 0x343c4b),
        );
        this.add.text(x + 10, y + 8, `CAM ${row * columns + column + 1}`, {
          color: "#727b8b",
          fontFamily: "monospace",
          fontSize: "12px",
        });
      }
    }

    this.addButton(
      150,
      height - 36,
      "Recalibrate",
      () => this.startCalibration(),
      170,
    );
    this.addButton(
      width / 2,
      height - 36,
      "Back to settings",
      () => this.setMode("setup"),
      170,
    );
    this.addButton(
      width - 150,
      height - 36,
      "Continue to shift",
      () => eventBus.emit("scene:navigate", "Shift"),
      170,
    );
  }

  private createOverlayUi(): void {
    this.validationGraphics = this.add.graphics().setDepth(8);
    this.debugPanel = this.add
      .rectangle(12, 12, 340, 92, 0x080a0f, 0.88)
      .setOrigin(0)
      .setDepth(9);
    this.debugText = this.add
      .text(24, 20, "", {
        color: "#d5f9e9",
        fontFamily: "monospace",
        fontSize: "12px",
        lineSpacing: 4,
      })
      .setDepth(9);
    this.cursor = this.add
      .container(0, 0, [
        this.add.circle(0, 0, 20, 0xffd166, 0.15).setStrokeStyle(2, 0xffd166),
        this.add.circle(0, 0, 4, 0xffd166),
      ])
      .setDepth(10)
      .setVisible(false);
  }

  private valueStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      color: "#68e0ad",
      fontFamily: "Arial, sans-serif",
      fontSize: "16px",
      fontStyle: "bold",
    };
  }

  private addButton(
    x: number,
    y: number,
    label: string,
    callback: () => void,
    width = 46,
  ): Phaser.GameObjects.Text {
    const background = this.add
      .rectangle(x, y, width, 38, 0x293141)
      .setStrokeStyle(1, 0x465267)
      .setInteractive({ useHandCursor: true });
    const text = this.add
      .text(x, y, label, {
        color: "#f3f4f6",
        fontFamily: "Arial, sans-serif",
        // Single glyphs (− and +) read better large; words stay compact.
        fontSize: label.length > 1 ? "14px" : "20px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    background.on("pointerover", () => background.setFillStyle(0x364156));
    background.on("pointerout", () => background.setFillStyle(0x293141));
    background.on("pointerdown", callback);
    text.setInteractive({ useHandCursor: true }).on("pointerdown", callback);
    return text;
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.setVisible(this.setupObjects, mode === "setup");
    this.setVisible(this.calibrationObjects, mode === "calibrating");
    this.setVisible(this.testObjects, mode === "testing");
    // Hide the webcam preview so it neither covers nor distracts from targets.
    mediaPipeGazeTracker.setPreviewVisible(mode !== "calibrating");
    this.refreshOverlayVisibility();
    this.updateStatus();
    this.updateTestHint();
  }

  private refreshOverlayVisibility(): void {
    const debug = this.debugVisible && this.mode !== "calibrating";
    this.setVisible([this.debugPanel, this.debugText], debug);
    this.validationGraphics.setVisible(debug && this.mode === "testing");
  }

  private adjustSetting(
    setting: "sensitivity" | "smoothing",
    amount: number,
  ): void {
    const bounds = setting === "sensitivity" ? [0.5, 2] : [0, 0.9];
    this.settings[setting] = Phaser.Math.Clamp(
      Math.round((this.settings[setting] + amount) * 10) / 10,
      bounds[0],
      bounds[1],
    );
    this.gaze.setSettings(this.settings);
    this.persistSettings();
    this.updateSettingsLabels();
  }

  private toggleFallback(): void {
    this.settings.useMouseFallback = !this.settings.useMouseFallback;
    this.gaze.setSettings(this.settings);
    this.persistSettings();
    this.updateSettingsLabels();
    this.updateStatus();
  }

  private updateSettingsLabels(): void {
    this.sensitivityText.setText(`${this.settings.sensitivity.toFixed(1)}×`);
    this.smoothingText.setText(`${Math.round(this.settings.smoothing * 100)}%`);
    this.fallbackText.setText(this.settings.useMouseFallback ? "ON" : "OFF");
  }

  private updateStatus(): void {
    const source = this.gaze.getSource();
    const phase = mediaPipeGazeTracker.getStatus().phase;
    this.setStatusPill(
      `●  ${this.getStatusLabel(phase, source)}`,
      phase === "error" ? "error" : source === "tracker" ? "ok" : "warn",
    );
  }

  private setStatusPill(text: string, tone: StatusTone): void {
    this.statusText.setText(text);
    this.statusText.setStyle({
      color: { ok: "#8ee5bd", warn: "#ffd166", error: "#ff9b9b" }[tone],
      backgroundColor: { ok: "#1c302b", warn: "#332b1d", error: "#3b2225" }[
        tone
      ],
    });
  }

  private getStatusLabel(phase: TrackerPhase, source: GazeSource): string {
    if (phase === "requesting") return "REQUESTING CAMERA";
    if (phase === "loading") return "LOADING FACE MODEL";
    if (phase === "error") return "WEBCAM ERROR";
    if (phase === "no-face") return "FACE NOT DETECTED";
    if (phase === "no-eyes") return "EYES NOT TRACKED";
    if (source === "tracker") return "EYE TRACKING ACTIVE";
    if (phase === "running") {
      return this.gaze.isCalibrated()
        ? "EYES NOT TRACKED"
        : "WEBCAM READY · CALIBRATE TO USE GAZE";
    }
    if (this.settings.useMouseFallback) return "MOUSE FALLBACK ENABLED";
    return "CAMERA OFF";
  }

  private updateTrackerStatus(status: TrackerStatus): void {
    this.cameraInfoText.setText(status.message);
    this.cameraButtonText.setText(
      status.phase === "requesting" || status.phase === "loading"
        ? "Cancel start"
        : status.phase === "running" ||
            status.phase === "no-face" ||
            status.phase === "no-eyes"
          ? "Stop webcam"
          : "Enable webcam",
    );
    if (this.run && (status.phase === "idle" || status.phase === "error")) {
      this.cancelCalibration(
        "Calibration stopped because the webcam turned off.",
      );
      return;
    }
    this.updateStatus();
  }

  private updateCalibrationInfo(): void {
    const model = this.gaze.getModel();
    if (!model) {
      this.calibrationInfoText.setText(
        "Not calibrated yet. Calibrate each time you change seat, screen, or lighting.",
      );
      return;
    }
    this.calibrationInfoText.setText(
      `${this.accuracySummary(model)}${this.saveFailed ? " · could not be saved on this device" : " · saved on this device"}`,
    );
  }

  private accuracySummary(model: GazeModel): string {
    const { width, height } = this.scale;
    const error = validationErrorPx(model, width, height);
    return `Calibrated · estimated error ≈ ${Math.round(error)} px (${accuracyLabel(error)})`;
  }

  private updateTestHint(): void {
    if (this.mode !== "testing") return;
    const model = this.gaze.getModel();
    const tracking = this.gaze.getSource() === "tracker";
    this.testHintText.setText(
      tracking && model
        ? `${this.accuracySummary(model)} · ESC to go back · D for debug`
        : "Eyes not tracked. Face the camera and keep both eyes visible.",
    );
    this.testHintText.setColor(tracking ? "#9ca3af" : "#ffd166");
  }

  private toggleWebcam(): void {
    const phase = mediaPipeGazeTracker.getStatus().phase;
    if (
      phase === "requesting" ||
      phase === "loading" ||
      phase === "running" ||
      phase === "no-face" ||
      phase === "no-eyes"
    ) {
      mediaPipeGazeTracker.stop();
      return;
    }
    void mediaPipeGazeTracker.start().catch(() => {
      this.updateTrackerStatus(mediaPipeGazeTracker.getStatus());
    });
  }

  private startCalibration(): void {
    if (mediaPipeGazeTracker.getStatus().phase !== "running") {
      this.setMode("setup");
      this.setStatusPill(
        "Enable the webcam and wait until it tracks both eyes, then calibrate.",
        "error",
      );
      return;
    }
    this.run = {
      phase: "intro",
      phaseStart: performance.now(),
      index: 0,
      pointSamples: 0,
      lastFrameTime: -1,
      samples: [],
    };
    this.setMode("calibrating");
    this.introText.setVisible(true);
    this.target.setVisible(false);
    this.warningText.setVisible(false);
    this.progressText.setText("ESC to cancel");
  }

  private updateCalibration(now: number): void {
    const run = this.run;
    if (!run) return;
    const { width, height } = this.scale;
    const elapsed = now - run.phaseStart;
    const target = CALIBRATION_TARGETS[run.index];

    switch (run.phase) {
      case "intro":
        if (elapsed < INTRO_MS) return;
        this.introText.setVisible(false);
        this.target
          .setVisible(true)
          .setPosition(target.x * width, target.y * height);
        this.updateProgress(run);
        this.enterPhase(run, "settle", now);
        return;

      case "move": {
        // Gliding between points lets the eyes follow instead of searching.
        const previous = CALIBRATION_TARGETS[run.index - 1];
        const t = Phaser.Math.Easing.Sine.InOut(Math.min(elapsed / MOVE_MS, 1));
        this.target.setPosition(
          Phaser.Math.Linear(previous.x, target.x, t) * width,
          Phaser.Math.Linear(previous.y, target.y, t) * height,
        );
        if (elapsed >= MOVE_MS) this.enterPhase(run, "settle", now);
        return;
      }

      case "settle":
        if (elapsed >= SETTLE_MS) this.enterPhase(run, "collect", now);
        return;

      case "collect": {
        const features = this.gaze.getTrackerFeatures();
        if (
          features &&
          !features.blink &&
          features.timestamp >= run.phaseStart &&
          features.timestamp !== run.lastFrameTime
        ) {
          run.lastFrameTime = features.timestamp;
          run.samples.push({ features, target: { ...target } });
          run.pointSamples += 1;
        }
        const progress = Math.min(
          elapsed / COLLECT_MS,
          run.pointSamples / MIN_POINT_SAMPLES,
          1,
        );
        this.targetRing.setScale(1 - 0.75 * progress);
        this.warningText.setVisible(
          elapsed > STALL_WARNING_MS && run.pointSamples < MIN_POINT_SAMPLES,
        );
        if (elapsed >= COLLECT_MS && run.pointSamples >= MIN_POINT_SAMPLES) {
          this.advanceCalibration(run, now);
        }
        return;
      }
    }
  }

  private enterPhase(
    run: CalibrationRun,
    phase: CalibrationRun["phase"],
    now: number,
  ): void {
    run.phase = phase;
    run.phaseStart = now;
    run.pointSamples = 0;
    this.targetRing.setScale(1);
    this.warningText.setVisible(false);
  }

  private updateProgress(run: CalibrationRun): void {
    this.progressText.setText(
      `${run.index + 1} / ${CALIBRATION_TARGETS.length} · ESC to cancel`,
    );
  }

  private advanceCalibration(run: CalibrationRun, now: number): void {
    run.index += 1;
    if (run.index >= CALIBRATION_TARGETS.length) {
      this.finishCalibration(run.samples);
      return;
    }
    this.updateProgress(run);
    this.enterPhase(run, "move", now);
  }

  private finishCalibration(samples: CalibrationSample[]): void {
    this.run = null;
    const model = fitGazeModel(samples);
    if (!model) {
      this.setMode("setup");
      this.setStatusPill(
        "Calibration could not be fitted. Add light, sit centered, and try again.",
        "error",
      );
      return;
    }
    this.gaze.setModel(model);
    this.saveFailed = !saveGazeModel(model);
    this.updateCalibrationInfo();
    this.startTest();
  }

  private cancelCalibration(message: string): void {
    this.run = null;
    this.setMode("setup");
    this.setStatusPill(message, "warn");
  }

  private startTest(): void {
    const model = this.gaze.getModel();
    if (!model) {
      this.setStatusPill("Calibrate first, then test your gaze.", "error");
      return;
    }
    this.drawValidation(model);
    this.setMode("testing");
  }

  private highlightPanel(point: GazePoint | null): void {
    const { width, height } = this.scale;
    const { columns, rows, left, top, right, bottom } = TEST_GRID;
    // Credit the nearest feed, as the game will, even when gaze lands in a gap.
    const active = point
      ? Phaser.Math.Clamp(
          Math.floor(((point.y * height - top) / (bottom - top)) * rows),
          0,
          rows - 1,
        ) *
          columns +
        Phaser.Math.Clamp(
          Math.floor(((point.x * width - left) / (right - left)) * columns),
          0,
          columns - 1,
        )
      : -1;
    this.testPanels.forEach((panel, index) => {
      const on = index === active;
      panel.setFillStyle(on ? 0x1f3b33 : 0x1b202b);
      panel.setStrokeStyle(on ? 3 : 1, on ? 0x68e0ad : 0x343c4b);
    });
  }

  /** Each calibration target (ring) and where it was predicted when held out (dot). */
  private drawValidation(model: GazeModel): void {
    const { width, height } = this.scale;
    const graphics = this.validationGraphics.clear();
    for (const { target, predicted } of model.validation) {
      const tx = target.x * width;
      const ty = target.y * height;
      const px = Phaser.Math.Clamp(predicted.x, 0, 1) * width;
      const py = Phaser.Math.Clamp(predicted.y, 0, 1) * height;
      graphics.lineStyle(1, 0xffffff, 0.5).lineBetween(tx, ty, px, py);
      graphics.strokeCircle(tx, ty, 7);
      graphics.fillStyle(0xff9b6b, 0.95).fillCircle(px, py, 4);
    }
  }

  private toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    this.debugButtonText.setText(
      `Debug overlay: ${this.debugVisible ? "ON" : "OFF"}`,
    );
    this.refreshOverlayVisibility();
  }

  private debugReport(
    source: GazeSource,
    point: GazePoint | null,
    now: number,
  ): string {
    const features = this.gaze.getTrackerFeatures();
    const signed = (value: number) =>
      `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
    return [
      `source ${source}  calibrated ${this.gaze.isCalibrated() ? "yes" : "no"}  blink ${features?.blink ? "yes" : "no"}`,
      features
        ? `eye ${signed(features.eyeX)} ${signed(features.eyeY)}  open ${features.openness.toFixed(2)}`
        : "eye —",
      features
        ? `head yaw ${signed(features.yaw)} pitch ${signed(features.pitch)}  at ${features.faceX.toFixed(2)},${features.faceY.toFixed(2)}`
        : "head —",
      `raw ${this.formatPoint(this.gaze.getRawPoint(now))}  out ${this.formatPoint(point)}`,
    ].join("\n");
  }

  private setVisible(
    objects: Phaser.GameObjects.GameObject[],
    visible: boolean,
  ): void {
    for (const object of objects) {
      if ("visible" in object) object.visible = visible;
    }
  }

  private persistSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.error("Could not save gaze settings.", error);
      this.setStatusPill("Could not save settings to this device.", "error");
    }
  }

  private formatPoint(point: GazePoint | null): string {
    return point ? `${point.x.toFixed(3)}, ${point.y.toFixed(3)}` : "—";
  }
}
