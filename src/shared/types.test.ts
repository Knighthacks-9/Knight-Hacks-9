import { describe, expect, it, vi } from "vitest";
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
