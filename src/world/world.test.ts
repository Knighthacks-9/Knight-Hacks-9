import mitt from "mitt";
import { describe, expect, it } from "vitest";
import type {
  AppEvents,
  WorldEvent,
  WorldMap,
  WorldSnapshot,
} from "../shared/types";
import { startWorld } from "./index";
import { buildMap, EXITS, idx, isWalkable } from "./map";
import { findPath } from "./pathfinding";

describe("world map", () => {
  const map = buildMap();

  it("has every camera seeing some floor", () => {
    expect(map.tiles).toHaveLength(map.width * map.height);
    for (const cam of map.cameras)
      expect(cam.visibleTiles.length).toBeGreaterThan(10);
  });

  it("never shows the same hallway tile on both hall cameras", () => {
    const cam = (id: string) => map.cameras.find((c) => c.id === id)!;
    const east = new Set(cam("cam3").visibleTiles);
    expect(cam("cam2").visibleTiles.filter((i) => east.has(i))).toEqual([]);
  });

  it("limits cameras 4, 5 and 6 to a 9x9 square", () => {
    for (const id of ["cam4", "cam5", "cam6"]) {
      const tiles = map.cameras.find((c) => c.id === id)!.visibleTiles;
      const xs = tiles.map((i) => i % map.width);
      const ys = tiles.map((i) => Math.floor(i / map.width));
      expect(Math.max(...xs) - Math.min(...xs) + 1).toBe(9);
      expect(Math.max(...ys) - Math.min(...ys) + 1).toBe(9);
    }
  });

  it("connects both exits to every room", () => {
    for (const exit of EXITS) {
      for (const r of map.rooms) {
        expect(findPath(map, exit, { x: r.x + 1, y: r.y + 1 })).not.toBeNull();
      }
    }
  });
});

describe("A* pathfinding", () => {
  const map = buildMap();

  it("returns a contiguous walkable path", () => {
    const path = findPath(map, EXITS[0], { x: 33, y: 5 })!;
    expect(path[0]).toEqual(EXITS[0]);
    expect(path.at(-1)).toEqual({ x: 33, y: 5 });
    for (let i = 1; i < path.length; i++) {
      const d =
        Math.abs(path[i].x - path[i - 1].x) +
        Math.abs(path[i].y - path[i - 1].y);
      expect(d).toBe(1);
      expect(isWalkable(map, path[i].x, path[i].y)).toBe(true);
    }
  });

  it("returns null for a wall goal", () => {
    expect(findPath(map, EXITS[0], { x: 0, y: 0 })).toBeNull();
  });

  it("sees fewer camera tiles when avoiding cameras", () => {
    const seen = new Set(map.cameras.flatMap((c) => c.visibleTiles));
    const cost = (i: number) => (seen.has(i) ? 25 : 0);
    const count = (p: { x: number; y: number }[]) =>
      p.filter((v) => seen.has(idx(map, v.x, v.y))).length;
    const goal = { x: 3, y: 3 };
    const plain = findPath(map, EXITS[1], goal)!;
    const sneaky = findPath(map, EXITS[1], goal, cost)!;
    expect(count(sneaky)).toBeLessThanOrEqual(count(plain));
  });
});

describe("startWorld", () => {
  it("emits the map, snapshots, and paired suspicious events over a shift", () => {
    const bus = mitt<AppEvents>();
    let map: WorldMap | undefined;
    let last: WorldSnapshot | undefined;
    const starts: WorldEvent[] = [];
    const ends: WorldEvent[] = [];
    bus.on("world:map", (m) => (map = m));
    let sawSuspicious = false;
    bus.on("world:snapshot", (s) => {
      last = s;
      if (s.npcs.some((n) => n.suspicious)) sawSuspicious = true;
    });
    bus.on("world:suspiciousStart", (e) => starts.push(e));
    bus.on("world:suspiciousEnd", (e) => ends.push(e));

    const world = startWorld({ bus, seed: 42, shiftSeconds: 240 });
    expect(map).toBeDefined();

    const dt = 1 / 30;
    for (let t = dt; t <= 400; t += dt) bus.emit("sim:tick", { dt, t });
    world.stop();

    expect(last).toBeDefined();
    expect(sawSuspicious).toBe(true);
    expect(starts.length).toBeGreaterThanOrEqual(4);
    expect(new Set(starts.map((s) => s.behavior)).size).toBe(4);
    expect(ends.map((e) => e.id).sort()).toEqual(
      starts.map((s) => s.id).sort(),
    );
    for (const s of starts) {
      const e = ends.find((x) => x.id === s.id)!;
      expect(e.t).toBeGreaterThan(s.t);
    }
    // Shift is over and everyone has left.
    expect(last!.npcs).toHaveLength(0);
  });
});

describe("short shifts", () => {
  it("spreads suspicious events across a 30 second shift", () => {
    const bus = mitt<AppEvents>();
    const starts: WorldEvent[] = [];
    bus.on("world:suspiciousStart", (e) => starts.push(e));
    const world = startWorld({ bus, seed: 3, shiftSeconds: 30 });
    const dt = 1 / 30;
    for (let t = dt; t <= 30; t += dt) bus.emit("sim:tick", { dt, t });
    world.stop();

    expect(starts.length).toBeGreaterThanOrEqual(3);
    const times = starts.map((s) => s.t);
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(5);
  });
});
