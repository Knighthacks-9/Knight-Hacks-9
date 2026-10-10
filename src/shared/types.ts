// TODO: Add the shared attention measurement interface.
export interface Attention {}

// TODO: Add shared world-event payloads.
export interface WorldEvent {}

// TODO: Add the shared player flag payload.
export interface Flag {}

export type SceneKey = "Title" | "Calibration" | "Shift" | "Debrief";

export type AppEvents = {
  "scene:navigate": SceneKey;
};
