import type {
  CameraDef,
  Room,
  TileType,
  Vec2,
  WorldMap,
} from "../shared/types";

export const MAP_W = 40;
export const MAP_H = 24;

// Layout: three rooms on top, a hallway across the middle, three rooms below.
export const ROOMS: Room[] = [
  { name: "Office A", x: 1, y: 1, w: 12, h: 9, restricted: false },
  { name: "Office B", x: 14, y: 1, w: 12, h: 9, restricted: false },
  { name: "Server Room", x: 27, y: 1, w: 12, h: 9, restricted: true },
  { name: "Hallway", x: 1, y: 11, w: 38, h: 3, restricted: false },
  { name: "Lobby", x: 1, y: 15, w: 12, h: 8, restricted: false },
  { name: "Break Room", x: 14, y: 15, w: 12, h: 8, restricted: false },
  { name: "Storage", x: 27, y: 15, w: 12, h: 8, restricted: false },
];

export const DOORS: Vec2[] = [
  { x: 6, y: 10 },
  { x: 20, y: 10 },
  { x: 32, y: 10 },
  { x: 6, y: 14 },
  { x: 20, y: 14 },
  { x: 32, y: 14 },
];

export const EXITS: Vec2[] = [
  { x: 6, y: 23 }, // front entrance, lobby
  { x: 39, y: 19 }, // back door, storage
];

type CameraSpec = Omit<CameraDef, "visibleTiles">;

const CAMERAS: CameraSpec[] = [
  {
    id: "cam1",
    name: "Lobby",
    x: 1,
    y: 15,
    angleDeg: 45,
    fovDeg: 90,
    range: 14,
  },
  {
    id: "cam2",
    name: "Hall West",
    x: 1,
    y: 12,
    angleDeg: 0,
    fovDeg: 40,
    range: 22,
  },
  {
    id: "cam3",
    name: "Hall East",
    x: 38,
    y: 12,
    angleDeg: 180,
    fovDeg: 40,
    range: 22,
  },
  {
    id: "cam4",
    name: "Office B",
    x: 25,
    y: 1,
    angleDeg: 135,
    fovDeg: 90,
    range: 14,
  },
  {
    id: "cam5",
    name: "Server Room",
    x: 27,
    y: 1,
    angleDeg: 45,
    fovDeg: 90,
    range: 16,
  },
  {
    id: "cam6",
    name: "Storage",
    x: 38,
    y: 22,
    angleDeg: 225,
    fovDeg: 90,
    range: 14,
  },
];

export function idx(map: WorldMap, x: number, y: number): number {
  return y * map.width + x;
}

export function tileAt(map: WorldMap, x: number, y: number): TileType {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return "wall";
  return map.tiles[idx(map, x, y)];
}

export function isWalkable(map: WorldMap, x: number, y: number): boolean {
  return tileAt(map, x, y) !== "wall";
}

export function roomAt(map: WorldMap, x: number, y: number): Room | undefined {
  return map.rooms.find(
    (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h,
  );
}

function computeVisible(map: WorldMap, cam: CameraSpec): number[] {
  const out: number[] = [];
  const cx = cam.x + 0.5;
  const cy = cam.y + 0.5;
  const half = cam.fovDeg / 2;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isWalkable(map, x, y)) continue;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > cam.range) continue;
      if (dist > 0) {
        const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
        const diff = Math.abs(((ang - cam.angleDeg + 540) % 360) - 180);
        if (diff > half) continue;
      }
      // March along the ray; any wall in between blocks the view.
      const steps = Math.ceil(dist * 4);
      let blocked = false;
      for (let s = 1; s < steps; s++) {
        const px = Math.floor(cx + (dx * s) / steps);
        const py = Math.floor(cy + (dy * s) / steps);
        if (!isWalkable(map, px, py)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) out.push(idx(map, x, y));
    }
  }
  return out;
}

export function buildMap(): WorldMap {
  const map: WorldMap = {
    width: MAP_W,
    height: MAP_H,
    tiles: new Array<TileType>(MAP_W * MAP_H).fill("wall"),
    rooms: ROOMS,
    cameras: [],
  };
  for (const r of ROOMS) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        map.tiles[idx(map, x, y)] = r.restricted ? "restricted" : "floor";
      }
    }
  }
  for (const d of DOORS) map.tiles[idx(map, d.x, d.y)] = "door";
  for (const e of EXITS) map.tiles[idx(map, e.x, e.y)] = "exit";
  map.cameras = CAMERAS.map((c) => ({
    ...c,
    visibleTiles: computeVisible(map, c),
  }));
  return map;
}
