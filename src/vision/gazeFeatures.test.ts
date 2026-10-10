import { describe, expect, it } from "vitest";
import type { Matrix, NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  BlinkDetector,
  extractGazeFeatures,
  headPoseFromLandmarks,
  headPoseFromMatrix,
} from "./gazeFeatures";

const FRAME = 1000;

interface FaceOptions {
  irisDx?: number;
  irisDy?: number;
  roll?: number;
  /** Depth offset of the image-right face edge; positive turns the nose toward image right. */
  turn?: number;
}

/** A frontal face on a 1000×1000 frame with 60 px wide eyes. */
function makeFace({
  irisDx = 0,
  irisDy = 0,
  roll = 0,
  turn = 0,
}: FaceOptions = {}): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  const set = (index: number, x: number, y: number, z = 0) => {
    const cos = Math.cos(roll);
    const sin = Math.sin(roll);
    landmarks[index] = {
      x: 0.5 + (x - 0.5) * cos - (y - 0.5) * sin,
      y: 0.5 + (x - 0.5) * sin + (y - 0.5) * cos,
      z,
      visibility: 1,
    };
  };

  const eyes = [
    { corners: [33, 133], upper: 159, lower: 145, iris: 468, center: 0.43 },
    { corners: [362, 263], upper: 386, lower: 374, iris: 473, center: 0.57 },
  ];
  for (const eye of eyes) {
    set(eye.corners[0], eye.center - 0.03, 0.45);
    set(eye.corners[1], eye.center + 0.03, 0.45);
    set(eye.upper, eye.center, 0.44);
    set(eye.lower, eye.center, 0.46);
    const ix = eye.center + irisDx;
    const iy = 0.45 + irisDy;
    set(eye.iris, ix, iy);
    set(eye.iris + 1, ix + 0.005, iy);
    set(eye.iris + 2, ix, iy - 0.005);
    set(eye.iris + 3, ix - 0.005, iy);
    set(eye.iris + 4, ix, iy + 0.005);
  }
  set(234, 0.35, 0.5, -turn);
  set(454, 0.65, 0.5, turn);
  set(10, 0.5, 0.3);
  set(152, 0.5, 0.7);
  return landmarks;
}

function columnMajor(rotation: number[][]): Matrix {
  const data = new Array<number>(16).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      data[column * 4 + row] = rotation[row][column];
    }
  }
  data[15] = 1;
  return { rows: 4, columns: 4, data };
}

describe("gaze feature extraction", () => {
  it("measures iris offset inside each eye in eye widths", () => {
    const centered = extractGazeFeatures(makeFace(), FRAME, FRAME, 42);
    expect(centered).toMatchObject({
      eyeX: expect.closeTo(0),
      eyeY: expect.closeTo(0),
      openness: expect.closeTo(1 / 3),
      faceX: expect.closeTo(0.5),
      faceY: expect.closeTo(0.45),
      faceScale: expect.closeTo(0.14),
      blink: false,
      timestamp: 42,
    });

    const shifted = extractGazeFeatures(
      makeFace({ irisDx: 0.006, irisDy: 0.003 }),
      FRAME,
      FRAME,
      0,
    );
    expect(shifted?.eyeX).toBeCloseTo(0.1);
    expect(shifted?.eyeY).toBeCloseTo(0.05);
  });

  it("ignores head roll when measuring the eyes", () => {
    const upright = extractGazeFeatures(
      makeFace({ irisDx: 0.006, irisDy: 0.003 }),
      FRAME,
      FRAME,
      0,
    );
    const tilted = extractGazeFeatures(
      makeFace({ irisDx: 0.006, irisDy: 0.003, roll: 0.35 }),
      FRAME,
      FRAME,
      0,
    );
    expect(tilted?.eyeX).toBeCloseTo(upright!.eyeX);
    expect(tilted?.eyeY).toBeCloseTo(upright!.eyeY);
    expect(tilted?.openness).toBeCloseTo(upright!.openness);
  });

  it("prefers the transformation matrix for head pose", () => {
    const angle = 0.2;
    const turned = columnMajor([
      [Math.cos(angle), 0, Math.sin(angle)],
      [0, 1, 0],
      [-Math.sin(angle), 0, Math.cos(angle)],
    ]);
    const features = extractGazeFeatures(makeFace(), FRAME, FRAME, 0, turned);
    expect(features?.yaw).toBeCloseTo(angle);
    expect(features?.pitch).toBeCloseTo(0);
  });

  it("rejects missing landmarks and collapsed eyes", () => {
    expect(
      extractGazeFeatures(makeFace().slice(0, 473), FRAME, FRAME, 0),
    ).toBeNull();
    const collapsed = makeFace();
    collapsed[133] = { ...collapsed[33] };
    expect(extractGazeFeatures(collapsed, FRAME, FRAME, 0)).toBeNull();
    expect(extractGazeFeatures(makeFace(), 0, FRAME, 0)).toBeNull();
  });
});

describe("head pose", () => {
  it("reads yaw and pitch from a column-major transform", () => {
    expect(
      headPoseFromMatrix(
        columnMajor([
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ]),
      ),
    ).toEqual({ yaw: expect.closeTo(0), pitch: expect.closeTo(0) });

    const angle = 0.15;
    // Rotating about camera x tips the face's forward axis down (camera y is up).
    const noddingDown = columnMajor([
      [1, 0, 0],
      [0, Math.cos(angle), -Math.sin(angle)],
      [0, Math.sin(angle), Math.cos(angle)],
    ]);
    expect(headPoseFromMatrix(noddingDown)).toEqual({
      yaw: expect.closeTo(0),
      pitch: expect.closeTo(angle),
    });
    expect(headPoseFromMatrix(undefined)).toBeNull();
  });

  it("falls back to the face outline in landmark space", () => {
    expect(headPoseFromLandmarks(makeFace(), FRAME, FRAME)).toEqual({
      yaw: expect.closeTo(0),
      pitch: expect.closeTo(0),
    });
    expect(
      headPoseFromLandmarks(makeFace({ turn: 0.05 }), FRAME, FRAME)?.yaw,
    ).toBeGreaterThan(0.1);
  });
});

describe("blink detection", () => {
  it("flags sudden lid closure but not a slow drop from looking down", () => {
    const detector = new BlinkDetector();
    for (let frame = 0; frame < 10; frame += 1) {
      expect(detector.update(0.3)).toBe(false);
    }
    expect(detector.update(0.05)).toBe(true);
    expect(detector.update(0.3)).toBe(false);

    for (let openness = 0.3; openness >= 0.16; openness -= 0.005) {
      expect(detector.update(openness)).toBe(false);
    }
  });
});
