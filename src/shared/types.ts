export type SceneKey = "Title" | "Calibration" | "Shift" | "Debrief";

export interface Attention {
  scene: SceneKey;
  focus: number;
  confidence?: number;
  timestamp: number;
  x?: number;
  y?: number;
  lookingAtTarget?: boolean;
  targetId?: string;
}

export interface WorldEvent {
  type: string;
  label?: string;
  scene: SceneKey;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface Flag {
  id: string;
  value: boolean;
  scene: SceneKey;
  timestamp: number;
}

export type AppEvents = {
  "scene:navigate": SceneKey;
  "vision:attention": Attention;
  "vision:gaze": Attention;
  "world:event": WorldEvent;
  "world:flag": Flag;
  "analytics:attention": Attention;
  "analytics:world-event": WorldEvent;
  "analytics:flag": Flag;
};
