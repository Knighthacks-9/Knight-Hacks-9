import { describe, expect, it } from "vitest";
import { playSfx, type SfxName } from "./sfx";

describe("playSfx", () => {
  it("does nothing without Web Audio instead of throwing", () => {
    const names: SfxName[] = [
      "click",
      "start",
      "tick",
      "capture",
      "success",
      "error",
      "cancel",
      "warning",
      "blip",
      "select",
      "deny",
      "send",
      "talkOn",
      "talkOff",
    ];
    for (const name of names) expect(() => playSfx(name)).not.toThrow();
  });
});
