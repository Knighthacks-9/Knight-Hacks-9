import { describe, expect, it } from "vitest";
import { speechSeconds } from "./radio";

describe("speechSeconds", () => {
  it("grows with the number of words", () => {
    expect(speechSeconds("")).toBe(1);
    expect(speechSeconds("Copy that, control. Report received.")).toBe(3);
    const long = "word ".repeat(50);
    expect(speechSeconds(long)).toBeGreaterThan(speechSeconds("one two"));
  });
});
