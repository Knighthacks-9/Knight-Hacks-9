import { describe, expect, it } from "vitest";
import { parseCameraCommand } from "./voiceCommand";

describe("parseCameraCommand", () => {
  it("reads the camera number after 'camera'", () => {
    expect(parseCameraCommand("Camera 3, sighting", 4)).toBe(3);
    expect(parseCameraCommand("camera three sighting", 4)).toBe(3);
    expect(parseCameraCommand("Cam number 2", 6)).toBe(2);
    expect(parseCameraCommand("cam3", 4)).toBe(3);
  });

  it("accepts sound-alikes only right after 'camera'", () => {
    expect(parseCameraCommand("camera for, sighting", 4)).toBe(4);
    expect(parseCameraCommand("camera to", 4)).toBe(2);
    expect(parseCameraCommand("sighting for you", 4)).toBeNull();
  });

  it("falls back to a single number anywhere", () => {
    expect(parseCameraCommand("sighting on six", 9)).toBe(6);
    expect(parseCameraCommand("between two and three", 9)).toBeNull();
  });

  it("rejects cameras that are not on screen", () => {
    expect(parseCameraCommand("camera 7", 4)).toBeNull();
    expect(parseCameraCommand("camera 0", 4)).toBeNull();
    expect(parseCameraCommand("camera 12", 9)).toBeNull();
    expect(parseCameraCommand("", 4)).toBeNull();
  });
});
