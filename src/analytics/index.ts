// Person 4: logging, scoring, and debrief. Talks to the rest of the game only
// through the event bus:
//   listens: shift:start, shift:end, world:map, world:snapshot,
//            world:suspiciousStart, world:suspiciousEnd, world:capture,
//            gaze:sample,
//            flag:created, scene:navigate
//   emits:   analytics:report (synchronously, in response to shift:end)
import type { Emitter } from "mitt";
import { eventBus } from "../shared/eventBus";
import type { AppEvents, ShiftReport } from "../shared/types";
import { buildDebriefMarkup } from "./debriefPanel";
import {
  appendHistory,
  clearHistory,
  loadHistory,
  summarize,
  type HistoryStorage,
} from "./history";
import { createShiftAnalytics } from "./shiftAnalytics";

export {
  MIN_GLANCE_SECONDS,
  attentionSpans,
  buildDebriefMarkup,
  type AttentionSpan,
} from "./debriefPanel";
export {
  MAX_HISTORY,
  appendHistory,
  clearHistory,
  loadHistory,
  summarize,
  type HistoryStorage,
  type ShiftSummary,
} from "./history";
export {
  ATTENTION_LAPSE_PENALTY,
  ATTENTION_LAPSE_SECONDS,
  AttentionWatch,
} from "./attention";
export {
  ESCAPED_LOSS,
  FALSE_FLAG_PENALTY,
  FLAG_GRACE_SECONDS,
  LOOKED_SECONDS,
  createShiftAnalytics,
  type ShiftAnalytics,
} from "./shiftAnalytics";

export interface AnalyticsOptions {
  bus?: Emitter<AppEvents>;
  /** Element id for the HTML debrief panel, shown only on the Debrief scene. */
  panelId?: string;
  /** Where shift history is saved; defaults to localStorage. */
  storage?: HistoryStorage;
}

/** Starts listening. Returns a function that stops it. */
export function installAnalytics({
  bus = eventBus,
  panelId = "analytics-panel",
  storage,
}: AnalyticsOptions = {}): () => void {
  const analytics = createShiftAnalytics();
  const cameraNames = new Map<string, string>();
  let report: ShiftReport | null = null;

  const stops: (() => void)[] = [];
  const listen = <K extends keyof AppEvents>(
    type: K,
    handler: (payload: AppEvents[K]) => void,
  ) => {
    bus.on(type, handler);
    stops.push(() => bus.off(type, handler));
  };

  listen("shift:start", (start) => {
    report = null;
    analytics.startShift(start);
  });
  listen("world:map", (map) => {
    for (const cam of map.cameras) cameraNames.set(cam.id, cam.name);
  });
  listen("world:snapshot", analytics.recordSnapshot);
  listen("world:suspiciousStart", analytics.recordEventStart);
  listen("world:suspiciousEnd", analytics.recordEventEnd);
  listen("gaze:sample", analytics.recordGaze);
  listen("flag:created", analytics.recordFlag);
  listen("world:capture", analytics.recordCapture);
  listen("shift:end", (end) => {
    report = analytics.endShift(end);
    appendHistory(summarize(report), storage);
    bus.emit("analytics:report", report);
  });
  listen("scene:navigate", (scene) => {
    const panel =
      typeof document === "undefined" ? null : document.getElementById(panelId);
    if (!panel) return;
    const show = scene === "Debrief" && report !== null;
    panel.hidden = !show;
    if (show) renderPanel(panel, report!);
    else panel.innerHTML = "";
  });

  function renderPanel(panel: HTMLElement, shown: ShiftReport) {
    panel.innerHTML = buildDebriefMarkup(
      shown,
      cameraNames,
      loadHistory(storage),
    );
    // Two clicks to clear, so one stray click can't wipe the history.
    const clear = panel.querySelector<HTMLButtonElement>(
      '[data-action="clear-history"]',
    );
    clear?.addEventListener("click", () => {
      if (clear.dataset.armed) {
        clearHistory(storage);
        renderPanel(panel, shown);
      } else {
        clear.dataset.armed = "true";
        clear.textContent = "Click again to clear";
      }
    });
  }

  return () => stops.forEach((stop) => stop());
}
