// Standalone World viewer. With `npm run dev`, open /src/world/world-debug.html.
// Plays the game's role: emits sim:tick and draws world:map / world:snapshot.
import { eventBus as bus } from "../shared/eventBus";
import type {
  SuspiciousBehavior,
  WorldMap,
  WorldSnapshot,
} from "../shared/types";
import { startWorld } from "./index";

const TILE = 20;
const TILE_COLORS = {
  wall: "#333",
  floor: "#5a5a5a",
  door: "#8a6d3b",
  restricted: "#6b3a3a",
  exit: "#3b8a4a",
};
const CAM_COLORS = ["#ff0", "#0ff", "#f0f", "#f80", "#8f8", "#88f"];

const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const logEl = document.getElementById("log")!;
const timeEl = document.getElementById("time")!;
const camsBox = document.getElementById("cams") as HTMLInputElement;
const speed = document.getElementById("speed") as HTMLInputElement;

let map: WorldMap | undefined;
let snap: WorldSnapshot | undefined;
const suspicious = new Map<string, SuspiciousBehavior>();

const log = (s: string) => {
  logEl.textContent = s + "\n" + logEl.textContent;
};

bus.on("world:map", (m) => {
  map = m;
  canvas.width = m.width * TILE;
  canvas.height = m.height * TILE;
});
bus.on("world:snapshot", (s) => (snap = s));
bus.on("world:suspiciousStart", (e) => {
  suspicious.set(e.npcId, e.behavior);
  log(
    `${e.t.toFixed(1)}s START ${e.behavior} ${e.npcId} [${e.cameraIds.join(",") || "no camera"}]`,
  );
});
bus.on("world:suspiciousEnd", (e) => {
  suspicious.delete(e.npcId);
  log(`${e.t.toFixed(1)}s END   ${e.behavior} ${e.npcId}`);
});

const world = startWorld({ shiftSeconds: 300 });
document.querySelectorAll<HTMLButtonElement>("button[data-b]").forEach((b) => {
  b.onclick = () => world.spawnSuspicious(b.dataset.b as SuspiciousBehavior);
});

function draw() {
  if (!map) return;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      ctx.fillStyle = TILE_COLORS[map.tiles[y * map.width + x]];
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }
  if (camsBox.checked) {
    map.cameras.forEach((cam, i) => {
      ctx.fillStyle = CAM_COLORS[i % CAM_COLORS.length] + "22";
      for (const t of cam.visibleTiles) {
        ctx.fillRect(
          (t % map!.width) * TILE,
          Math.floor(t / map!.width) * TILE,
          TILE,
          TILE,
        );
      }
      ctx.fillStyle = CAM_COLORS[i % CAM_COLORS.length];
      ctx.fillText(cam.name, cam.x * TILE + 2, cam.y * TILE + 12);
    });
  }
  ctx.fillStyle = "#aaa";
  for (const r of map.rooms)
    ctx.fillText(r.name, r.x * TILE + 4, (r.y + r.h) * TILE - 4);
  for (const n of snap?.npcs ?? []) {
    const px = n.x * TILE;
    const py = n.y * TILE;
    ctx.fillStyle = "#" + n.color.toString(16).padStart(6, "0");
    ctx.beginPath();
    ctx.arc(px, py, TILE * 0.35, 0, Math.PI * 2);
    ctx.fill();
    const b = suspicious.get(n.id);
    if (b) {
      ctx.strokeStyle = "#f33";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#f66";
      ctx.fillText(b, px + 8, py - 8);
    }
  }
}

let t = 0;
let prev = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - prev) / 1000) * Number(speed.value);
  prev = now;
  t += dt;
  bus.emit("sim:tick", { dt, t });
  timeEl.textContent = `t=${t.toFixed(1)}s npcs=${snap?.npcs.length ?? 0}`;
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
