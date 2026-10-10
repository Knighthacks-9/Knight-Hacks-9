import { describe, expect, it } from "vitest";
import type { BoundingBox, NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  estimateGazePoint,
  faceBoxFromDetection,
  faceBoxFromLandmarks,
  lowLightBrightness,
} from "./MediaPipeGazeTracker";

function makeLandmarks(): NormalizedLandmark[] {
  return Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
}

describe("MediaPipe gaze estimation", () => {
  it("averages iris position within both eye regions", () => {
    const landmarks = makeLandmarks();
    Object.assign(landmarks[33], { x: 0.2 });
    Object.assign(landmarks[133], { x: 0.4 });
    Object.assign(landmarks[159], { y: 0.4 });
    Object.assign(landmarks[145], { y: 0.5 });
    Object.assign(landmarks[468], { x: 0.35, y: 0.47 });
    Object.assign(landmarks[362], { x: 0.6 });
    Object.assign(landmarks[263], { x: 0.8 });
    Object.assign(landmarks[386], { y: 0.4 });
    Object.assign(landmarks[374], { y: 0.5 });
    Object.assign(landmarks[473], { x: 0.75, y: 0.47 });

    expect(estimateGazePoint(landmarks)).toEqual({
      x: expect.closeTo(0.75),
      y: expect.closeTo(0.7),
    });
  });

  describe("face box helpers", () => {
    it("creates a padded face box from normalized landmarks", () => {
      const landmarks = makeLandmarks();
      Object.assign(landmarks[0], { x: 0.25, y: 0.2 });
      Object.assign(landmarks[1], { x: 0.75, y: 0.8 });

      expect(faceBoxFromLandmarks(landmarks.slice(0, 2), 640, 480)).toEqual({
        x: expect.closeTo(134.4),
        y: expect.closeTo(72.96),
        width: expect.closeTo(371.2),
        height: expect.closeTo(334.08),
      });

      describe("low-light enhancement", () => {
        it("boosts dark frames more than bright frames and caps the gain", () => {
          const dark = { data: new Uint8ClampedArray([25, 25, 25, 255]) };
          const medium = { data: new Uint8ClampedArray([80, 80, 80, 255]) };
          const bright = { data: new Uint8ClampedArray([220, 220, 220, 255]) };

          expect(lowLightBrightness(dark)).toBe(1.8);
          expect(lowLightBrightness(medium)).toBeCloseTo(1.475);
          expect(lowLightBrightness(bright)).toBe(1);
          expect(lowLightBrightness({ data: new Uint8ClampedArray() })).toBe(
            1.8,
          );
        });
      });
    });

    it("clips detector boxes to the camera frame and rejects invalid boxes", () => {
      const box: BoundingBox = {
        originX: -20,
        originY: 30,
        width: 120,
        height: 100,
        angle: 0,
      };

      expect(faceBoxFromDetection(box, 640, 480)).toEqual({
        x: 0,
        y: 30,
        width: 100,
        height: 100,
      });
      expect(faceBoxFromDetection(undefined, 640, 480)).toBeNull();
      expect(
        faceBoxFromDetection({ ...box, originX: 700 }, 640, 480),
      ).toBeNull();
    });
  });

  it("rejects missing or unusable eye landmarks", () => {
    expect(estimateGazePoint(makeLandmarks().slice(0, 473))).toBeNull();

    const landmarks = makeLandmarks();
    Object.assign(landmarks[33], { x: 0.5 });
    Object.assign(landmarks[133], { x: 0.5 });
    expect(estimateGazePoint(landmarks)).toBeNull();
  });
});
