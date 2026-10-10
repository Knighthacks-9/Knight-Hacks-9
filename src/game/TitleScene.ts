import Phaser from "phaser";
import { LEVEL_KEY } from "./levels";
import { addButton, addText } from "./ui";

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
    addText(this, 150, "NIGHTWATCH", 64, "#f3f4f6", true);
    addText(this, 210, "Train your attention", 22, "#9ca3af");
    addText(
      this,
      310,
      "Monitor the camera feeds through the night.\nClick anyone who looks suspicious to flag them.",
      18,
      "#d1d5db",
    );
    addButton(this, 410, "Start shift", "Calibration");
  }
}
