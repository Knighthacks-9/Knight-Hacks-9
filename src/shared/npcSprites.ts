// NPC sprite sheets in public/assets/npcs: 256x256, 4x4 frames of 64x64.
// Rows face down, left, right, up; each row is a 4-frame walk cycle and
// column 0 doubles as the standing pose. No engine imports, so both the
// Phaser scenes and the DOM UI can use it.

export const NPC_SHEETS = ["npc1", "npc2", "npc3"] as const;
export const NPC_FRAME = 64;
export const NPC_WALK_FPS = 8;
/** Figure height in tiles is about 0.6 of this (the frame has padding). */
export const NPC_FRAME_TILES = 2.16;
/** Where the feet sit in the frame, as a fraction of its height. */
export const NPC_FEET_Y = 0.8;

const DIRS = ["down", "left", "right", "up"] as const;
export type Facing = (typeof DIRS)[number];

export function npcSheetUrl(sheet: string): string {
  return `${import.meta.env.BASE_URL}assets/npcs/${sheet}.png`;
}

/** Same NPC always gets the same look, on every feed. */
export function sheetFor(npcId: string): string {
  let h = 0;
  for (const c of npcId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return NPC_SHEETS[h % NPC_SHEETS.length];
}

/** facingDeg: 0 = east, 90 = south (screen coords). */
export function facingFor(facingDeg: number): Facing {
  const a = ((facingDeg % 360) + 360) % 360;
  if (a >= 45 && a < 135) return "down";
  if (a >= 135 && a < 225) return "left";
  if (a >= 225 && a < 315) return "up";
  return "right";
}

/** Sheet row for a direction (each row holds 4 walk frames). */
export function facingRow(dir: Facing): number {
  return DIRS.indexOf(dir);
}

export const NPC_FACINGS = DIRS;
