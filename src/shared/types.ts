// TODO: Add the shared attention measurement interface.
export interface Attention {}

// TODO: Add shared world-event payloads.
export interface WorldEvent {}

export interface Flag {
  cameraId: number;
  npcId: string;
  /** Milliseconds since the shift started. */
  time: number;
}

export type SceneKey = "Title" | "Calibration" | "Shift" | "Debrief";

export type AppEvents = {
  "scene:navigate": SceneKey;
  "flag:created": Flag;
};
