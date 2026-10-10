import Phaser from "phaser";
import type { TileType, WorldMap } from "../shared/types";

const TILE = 14;
const PAD = 8;
const HEADER = 20;
const TILE_COLORS: Record<TileType, number> = {
  wall: 0x1a1f1c,
  floor: 0x56645b,
  door: 0x9a7a3a,
  restricted: 0x7a3a3a,
  exit: 0x3b8a4a,
};
const CAMERA_COLOR = 0x44ccff;

/**
 * Layout of the whole building: rooms, doors, exits and where each camera
 * hangs. It shows no NPCs on purpose, so it can't be used to see into blind
 * spots. Hidden until toggled; while open it swallows clicks under it.
 */
export class MinimapOverlay extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, right: number, top: number, map: WorldMap) {
    const w = map.width * TILE + PAD * 2;
    const h = map.height * TILE + PAD * 2 + HEADER;
    super(scene, right - w, top);

    const bg = scene.add
      .rectangle(0, 0, w, h, 0x0b0f0d, 0.95)
      .setOrigin(0)
      .setStrokeStyle(1, 0x6b7280)
      .setInteractive(); // block clicks reaching the feeds underneath
    const title = scene.add.text(PAD, 4, "BUILDING MAP", {
      color: "#9ca3af",
      fontFamily: "monospace",
      fontSize: "12px",
    });

    const g = scene.add.graphics();
    const ox = PAD;
    const oy = PAD + HEADER;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        g.fillStyle(TILE_COLORS[map.tiles[y * map.width + x]]);
        g.fillRect(ox + x * TILE, oy + y * TILE, TILE, TILE);
      }
    }
    g.fillStyle(CAMERA_COLOR);
    for (const cam of map.cameras) {
      g.fillCircle(ox + (cam.x + 0.5) * TILE, oy + (cam.y + 0.5) * TILE, 4);
    }

    // Room names in the middle of each room, clear of the corner cameras.
    const labels = map.rooms.map((r) =>
      scene.add
        .text(
          ox + (r.x + r.w / 2) * TILE,
          oy + (r.y + r.h / 2) * TILE,
          r.name,
          { color: "#d1d5db", fontFamily: "monospace", fontSize: "11px" },
        )
        .setOrigin(0.5),
    );
    // Labels sit on the inward side of the camera so edge cameras stay inside.
    const camLabels = map.cameras.map((cam) => {
      const right = cam.x > map.width / 2;
      const below = cam.y > map.height / 2;
      return scene.add
        .text(
          ox + (cam.x + 0.5) * TILE + (right ? -6 : 6),
          oy + (cam.y + 0.5) * TILE + (below ? -6 : 6),
          cam.name,
          { color: "#44ccff", fontFamily: "monospace", fontSize: "10px" },
        )
        .setOrigin(right ? 1 : 0, below ? 1 : 0);
    });

    this.add([bg, title, g, ...labels, ...camLabels]);
    this.setDepth(20).setVisible(false);
    scene.add.existing(this);
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }
}
