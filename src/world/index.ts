// Person 2: map, NPCs, and pathfinding. Talks to the rest of the game only
// through the event bus:
//   listens: sim:tick { dt, t }   (seconds)
//   emits:   world:map, world:snapshot, world:suspiciousStart,
//            world:suspiciousEnd, world:capture
import type { Emitter } from "mitt";
import { eventBus } from "../shared/eventBus";
import type {
  AppEvents,
  KnightStatus,
  SimTick,
  SuspiciousBehavior,
  Vec2,
} from "../shared/types";
import { buildMap } from "./map";
import { WorldSim, type SimOptions } from "./sim";

export { buildMap, cameraSpot } from "./map";
export { findPath } from "./pathfinding";

export interface WorldHandle {
  stop(): void;
  /** Debug/testing: force a suspicious NPC right now. Returns the NPC id. */
  spawnSuspicious(behavior: SuspiciousBehavior): string;
  /** Security caught this NPC (see WorldSim.detain). False if they already left. */
  detain(npcId: string): boolean;
  /**
   * Sends a knight after a report (see WorldSim.dispatchKnight). `spot` is
   * the tile to check when there's nobody to catch. Returns the knight's id.
   */
  dispatchKnight(target: { npcId: string | null; spot: Vec2 }): string;
  /** A knight's job, or null once they've left the building. */
  knightStatus(knightId: string): KnightStatus | null;
  /** The watch is over: nobody new walks in. */
  stopSpawning(): void;
}

let current: WorldHandle | null = null;

/**
 * Start the world. Emits world:map immediately, so subscribe to it first.
 * Calling again stops the previous world.
 */
export function startWorld(
  opts: SimOptions & { bus?: Emitter<AppEvents> } = {},
): WorldHandle {
  current?.stop();
  const bus = opts.bus ?? eventBus;
  const sim = new WorldSim(
    buildMap(),
    {
      onStart: (ev) => bus.emit("world:suspiciousStart", ev),
      onEnd: (ev) => bus.emit("world:suspiciousEnd", ev),
      onCapture: (ev) => bus.emit("world:capture", ev),
    },
    opts,
  );

  const onTick = ({ dt, t }: SimTick) => {
    sim.update(dt, t);
    bus.emit("world:snapshot", sim.snapshot());
  };
  bus.on("sim:tick", onTick);
  bus.emit("world:map", sim.map);

  const handle: WorldHandle = {
    stop() {
      bus.off("sim:tick", onTick);
      if (current === handle) current = null;
    },
    spawnSuspicious: (b) => sim.spawnSuspicious(b),
    detain: (npcId) => sim.detain(npcId),
    dispatchKnight: (target) => sim.dispatchKnight(target),
    knightStatus: (knightId) => sim.knightStatus(knightId),
    stopSpawning: () => sim.stopSpawning(),
  };
  current = handle;
  return handle;
}
