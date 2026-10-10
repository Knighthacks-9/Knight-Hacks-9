import Phaser from "phaser";
import type {
  CameraDef,
  TileType,
  Vec2,
  WorldMap,
  WorldSnapshot,
} from "../shared/types";
import { NPC_FRAME_TILES } from "../shared/npcSprites";
import { facingFor, sheetFor, standingFrame } from "./npcSprites";

interface Person {
  sprite: Phaser.GameObjects.Sprite;
  ring: Phaser.GameObjects.Ellipse;
}

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
 * currently sees, and the CCTV filter overlay. Clicking an NPC picks them in a
 * report (see ControlPanel).
 */
export class CameraFeed extends Phaser.GameObjects.Container {
  private readonly npcLayer: Phaser.GameObjects.Container;
  private readonly people = new Map<string, Person>();
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
    private readonly onPersonClick: (npcId: string) => void,
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

  /** Maps a canvas point (in pixels) on this feed back to building tile units. */
  toWorld(px: number, py: number): Vec2 {
    return {
      x: this.minTileX + (px - this.x - this.viewX) / this.tileSize,
      y: this.minTileY + (py - this.y - this.viewY) / this.tileSize,
    };
  }

  /**
   * Border: amber when chosen in a report, green when the player is looking
   * at it, grey otherwise.
   */
  setHighlight(watched: boolean, selected: boolean): void {
    if (selected) this.border.setStrokeStyle(4, 0xfbbf24);
    else this.border.setStrokeStyle(2, watched ? 0x4ade80 : 0x3a4a42);
  }

  /** Highlights the feed the player is looking at (kept for older callers). */
  setWatched(watched: boolean): void {
    this.setHighlight(watched, false);
  }

  /**
   * Moves the NPC sprites. Reported people get a red ring; the person picked
   * in the current report gets a thick amber one.
   */
  update(
    snapshot: WorldSnapshot | null,
    reported: ReadonlySet<string>,
    selectedNpc: string | null,
    shiftSeconds: number,
  ): void {
    const seen = new Set<string>();
    for (const npc of snapshot?.npcs ?? []) {
      if (!npc.cameraIds.includes(this.camera.id)) continue;
      seen.add(npc.id);
      const person = this.people.get(npc.id) ?? this.createPerson(npc.id);
      const px = this.viewX + (npc.x - this.minTileX) * this.tileSize;
      const py = this.viewY + (npc.y - this.minTileY) * this.tileSize;
      const ringColor =
        npc.id === selectedNpc
          ? 0xfbbf24
          : reported.has(npc.id)
            ? 0xff4040
            : null;
      person.ring
        .setPosition(px, py)
        .setStrokeStyle(npc.id === selectedNpc ? 4 : 2, ringColor ?? 0, 0.95)
        .setVisible(ringColor !== null);

      const dir = facingFor(npc.facingDeg);
      const sheet = person.sprite.texture.key;
      person.sprite.setPosition(px, py).setVisible(true);
      if (npc.moving) {
        person.sprite.play(`${sheet}-walk-${dir}`, true);
      } else {
        person.sprite.stop();
        person.sprite.setFrame(standingFrame(dir));
      }
    }
    for (const [id, person] of this.people) {
      if (!seen.has(id)) {
        person.sprite.setVisible(false);
        person.ring.setVisible(false);
      }
    }

    this.noise.setFillStyle(0xffffff, Math.random() < 0.08 ? 0.06 : 0);
    const s = Math.floor(shiftSeconds);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    this.clock.setText(`T+${mm}:${ss}`);
  }

  private createPerson(npcId: string): Person {
    // Stand the sprite's feet on the NPC's position (size shared with the UI).
    const size = Math.max(12, this.tileSize * NPC_FRAME_TILES);
    const ring = this.scene.add
      .ellipse(0, 0, this.tileSize * 1.1, this.tileSize * 0.6)
      .setVisible(false);
    const sprite = this.scene.add
      .sprite(0, 0, sheetFor(npcId), 0)
      .setDisplaySize(size, size)
      .setOrigin(0.5, 0.8)
      .setInteractive({ useHandCursor: true, pixelPerfect: true })
      .on("pointerdown", () => this.onPersonClick(npcId));
    const person = { sprite, ring };
    this.people.set(npcId, person);
    this.npcLayer.add([ring, sprite]);
    return person;
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
