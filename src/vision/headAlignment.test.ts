import { describe, expect, it } from "vitest";
import { HEAD_TARGET, checkHeadAlignment, headGuide } from "./headAlignment";

const centered = {
  faceX: HEAD_TARGET.x,
  faceY: HEAD_TARGET.y,
  faceScale: HEAD_TARGET.scale,
  yaw: HEAD_TARGET.yaw,
  pitch: HEAD_TARGET.pitch,
};

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

  it("frames generously, since cameras sit in all sorts of places", () => {
    // Off-center cameras put the face well away from the middle.
    expect(
      checkHeadAlignment({
        ...centered,
        faceX: 0.65,
        faceY: 0.55,
        faceScale: 0.06,
        yaw: 0.25,
      }).aligned,
    ).toBe(true);
  });

  it("gives directions from the player's point of view", () => {
    // The camera image is unmirrored: the image's left is the player's right.
    expect(checkHeadAlignment({ ...centered, faceX: 0.2 }).issue).toBe(
      "move-left",
    );
    expect(checkHeadAlignment({ ...centered, faceX: 0.8 }).issue).toBe(
      "move-right",
    );
    expect(checkHeadAlignment({ ...centered, faceY: 0.1 }).issue).toBe(
      "move-down",
    );
    expect(checkHeadAlignment({ ...centered, faceY: 0.8 }).issue).toBe(
      "move-up",
    );
    expect(checkHeadAlignment({ ...centered, faceScale: 0.03 }).issue).toBe(
      "move-closer",
    );
    expect(checkHeadAlignment({ ...centered, faceScale: 0.2 }).issue).toBe(
      "move-back",
    );
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

  it("is more forgiving once aligned, so the state does not flicker", () => {
    const edge = { ...centered, faceX: HEAD_TARGET.x + 0.25 };
    expect(checkHeadAlignment(edge, false).aligned).toBe(false);
    expect(checkHeadAlignment(edge, true).aligned).toBe(true);
  });
});

describe("headGuide", () => {
  it("centers an upright oval on the target inside the frame", () => {
    const guide = headGuide(1280, 720);
    expect(guide.cx).toBe(640);
    expect(guide.eyeY).toBeCloseTo(HEAD_TARGET.y * 720);
    expect(guide.cy).toBeGreaterThan(guide.eyeY);
    expect(guide.ry).toBeGreaterThan(guide.rx);
    expect(guide.cy - guide.ry).toBeGreaterThan(0);
    expect(guide.cy + guide.ry).toBeLessThan(720);
  });
});
