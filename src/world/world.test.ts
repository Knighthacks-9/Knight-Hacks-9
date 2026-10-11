import mitt from "mitt";
import { describe, expect, it } from "vitest";
import type {
  AppEvents,
  CaptureEvent,
  WorldEvent,
  WorldMap,
  WorldSnapshot,
} from "../shared/types";
import { startWorld } from "./index";
import { buildMap, EXITS, idx, isWalkable } from "./map";
import { findPath } from "./pathfinding";
import { DETAIN_SECONDS, KNIGHT_GIVE_UP_SECONDS } from "./sim";

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

describe("detain", () => {
  it("ends the event, holds the NPC still, then leads them out", () => {
    const bus = mitt<AppEvents>();
    const starts: WorldEvent[] = [];
    const ends: WorldEvent[] = [];
    let last: WorldSnapshot | undefined;
    bus.on("world:suspiciousStart", (e) => starts.push(e));
    bus.on("world:suspiciousEnd", (e) => ends.push(e));
    bus.on("world:snapshot", (s) => (last = s));
    const world = startWorld({
      bus,
      seed: 9,
      shiftSeconds: 600,
      anomalyCount: 0,
    });
    const id = world.spawnSuspicious("loitering");
    const dt = 1 / 10;
    let t = 0;
    while (!starts.some((s) => s.npcId === id) && t < 120)
      bus.emit("sim:tick", { dt, t: (t += dt) });
    expect(starts.some((s) => s.npcId === id)).toBe(true);

    expect(world.detain(id)).toBe(true);
    expect(ends.some((e) => e.npcId === id)).toBe(true);
    bus.emit("sim:tick", { dt, t: (t += dt) });
    const held = last!.npcs.find((n) => n.id === id)!;
    expect(held.suspicious).toBe(false);
    for (let i = 0; i < 30; i++) bus.emit("sim:tick", { dt, t: (t += dt) });
    const later = last!.npcs.find((n) => n.id === id)!;
    expect([later.x, later.y, later.moving]).toEqual([held.x, held.y, false]);

    for (let i = 0; i < DETAIN_SECONDS / dt + 5; i++)
      bus.emit("sim:tick", { dt, t: (t += dt) });
    expect(last!.npcs.some((n) => n.id === id)).toBe(false);
    expect(world.detain(id)).toBe(false);
    world.stop();
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

describe("shift options", () => {
  function run(opts: { anomalyCount?: number; spawnRate?: number }) {
    const bus = mitt<AppEvents>();
    const suspects = new Set<string>();
    let peak = 0;
    bus.on("world:suspiciousStart", (e) => suspects.add(e.npcId));
    bus.on("world:snapshot", (s) => (peak = Math.max(peak, s.npcs.length)));
    const world = startWorld({ bus, seed: 5, shiftSeconds: 200, ...opts });
    const dt = 1 / 10;
    for (let t = dt; t <= 400; t += dt) bus.emit("sim:tick", { dt, t });
    world.stop();
    return { suspects: suspects.size, peak };
  }

  it("schedules exactly the requested number of anomalies", () => {
    expect(run({ anomalyCount: 1 }).suspects).toBe(1);
    expect(run({ anomalyCount: 7 }).suspects).toBe(7);
  });

  it("fills the building faster at a higher spawn rate", () => {
    expect(run({ spawnRate: 1.75 }).peak).toBeGreaterThan(
      run({ spawnRate: 0.5 }).peak,
    );
  });
});

describe("acting", () => {
  it("is only set during the visible part of a suspicious behavior", () => {
    const bus = mitt<AppEvents>();
    let sawWalkUp = false;
    let sawActing = false;
    let actingOutside = false;
    bus.on("world:snapshot", (s) => {
      for (const n of s.npcs) {
        if (n.acting) sawActing = true;
        if (n.acting && !n.suspicious) actingOutside = true;
        if (n.suspicious && !n.acting) sawWalkUp = true;
      }
    });
    const world = startWorld({
      bus,
      seed: 4,
      shiftSeconds: 600,
      anomalyCount: 0,
    });
    // Door checks have walks between stops; avoiding cameras a walk in.
    world.spawnSuspicious("revisitingDoors");
    world.spawnSuspicious("avoidingCameras");
    const dt = 1 / 10;
    for (let t = dt; t <= 120; t += dt) bus.emit("sim:tick", { dt, t });
    world.stop();
    expect(sawActing).toBe(true);
    expect(sawWalkUp).toBe(true);
    expect(actingOutside).toBe(false);
  });
});

describe("knights", () => {
  function setup(seed = 9) {
    const bus = mitt<AppEvents>();
    const captures: CaptureEvent[] = [];
    let last: WorldSnapshot | undefined;
    bus.on("world:capture", (e) => captures.push(e));
    bus.on("world:snapshot", (s) => (last = s));
    const world = startWorld({ bus, seed, shiftSeconds: 600, anomalyCount: 0 });
    const dt = 1 / 10;
    let t = 0;
    const tick = (seconds: number) => {
      for (let i = 0; i < seconds / dt; i++)
        bus.emit("sim:tick", { dt, t: (t += dt) });
    };
    return { world, captures, tick, snapshot: () => last! };
  }

  it("catches a loiterer, holds them, and leads them out", () => {
    const { world, captures, tick, snapshot } = setup();
    world.stopSpawning();
    const id = world.spawnSuspicious("loitering");
    tick(20); // walk to the spot and start loitering
    const knight = world.dispatchKnight({ npcId: id, spot: { x: 6, y: 18 } });
    expect(world.knightStatus(knight)).toMatchObject({
      phase: "en_route",
      outcome: null,
    });
    tick(KNIGHT_GIVE_UP_SECONDS);
    expect(captures).toEqual([
      expect.objectContaining({
        knightId: knight,
        npcId: id,
        outcome: "caught",
      }),
    ]);
    const held = snapshot().npcs.find((n) => n.id === id);
    // Either still held, or already led out of the building.
    if (held) expect(held.detained).toBe(true);
    tick(60);
    expect(snapshot().npcs.some((n) => n.id === id)).toBe(false);
    expect(world.knightStatus(knight)).toBeNull();
    world.stop();
  });

  it("reports an escape when the person leaves before the knight arrives", () => {
    const { world, captures, tick } = setup(2);
    world.stopSpawning();
    const id = world.spawnSuspicious("loitering");
    // Reported far too late: the person has already walked out.
    tick(200);
    const late = world.dispatchKnight({ npcId: id, spot: { x: 6, y: 18 } });
    tick(1);
    expect(captures).toEqual([
      expect.objectContaining({
        knightId: late,
        npcId: id,
        outcome: "escaped",
      }),
    ]);
    expect(world.knightStatus(late)).toMatchObject({ phase: "leaving" });
    world.stop();
  });

  it("checks the spot and leaves when the report pointed at nobody", () => {
    const { world, captures, tick } = setup();
    world.stopSpawning();
    const knight = world.dispatchKnight({
      npcId: null,
      spot: { x: 20, y: 12 },
    });
    tick(KNIGHT_GIVE_UP_SECONDS);
    expect(captures).toEqual([
      expect.objectContaining({
        knightId: knight,
        npcId: null,
        outcome: "nothing",
      }),
    ]);
    tick(60);
    expect(world.knightStatus(knight)).toBeNull();
    world.stop();
  });

  it("doesn't count knights toward the crowd", () => {
    const { world, tick, snapshot } = setup();
    for (let i = 0; i < 6; i++)
      world.dispatchKnight({ npcId: null, spot: { x: 20, y: 12 } });
    tick(1);
    const knights = snapshot().npcs.filter((n) => n.role === "knight");
    expect(knights).toHaveLength(6);
    tick(10);
    expect(
      snapshot().npcs.filter((n) => n.role !== "knight").length,
    ).toBeGreaterThan(0);
    world.stop();
  });
});
