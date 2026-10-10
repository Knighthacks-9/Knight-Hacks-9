import Phaser from "phaser";
import { CalibrationScene } from "./game/CalibrationScene";
import { DebriefScene } from "./game/DebriefScene";
import { ShiftScene } from "./game/ShiftScene";
import { TitleScene } from "./game/TitleScene";
import { eventBus } from "./shared/eventBus";
import type { SceneKey } from "./shared/types";
import "./style.css";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: 960,
  hehight: 540,
  backgroundColor: "#10131b",
  scene: [TitleScene],
});

game.events.once(Phaser.Core.Events.READY, () => {
  game.scene.add("Calibration", CalibrationScene, false);
  game.scene.add("Shift", ShiftScene, false);
  game.scene.add("Debrief", DebriefScene, false);
});

eventBus.on("scene:navigate", (scene: SceneKey) => {
  for (const activeScene of game.scene.getScenes(true)) {
    game.scene.stop(activeScene.scene.key);
  }
  game.scene.start(scene);
});
