import Phaser from "phaser";
import { eventBus } from "../shared/eventBus";
import type { SceneKey } from "../shared/types";

export class SceneScreen extends Phaser.Scene {
  constructor(
    private readonly sceneKey: SceneKey,
    private readonly nextScene: SceneKey,
  ) {
    super(sceneKey);
  }

  create(): void {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height / 2 - 24, this.sceneKey, {
        color: "#f3f4f6",
        fontFamily: "Arial, sans-serif",
        fontSize: "40px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 + 36, "Click to continue", {
        color: "#9ca3af",
        fontFamily: "Arial, sans-serif",
        fontSize: "18px",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => eventBus.emit("scene:navigate", this.nextScene));
  }
}
