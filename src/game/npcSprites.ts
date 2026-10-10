import type Phaser from "phaser";
import {
  NPC_FACINGS,
  NPC_FRAME,
  NPC_SHEETS,
  NPC_WALK_FPS,
  facingRow,
  npcSheetUrl,
  type Facing,
} from "../shared/npcSprites";

export { facingFor, sheetFor } from "../shared/npcSprites";

export function preloadNpcSprites(scene: Phaser.Scene): void {
  for (const key of NPC_SHEETS) {
    scene.load.spritesheet(key, npcSheetUrl(key), {
      frameWidth: NPC_FRAME,
      frameHeight: NPC_FRAME,
    });
  }
}

/** Registers walk animations once per game (animations are global). */
export function createNpcAnims(scene: Phaser.Scene): void {
  for (const key of NPC_SHEETS) {
    for (const dir of NPC_FACINGS) {
      const anim = `${key}-walk-${dir}`;
      if (scene.anims.exists(anim)) continue;
      const row = facingRow(dir);
      scene.anims.create({
        key: anim,
        frames: scene.anims.generateFrameNumbers(key, {
          start: row * 4,
          end: row * 4 + 3,
        }),
        frameRate: NPC_WALK_FPS,
        repeat: -1,
      });
    }
  }
}

export function standingFrame(dir: Facing): number {
  return facingRow(dir) * 4;
}
