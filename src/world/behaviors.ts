import type { Room, SuspiciousBehavior, Vec2, WorldMap } from "../shared/types";
import { DOORS, EXITS, isWalkable } from "./map";
import type { Rng } from "./rng";

/**
 * An NPC follows a plan: a list of steps. Steps tagged with a behavior are
 * the suspicious window; the sim emits world:suspiciousStart when the first
 * tagged step begins and world:suspiciousEnd when the tagged run finishes.
 */
export type Step =
  | { kind: "walk"; to: Vec2; avoidCameras?: boolean; tag?: SuspiciousBehavior }
  | { kind: "wait"; seconds: number; tag?: SuspiciousBehavior };

export interface Plan {
  spawn: Vec2;
  speed: number;
  steps: Step[];
}

export const SUSPICIOUS_BEHAVIORS: SuspiciousBehavior[] = [
  "loitering",
  "revisitingDoors",
  "restrictedZone",
  "avoidingCameras",
];

function room(map: WorldMap, name: string): Room {
  return map.rooms.find((r) => r.name === name)!;
}

function pointIn(map: WorldMap, r: Room, rng: Rng): Vec2 {
  for (;;) {
    const p = { x: r.x + rng.int(0, r.w - 1), y: r.y + rng.int(0, r.h - 1) };
    if (isWalkable(map, p.x, p.y)) return p;
  }
}

function near(map: WorldMap, p: Vec2, rng: Rng): Vec2 {
  for (let tries = 0; tries < 20; tries++) {
    const q = { x: p.x + rng.int(-2, 2), y: p.y + rng.int(-2, 2) };
    if (
      isWalkable(map, q.x, q.y) &&
      map.tiles[q.y * map.width + q.x] !== "exit"
    )
      return q;
  }
  return p;
}

const PUBLIC_ROOMS = ["Office A", "Office B", "Break Room", "Lobby", "Storage"];

export function normalPlan(map: WorldMap, rng: Rng): Plan {
  const steps: Step[] = [];
  const visits = rng.int(2, 3);
  for (let i = 0; i < visits; i++) {
    steps.push({
      kind: "walk",
      to: pointIn(map, room(map, rng.pick(PUBLIC_ROOMS)), rng),
    });
    steps.push({ kind: "wait", seconds: rng.range(2, 7) });
  }
  steps.push({ kind: "walk", to: rng.pick(EXITS) });
  return { spawn: rng.pick(EXITS), speed: rng.range(1.8, 2.6), steps };
}

export function suspiciousPlan(
  map: WorldMap,
  rng: Rng,
  behavior: SuspiciousBehavior,
): Plan {
  const tag = behavior;
  const spawn = rng.pick(EXITS);
  const steps: Step[] = [];

  switch (behavior) {
    case "loitering": {
      const spot = pointIn(
        map,
        room(map, rng.pick(["Lobby", "Hallway", "Storage"])),
        rng,
      );
      steps.push({ kind: "walk", to: spot });
      for (let i = 0; i < 3; i++) {
        steps.push({ kind: "wait", seconds: rng.range(7, 11), tag });
        steps.push({ kind: "walk", to: near(map, spot, rng), tag });
      }
      break;
    }
    case "revisitingDoors": {
      const door = rng.pick(DOORS);
      const hall = room(map, "Hallway");
      steps.push({ kind: "walk", to: door });
      for (let i = 0; i < 3; i++) {
        steps.push({ kind: "wait", seconds: rng.range(1.5, 3), tag });
        steps.push({ kind: "walk", to: pointIn(map, hall, rng), tag });
        steps.push({ kind: "wait", seconds: rng.range(2, 4), tag });
        steps.push({ kind: "walk", to: door, tag });
      }
      break;
    }
    case "restrictedZone": {
      const serverDoor = DOORS[2];
      steps.push({ kind: "walk", to: serverDoor });
      steps.push({
        kind: "walk",
        to: pointIn(map, room(map, "Server Room"), rng),
        tag,
      });
      steps.push({ kind: "wait", seconds: rng.range(6, 10), tag });
      steps.push({
        kind: "walk",
        to: pointIn(map, room(map, "Server Room"), rng),
        tag,
      });
      steps.push({ kind: "wait", seconds: rng.range(3, 6), tag });
      steps.push({ kind: "walk", to: serverDoor, tag });
      break;
    }
    case "avoidingCameras": {
      const target = pointIn(
        map,
        room(map, rng.pick(["Office A", "Break Room", "Storage"])),
        rng,
      );
      steps.push({ kind: "walk", to: target, avoidCameras: true, tag });
      steps.push({ kind: "wait", seconds: rng.range(4, 8), tag });
      steps.push({
        kind: "walk",
        to: rng.pick(EXITS),
        avoidCameras: true,
        tag,
      });
      break;
    }
  }

  // Leave the building (the avoidingCameras plan already ends at an exit).
  if (behavior !== "avoidingCameras")
    steps.push({ kind: "walk", to: rng.pick(EXITS) });
  return { spawn, speed: rng.range(1.6, 2.2), steps };
}
