import { describe, expect, it } from "vitest";
import {
  END_MARGIN_SECONDS,
  InvestigationDesk,
  LATE_CUTOFF_SECONDS,
  STAGES,
  STAGE_DELAYS,
  investigationFacts,
  investigationTemplate,
  planStageTimes,
  type InvestigationCase,
  type InvestigationLine,
  type Whereabouts,
} from "./investigation";

const TOTAL = STAGES.reduce((sum, s) => sum + STAGE_DELAYS[s], 0);

describe("planStageTimes", () => {
  it("uses the normal delays when there is plenty of time", () => {
    const times = planStageTimes(10, 300)!;
    expect(times).toHaveLength(STAGES.length);
    expect(times[0]).toBe(10);
    expect(times.at(-1)).toBeCloseTo(10 + TOTAL);
  });

  it("compresses the delays so the investigation closes before the shift ends", () => {
    const shiftSeconds = 120;
    const now = shiftSeconds - 15;
    const times = planStageTimes(now, shiftSeconds)!;
    expect(times.at(-1)).toBeLessThanOrEqual(shiftSeconds - END_MARGIN_SECONDS);
    expect(times.at(-1)).toBeCloseTo(shiftSeconds - END_MARGIN_SECONDS);
    // Still in order, with every stage after the last.
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
  });

  it("closes in time just above the cutoff", () => {
    const times = planStageTimes(100 - LATE_CUTOFF_SECONDS - 0.01, 100)!;
    expect(times.at(-1)).toBeLessThan(100);
  });

  it("refuses to start in the last seconds of the shift", () => {
    expect(planStageTimes(100 - LATE_CUTOFF_SECONDS, 100)).toBeNull();
    expect(planStageTimes(99, 100)).toBeNull();
    expect(planStageTimes(120, 100)).toBeNull();
  });
});

const suspectCase: InvestigationCase = {
  camera: 2,
  location: "Hall West",
  reportedBehavior: "loitering",
  description: "red shirt by the door",
  suspect: "loitering",
  npcId: "npc3",
};

describe("investigation lines", () => {
  it("says the subject moved when they're on another camera at on_scene", () => {
    const now: Whereabouts = { camera: 5, location: "Server Room" };
    expect(investigationFacts("on_scene", suspectCase, now)).toContain(
      "moved to Server Room (camera 5)",
    );
    // Every variant names where they went.
    for (const random of [0, 0.5, 0.99]) {
      expect(
        investigationTemplate("on_scene", suspectCase, now, () => random),
      ).toContain("Server Room");
    }
  });

  it("resolves from ground truth: suspect detained, innocent cleared", () => {
    expect(investigationFacts("resolved", suspectCase, null)).toContain(
      "detained",
    );
    const innocent = { ...suspectCase, suspect: null };
    expect(investigationFacts("resolved", innocent, null)).toContain(
      "false report",
    );
    expect(investigationTemplate("resolved", innocent, null)).toContain(
      "cleared",
    );
  });

  it("has a template for every stage", () => {
    for (const stage of STAGES) {
      expect(investigationTemplate(stage, suspectCase, null)).not.toBe("");
    }
  });
});

describe("InvestigationDesk", () => {
  const setup = (shiftSeconds = 300) => {
    const lines: InvestigationLine[] = [];
    const writes: string[] = [];
    const desk = new InvestigationDesk({
      shiftSeconds,
      locate: () => ({ camera: 2, location: "Hall West" }),
      deliver: (line) => lines.push(line),
      write: async (stage, _facts, template) => {
        writes.push(stage);
        return template;
      },
    });
    return { desk, lines, writes };
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("delivers every stage in order on the shift clock", async () => {
    const { desk, lines } = setup();
    desk.start(suspectCase, 10);
    for (let t = 10; t <= 10 + TOTAL + 1; t += 0.5) {
      desk.update(t);
      await flush();
    }
    expect(lines.map((l) => l.stage)).toEqual([...STAGES]);
  });

  it("prefetches the next line before it is due", async () => {
    const { desk, writes } = setup();
    desk.start(suspectCase, 10);
    await flush();
    desk.update(10 + STAGE_DELAYS.en_route - 2);
    expect(writes).toEqual(["acknowledged", "en_route"]);
  });

  it("runs the full investigation after the shift when not fitting to it", async () => {
    const lines: InvestigationLine[] = [];
    const desk = new InvestigationDesk({
      shiftSeconds: 100,
      fitToShift: false,
      locate: () => ({ camera: 2, location: "Hall West" }),
      deliver: (line) => lines.push(line),
      write: async (_stage, _facts, template) => template,
    });
    desk.start(suspectCase, 95);
    expect(desk.busy).toBe(true);
    for (let t = 95; t <= 95 + TOTAL + 1; t += 0.5) {
      desk.update(t);
      await flush();
    }
    expect(lines.map((l) => l.stage)).toEqual([...STAGES]);
    expect(lines.every((l) => l.case === suspectCase)).toBe(true);
    expect(desk.busy).toBe(false);
  });

  it("gives a log-it line instead of investigating at the end of the shift", async () => {
    const { desk, lines } = setup(100);
    desk.start(suspectCase, 95);
    await flush();
    expect(lines).toHaveLength(1);
    expect(lines[0].stage).toBe("late");
    expect(lines[0].text).toContain("next crew");
  });
});
