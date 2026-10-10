import type { Matrix, NormalizedLandmark } from "@mediapipe/tasks-vision";

/**
 * One camera frame's measurements used to estimate gaze. Directions refer to
 * the unmirrored camera image, so the player's right is the image's left.
 */
export interface GazeFeatures {
  /** Iris offset along the eye, in eye widths; + toward image right. */
  eyeX: number;
  /** Iris offset across the eye, in eye widths; + toward image bottom. */
  eyeY: number;
  /** Eyelid gap divided by eye width; drops sharply during a blink. */
  openness: number;
  /** Head turn in radians; + when the nose points toward image right. */
  yaw: number;
  /** Head tilt in radians; + when the nose points toward image bottom. */
  pitch: number;
  /** Point between the eyes, as a fraction of the camera frame. */
  faceX: number;
  faceY: number;
  /** Distance between the eyes as a fraction of frame width; grows when leaning in. */
  faceScale: number;
  blink: boolean;
  /** performance.now() time of the camera frame. */
  timestamp: number;
}

export interface HeadPose {
  yaw: number;
  pitch: number;
}

interface Point3 {
  x: number;
  y: number;
  z: number;
}

// MediaPipe Face Landmarker eye corners (image-left first), eyelid midpoints,
// and iris center followed by its four ring points.
export const EYE_LANDMARKS = [
  {
    corners: [33, 133],
    upper: 159,
    lower: 145,
    iris: [468, 469, 470, 471, 472],
  },
  {
    corners: [362, 263],
    upper: 386,
    lower: 374,
    iris: [473, 474, 475, 476, 477],
  },
] as const;

// Face outline points used for head pose when no transformation matrix exists.
const FACE_LEFT = 234;
const FACE_RIGHT = 454;
const FACE_TOP = 10;
const FACE_BOTTOM = 152;

const MIN_EYE_WIDTH_PX = 6;
const BLINK_RATIO = 0.5;
const MIN_BLINK_OPENNESS = 0.08;
const BLINK_BASELINE_RATE = 0.05;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function toPixels(
  point: NormalizedLandmark | undefined,
  frameWidth: number,
  frameHeight: number,
): Point3 | null {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }
  const z = Number.isFinite(point.z) ? point.z : 0;
  // MediaPipe scales z roughly like x.
  return {
    x: point.x * frameWidth,
    y: point.y * frameHeight,
    z: z * frameWidth,
  };
}

/** x and y are image directions (right, down); z points toward the camera. */
function poseFromForward(x: number, y: number, z: number): HeadPose | null {
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  return {
    yaw: Math.asin(clamp(x / length, -1, 1)),
    pitch: Math.asin(clamp(y / length, -1, 1)),
  };
}

export function headPoseFromMatrix(
  matrix: Matrix | undefined,
): HeadPose | null {
  const data = matrix?.data;
  if (!data || data.length < 16) return null;
  // The 4x4 transform is packed column-major; column 2 is the face's forward
  // axis in camera space (x right, y up, z toward the camera).
  return poseFromForward(data[8], -data[9], data[10]);
}

export function headPoseFromLandmarks(
  landmarks: NormalizedLandmark[],
  frameWidth: number,
  frameHeight: number,
): HeadPose | null {
  const left = toPixels(landmarks[FACE_LEFT], frameWidth, frameHeight);
  const right = toPixels(landmarks[FACE_RIGHT], frameWidth, frameHeight);
  const top = toPixels(landmarks[FACE_TOP], frameWidth, frameHeight);
  const bottom = toPixels(landmarks[FACE_BOTTOM], frameWidth, frameHeight);
  if (!left || !right || !top || !bottom) return null;

  const across = {
    x: right.x - left.x,
    y: right.y - left.y,
    z: right.z - left.z,
  };
  const down = {
    x: bottom.x - top.x,
    y: bottom.y - top.y,
    z: bottom.z - top.z,
  };
  // Landmark z grows away from the camera, so down × across points out of the
  // face toward the camera.
  const normal = {
    x: down.y * across.z - down.z * across.y,
    y: down.z * across.x - down.x * across.z,
    z: down.x * across.y - down.y * across.x,
  };
  return poseFromForward(normal.x, normal.y, -normal.z);
}

/**
 * Measures iris position inside each eye, eyelid opening, head pose, and head
 * position. Returns null when the eyes cannot be measured reliably.
 */
export function extractGazeFeatures(
  landmarks: NormalizedLandmark[],
  frameWidth: number,
  frameHeight: number,
  timestamp: number,
  matrix?: Matrix,
): GazeFeatures | null {
  if (landmarks.length < 478 || !(frameWidth > 0) || !(frameHeight > 0)) {
    return null;
  }

  let eyeX = 0;
  let eyeY = 0;
  let openness = 0;
  const centers: { x: number; y: number }[] = [];

  for (const eye of EYE_LANDMARKS) {
    const a = toPixels(landmarks[eye.corners[0]], frameWidth, frameHeight);
    const b = toPixels(landmarks[eye.corners[1]], frameWidth, frameHeight);
    const upper = toPixels(landmarks[eye.upper], frameWidth, frameHeight);
    const lower = toPixels(landmarks[eye.lower], frameWidth, frameHeight);
    const irisPoints = eye.iris.map((index) =>
      toPixels(landmarks[index], frameWidth, frameHeight),
    );
    if (!a || !b || !upper || !lower || irisPoints.some((p) => !p)) {
      return null;
    }

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const width = Math.hypot(dx, dy);
    if (width < MIN_EYE_WIDTH_PX) return null;

    let irisX = 0;
    let irisY = 0;
    for (const point of irisPoints as Point3[]) {
      irisX += point.x / irisPoints.length;
      irisY += point.y / irisPoints.length;
    }

    // Measure in the eye's own frame so head roll does not leak into gaze.
    const ux = dx / width;
    const uy = dy / width;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const ox = irisX - cx;
    const oy = irisY - cy;
    eyeX += (ox * ux + oy * uy) / width;
    eyeY += (oy * ux - ox * uy) / width;
    openness += Math.hypot(lower.x - upper.x, lower.y - upper.y) / width;
    centers.push({ x: cx, y: cy });
  }

  const pose =
    headPoseFromMatrix(matrix) ??
    headPoseFromLandmarks(landmarks, frameWidth, frameHeight);
  if (!pose) return null;

  const [first, second] = centers;
  return {
    eyeX: eyeX / 2,
    eyeY: eyeY / 2,
    openness: openness / 2,
    yaw: pose.yaw,
    pitch: pose.pitch,
    faceX: (first.x + second.x) / 2 / frameWidth,
    faceY: (first.y + second.y) / 2 / frameHeight,
    faceScale: Math.hypot(second.x - first.x, second.y - first.y) / frameWidth,
    blink: false,
    timestamp,
  };
}

/**
 * Flags blinks when eyelid opening falls well below its recent open-eye level.
 * The baseline adapts slowly, so looking down does not count as a blink.
 */
export class BlinkDetector {
  private baseline: number | null = null;

  update(openness: number): boolean {
    if (!Number.isFinite(openness)) return true;
    this.baseline ??= openness;
    const blink =
      openness < Math.max(MIN_BLINK_OPENNESS, this.baseline * BLINK_RATIO);
    if (!blink) {
      this.baseline += (openness - this.baseline) * BLINK_BASELINE_RATE;
    }
    return blink;
  }

  reset(): void {
    this.baseline = null;
  }
}
