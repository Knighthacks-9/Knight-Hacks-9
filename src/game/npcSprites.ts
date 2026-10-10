import Phaser from "phaser";

/**
 * NPC sprite sheets in public/assets/npcs: 256x256, 4x4 frames of 64x64.
 * Rows face down, left, right, up; each row is a 4-frame walk cycle and
 * column 0 doubles as the standing pose.
 */
const SHEETS = ["npc1", "npc2", "npc3"];
const FRAME = 64;
const DIRS = ["down", "left", "right", "up"] as const;
export type Facing = (typeof DIRS)[number];

export function preloadNpcSprites(scene: Phaser.Scene): void {
  for (const key of SHEETS) {
    scene.load.spritesheet(
      key,
      `${import.meta.env.BASE_URL}assets/npcs/${key}.png`,
      { frameWidth: FRAME, frameHeight: FRAME },
    );
  }
}

/** Registers walk animations once per game (animations are global). */
export function createNpcAnims(scene: Phaser.Scene): void {
  for (const key of SHEETS) {
    DIRS.forEach((dir, row) => {
      const anim = `${key}-walk-${dir}`;
      if (scene.anims.exists(anim)) return;
      scene.anims.create({
        key: anim,
        frames: scene.anims.generateFrameNumbers(key, {
          start: row * 4,
          end: row * 4 + 3,
        }),
        frameRate: 8,
        repeat: -1,
      });
    });
  }
}

/** Same NPC always gets the same look, on every feed. */
export function sheetFor(npcId: string): string {
  let h = 0;
  for (const c of npcId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SHEETS[h % SHEETS.length];
}

/** facingDeg: 0 = east, 90 = south (screen coords). */
export function facingFor(facingDeg: number): Facing {
  const a = ((facingDeg % 360) + 360) % 360;
  if (a >= 45 && a < 135) return "down";
  if (a >= 135 && a < 225) return "left";
  if (a >= 225 && a < 315) return "up";
  return "right";
}

export function standingFrame(dir: Facing): number {
  return DIRS.indexOf(dir) * 4;
}
