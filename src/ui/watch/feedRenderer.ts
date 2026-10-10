// Draws one CCTV feed on a canvas: the part of the building a world camera
// sees plus the people in view, in a low-light green-grey palette. Placeholder
// feeds (no world camera) draw a static scene or their imageUrl instead.
// The canvas renders at reduced resolution and is scaled up pixelated.
import type {
  TileType,
  Vec2,
  WorldMap,
  WorldSnapshot,
} from "../../shared/types";
import {
  NPC_FEET_Y,
  NPC_FRAME,
  NPC_FRAME_TILES,
  NPC_SHEETS,
  NPC_WALK_FPS,
  facingFor,
  facingRow,
  npcSheetUrl,
  sheetFor,
} from "../../shared/npcSprites";
import { prefersReducedMotion } from "../dom";
import type { CameraFeed } from "../service";

/** CSS pixels per canvas pixel. */
const PIXEL = 2;

const TILE: Record<TileType, string> = {
  wall: "#090d0b",
  floor: "#3b4740",
  door: "#4e4a36",
  restricted: "#47322f",
  exit: "#2f4936",
};
const HIDDEN = "#141a17";
const TINT = [143, 170, 151];

export type GlitchKind =
  "jitter" | "split" | "static" | "contrast" | "interference" | "scan";

let grain: HTMLCanvasElement | null = null;

/** NPC sprite sheets, loaded once and shared by every feed. */
const sheets = new Map<string, HTMLImageElement>();
function npcSheet(name: string): HTMLImageElement | null {
  if (!sheets.size) {
    for (const key of NPC_SHEETS) {
      const image = new Image();
      image.src = npcSheetUrl(key);
      sheets.set(key, image);
    }
  }
  const image = sheets.get(name);
  return image && image.complete && image.naturalWidth ? image : null;
}

/** A shared tile of film grain, drawn over every feed at a moving offset. */
function grainTile(): HTMLCanvasElement {
  if (grain) return grain;
  grain = document.createElement("canvas");
  grain.width = grain.height = 64;
  const g = grain.getContext("2d")!;
  const image = g.createImageData(64, 64);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.random() < 0.5 ? 0 : 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = Math.random() * 24;
  }
  g.putImageData(image, 0, 0);
  return grain;
}

function hash(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Mutes a shirt colour toward the monitor tint so it stays identifiable but dim. */
function muted(color: number, amount = 0.5): string {
  const rgb = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
  const out = rgb.map((c, i) =>
    Math.round(c * (1 - amount) + TINT[i] * amount),
  );
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}

export class FeedRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly background = document.createElement("canvas");
  private readonly frame = document.createElement("canvas");
  private width = 0;
  private height = 0;
  private tileSize = 1;
  private viewX = 0;
  private viewY = 0;
  private minTileX = 0;
  private minTileY = 0;
  private tilesWide = 1;
  private tilesHigh = 1;
  private image: HTMLImageElement | null = null;
  /** On-screen size from a ResizeObserver, so drawing never forces layout. */
  private cssWidth = 0;
  private cssHeight = 0;
  private readonly observer: ResizeObserver;
  private grainPattern: CanvasPattern | null = null;
  private readonly calm = prefersReducedMotion();
  private glitch: { kind: GlitchKind; seed: number; reduced: boolean } | null =
    null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly feed: CameraFeed,
    private readonly map: WorldMap | null,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.grainPattern = this.ctx.createPattern(grainTile(), "repeat");
    this.observer = new ResizeObserver(([entry]) => {
      this.cssWidth = entry.contentRect.width;
      this.cssHeight = entry.contentRect.height;
    });
    this.observer.observe(canvas);
    const camera = feed.source;
    if (camera && map) {
      const xs = camera.visibleTiles.map((i) => i % map.width).concat(camera.x);
      const ys = camera.visibleTiles
        .map((i) => Math.floor(i / map.width))
        .concat(camera.y);
      this.minTileX = Math.min(...xs) - 1;
      this.minTileY = Math.min(...ys) - 1;
      this.tilesWide = Math.max(...xs) + 2 - this.minTileX;
      this.tilesHigh = Math.max(...ys) + 2 - this.minTileY;
    }
    if (feed.imageUrl) {
      const image = new Image();
      image.onload = () => {
        this.image = image;
        this.paintBackground();
      };
      image.src = feed.imageUrl;
    }
  }

  destroy(): void {
    this.observer.disconnect();
  }

  /** Matches the canvas buffer to its on-screen size. Cheap when unchanged. */
  private resize(): void {
    const w = Math.max(16, Math.round(this.cssWidth / PIXEL));
    const h = Math.max(12, Math.round(this.cssHeight / PIXEL));
    if (w === this.width && h === this.height) return;
    this.width =
      this.canvas.width =
      this.frame.width =
      this.background.width =
        w;
    this.height =
      this.canvas.height =
      this.frame.height =
      this.background.height =
        h;
    // Fit everything the camera sees; the margins show the unseen building.
    this.tileSize = Math.min(w / this.tilesWide, h / this.tilesHigh);
    this.viewX = (w - this.tilesWide * this.tileSize) / 2;
    this.viewY = (h - this.tilesHigh * this.tileSize) / 2;
    this.paintBackground();
  }

  setGlitch(kind: GlitchKind | null, reduced = false): void {
    this.glitch = kind ? { kind, seed: Math.random() * 1000, reduced } : null;
  }

  /** Maps a client (viewport) point over this canvas to building tile units. */
  toWorld(clientX: number, clientY: number): Vec2 | null {
    if (!this.feed.source) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const px = ((clientX - rect.left) / rect.width) * this.width;
    const py = ((clientY - rect.top) / rect.height) * this.height;
    return {
      x: this.minTileX + (px - this.viewX) / this.tileSize,
      y: this.minTileY + (py - this.viewY) / this.tileSize,
    };
  }

  draw(snapshot: WorldSnapshot | null, t: number): void {
    this.resize();
    const f = this.frame.getContext("2d")!;
    f.drawImage(this.background, 0, 0);
    if (this.feed.source) this.drawPeople(f, snapshot, t);
    this.drawFlicker(f, t);
    this.compose(t);
    this.drawGrain(t);
  }

  private drawPeople(
    f: CanvasRenderingContext2D,
    snapshot: WorldSnapshot | null,
    t: number,
  ) {
    const id = this.feed.id;
    const r = Math.max(2, this.tileSize * 0.42);
    // Draw back to front so people lower on screen overlap those behind.
    const inView = (snapshot?.npcs ?? [])
      .filter((npc) => npc.cameraIds.includes(id))
      .sort((a, b) => a.y - b.y);
    for (const npc of inView) {
      const x = this.viewX + (npc.x - this.minTileX) * this.tileSize;
      const y = this.viewY + (npc.y - this.minTileY) * this.tileSize;
      const sheet = npcSheet(sheetFor(npc.id));
      if (sheet) {
        // Feet shadow, then the sprite frame standing on the NPC's position.
        f.fillStyle = "rgba(0,0,0,0.4)";
        f.beginPath();
        f.ellipse(x, y, r * 1.1, r * 0.5, 0, 0, Math.PI * 2);
        f.fill();
        const row = facingRow(facingFor(npc.facingDeg));
        const col = npc.moving ? Math.floor(t * NPC_WALK_FPS) % 4 : 0;
        const size = Math.max(8, this.tileSize * NPC_FRAME_TILES);
        f.imageSmoothingEnabled = false;
        f.filter = "saturate(0.55) brightness(0.9)"; // dim to the monitor look
        f.drawImage(
          sheet,
          col * NPC_FRAME,
          row * NPC_FRAME,
          NPC_FRAME,
          NPC_FRAME,
          Math.round(x - size / 2),
          Math.round(y - size * NPC_FEET_Y),
          Math.round(size),
          Math.round(size),
        );
        f.filter = "none";
        continue;
      }
      // Sheets still loading: the original dot-and-head marker.
      f.fillStyle = "rgba(0,0,0,0.45)";
      f.beginPath();
      f.ellipse(
        x + r * 0.35,
        y + r * 0.45,
        r * 1.05,
        r * 0.8,
        0,
        0,
        Math.PI * 2,
      );
      f.fill();
      f.fillStyle = muted(npc.color);
      f.beginPath();
      f.arc(x, y, r, 0, Math.PI * 2);
      f.fill();
      // Head, nudged toward where they face.
      const a = (npc.facingDeg * Math.PI) / 180;
      f.fillStyle = "#c9d3c6";
      f.beginPath();
      f.arc(
        x + Math.cos(a) * r * 0.25,
        y + Math.sin(a) * r * 0.25,
        r * 0.48,
        0,
        Math.PI * 2,
      );
      f.fill();
    }
  }

  /** Slow brightness breathing, like a cheap camera's auto-gain. */
  private drawFlicker(f: CanvasRenderingContext2D, t: number) {
    const k = 0.04 + 0.03 * Math.sin(t * 2.3 + this.feed.id.length);
    f.fillStyle = `rgba(0,0,0,${k.toFixed(3)})`;
    f.fillRect(0, 0, this.width, this.height);
  }

  /** Copies the frame to the visible canvas, applying any active glitch. */
  private compose(t: number) {
    const { ctx, width: w, height: h } = this;
    const g = this.glitch;
    ctx.fillStyle = "#050806";
    ctx.fillRect(0, 0, w, h);
    if (!g) {
      ctx.drawImage(this.frame, 0, 0);
      return;
    }
    // Reduced motion: effects hold still instead of changing every frame.
    const step = g.reduced ? 0 : Math.floor(t * 30);
    const rnd = (i: number) => hash(g.seed + step, i);
    switch (g.kind) {
      case "split": {
        const cut = Math.floor(h * (0.3 + rnd(1) * 0.4));
        const dx = Math.round((rnd(2) - 0.5) * w * 0.12);
        ctx.drawImage(this.frame, 0, 0, w, cut, dx, 0, w, cut);
        ctx.drawImage(this.frame, 0, cut, w, h - cut, -dx, cut, w, h - cut);
        break;
      }
      case "jitter": {
        const band = Math.max(2, Math.floor(h / 10));
        for (let y = 0; y < h; y += band) {
          const dx = Math.round((rnd(y) - 0.5) * (g.reduced ? 2 : 8));
          ctx.drawImage(this.frame, 0, y, w, band, dx, y, w, band);
        }
        break;
      }
      default:
        ctx.drawImage(this.frame, 0, 0);
    }
    if (g.kind === "static" || g.kind === "interference") {
      const count = Math.floor(w * h * (g.kind === "static" ? 0.12 : 0.03));
      for (let i = 0; i < count; i++) {
        const v = rnd(i * 3) > 0.5 ? 220 : 30;
        ctx.fillStyle = `rgba(${v},${v + 20},${v},0.5)`;
        ctx.fillRect(
          Math.floor(rnd(i * 3 + 1) * w),
          Math.floor(rnd(i * 3 + 2) * h),
          1,
          1,
        );
      }
    }
    if (g.kind === "interference" || g.kind === "scan") {
      const lines = g.kind === "scan" ? 3 : 6;
      for (let i = 0; i < lines; i++) {
        const y = Math.floor(rnd(100 + i) * h);
        ctx.fillStyle =
          g.kind === "scan"
            ? "rgba(235,255,240,0.55)"
            : `rgba(120,255,160,${(0.15 + rnd(200 + i) * 0.3).toFixed(2)})`;
        ctx.fillRect(0, y, w, 1 + Math.floor(rnd(300 + i) * 2));
      }
    }
  }

  /** Moving film grain (still with reduced motion). */
  private drawGrain(t: number) {
    if (!this.grainPattern) return;
    const step = this.calm ? 0 : Math.floor(t * 24);
    this.grainPattern.setTransform(
      new DOMMatrix().translate(hash(step, 1) * 64, hash(step, 2) * 64),
    );
    this.ctx.fillStyle = this.grainPattern;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  private paintBackground() {
    const b = this.background.getContext("2d");
    if (!b || !this.width) return;
    b.fillStyle = "#0a0f0c";
    b.fillRect(0, 0, this.width, this.height);
    if (this.feed.source && this.map) this.paintWorld(b, this.map);
    else if (this.image) this.paintImage(b, this.image);
    else this.paintPlaceholder(b);
  }

  private paintWorld(b: CanvasRenderingContext2D, map: WorldMap) {
    const camera = this.feed.source!;
    const visible = new Set(camera.visibleTiles);
    const s = this.tileSize;
    // Cover the whole canvas, including the margins around the camera's view.
    const padX = Math.ceil(this.viewX / s) + 1;
    const padY = Math.ceil(this.viewY / s) + 1;
    for (let ty = -padY; ty < this.tilesHigh + padY; ty++) {
      for (let tx = -padX; tx < this.tilesWide + padX; tx++) {
        const mx = this.minTileX + tx;
        const my = this.minTileY + ty;
        const inside = mx >= 0 && my >= 0 && mx < map.width && my < map.height;
        const i = my * map.width + mx;
        const type: TileType = inside ? map.tiles[i] : "wall";
        const x = Math.floor(this.viewX + tx * s);
        const y = Math.floor(this.viewY + ty * s);
        const size = Math.ceil(s) + 1;
        b.fillStyle = type === "wall" || visible.has(i) ? TILE[type] : HIDDEN;
        b.fillRect(x, y, size, size);
        if (type !== "wall" && visible.has(i)) {
          // Worn floor: per-tile shade and grout lines.
          const shade = hash(mx, my) * 0.05;
          b.fillStyle = `rgba(255,255,255,${shade.toFixed(3)})`;
          b.fillRect(x, y, size, size);
          b.fillStyle = "rgba(0,0,0,0.18)";
          b.fillRect(x, y, size, 1);
          b.fillRect(x, y, 1, size);
        }
      }
    }
    // Pools of light from ceiling fixtures.
    for (let i = 0; i < 4; i++) {
      const lx = (0.15 + hash(i, camera.x) * 0.7) * this.width;
      const ly = (0.15 + hash(camera.y, i) * 0.7) * this.height;
      const radius = Math.max(this.width, this.height) * 0.35;
      const glow = b.createRadialGradient(lx, ly, 0, lx, ly, radius);
      glow.addColorStop(0, "rgba(210,240,215,0.16)");
      glow.addColorStop(1, "rgba(210,240,215,0)");
      b.fillStyle = glow;
      b.fillRect(0, 0, this.width, this.height);
    }
  }

  private paintImage(b: CanvasRenderingContext2D, image: HTMLImageElement) {
    const scale = Math.max(
      this.width / image.width,
      this.height / image.height,
    );
    const w = image.width * scale;
    const h = image.height * scale;
    b.filter = "grayscale(1) brightness(0.75) contrast(1.15)";
    b.drawImage(image, (this.width - w) / 2, (this.height - h) / 2, w, h);
    b.filter = "none";
    b.fillStyle = "rgba(90,140,105,0.18)";
    b.fillRect(0, 0, this.width, this.height);
  }

  /** A dim one-point-perspective corridor, varied per feed. */
  private paintPlaceholder(b: CanvasRenderingContext2D) {
    const { width: w, height: h } = this;
    const seed = this.feed.id.length * 7 + this.feed.location.length;
    const vx = w * (0.4 + hash(seed, 1) * 0.2);
    const vy = h * 0.42;
    const far = {
      l: vx - w * 0.08,
      r: vx + w * 0.08,
      t: vy - h * 0.08,
      b: vy + h * 0.08,
    };
    const quad = (pts: number[][], fill: string) => {
      b.fillStyle = fill;
      b.beginPath();
      b.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) b.lineTo(p[0], p[1]);
      b.closePath();
      b.fill();
    };
    quad(
      [
        [0, 0],
        [w, 0],
        [far.r, far.t],
        [far.l, far.t],
      ],
      "#1a211d",
    );
    quad(
      [
        [0, h],
        [w, h],
        [far.r, far.b],
        [far.l, far.b],
      ],
      "#2c3631",
    );
    quad(
      [
        [0, 0],
        [far.l, far.t],
        [far.l, far.b],
        [0, h],
      ],
      "#202824",
    );
    quad(
      [
        [w, 0],
        [far.r, far.t],
        [far.r, far.b],
        [w, h],
      ],
      "#1d2521",
    );
    b.fillStyle = "#0b100d";
    b.fillRect(far.l, far.t, far.r - far.l, far.b - far.t);
    // Ceiling light strips and wall pillars, from near (k=0) to far (k=1).
    const lerp = (a: number, z: number, k: number) => a + (z - a) * k;
    for (const k of [0.12, 0.34, 0.5, 0.62, 0.71, 0.78, 0.84]) {
      const cx = lerp(w / 2, vx, k);
      const y = lerp(h * 0.03, far.t, k);
      const len = lerp(w * 0.3, (far.r - far.l) * 0.4, k);
      b.fillStyle = `rgba(230,245,232,${(0.75 - 0.55 * k).toFixed(2)})`;
      b.fillRect(cx - len / 2, y, len, Math.max(1, lerp(4, 1, k)));
    }
    for (const k of [0.2, 0.45, 0.65]) {
      const top = lerp(0, far.t, k);
      const bottom = lerp(h, far.b, k);
      const pw = Math.max(1, lerp(w * 0.05, 1, k));
      b.fillStyle = "rgba(0,0,0,0.4)";
      b.fillRect(lerp(0, far.l, k), top, pw, bottom - top);
      b.fillRect(lerp(w, far.r, k) - pw, top, pw, bottom - top);
    }
    // Light reflected on the floor.
    const glow = b.createLinearGradient(0, far.b, 0, h);
    glow.addColorStop(0, "rgba(200,230,210,0.14)");
    glow.addColorStop(1, "rgba(200,230,210,0)");
    b.fillStyle = glow;
    b.fillRect(0, far.b, w, h - far.b);
  }
}
