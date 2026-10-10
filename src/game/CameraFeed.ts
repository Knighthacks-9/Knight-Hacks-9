import Phaser from "phaser";
import {
  spawnPlaceholderNpcs,
  stepPlaceholderNpcs,
  type PlaceholderNpc,
} from "./placeholderNpcs";

/** One CCTV monitor: background, NPC markers, and the CCTV filter overlay. */
export class CameraFeed extends Phaser.GameObjects.Container {
  private readonly npcs: PlaceholderNpc[];
  private readonly dots = new Map<string, Phaser.GameObjects.Arc>();
  private readonly border: Phaser.GameObjects.Rectangle;
  private readonly noise: Phaser.GameObjects.Rectangle;
  private readonly clock: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    readonly cameraId: number,
    readonly feedWidth: number,
    readonly feedHeight: number,
    onFlag: (cameraId: number, npcId: string) => void,
  ) {
    super(scene, x, y);

    this.add(
      scene.add
        .rectangle(0, 0, this.feedWidth, this.feedHeight, 0x1d2a24)
        .setOrigin(0),
    );

    this.npcs = spawnPlaceholderNpcs(
      cameraId,
      4,
      this.feedWidth,
      this.feedHeight,
    );
    for (const npc of this.npcs) {
      const dot = scene.add
        .circle(npc.x, npc.y, 7, 0xcfd8cf)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => {
          onFlag(cameraId, npc.id);
          dot.setStrokeStyle(2, 0xff4040);
        });
      this.dots.set(npc.id, dot);
      this.add(dot);
    }

    this.add(this.buildFilter(scene));

    this.noise = scene.add
      .rectangle(0, 0, this.feedWidth, this.feedHeight, 0xffffff, 0)
      .setOrigin(0);
    this.add(this.noise);

    const style = {
      color: "#d7ffd7",
      fontFamily: "monospace",
      fontSize: "12px",
    };
    this.add(scene.add.text(8, 6, `CAM ${cameraId + 1}`, style));
    this.add(
      scene.add.text(this.feedWidth - 48, 6, "● REC", {
        ...style,
        color: "#ff5555",
      }),
    );
    this.clock = scene.add.text(8, this.feedHeight - 20, "", style);
    this.add(this.clock);

    this.border = scene.add
      .rectangle(0, 0, this.feedWidth, this.feedHeight)
      .setOrigin(0)
      .setStrokeStyle(2, 0x3a4a42);
    this.add(this.border);

    scene.add.existing(this);
  }

  /** Highlights the feed the player is looking at (mouse stands in for gaze). */
  setWatched(watched: boolean): void {
    this.border.setStrokeStyle(2, watched ? 0x4ade80 : 0x3a4a42);
  }

  update(dt: number, shiftMs: number): void {
    stepPlaceholderNpcs(this.npcs, dt, this.feedWidth, this.feedHeight);
    for (const npc of this.npcs)
      this.dots.get(npc.id)?.setPosition(npc.x, npc.y);

    this.noise.setFillStyle(0xffffff, Math.random() < 0.08 ? 0.06 : 0);

    const s = Math.floor(shiftMs / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    this.clock.setText(`T+${mm}:${ss}`);
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
