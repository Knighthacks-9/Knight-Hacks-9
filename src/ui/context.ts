import type { NightwatchService, ShiftResult } from "./service";
import type { ShiftSettings } from "./shiftSettings";

export type ScreenName = "desktop" | "calibration" | "watch" | "debrief";

export interface ScreenParams {
  /** Debrief to show (defaults to the last one). */
  result?: ShiftResult;
  /** Level to start the Watch Station on. */
  level?: number;
  /** The shift just ended: the dispatcher reads the debrief summary aloud. */
  announce?: boolean;
}

export interface AppState {
  /** Difficulty, 1-3. */
  level: number;
  shiftSeconds: number;
  /** Shift Setup choices layered on top of the level. */
  settings: ShiftSettings;
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
  /**
   * Sets the active application's taskbar button; null clears it. Pass the
   * window so the taskbar can raise it and show when it is in front.
   */
  setTask(
    label: string | null,
    onToggle?: () => void,
    root?: HTMLElement,
  ): void;
  /** Adds a taskbar button for an extra window; returns its remover. */
  addTask(label: string, root: HTMLElement): () => void;
}

/** Mounts a screen; returns its cleanup. */
export type Screen = (ctx: AppContext, params: ScreenParams) => () => void;
