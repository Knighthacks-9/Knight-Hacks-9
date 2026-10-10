import { describe, expect, it, vi } from "vitest";
import { createAnalyticsStore } from "../analytics";
import { eventBus } from "./eventBus";

describe("shared event bus", () => {
  it("delivers scene navigation events", () => {
    const listener = vi.fn();
    eventBus.on("scene:navigate", listener);
    eventBus.emit("scene:navigate", "Calibration");
    eventBus.off("scene:navigate", listener);

    expect(listener).toHaveBeenCalledWith("Calibration");
  });
});

describe("analytics store", () => {
  it("tracks attention and produces a debreif summary", () => {
    const analytics = createAnalyticsStore();

    analytics.recordScene("Calibration");
    analytics.recordAttention({
      scene: "Calibration",
      focus: 0.92,
      confidence: 0.85,
      timestamp: 1000,
    });
    analytics.recordWorldEvent({
      type: "scan",
      label: "Target identified",
      scene: "Calibration",
      timestamp: 1020,
    });
    analytics.recordFlag({
      id: "checkpoint-1",
      value: true,
      scene: "Calibration",
      timestamp: 1030,
    });

    expect(analytics.getScore()).toBeGreaterThan(0);
    expect(analytics.getDebrief().focus).toBeGreaterThanOrEqual(0.8);
    expect(analytics.getDebrief().events).toBeGreaterThanOrEqual(1);
    expect(analytics.getDebrief().flags).toContain("checkpoint-1");
  });
});
