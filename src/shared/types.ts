// TODO: Add the shared attention measurement interface.
export interface Attention {}


export interface Flag {
  cameraId: number;
  npcId: string | null;
  /** Milliseconds since the shift started. */
  t: number;
}

export type SceneKey = "Title" | "Calibration" | "Shift" | "Debrief";

// ---------------------------------------------------------------------------
// World (Person 2). All positions are in tile units; multiply by tile size to
// draw. NPC x/y are continuous, a tile's centre is (tx + 0.5, ty + 0.5).
// ---------------------------------------------------------------------------

export interface Vec2 {
  x: number;
  y: number;
}

export type TileType = "wall" | "floor" | "door" | "restricted" | "exit";

export interface Room {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  restricted: boolean;
}

export interface CameraDef {
  id: string;
  name: string;
  /** Tile the camera is mounted on. */
  x: number;
  y: number;
  /** Direction the camera faces, degrees, 0 = east, 90 = south (screen coords). */
  angleDeg: number;
  fovDeg: number;
  /** View distance in tiles. */
  range: number;
  /** Row-major tile indices (y * width + x) this camera can see. */
  visibleTiles: number[];
}

export interface WorldMap {
  width: number;
  height: number;
  /** Row-major, length width * height. */
  tiles: TileType[];
  rooms: Room[];
  cameras: CameraDef[];
}

export interface NpcSnapshot {
  id: string;
  x: number;
  y: number;
  facingDeg: number;
  moving: boolean;
  /** 0xRRGGBB shirt colour, stable per NPC. */
  color: number;
  /** Cameras that currently see this NPC. */
  cameraIds: string[];
}

export interface WorldSnapshot {
  t: number;
  npcs: NpcSnapshot[];
}

export type SuspiciousBehavior =
  "loitering" | "revisitingDoors" | "restrictedZone" | "avoidingCameras";

/** Payload of world:suspiciousStart / world:suspiciousEnd. Same id on both. */
export interface WorldEvent {
  id: string;
  npcId: string;
  behavior: SuspiciousBehavior;
  t: number;
  x: number;
  y: number;
  /** Cameras that see the NPC at this moment. */
  cameraIds: string[];
}

/** Emitted by the game every frame. dt and t are in seconds. */
export interface SimTick {
  dt: number;
  t: number;
}

export type AppEvents = {
  "scene:navigate": SceneKey;
  "sim:tick": SimTick;
  "world:map": WorldMap;
  "world:snapshot": WorldSnapshot;
  "world:suspiciousStart": WorldEvent;
  "world:suspiciousEnd": WorldEvent;
  "flag:created": Flag;
};
