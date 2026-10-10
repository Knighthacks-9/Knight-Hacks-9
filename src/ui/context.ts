import type { NightwatchService, ShiftResult } from "./service";

export type ScreenName = "desktop" | "calibration" | "watch" | "debrief";

export interface ScreenParams {
  /** Debrief to show (defaults to the last one). */
  result?: ShiftResult;
  /** Level to start the Watch Station on. */
  level?: number;
}

export interface AppState {
  level: number;
  shiftSeconds: number;
}

export interface AppContext {
  readonly service: NightwatchService;
  readonly state: AppState;
  /** The whole app; gaze coordinates are fractions of this element. */
  readonly root: HTMLElement;
  /** Desktop window layer (above icons, below the taskbar). */
  readonly layer: HTMLElement;
  /** Full-screen layer above everything (Watch Station, calibration targets). */
  readonly overlay: HTMLElement;
  go(screen: ScreenName, params?: ScreenParams): void;
  /** Sets the active application's taskbar button; null clears it. */
  setTask(label: string | null, onToggle?: () => void): void;
}

/** Mounts a screen; returns its cleanup. */
export type Screen = (ctx: AppContext, params: ScreenParams) => () => void;
