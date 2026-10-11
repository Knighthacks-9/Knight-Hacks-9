import type { GazeFeatures } from "./gazeFeatures";

/** Where a head sits in the camera frame and which way it faces. */
export interface HeadPosition {
  /** Point between the eyes, as a fraction of the frame. */
  x: number;
  y: number;
  /** Eye distance as a fraction of frame width; grows when leaning in. */
  scale: number;
  /** Head pose in radians (see GazeFeatures). */
  yaw: number;
  pitch: number;
}

/**
 * A typical comfortable spot: centered, about an arm's length away. A webcam
 * above the screen sees the head tipped down a little. The guide outline is
 * drawn here; the player only needs to be near it.
 */
export const HEAD_TARGET: HeadPosition = {
  x: 0.5,
  y: 0.42,
  scale: 0.085,
  yaw: 0,
  pitch: 0.1,
};

// The gaze model accounts for head movement, so the head only needs to be
// well in view and facing the screen. Generous, since cameras sit in all
// sorts of places.
const FRAMING = {
  x: 0.22,
  y: 0.22,
  minScale: 0.045,
  maxScale: 0.18,
  yaw: 0.42,
  pitch: 0.45,
};
// Once aligned, the limits widen so small wobbles do not flicker the state.
const STAY_SLACK = 1.3;

export type AlignmentIssue =
  | "no-face"
  | "move-left"
  | "move-right"
  | "move-up"
  | "move-down"
  | "move-closer"
  | "move-back"
  | "turn-left"
  | "turn-right"
  | "chin-up"
  | "chin-down";

export interface HeadAlignment {
  aligned: boolean;
  issue: AlignmentIssue | null;
  /** Short instruction for the player, from their point of view. */
  hint: string;
}

const HINTS: Record<AlignmentIssue, string> = {
  "no-face": "Show your face to the camera",
  "move-left": "Move left",
  "move-right": "Move right",
  "move-up": "Raise your head",
  "move-down": "Lower your head",
  "move-closer": "Lean closer",
  "move-back": "Sit back a little",
  "turn-left": "Turn your head left",
  "turn-right": "Turn your head right",
  "chin-up": "Lift your chin",
  "chin-down": "Lower your chin",
};

export const NOT_ALIGNED: HeadAlignment = {
  aligned: false,
  issue: "no-face",
  hint: HINTS["no-face"],
};

const issue = (value: AlignmentIssue): HeadAlignment => ({
  aligned: false,
  issue: value,
  hint: HINTS[value],
});

/**
 * Checks that one frame's head is well in view and facing the screen.
 * Directions in the hint are the player's own (features use the unmirrored
 * camera image, where the player's left is the image's right). Pass the
 * previous result's `aligned` so the check is a little more forgiving once
 * lined up.
 */
export function checkHeadAlignment(
  features: Pick<
    GazeFeatures,
    "faceX" | "faceY" | "faceScale" | "yaw" | "pitch"
  > | null,
  wasAligned = false,
): HeadAlignment {
  if (
    !features ||
    ![
      features.faceX,
      features.faceY,
      features.faceScale,
      features.yaw,
      features.pitch,
    ].every(Number.isFinite)
  ) {
    return NOT_ALIGNED;
  }
  const k = wasAligned ? STAY_SLACK : 1;
  const dx = features.faceX - HEAD_TARGET.x;
  const dy = features.faceY - HEAD_TARGET.y;

  // Distance first: it changes how big every other offset looks.
  if (features.faceScale < FRAMING.minScale / k) return issue("move-closer");
  if (features.faceScale > FRAMING.maxScale * k) return issue("move-back");
  // Face on the image's left is on the player's right: they move left.
  if (dx < -FRAMING.x * k) return issue("move-left");
  if (dx > FRAMING.x * k) return issue("move-right");
  if (dy < -FRAMING.y * k) return issue("move-down");
  if (dy > FRAMING.y * k) return issue("move-up");
  // Positive yaw: nose toward the image's right, the player's left.
  const yaw = features.yaw - HEAD_TARGET.yaw;
  if (yaw > FRAMING.yaw * k) return issue("turn-right");
  if (yaw < -FRAMING.yaw * k) return issue("turn-left");
  // Positive pitch: nose toward the image's bottom (looking down).
  const pitch = features.pitch - HEAD_TARGET.pitch;
  if (pitch > FRAMING.pitch * k) return issue("chin-up");
  if (pitch < -FRAMING.pitch * k) return issue("chin-down");
  return { aligned: true, issue: null, hint: "Head in view" };
}

/**
 * The head outline to draw over a camera frame of the given size, in pixels.
 * A face is about 2.3 eye-distances wide, and its center sits a little below
 * the eyes.
 */
export function headGuide(
  frameWidth: number,
  frameHeight: number,
): { cx: number; cy: number; rx: number; ry: number; eyeY: number } {
  const eyeGap = HEAD_TARGET.scale * frameWidth;
  const rx = eyeGap * 1.3;
  const eyeY = HEAD_TARGET.y * frameHeight;
  return {
    cx: HEAD_TARGET.x * frameWidth,
    cy: eyeY + eyeGap * 0.35,
    rx,
    ry: rx * 1.35,
    eyeY,
  };
}
