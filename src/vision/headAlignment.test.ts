import { describe, expect, it } from "vitest";
import {
  HEAD_TARGET,
  averageHeadPosition,
  checkHeadAlignment,
  headGuide,
  headPosition,
} from "./headAlignment";

const centered = {
  faceX: HEAD_TARGET.x,
  faceY: HEAD_TARGET.y,
  faceScale: HEAD_TARGET.scale,
  yaw: HEAD_TARGET.yaw,
  pitch: HEAD_TARGET.pitch,
  frameAspect: 9 / 16,
};
// A phone held close in portrait: the face fills much of a tall frame.
const phone = {
  faceX: 0.5,
  faceY: 0.4,
  faceScale: 0.3,
  yaw: 0,
  pitch: 0.05,
  frameAspect: 16 / 9,
};
const anchor = headPosition(centered)!;

describe("checkHeadAlignment", () => {
  it("accepts a centered head", () => {
    expect(checkHeadAlignment(centered)).toEqual({
      aligned: true,
      issue: null,
      hint: "Head in view",
    });
  });

  it("asks for a face when there is none", () => {
    expect(checkHeadAlignment(null)).toMatchObject({
      aligned: false,
      issue: "no-face",
    });
    expect(checkHeadAlignment({ ...centered, yaw: NaN }).issue).toBe("no-face");
  });

  it("accepts a face at any distance before a position is locked in", () => {
    expect(checkHeadAlignment(phone).aligned).toBe(true);
    expect(checkHeadAlignment({ ...centered, faceScale: 0.15 }).aligned).toBe(
      true,
    );
    // Off-center cameras put the face well away from the middle.
    expect(
      checkHeadAlignment({
        ...centered,
        faceX: 0.2,
        faceY: 0.6,
        faceScale: 0.06,
        yaw: 0.25,
      }).aligned,
    ).toBe(true);
  });

  it("keeps the whole face in the frame", () => {
    // The camera image is unmirrored: the image's left is the player's right.
    expect(checkHeadAlignment({ ...centered, faceX: 0.05 }).issue).toBe(
      "move-left",
    );
    expect(checkHeadAlignment({ ...centered, faceX: 0.95 }).issue).toBe(
      "move-right",
    );
    expect(checkHeadAlignment({ ...centered, faceY: 0.1 }).issue).toBe(
      "move-down",
    );
    expect(checkHeadAlignment({ ...centered, faceY: 0.8 }).issue).toBe(
      "move-up",
    );
    expect(checkHeadAlignment({ ...centered, faceScale: 0.02 }).issue).toBe(
      "move-closer",
    );
    // Too close for the face to fit at all.
    expect(checkHeadAlignment({ ...phone, faceScale: 0.5 }).issue).toBe(
      "move-back",
    );
  });

  it("asks the player to face the screen", () => {
    expect(checkHeadAlignment({ ...centered, yaw: 0.5 }).issue).toBe(
      "turn-right",
    );
    expect(checkHeadAlignment({ ...centered, yaw: -0.5 }).issue).toBe(
      "turn-left",
    );
    expect(checkHeadAlignment({ ...centered, pitch: 0.6 }).issue).toBe(
      "chin-up",
    );
    expect(checkHeadAlignment({ ...centered, pitch: -0.4 }).issue).toBe(
      "chin-down",
    );
  });

  it("keeps the face near the locked position, at its distance", () => {
    expect(checkHeadAlignment(centered, false, anchor).aligned).toBe(true);
    expect(
      checkHeadAlignment({ ...centered, faceScale: 0.06 }, false, anchor).issue,
    ).toBe("move-closer");
    expect(
      checkHeadAlignment({ ...centered, faceScale: 0.12 }, false, anchor).issue,
    ).toBe("move-back");
    expect(
      checkHeadAlignment({ ...centered, faceX: 0.25 }, false, anchor).issue,
    ).toBe("move-left");
    expect(
      checkHeadAlignment({ ...centered, faceX: 0.75 }, false, anchor).issue,
    ).toBe("move-right");
    // Facing is judged against how the player sat when locked in.
    const tilted = { ...centered, pitch: 0.4 };
    expect(checkHeadAlignment(tilted).issue).toBe(null);
    expect(
      checkHeadAlignment({ ...tilted, pitch: 0.1 }, false, headPosition(tilted))
        .aligned,
    ).toBe(true);
  });

  it("locks in a close phone position just as well", () => {
    const locked = headPosition(phone);
    expect(
      checkHeadAlignment({ ...phone, faceScale: 0.27 }, false, locked).aligned,
    ).toBe(true);
    expect(
      checkHeadAlignment({ ...phone, faceScale: 0.15 }, false, locked).issue,
    ).toBe("move-closer");
  });

  it("is more forgiving once aligned, so the state does not flicker", () => {
    const edge = { ...centered, faceX: HEAD_TARGET.x + 0.23 };
    expect(checkHeadAlignment(edge, false, anchor).aligned).toBe(false);
    expect(checkHeadAlignment(edge, true, anchor).aligned).toBe(true);
  });
});

describe("averageHeadPosition", () => {
  it("averages the frames, or gives null without any", () => {
    expect(averageHeadPosition([])).toBeNull();
    const head = averageHeadPosition([
      { x: 0.4, y: 0.4, scale: 0.1, yaw: 0, pitch: 0 },
      { x: 0.6, y: 0.5, scale: 0.2, yaw: 0.2, pitch: 0.1 },
    ])!;
    expect(head.x).toBeCloseTo(0.5);
    expect(head.y).toBeCloseTo(0.45);
    expect(head.scale).toBeCloseTo(0.15);
    expect(head.yaw).toBeCloseTo(0.1);
    expect(head.pitch).toBeCloseTo(0.05);
  });
});

describe("headGuide", () => {
  it("centers an upright oval on the head inside the frame", () => {
    const guide = headGuide(1280, 720, anchor);
    expect(guide.cx).toBe(640);
    expect(guide.eyeY).toBeCloseTo(HEAD_TARGET.y * 720);
    expect(guide.cy).toBeGreaterThan(guide.eyeY);
    expect(guide.ry).toBeGreaterThan(guide.rx);
    expect(guide.cy - guide.ry).toBeGreaterThan(0);
    expect(guide.cy + guide.ry).toBeLessThan(720);
  });

  it("grows with a closer face", () => {
    expect(headGuide(720, 1280, headPosition(phone)!).rx).toBeGreaterThan(
      headGuide(720, 1280, anchor).rx,
    );
  });
});
