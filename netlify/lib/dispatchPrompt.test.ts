import { describe, expect, it } from "vitest";
import { cleanDispatchLine } from "./dispatchPrompt";

describe("cleanDispatchLine", () => {
  it("strips a <think> block and trims", () => {
    expect(
      cleanDispatchLine(
        "<think>The facts say camera 2.\nKeep it short.</think>\n\n  Unit en route to Hall West, camera 2.  ",
      ),
    ).toBe("Unit en route to Hall West, camera 2.");
  });

  it("strips several blocks, case-insensitively", () => {
    expect(
      cleanDispatchLine("<THINK>a</THINK>Copy, control.<think>b</think>"),
    ).toBe("Copy, control.");
  });

  it("drops an unclosed block cut off by max_tokens", () => {
    expect(cleanDispatchLine("<think>Let me consider the facts")).toBe("");
  });

  it("keeps only the first line and removes wrapping quotes", () => {
    expect(
      cleanDispatchLine('"Subject detained in Storage."\nAnything else?'),
    ).toBe("Subject detained in Storage.");
  });

  it("leaves a plain reply alone", () => {
    expect(cleanDispatchLine("Report logged, control.")).toBe(
      "Report logged, control.",
    );
  });
});
