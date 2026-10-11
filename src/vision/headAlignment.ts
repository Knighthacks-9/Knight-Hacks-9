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
  /** Head pose in radians (see GazeFeatures). */
  pitch: number;
}

/**
 * A typical face about an arm's length from a laptop camera. Before the
 * player's own position is locked in, only its pose is used: a face is in
 * view at any distance, so a phone held close works as well as a laptop.
 */
export const HEAD_TARGET: HeadPosition = {
  x: 0.5,
  y: 0.42,
  scale: 0.085,
  yaw: 0,
  pitch: 0.1,
};

// The gaze model accounts for head movement, so the head only needs to stay
// in view, facing the screen, and near where it was when calibrated.
const FRAMING = {
  /** Farthest away a face is still tracked well (eye gap / frame width). */
  minScale: 0.03,
  /** Locked in: allowed change in distance, as a ratio either way. */
  depth: 1.3,
  /** Locked in: allowed drift, in eye gaps at the locked distance. */
  shift: 2.5,
  yaw: 0.42,
  pitch: 0.45,
};
/**
 * The face's extent around the point between the eyes, in eye gaps: about
 * 2.6 wide, from the brow down past the mouth. Landmarks need all of it.
 */
const FACE_EXTENT = { side: 1.2, up: 1, down: 1.8 };
// Once aligned, the limits widen so small wobbles do not flicker the state.
const STAY_SLACK = 1.3;
/** Height / width of a 16:9 frame, for features that do not carry their own. */
const DEFAULT_ASPECT = 9 / 16;

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

type HeadFeatures = Pick<
  GazeFeatures,
  "faceX" | "faceY" | "faceScale" | "yaw" | "pitch" | "frameAspect"
>;

/** One frame's head position, or null when the face was not measured. */
export function headPosition(
  features: HeadFeatures | null,
): HeadPosition | null {
  if (!features) return null;
  const head = {
    x: features.faceX,
    y: features.faceY,
    scale: features.faceScale,
    yaw: features.yaw,
    pitch: features.pitch,
  };
  return Object.values(head).every(Number.isFinite) && head.scale > 0
    ? head
    : null;
}

/** The average of several frames' head positions, e.g. to lock one in. */
export function averageHeadPosition(
  heads: HeadPosition[],
): HeadPosition | null {
  if (!heads.length) return null;
  const mean = (key: keyof HeadPosition) =>
    heads.reduce((sum, head) => sum + head[key], 0) / heads.length;
  return {
    x: mean("x"),
    y: mean("y"),
    scale: mean("scale"),
    yaw: mean("yaw"),
    pitch: mean("pitch"),
  };
}

/**
 * Checks that one frame's head is in view and facing the screen.
 *
 * Without an anchor, any distance works as long as the whole face is in the
 * frame. With one (the position locked in at calibration), the head must also
 * stay near it: about the same distance from the camera, not drifted far,
 * and facing about the same way.
 *
 * Directions in the hint are the player's own (features use the unmirrored
 * camera image, where the player's left is the image's right). Pass the
 * previous result's `aligned` so the check is a little more forgiving once
 * lined up.
 */
export function checkHeadAlignment(
  features: HeadFeatures | null,
  wasAligned = false,
  anchor: HeadPosition | null = null,
): HeadAlignment {
  const head = headPosition(features);
  if (!head) return NOT_ALIGNED;
  const k = wasAligned ? STAY_SLACK : 1;
  const aspect =
    features?.frameAspect && features.frameAspect > 0
      ? features.frameAspect
      : DEFAULT_ASPECT;

  // Distance first: it changes how big every other offset looks.
  if (anchor) {
    const ratio = head.scale / anchor.scale;
    if (ratio < 1 / (FRAMING.depth * k)) return issue("move-closer");
    if (ratio > FRAMING.depth * k) return issue("move-back");
  } else if (head.scale < FRAMING.minScale / k) {
    return issue("move-closer");
  }

  // The whole face must be in the frame. Vertical extents are converted
  // from frame widths to frame heights.
  const reach = 1 / k;
  const side = FACE_EXTENT.side * head.scale * reach;
  const up = (FACE_EXTENT.up * head.scale * reach) / aspect;
  const down = (FACE_EXTENT.down * head.scale * reach) / aspect;
  if (side * 2 > 1 || up + down > 1) return issue("move-back");
  // Face off the image's left is off the player's right: they move left.
  if (head.x - side < 0) return issue("move-left");
  if (head.x + side > 1) return issue("move-right");
  if (head.y - up < 0) return issue("move-down");
  if (head.y + down > 1) return issue("move-up");

  const facing = anchor ?? HEAD_TARGET;
  if (anchor) {
    // Drift in eye gaps at the locked distance, the same units on both axes.
    const limit = FRAMING.shift * anchor.scale * k;
    const dx = head.x - anchor.x;
    const dy = (head.y - anchor.y) * aspect;
    if (dx < -limit) return issue("move-left");
    if (dx > limit) return issue("move-right");
    if (dy < -limit) return issue("move-down");
    if (dy > limit) return issue("move-up");
  }
  // Positive yaw: nose toward the image's right, the player's left.
  const yaw = head.yaw - facing.yaw;
  if (yaw > FRAMING.yaw * k) return issue("turn-right");
  if (yaw < -FRAMING.yaw * k) return issue("turn-left");
  // Positive pitch: nose toward the image's bottom (looking down).
  const pitch = head.pitch - facing.pitch;
  if (pitch > FRAMING.pitch * k) return issue("chin-up");
  if (pitch < -FRAMING.pitch * k) return issue("chin-down");
  return { aligned: true, issue: null, hint: "Head in view" };
}

/**
 * The head outline around a head position, in pixels of a camera frame of the
 * given size. A face is about 2.3 eye-distances wide, and its center sits a
 * little below the eyes.
 */
export function headGuide(
  frameWidth: number,
  frameHeight: number,
  head: Pick<HeadPosition, "x" | "y" | "scale"> = HEAD_TARGET,
): { cx: number; cy: number; rx: number; ry: number; eyeY: number } {
  const eyeGap = head.scale * frameWidth;
  const rx = eyeGap * 1.3;
  const eyeY = head.y * frameHeight;
  return {
    cx: head.x * frameWidth,
    cy: eyeY + eyeGap * 0.35,
    rx,
    ry: rx * 1.35,
    eyeY,
  };
}
