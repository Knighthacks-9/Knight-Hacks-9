// The contract between modules. Modules talk only through these event payloads
// (see AppEvents) and each other's public index.ts, never internal files.
//
// Time: every payload with `t` uses shift seconds from sim:tick, so gaze,
// world events, and flags line up on one timeline.

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

// ---------------------------------------------------------------------------
// Game (Person 3) and Vision (Person 1).
// ---------------------------------------------------------------------------

/** Emitted by the game every frame. dt and t are in seconds. */
export interface SimTick {
  dt: number;
  t: number;
}

export interface ShiftStart {
  level: number;
  shiftSeconds: number;
  /** Cameras shown on screen this shift, in grid order. */
  cameraIds: string[];
}

export interface ShiftEnd {
  t: number;
  /** False when the player ended the shift early. */
  completed: boolean;
}

export type GazeSource = "tracker" | "mouse" | "none";

/** Emitted by the game every frame during a shift. */
export interface GazeSample {
  t: number;
  /** Canvas position 0..1, or null when nothing is tracked. */
  x: number | null;
  y: number | null;
  source: GazeSource;
  /** Camera feed under the gaze point, or null when off the feeds. */
  cameraId: string | null;
  /** The gaze point mapped into the building (tile units) through that feed. */
  world?: Vec2 | null;
}

/** The player clicked an NPC on a camera feed. */
export interface Flag {
  t: number;
  npcId: string;
  cameraId: string;
}

// ---------------------------------------------------------------------------
// Audio: radio dispatcher voice and push-to-talk.
// ---------------------------------------------------------------------------

/** Which service produced speech or a transcript. */
export type VoiceProvider = "elevenlabs" | "browser";

/** A push-to-talk transmission from the player, transcribed. */
export interface RadioReport {
  text: string;
  /** Shift seconds when the player started talking. */
  t: number;
  provider: VoiceProvider;
}

// ---------------------------------------------------------------------------
// Analytics (Person 4): the debrief report, built when a shift ends.
// ---------------------------------------------------------------------------

export type EventOutcome = "caught" | "missed-not-looking" | "missed-looking";

export interface ClassifiedEvent {
  id: string;
  npcId: string;
  behavior: SuspiciousBehavior;
  start: number;
  /** Null if the shift ended while the behavior was still going. */
  end: number | null;
  /** Every camera that saw the NPC during the event. */
  cameraIds: string[];
  outcome: EventOutcome;
  /** Seconds the player spent looking at a feed that showed the NPC. */
  watchedSeconds: number;
  flaggedAt: number | null;
}

export interface FeedStats {
  cameraId: string;
  watchedSeconds: number;
  /** Share of the shift spent on this feed, 0..1. */
  share: number;
  events: number;
  caught: number;
  missed: number;
}

/** A stretch of time the gaze stayed on one feed (or off all feeds). */
export interface GazeSegment {
  cameraId: string | null;
  start: number;
  end: number;
}

/** How far the gaze was from the nearest suspect a shown feed could see. */
export interface GazeDistanceSample {
  t: number;
  /** Tiles between the gaze point and the suspect; null when looking off the feeds. */
  tiles: number | null;
  npcId: string;
}

export interface ShiftReport {
  level: number;
  duration: number;
  completed: boolean;
  passed: boolean;
  score: number;
  events: ClassifiedEvent[];
  falseFlags: Flag[];
  feeds: FeedStats[];
  timeline: GazeSegment[];
  /** Sampled while a suspect is on a shown feed; gaps mean no suspect was visible. */
  gazeDistance: GazeDistanceSample[];
  /** Seconds gaze came from the webcam tracker (the rest is mouse or none). */
  trackerSeconds: number;
}

export type AppEvents = {
  "scene:navigate": SceneKey;
  "shift:start": ShiftStart;
  "shift:end": ShiftEnd;
  "sim:tick": SimTick;
  "world:map": WorldMap;
  "world:snapshot": WorldSnapshot;
  "world:suspiciousStart": WorldEvent;
  "world:suspiciousEnd": WorldEvent;
  "gaze:sample": GazeSample;
  "flag:created": Flag;
  "radio:report": RadioReport;
  "analytics:report": ShiftReport;
};
