import Phaser from "phaser";
import type {
  CameraDef,
  TileType,
  WorldMap,
  WorldSnapshot,
} from "../shared/types";

const TILE_COLORS: Record<TileType, number> = {
  wall: 0x0f1512,
  floor: 0x3b4a41,
  door: 0x5c5236,
  restricted: 0x4f3434,
  exit: 0x35583f,
};
/** Walkable tiles inside the frame that this camera cannot see. */
const HIDDEN_TILE = 0x18201b;

/**
 * One CCTV monitor: the part of the building a world camera sees, the NPCs it
 * currently sees, and the CCTV filter overlay. Clicking an NPC flags it.
 */
export class CameraFeed extends Phaser.GameObjects.Container {
  private readonly npcLayer: Phaser.GameObjects.Container;
  private readonly dots = new Map<string, Phaser.GameObjects.Arc>();
  private readonly border: Phaser.GameObjects.Rectangle;
  private readonly noise: Phaser.GameObjects.Rectangle;
  private readonly clock: Phaser.GameObjects.Text;
  private readonly tileSize: number;
  private readonly viewX: number;
  private readonly viewY: number;
  private readonly minTileX: number;
  private readonly minTileY: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    readonly feedWidth: number,
    readonly feedHeight: number,
    readonly camera: CameraDef,
    map: WorldMap,
    index: number,
    private readonly onFlag: (npcId: string) => void,
  ) {
    super(scene, x, y);

    // Frame the tiles this camera can see (plus the camera itself).
    const xs = camera.visibleTiles.map((i) => i % map.width).concat(camera.x);
    const ys = camera.visibleTiles
      .map((i) => Math.floor(i / map.width))
      .concat(camera.y);
    this.minTileX = Math.min(...xs) - 1;
    this.minTileY = Math.min(...ys) - 1;
    const tilesWide = Math.max(...xs) + 2 - this.minTileX;
    const tilesHigh = Math.max(...ys) + 2 - this.minTileY;
    this.tileSize = Math.min(feedWidth / tilesWide, feedHeight / tilesHigh);
    this.viewX = (feedWidth - tilesWide * this.tileSize) / 2;
    this.viewY = (feedHeight - tilesHigh * this.tileSize) / 2;

    this.add(
      scene.add.rectangle(0, 0, feedWidth, feedHeight, 0x0b100d).setOrigin(0),
    );
    this.add(this.drawView(scene, map, tilesWide, tilesHigh));
    this.npcLayer = scene.add.container(0, 0);
    this.add(this.npcLayer);
    this.add(this.buildFilter(scene));

    this.noise = scene.add
      .rectangle(0, 0, feedWidth, feedHeight, 0xffffff, 0)
      .setOrigin(0);
    this.add(this.noise);

    const style = {
      color: "#d7ffd7",
      fontFamily: "monospace",
      fontSize: "12px",
    };
    this.add(
      scene.add.text(
        8,
        6,
        `CAM ${index + 1} · ${camera.name.toUpperCase()}`,
        style,
      ),
    );
    this.add(
      scene.add.text(feedWidth - 48, 6, "● REC", {
        ...style,
        color: "#ff5555",
      }),
    );
    this.clock = scene.add.text(8, feedHeight - 20, "", style);
    this.add(this.clock);

    this.border = scene.add
      .rectangle(0, 0, feedWidth, feedHeight)
      .setOrigin(0)
      .setStrokeStyle(2, 0x3a4a42);
    this.add(this.border);

    scene.add.existing(this);
  }

  /** True when a canvas point (in pixels) lies on this feed. */
  contains(px: number, py: number): boolean {
    return (
      px >= this.x &&
      px < this.x + this.feedWidth &&
      py >= this.y &&
      py < this.y + this.feedHeight
    );
  }

  /** Highlights the feed the player is looking at. */
  setWatched(watched: boolean): void {
    this.border.setStrokeStyle(2, watched ? 0x4ade80 : 0x3a4a42);
  }

  update(
    snapshot: WorldSnapshot | null,
    flagged: ReadonlySet<string>,
    shiftSeconds: number,
  ): void {
    const seen = new Set<string>();
    for (const npc of snapshot?.npcs ?? []) {
      if (!npc.cameraIds.includes(this.camera.id)) continue;
      seen.add(npc.id);
      const dot = this.dots.get(npc.id) ?? this.createDot(npc.id, npc.color);
      dot
        .setPosition(
          this.viewX + (npc.x - this.minTileX) * this.tileSize,
          this.viewY + (npc.y - this.minTileY) * this.tileSize,
        )
        .setStrokeStyle(2, flagged.has(npc.id) ? 0xff4040 : 0x000000, 0.9)
        .setVisible(true);
    }
    for (const [id, dot] of this.dots) {
      if (!seen.has(id)) dot.setVisible(false);
    }

    this.noise.setFillStyle(0xffffff, Math.random() < 0.08 ? 0.06 : 0);
    const s = Math.floor(shiftSeconds);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    this.clock.setText(`T+${mm}:${ss}`);
  }

  private createDot(npcId: string, color: number): Phaser.GameObjects.Arc {
    const radius = Math.max(4, this.tileSize * 0.45);
    const dot = this.scene.add
      .circle(0, 0, radius, color)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.onFlag(npcId));
    this.dots.set(npcId, dot);
    this.npcLayer.add(dot);
    return dot;
  }

  private drawView(
    scene: Phaser.Scene,
    map: WorldMap,
    tilesWide: number,
    tilesHigh: number,
  ): Phaser.GameObjects.Graphics {
    const visible = new Set(this.camera.visibleTiles);
    const g = scene.add.graphics();
    for (let ty = 0; ty < tilesHigh; ty++) {
      for (let tx = 0; tx < tilesWide; tx++) {
        const mx = this.minTileX + tx;
        const my = this.minTileY + ty;
        if (mx < 0 || my < 0 || mx >= map.width || my >= map.height) continue;
        const i = my * map.width + mx;
        const type = map.tiles[i];
        g.fillStyle(
          type === "wall" || visible.has(i) ? TILE_COLORS[type] : HIDDEN_TILE,
        );
        g.fillRect(
          this.viewX + tx * this.tileSize,
          this.viewY + ty * this.tileSize,
          Math.ceil(this.tileSize),
          Math.ceil(this.tileSize),
        );
      }
    }
    return g;
  }

  /** Scanlines and edge vignette. */
  private buildFilter(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
    const g = scene.add.graphics();
    g.fillStyle(0x000000, 0.18);
    for (let y = 0; y < this.feedHeight; y += 4)
      g.fillRect(0, y, this.feedWidth, 2);

    const v = 40;
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.5, 0.5, 0, 0);
    g.fillRect(0, 0, this.feedWidth, v);
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.5, 0.5);
    g.fillRect(0, this.feedHeight - v, this.feedWidth, v);
    return g;
  }
}
