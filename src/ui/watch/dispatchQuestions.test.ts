import { describe, expect, it } from "vitest";
import type { WorldSnapshot } from "../../shared/types";
import {
  QuestionWindow,
  feedCounts,
  isSightingReport,
  parseAnswer,
  pickQuestion,
  type DispatchQuestion,
} from "./dispatchQuestions";

const FEEDS = [
  { id: "cam1", location: "Lobby" },
  { id: "cam2", location: "Server Room" },
  { id: "cam3", location: "Hallway" },
];

const question = (
  kind: DispatchQuestion["kind"],
  camera: number | null = null,
): DispatchQuestion => ({ kind, camera, headline: "", text: "" });

describe("dispatch questions", () => {
  it("counts the people each feed sees", () => {
    const npc = (id: string, cameraIds: string[]) => ({
      id,
      x: 0,
      y: 0,
      facingDeg: 0,
      moving: false,
      color: 0,
      cameraIds,
    });
    const snapshot: WorldSnapshot = {
      t: 0,
      npcs: [npc("a", ["cam1"]), npc("b", ["cam1", "cam3"])],
    };
    expect(feedCounts(snapshot, FEEDS)).toEqual([2, 0, 1]);
    expect(feedCounts(null, FEEDS)).toEqual([0, 0, 0]);
  });

  it("only asks for a busiest or empty camera when one exists", () => {
    for (let i = 0; i < 20; i++) {
      const kind = pickQuestion(FEEDS, [0, 0, 0], () => i / 20).kind;
      expect(["count", "occupied"]).toContain(kind);
    }
    const kinds = new Set(
      Array.from(
        { length: 20 },
        (_, i) => pickQuestion(FEEDS, [2, 0, 1], () => i / 20).kind,
      ),
    );
    expect(kinds).toEqual(new Set(["count", "occupied", "busiest", "empty"]));
  });

  it("names the camera it asks about", () => {
    const asked = pickQuestion(FEEDS, [0, 0, 0], () => 0.5);
    expect(asked.camera).toBe(2);
    expect(asked.text).toContain("camera 2");
  });

  it("tells answers apart from sighting reports", () => {
    expect(isSightingReport("Camera 3, sighting")).toBe(true);
    expect(isSightingReport("camera three")).toBe(false);
    expect(isSightingReport("two people")).toBe(false);
  });

  it("reads counts, yes/no and cameras", () => {
    const count = question("count", 2);
    expect(parseAnswer(count, "three", 3)).toEqual({
      kind: "number",
      value: 3,
    });
    expect(parseAnswer(count, "Camera 2 has two people", 3)).toEqual({
      kind: "number",
      value: 2,
    });
    expect(parseAnswer(count, "no one", 3)).toEqual({
      kind: "number",
      value: 0,
    });
    expect(parseAnswer(count, "hmm", 3)).toBeNull();

    const occupied = question("occupied", 1);
    expect(parseAnswer(occupied, "yes", 3)).toEqual({
      kind: "yesno",
      value: true,
    });
    expect(parseAnswer(occupied, "no people", 3)).toEqual({
      kind: "yesno",
      value: false,
    });

    expect(parseAnswer(question("busiest"), "camera three", 3)).toEqual({
      kind: "camera",
      value: 3,
    });
    expect(parseAnswer(question("empty"), "camera 7", 3)).toBeNull();
  });

  it("accepts any count seen while the question was open", () => {
    const open = new QuestionWindow(question("count", 1), 3);
    open.observe([2, 0, 1]);
    open.observe([3, 0, 1]);
    expect(open.grade({ kind: "number", value: 2 }).correct).toBe(true);
    expect(open.grade({ kind: "number", value: 3 }).correct).toBe(true);
    const wrong = open.grade({ kind: "number", value: 5 });
    expect(wrong.correct).toBe(false);
    expect(wrong.reply).toContain("3 people on camera 1");
  });

  it("grades yes/no, busiest and empty answers", () => {
    const occupied = new QuestionWindow(question("occupied", 2), 3);
    occupied.observe([2, 0, 1]);
    expect(occupied.grade({ kind: "yesno", value: false }).correct).toBe(true);
    expect(occupied.grade({ kind: "yesno", value: true }).correct).toBe(false);

    const busiest = new QuestionWindow(question("busiest"), 3);
    busiest.observe([2, 0, 2]);
    expect(busiest.grade({ kind: "camera", value: 3 }).correct).toBe(true);
    expect(busiest.grade({ kind: "camera", value: 2 }).correct).toBe(false);

    const empty = new QuestionWindow(question("empty"), 3);
    empty.observe([2, 0, 1]);
    expect(empty.grade({ kind: "camera", value: 2 }).correct).toBe(true);
    expect(empty.grade({ kind: "camera", value: 1 }).reply).toContain(
      "2 people on camera 1",
    );
  });
});
