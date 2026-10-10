import Phaser from "phaser";
import { eventBus } from "../shared/eventBus";
import { CameraFeed } from "./CameraFeed";
import { LEVEL_COMPLETED_KEY, LEVEL_KEY, getLevelConfig } from "./levels";

const GAP = 8;
const MARGIN_X = 16;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 12;
export const FLAG_COUNT_KEY = "flagCount";
const SHIFT_DURATION_MS = 60_000;

export class ShiftScene extends Phaser.Scene {
  private feeds: CameraFeed[] = [];
  private shiftMs = 0;
  private flagCount = 0;
  private level = 1;
  private hud!: Phaser.GameObjects.Text;

  constructor() {
    super("Shift");
  }

  create(): void {
    this.feeds = [];
    this.shiftMs = 0;
    this.flagCount = 0;

    this.level = (this.registry.get(LEVEL_KEY) as number | undefined) ?? 1;
    const { screens, columns } = getLevelConfig(this.level);
    const rows = Math.ceil(screens / columns);
    const feedW = Math.floor(
      (this.scale.width - 2 * MARGIN_X - (columns - 1) * GAP) / columns,
    );
    const feedH = Math.floor(
      (this.scale.height - MARGIN_TOP - MARGIN_BOTTOM - (rows - 1) * GAP) /
        rows,
    );

    for (let i = 0; i < screens; i++) {
      const x = MARGIN_X + (i % columns) * (feedW + GAP);
      const y = MARGIN_TOP + Math.floor(i / columns) * (feedH + GAP);
      this.feeds.push(
        new CameraFeed(this, x, y, i, feedW, feedH, (cam, npc) =>
          this.flag(cam, npc),
        ),
      );
    }

    this.hud = this.add.text(MARGIN_X, 10, "", {
      color: "#9ca3af",
      fontFamily: "monospace",
      fontSize: "14px",
    });

    this.add
      .text(this.scale.width - MARGIN_X, 10, "End shift", {
        color: "#f3f4f6",
        fontFamily: "monospace",
        fontSize: "14px",
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.endShift(false));
  }

  update(_time: number, delta: number): void {
    this.shiftMs += delta;
    if (this.shiftMs >= SHIFT_DURATION_MS) return this.endShift(true);

    // TODO: swap the mouse pointer for the vision module's gaze point.
    const { x, y } = this.input.activePointer;
    for (const feed of this.feeds) {
      const watched =
        x >= feed.x &&
        x < feed.x + feed.feedWidth &&
        y >= feed.y &&
        y < feed.y + feed.feedHeight;
      feed.setWatched(watched);
      feed.update(delta / 1000, this.shiftMs);
    }

    const left = Math.ceil((SHIFT_DURATION_MS - this.shiftMs) / 1000);
    this.hud.setText(
      `NIGHT SHIFT  Level ${this.level} (${this.feeds.length} screens)  ${left}s left   Flags: ${this.flagCount}`,
    );
  }

  private flag(cameraId: number, npcId: string): void {
    this.flagCount++;
    eventBus.emit("flag:created", { cameraId, npcId, time: this.shiftMs });
  }

  private endShift(completed: boolean): void {
    this.registry.set(FLAG_COUNT_KEY, this.flagCount);
    // TODO: replace with real catch/miss scoring once analytics lands.
    this.registry.set(LEVEL_COMPLETED_KEY, completed && this.flagCount > 0);
    eventBus.emit("scene:navigate", "Debrief");
  }
}
