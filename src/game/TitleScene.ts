import Phaser from "phaser";
import {
  LEVEL_KEY,
  MAX_SHIFT_SECONDS,
  MIN_SHIFT_SECONDS,
  SHIFT_SECONDS_KEY,
  SHIFT_SECONDS_STEP,
  loadShiftSeconds,
  saveShiftSeconds,
} from "./levels";
import { addButton, addSlider, addText } from "./ui";

function formatShift(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `Shift length: ${m}:${String(s).padStart(2, "0")}`;
}

export class TitleScene extends Phaser.Scene {
  constructor() {
    super("Title");
  }

  create(): void {
    // Dev shortcut: open /?level=7 to start at a later level.
    const requested = Number(
      new URLSearchParams(window.location.search).get("level"),
    );
    this.registry.set(
      LEVEL_KEY,
      Number.isInteger(requested) && requested > 0 ? requested : 1,
    );
    const shiftSeconds = loadShiftSeconds();
    this.registry.set(SHIFT_SECONDS_KEY, shiftSeconds);

    addText(this, 140, "KNIGHT'S EYE", 64, "#f3f4f6", true);
    addText(this, 200, "Train your attention", 22, "#9ca3af");
    addText(
      this,
      270,
      "Monitor the camera feeds through the night.\nReport anyone acting suspicious to dispatch for investigation.",
      18,
      "#d1d5db",
    );
    addSlider(this, 365, {
      min: MIN_SHIFT_SECONDS,
      max: MAX_SHIFT_SECONDS,
      step: SHIFT_SECONDS_STEP,
      value: shiftSeconds,
      format: formatShift,
      onChange: (seconds) => {
        this.registry.set(SHIFT_SECONDS_KEY, seconds);
        saveShiftSeconds(seconds);
      },
    });
    addButton(this, 440, "Start shift", "Calibration");
  }
}
