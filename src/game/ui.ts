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

export interface SliderOptions {
  min: number;
  max: number;
  step: number;
  value: number;
  width?: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

/** A horizontal slider centred at y, with its value shown above it. Drag or click the track. */
export function addSlider(
  scene: Phaser.Scene,
  y: number,
  { min, max, step, value, width = 320, format, onChange }: SliderOptions,
): void {
  const left = scene.scale.width / 2 - width / 2;
  const label = addText(scene, y - 26, format(value), 16, "#d1d5db");
  scene.add
    .rectangle(left, y, width, 6, 0x374151)
    .setOrigin(0, 0.5)
    .setInteractive({ useHandCursor: true })
    .on("pointerdown", (pointer: Phaser.Input.Pointer) => setFromX(pointer.x));
  const fill = scene.add.rectangle(left, y, 0, 6, 0x4ade80).setOrigin(0, 0.5);
  const handle = scene.add
    .circle(0, y, 10, 0x4ade80)
    .setStrokeStyle(2, 0x10131b)
    .setInteractive({ useHandCursor: true, draggable: true })
    .on("drag", (pointer: Phaser.Input.Pointer) => setFromX(pointer.x));

  function show(current: number) {
    const x = left + ((current - min) / (max - min)) * width;
    handle.setX(x);
    fill.width = x - left;
    label.setText(format(current));
  }

  function setFromX(x: number) {
    const ratio = Phaser.Math.Clamp((x - left) / width, 0, 1);
    const next = Math.round((min + ratio * (max - min)) / step) * step;
    if (next !== value) {
      value = next;
      onChange(value);
    }
    show(value);
  }

  show(value);
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
