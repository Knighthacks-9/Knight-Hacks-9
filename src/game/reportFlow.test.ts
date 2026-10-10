import { describe, expect, it } from "vitest";
import { ReportFlow } from "./reportFlow";

describe("report flow", () => {
  it("walks feed → person → incident → send → spoken follow-up", () => {
    const flow = new ReportFlow();
    flow.start();
    expect(flow.step).toBe("feed");

    expect(flow.chooseFeed("cam2")).toBe(true);
    expect(flow.step).toBe("person");
    expect(flow.choosePerson("cam2", "npc7")).toBe(true);
    expect(flow.send(12)).toBeNull(); // no incident type yet

    flow.chooseBehavior("loitering");
    expect(flow.send(12)).toEqual({
      cameraId: "cam2",
      npcId: "npc7",
      behavior: "loitering",
      t: 12,
    });
    expect(flow.step).toBe("follow-up");

    // Dispatch needs words; an empty transcript keeps waiting.
    expect(flow.completeFollowUp("   ")).toBeNull();
    expect(flow.step).toBe("follow-up");
    expect(flow.completeFollowUp(" Grey hoodie by the lobby door ")).toEqual({
      cameraId: "cam2",
      npcId: "npc7",
      behavior: "loitering",
      t: 12,
      note: "Grey hoodie by the lobby door",
    });
    expect(flow.step).toBe("idle");
  });

  it("treats clicking a person in step 1 as choosing their feed", () => {
    const flow = new ReportFlow();
    flow.start();
    flow.choosePerson("cam3", "npc1");
    expect(flow.step).toBe("person");
    expect(flow.cameraId).toBe("cam3");
    expect(flow.npcId).toBeNull();
  });

  it("rejects people on other feeds and people already reported", () => {
    const flow = new ReportFlow();
    flow.start();
    flow.chooseFeed("cam1");
    expect(flow.choosePerson("cam2", "npc1")).toBe(false);
    expect(flow.notice).toMatch(/feed you chose/);

    flow.choosePerson("cam1", "npc1");
    flow.chooseBehavior("restrictedZone");
    flow.send(5);
    flow.completeFollowUp("in the server room");

    flow.start();
    flow.chooseFeed("cam1");
    expect(flow.choosePerson("cam1", "npc1")).toBe(false);
    expect(flow.notice).toMatch(/Already reported/);
  });

  it("can't start or cancel a new report until dispatch gets the follow-up", () => {
    const flow = new ReportFlow();
    flow.start();
    flow.chooseFeed("cam1");
    flow.choosePerson("cam1", "npc1");
    flow.chooseBehavior("avoidingCameras");
    flow.send(1);

    flow.start();
    flow.cancel();
    expect(flow.step).toBe("follow-up");
    expect(flow.pending?.npcId).toBe("npc1");
  });

  it("steps back without losing earlier choices", () => {
    const flow = new ReportFlow();
    flow.start();
    flow.chooseFeed("cam4");
    flow.choosePerson("cam4", "npc2");
    flow.back();
    expect(flow.step).toBe("person");
    expect(flow.cameraId).toBe("cam4");
    flow.back();
    expect(flow.step).toBe("feed");
  });
});
