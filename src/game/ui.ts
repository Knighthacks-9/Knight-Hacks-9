import Phaser from "phaser";
import { eventBus } from "../shared/eventBus";
import type { SceneKey } from "../shared/types";

const FONT = "Arial, sans-serif";

export function addText(
  scene: Phaser.Scene,
  y: number,
  text: string,
  size: number,
  color = "#f3f4f6",
  bold = false,
): Phaser.GameObjects.Text {
  return scene.add
    .text(scene.scale.width / 2, y, text, {
      align: "center",
      color,
      fontFamily: FONT,
      fontSize: `${size}px`,
      fontStyle: bold ? "bold" : "normal",
    })
    .setOrigin(0.5);
}

export function addButton(
  scene: Phaser.Scene,
  y: number,
  label: string,
  target: SceneKey,
  onClick?: () => void,
): Phaser.GameObjects.Text {
  return addText(scene, y, label, 22, "#4ade80", true)
    .setPadding(16, 8)
    .setInteractive({ useHandCursor: true })
    .on("pointerover", function (this: Phaser.GameObjects.Text) {
      this.setColor("#bbf7d0");
    })
    .on("pointerout", function (this: Phaser.GameObjects.Text) {
      this.setColor("#4ade80");
    })
    .on("pointerdown", () => {
      onClick?.();
      eventBus.emit("scene:navigate", target);
    });
}
