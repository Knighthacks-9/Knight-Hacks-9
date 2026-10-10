import Phaser from "phaser";
import { startListening, type Transmission } from "../audio";
import { eventBus } from "../shared/eventBus";
import type { ShiftReport, WorldMap, WorldSnapshot } from "../shared/types";
import { gazeController } from "../vision";
import { startWorld, type WorldHandle } from "../world";
import { CameraFeed } from "./CameraFeed";
import {
  FEED_LIMIT_KEY,
  LEVEL_KEY,
  REPORT_KEY,
  LEVELS,
  SHIFT_SECONDS_KEY,
  clampShiftSeconds,
  loadShiftSeconds,
  getFeedLayout,
} from "./levels";

const GAP = 8;
const MARGIN_X = 16;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 12;
/** Longest frame step fed to the sim, so a backgrounded tab doesn't jump ahead. */
const MAX_DT = 0.1;

/**
 * Runs a shift: owns the clock (sim:tick), shows the world's cameras, turns
 * the vision module's gaze point into the watched feed (gaze:sample), and
 * reports flags. Analytics answers shift:end with the debrief report.
 */
export class ShiftScene extends Phaser.Scene {
  private feeds: CameraFeed[] = [];
  private world: WorldHandle | null = null;
  private snapshot: WorldSnapshot | null = null;
  private flagged = new Set<string>();
  private t = 0;
  private level = 1;
  private shiftSeconds = 0;
  private ended = false;
  private hud!: Phaser.GameObjects.Text;
  private reticle!: Phaser.GameObjects.Arc;
  private transmittingText!: Phaser.GameObjects.Text;
  private transmission: Transmission | null = null;
  private transmissionStart = 0;

  constructor() {
    super("Shift");
  }

  create(): void {
    this.feeds = [];
    this.snapshot = null;
    this.flagged = new Set();
    this.t = 0;
    this.ended = false;
    this.level = (this.registry.get(LEVEL_KEY) as number | undefined) ?? 1;
    this.shiftSeconds = clampShiftSeconds(
      (this.registry.get(SHIFT_SECONDS_KEY) as number | undefined) ??
        loadShiftSeconds(),
    );
    this.registry.remove(REPORT_KEY);

    const onSnapshot = (snapshot: WorldSnapshot) => (this.snapshot = snapshot);
    const onReport = (report: ShiftReport) =>
      this.registry.set(REPORT_KEY, report);
    eventBus.on("world:snapshot", onSnapshot);
    eventBus.on("analytics:report", onReport);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // A transmission still open when the shift ends is discarded.
      void this.transmission?.stop();
      this.transmission = null;
      this.world?.stop();
      this.world = null;
      eventBus.off("world:snapshot", onSnapshot);
      eventBus.off("analytics:report", onReport);
    });

    // startWorld emits world:map synchronously, so listen first.
    let map: WorldMap | null = null;
    const onMap = (m: WorldMap) => (map = m);
    eventBus.on("world:map", onMap);
    this.world = startWorld({ shiftSeconds: this.shiftSeconds });
    eventBus.off("world:map", onMap);
    if (!map) throw new Error("The world did not publish its map.");
    this.buildFeeds(map);

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
    if (this.level < LEVELS.length) {
      this.add
        .text(this.scale.width - MARGIN_X - 100, 10, "Skip level ▸", {
          color: "#fbbf24",
          fontFamily: "monospace",
          fontSize: "14px",
        })
        .setOrigin(1, 0)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.skipLevel());
    }
    // Shows where the eye tracker thinks the player is looking.
    this.reticle = this.add
      .circle(0, 0, 14)
      .setStrokeStyle(2, 0xffd166, 0.7)
      .setDepth(10)
      .setVisible(false);

    // Push-to-talk: hold Space to radio in, release to send.
    this.transmittingText = this.add
      .text(660, 10, "● TRANSMITTING", {
        color: "#ff5555",
        fontFamily: "monospace",
        fontSize: "14px",
      })
      .setOrigin(0.5, 0)
      .setVisible(false);
    const talkKey = this.input.keyboard?.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE,
    );
    talkKey?.on("down", () => this.startTransmission());
    talkKey?.on("up", () => void this.endTransmission());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (talkKey) this.input.keyboard?.removeKey(talkKey, true);
    });

    eventBus.emit("shift:start", {
      level: this.level,
      shiftSeconds: this.shiftSeconds,
      cameraIds: this.feeds.map((feed) => feed.camera.id),
    });
  }

  update(_time: number, delta: number): void {
    if (this.ended) return;
    const dt = Math.min(delta / 1000, MAX_DT);
    this.t += dt;
    eventBus.emit("sim:tick", { dt, t: this.t }); // world replies with world:snapshot

    const now = performance.now();
    const source = gazeController.getSource(now);
    const point = gazeController.getPoint(now);
    const px = point ? point.x * this.scale.width : -1;
    const py = point ? point.y * this.scale.height : -1;
    const watched = point
      ? (this.feeds.find((feed) => feed.contains(px, py)) ?? null)
      : null;
    for (const feed of this.feeds) {
      feed.setWatched(feed === watched);
      feed.update(this.snapshot, this.flagged, this.t);
    }
    this.reticle.setPosition(px, py).setVisible(source === "tracker");
    eventBus.emit("gaze:sample", {
      t: this.t,
      x: point?.x ?? null,
      y: point?.y ?? null,
      source,
      cameraId: watched?.camera.id ?? null,
    });

    if (this.t >= this.shiftSeconds) return this.endShift(true);
    const left = Math.ceil(this.shiftSeconds - this.t);
    this.hud.setText(
      `NIGHT SHIFT  Level ${this.level} (${this.feeds.length} screens)  ${left}s left   Flags: ${this.flagged.size}   Gaze: ${source}`,
    );
  }

  private buildFeeds(map: WorldMap): void {
    this.registry.set(FEED_LIMIT_KEY, map.cameras.length);
    const { screens, columns } = getFeedLayout(this.level, map.cameras.length);
    const rows = Math.ceil(screens / columns);
    const feedW = Math.floor(
      (this.scale.width - 2 * MARGIN_X - (columns - 1) * GAP) / columns,
    );
    const feedH = Math.floor(
      (this.scale.height - MARGIN_TOP - MARGIN_BOTTOM - (rows - 1) * GAP) /
        rows,
    );

    map.cameras.slice(0, screens).forEach((camera, i) => {
      const x = MARGIN_X + (i % columns) * (feedW + GAP);
      const y = MARGIN_TOP + Math.floor(i / columns) * (feedH + GAP);
      this.feeds.push(
        new CameraFeed(this, x, y, feedW, feedH, camera, map, i, (npcId) =>
          this.flag(camera.id, npcId),
        ),
      );
    });
  }

  private flag(cameraId: string, npcId: string): void {
    if (this.ended || this.flagged.has(npcId)) return;
    this.flagged.add(npcId);
    eventBus.emit("flag:created", { t: this.t, npcId, cameraId });
  }

  private startTransmission(): void {
    if (this.ended || this.transmission) return;
    this.transmission = startListening();
    this.transmissionStart = this.t;
    this.transmittingText.setVisible(true);
  }

  private async endTransmission(): Promise<void> {
    const transmission = this.transmission;
    if (!transmission) return;
    this.transmission = null;
    this.transmittingText.setVisible(false);
    const t = this.transmissionStart;
    const text = await transmission.stop();
    if (!text) return;
    console.info(`[radio] ${text}`);
    eventBus.emit("radio:report", {
      text,
      t,
      provider: transmission.provider ?? "browser",
    });
  }

  /** Jumps straight to the next level's shift, without a debrief. */
  private skipLevel(): void {
    if (this.ended) return;
    this.ended = true;
    this.registry.set(LEVEL_KEY, Math.min(this.level + 1, LEVELS.length));
    eventBus.emit("scene:navigate", "Shift");
  }

  private endShift(completed: boolean): void {
    if (this.ended) return;
    this.ended = true;
    // Analytics answers synchronously with analytics:report (stored above).
    eventBus.emit("shift:end", { t: this.t, completed });
    eventBus.emit("scene:navigate", "Debrief");
  }
}
