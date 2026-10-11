import { describe, expect, it } from "vitest";
import type { ClassifiedEvent, ShiftReport } from "../shared/types";
import { debriefFacts, debriefInput, debriefTemplate } from "./debriefSummary";

const FEEDS = [
  { id: "cam1", location: "Lobby" },
  { id: "cam2", location: "Hall West" },
  { id: "cam5", location: "Server Room" },
];

function event(over: Partial<ClassifiedEvent>): ClassifiedEvent {
  return {
    id: "e1",
    npcId: "npc1",
    behavior: "loitering",
    start: 10,
    end: 20,
    cameraIds: ["cam1"],
    outcome: "caught",
    watchedSeconds: 3,
    flaggedAt: 12,
    escaped: false,
    reportedBehavior: null,
    reportNote: null,
    ...over,
  };
}

function report(events: ClassifiedEvent[], falseFlags = 0): ShiftReport {
  return {
    level: 1,
    duration: 120,
    completed: true,
    passed: true,
    score: 80,
    events,
    falseFlags: Array.from({ length: falseFlags }, (_, i) => ({
      t: 30 + i,
      npcId: `npc${10 + i}`,
      cameraId: "cam2",
    })),
    feeds: [],
    timeline: [],
    gazeDistance: [],
    trackerSeconds: 0,
    attentionLapses: 0,
  };
}

describe("debriefInput", () => {
  it("splits caught and missed suspects and names their first shown feed", () => {
    const input = debriefInput(
      report(
        [
          event({ id: "a" }),
          event({
            id: "b",
            behavior: "restrictedZone",
            cameraIds: ["cam9", "cam5"],
            outcome: "missed-not-looking",
            flaggedAt: null,
            escaped: false,
          }),
          event({
            id: "c",
            behavior: "avoidingCameras",
            cameraIds: ["cam2"],
            outcome: "missed-looking",
            flaggedAt: null,
            escaped: false,
          }),
        ],
        2,
      ),
      FEEDS,
    );
    expect(input.caught).toEqual([
      { behavior: "loitering", camera: 1, location: "Lobby", watched: true },
    ]);
    expect(input.missed).toEqual([
      {
        behavior: "restrictedZone",
        camera: 3,
        location: "Server Room",
        watched: false,
      },
      {
        behavior: "avoidingCameras",
        camera: 2,
        location: "Hall West",
        watched: true,
      },
    ]);
    expect(input.falseReports).toBe(2);
  });
});

describe("debriefFacts", () => {
  it("congratulates when everyone was caught", () => {
    const input = debriefInput(
      report([event({}), event({ id: "b", behavior: "revisitingDoors" })]),
      FEEDS,
    );
    const facts = debriefFacts(input);
    expect(facts).toContain("Suspects caught: 2");
    expect(facts).toContain("congratulate");
    expect(facts).not.toContain("Consequence");
    const template = debriefTemplate(input);
    expect(template).toContain("loitering");
    expect(template).toContain("repeatedly checking doors");
  });

  it("gives each miss its consequence and notes an unwatched feed", () => {
    const input = debriefInput(
      report([
        event({
          behavior: "restrictedZone",
          cameraIds: ["cam5"],
          outcome: "missed-not-looking",
          flaggedAt: null,
          escaped: false,
        }),
        event({
          id: "b",
          behavior: "revisitingDoors",
          cameraIds: ["cam2"],
          outcome: "missed-looking",
          flaggedAt: null,
          escaped: false,
        }),
      ]),
      FEEDS,
    );
    const facts = debriefFacts(input);
    expect(facts).toContain("unauthorized access to the server room");
    expect(facts).toContain("Control was not watching camera 3.");
    expect(facts).toContain("a door found propped open");
    // Watching camera 2, so no "not watching" note for it.
    expect(facts).not.toContain("not watching camera 2");
    const template = debriefTemplate(input);
    expect(template).toContain("watching camera 3");
    expect(template).not.toContain("watching camera 2");
  });

  it("mentions false reports gently", () => {
    const input = debriefInput(report([event({})], 1), FEEDS);
    expect(debriefFacts(input)).toContain(
      "False reports (innocent people reported): 1.",
    );
    expect(debriefFacts(input)).toContain("gently");
    expect(debriefTemplate(input).toLowerCase()).toContain("one false report");
  });
});
