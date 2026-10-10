import Phaser from "phaser";
import {
  DEFAULT_GAZE_SETTINGS,
  fitCalibration,
  gazeController,
  type CalibrationSample,
  type GazePoint,
  type GazeSettings,
} from "../vision";
import { eventBus } from "../shared/eventBus";

const SETTINGS_KEY = "night-watch:gaze-settings";
const CALIBRATION_KEY = "night-watch:gaze-calibration";
const SAMPLE_TARGETS: GazePoint[] = [
  { x: 0.12, y: 0.14 },
  { x: 0.88, y: 0.14 },
  { x: 0.5, y: 0.5 },
  { x: 0.12, y: 0.86 },
  { x: 0.88, y: 0.86 },
];

function isPoint(value: unknown): value is GazePoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<GazePoint>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
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

function readCalibration(): CalibrationSample[] {
  try {
    const stored = localStorage.getItem(CALIBRATION_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (sample) =>
          sample &&
          typeof sample === "object" &&
          isPoint(sample.input) &&
          isPoint(sample.target),
      )
    ) {
      throw new Error("Stored calibration data has an invalid shape.");
    }
    return parsed as CalibrationSample[];
  } catch (error) {
    console.error("Could not load gaze calibration.", error);
    return [];
  }
}

export class CalibrationScene extends Phaser.Scene {
  private readonly gaze = gazeController;
  private settings: GazeSettings = { ...DEFAULT_GAZE_SETTINGS };
  private samples: CalibrationSample[] = [];
  private targetIndex = 0;
  private calibrating = false;
  private debugVisible = false;
  private lastSource: "tracker" | "mouse" | "none" = "none";
  private setupObjects: Phaser.GameObjects.GameObject[] = [];
  private calibrationObjects: Phaser.GameObjects.GameObject[] = [];
  private sensitivityText!: Phaser.GameObjects.Text;
  private smoothingText!: Phaser.GameObjects.Text;
  private fallbackText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private target!: Phaser.GameObjects.Container;
  private progressText!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  private debugText!: Phaser.GameObjects.Text;
  private debugPanel!: Phaser.GameObjects.Rectangle;
  private cursor!: Phaser.GameObjects.Arc;

  constructor() {
    super("Calibration");
  }

  create(): void {
    const { width, height } = this.scale;
    this.settings = readSettings();
    this.gaze.setSettings(this.settings);
    this.samples = readCalibration();
    this.gaze.setCalibration(fitCalibration(this.samples));

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
      .rectangle(width / 2, 255, 650, 195, 0x1b202b)
      .setStrokeStyle(1, 0x343c4b);
    this.add.text(180, 184, "POINTER TUNING", {
      color: "#c5cbd5",
      fontFamily: "Arial, sans-serif",
      fontSize: "14px",
      fontStyle: "bold",
    });
    this.add.text(180, 224, "Sensitivity", {
      color: "#f3f4f6",
      fontFamily: "Arial, sans-serif",
      fontSize: "17px",
    });
    this.sensitivityText = this.add.text(414, 224, "", this.valueStyle());
    this.add.text(180, 294, "Smoothing", {
      color: "#f3f4f6",
      fontFamily: "Arial, sans-serif",
      fontSize: "17px",
    });
    this.smoothingText = this.add.text(414, 294, "", this.valueStyle());
    this.add.text(180, 354, "Mouse fallback", {
      color: "#f3f4f6",
      fontFamily: "Arial, sans-serif",
      fontSize: "17px",
    });
    this.fallbackText = this.add.text(414, 354, "", this.valueStyle());

    this.addButton(520, 236, "−", () =>
      this.adjustSetting("sensitivity", -0.1),
    );
    this.addButton(574, 236, "+", () => this.adjustSetting("sensitivity", 0.1));
    this.addButton(520, 306, "−", () => this.adjustSetting("smoothing", -0.1));
    this.addButton(574, 306, "+", () => this.adjustSetting("smoothing", 0.1));
    this.addButton(520, 366, "Toggle", () => this.toggleFallback());

    this.add
      .text(
        width / 2,
        378,
        "If a tracker has no face sample, the cursor can stand in for gaze.",
        {
          color: "#9ca3af",
          fontFamily: "Arial, sans-serif",
          fontSize: "13px",
        },
      )
      .setOrigin(0.5, 0);
    this.addButton(
      width / 2,
      438,
      "START 5-POINT CALIBRATION",
      () => this.startCalibration(),
      280,
    );
    this.addButton(
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
    this.add.text(52, height - 72, "Calibration saved on this device.", {
      color: "#727b8b",
      fontFamily: "Arial, sans-serif",
      fontSize: "13px",
    });

    this.setupObjects = [...this.children.list];

    this.instructionText = this.add
      .text(
        width / 2,
        55,
        "Look at each dot, then press SPACE or click to record.",
        {
          color: "#d7dce5",
          fontFamily: "Arial, sans-serif",
          fontSize: "18px",
        },
      )
      .setOrigin(0.5);
    this.progressText = this.add
      .text(width / 2, height - 46, "", {
        color: "#aab2c0",
        fontFamily: "Arial, sans-serif",
        fontSize: "16px",
      })
      .setOrigin(0.5);
    this.target = this.add.container(0, 0, [
      this.add.circle(0, 0, 25, 0x68e0ad, 0.2),
      this.add.circle(0, 0, 10, 0x68e0ad),
      this.add.circle(0, 0, 3, 0xffffff),
    ]);
    this.calibrationObjects = [
      this.instructionText,
      this.progressText,
      this.target,
    ];
    this.setVisible(this.calibrationObjects, false);

    this.debugPanel = this.add
      .rectangle(12, 12, 300, 76, 0x080a0f, 0.88)
      .setOrigin(0);
    this.debugText = this.add.text(24, 20, "", {
      color: "#d5f9e9",
      fontFamily: "monospace",
      fontSize: "12px",
      lineSpacing: 4,
    });
    this.cursor = this.add.circle(0, 0, 7, 0xffd166).setDepth(10);
    this.setVisible([this.debugPanel, this.debugText, this.cursor], false);

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      this.updateMousePoint(pointer);
    });
    this.input.on(
      "pointerdown",
      (
        pointer: Phaser.Input.Pointer,
        currentlyOver: Phaser.GameObjects.GameObject[],
      ) => {
        this.updateMousePoint(pointer);
        if (this.calibrating && currentlyOver.length === 0) {
          this.captureSample();
        }
      },
    );
    this.input.keyboard?.on("keydown-SPACE", () => {
      if (this.calibrating) this.captureSample();
    });

    this.updateSettingsLabels();
    this.updateStatus();
  }

  update(): void {
    const source = this.gaze.getSource();
    if (source !== this.lastSource) {
      this.lastSource = source;
      this.updateStatus();
    }

    const point = this.gaze.getPoint();
    if (point) {
      this.cursor.setPosition(
        point.x * this.scale.width,
        point.y * this.scale.height,
      );
    }
    this.cursor.setVisible(this.debugVisible && point !== null);
    this.debugText.setText(
      `source: ${this.gaze.getSource()}\nraw: ${this.formatPoint(this.gaze.getRawPoint())}\noutput: ${this.formatPoint(point)}`,
    );
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
  ): void {
    const background = this.add
      .rectangle(x, y, width, 38, 0x293141)
      .setStrokeStyle(1, 0x465267)
      .setInteractive({ useHandCursor: true });
    const text = this.add
      .text(x, y, label, {
        color: "#f3f4f6",
        fontFamily: "Arial, sans-serif",
        fontSize: width > 100 ? "14px" : "20px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    background.on("pointerover", () => background.setFillStyle(0x364156));
    background.on("pointerout", () => background.setFillStyle(0x293141));
    background.on("pointerdown", callback);
    text.setInteractive({ useHandCursor: true }).on("pointerdown", callback);
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
    const label =
      source === "tracker"
        ? "TRACKER CONNECTED"
        : this.settings.useMouseFallback
          ? "MOUSE FALLBACK ENABLED"
          : "WAITING FOR TRACKER";
    this.statusText.setText(`●  ${label}`);
    this.statusText.setStyle({
      color: source === "tracker" ? "#8ee5bd" : "#ffd166",
      backgroundColor: source === "tracker" ? "#1c302b" : "#332b1d",
    });
  }

  private updateMousePoint(pointer: Phaser.Input.Pointer): void {
    const canvas = this.game.canvas;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    this.gaze.setMousePoint({
      x: Phaser.Math.Clamp(pointer.x / this.scale.width, 0, 1),
      y: Phaser.Math.Clamp(pointer.y / this.scale.height, 0, 1),
    });
  }

  private startCalibration(): void {
    this.calibrating = true;
    this.targetIndex = 0;
    this.samples = [];
    this.setVisible(this.setupObjects, false);
    this.setVisible(this.calibrationObjects, true);
    this.updateTarget();
  }

  private captureSample(): void {
    const input = this.gaze.getRawPoint();
    if (!input) {
      this.instructionText.setText(
        "No gaze sample available. Enable mouse fallback or connect a tracker.",
      );
      return;
    }

    const target = SAMPLE_TARGETS[this.targetIndex];
    this.samples.push({ input, target: { ...target } });
    this.targetIndex += 1;

    if (this.targetIndex < SAMPLE_TARGETS.length) {
      this.updateTarget();
      return;
    }

    const transform = fitCalibration(this.samples);
    if (!transform) {
      this.instructionText.setText(
        "Those points could not be mapped. Try again and keep each sample distinct.",
      );
      this.targetIndex = 0;
      this.samples = [];
      this.updateTarget();
      return;
    }

    this.gaze.setCalibration(transform);
    this.persistCalibration();
    this.calibrating = false;
    this.setVisible(this.calibrationObjects, false);
    this.setVisible(this.setupObjects, true);
    this.updateStatus();
  }

  private updateTarget(): void {
    const { width, height } = this.scale;
    const point = SAMPLE_TARGETS[this.targetIndex];
    this.target.setPosition(point.x * width, point.y * height);
    this.progressText.setText(
      `POINT ${this.targetIndex + 1} OF ${SAMPLE_TARGETS.length}`,
    );
    this.instructionText.setText(
      "Look at the dot, then press SPACE or click to record.",
    );
  }

  private toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    this.setVisible([this.debugPanel, this.debugText], this.debugVisible);
    const button = this.children.list.find(
      (object): object is Phaser.GameObjects.Text =>
        object instanceof Phaser.GameObjects.Text &&
        object.text.startsWith("Debug overlay:"),
    );
    button?.setText(`Debug overlay: ${this.debugVisible ? "ON" : "OFF"}`);
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
      this.statusText.setText("Could not save settings to this device.");
    }
  }

  private persistCalibration(): void {
    try {
      localStorage.setItem(CALIBRATION_KEY, JSON.stringify(this.samples));
    } catch (error) {
      console.error("Could not save gaze calibration.", error);
      this.statusText.setText(
        "Calibration works for this session but could not be saved.",
      );
    }
  }

  private formatPoint(point: GazePoint | null): string {
    return point ? `${point.x.toFixed(3)}, ${point.y.toFixed(3)}` : "—";
  }
}
