// Shift history kept in browser storage, so the debrief can show progress
// across shifts and page reloads. Stays inside analytics (not a shared type).
import type { ShiftReport } from "../shared/types";
import { attentionSpans } from "./debriefPanel";

const HISTORY_STORAGE_KEY = "night-watch:shift-history";
/** Oldest shifts are dropped beyond this many. */
export const MAX_HISTORY = 50;

/** The parts of a ShiftReport worth keeping between shifts. */
export interface ShiftSummary {
  /** When the shift ended, ms since epoch. */
  at: number;
  level: number;
  score: number;
  passed: boolean;
  completed: boolean;
  caught: number;
  total: number;
  falseFlags: number;
  duration: number;
  /** Average attention span in seconds, or null with no gaze data. */
  avgSpan: number | null;
  /** Average gaze distance from suspects in tiles, or null with no data. */
  avgDistance: number | null;
}

export type HistoryStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

const defaultStorage = (): HistoryStorage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

const average = (values: number[]) =>
  values.length
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) /
      100
    : null;

export function summarize(report: ShiftReport, at = Date.now()): ShiftSummary {
  return {
    at,
    level: report.level,
    score: report.score,
    passed: report.passed,
    completed: report.completed,
    caught: report.events.filter((e) => e.outcome === "caught").length,
    total: report.events.length,
    falseFlags: report.falseFlags.length,
    duration: report.duration,
    avgSpan: average(attentionSpans(report.timeline).map((s) => s.seconds)),
    avgDistance: average(
      report.gazeDistance.flatMap((s) => (s.tiles === null ? [] : [s.tiles])),
    ),
  };
}

export function loadHistory(storage = defaultStorage()): ShiftSummary[] {
  try {
    const parsed: unknown = JSON.parse(
      storage?.getItem(HISTORY_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(parsed) ? (parsed as ShiftSummary[]) : [];
  } catch {
    return [];
  }
}

export function appendHistory(
  summary: ShiftSummary,
  storage = defaultStorage(),
): void {
  const history = [...loadHistory(storage), summary].slice(-MAX_HISTORY);
  try {
    storage?.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch (error) {
    console.error("Could not save the shift history.", error);
  }
}

export function clearHistory(storage = defaultStorage()): void {
  try {
    storage?.removeItem(HISTORY_STORAGE_KEY);
  } catch (error) {
    console.error("Could not clear the shift history.", error);
  }
}
