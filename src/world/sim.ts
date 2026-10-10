import type {
  CameraDef,
  NpcSnapshot,
  SuspiciousBehavior,
  Vec2,
  WorldEvent,
  WorldMap,
  WorldSnapshot,
} from "../shared/types";
import {
  normalPlan,
  suspiciousPlan,
  SUSPICIOUS_BEHAVIORS,
  type Plan,
  type Step,
} from "./behaviors";
import { idx } from "./map";
import { findPath } from "./pathfinding";
import { Rng } from "./rng";

const CAMERA_AVOID_COST = 25;
const MAX_NORMAL_NPCS = 8;
const SHIRT_COLORS = [
  0x4f81bd, 0xc0504d, 0x9bbb59, 0x8064a2, 0x4bacc6, 0xf79646, 0xd9d9d9,
  0x7f6000,
];

export interface SimOptions {
  seed?: number;
  /** Shift length in seconds. Suspicious events are spread across it. */
  shiftSeconds?: number;
}

export interface SimListener {
  onStart(ev: WorldEvent): void;
  onEnd(ev: WorldEvent): void;
}

interface Npc {
  id: string;
  x: number;
  y: number;
  facingDeg: number;
  speed: number;
  color: number;
  steps: Step[];
  stepIndex: number;
  path: Vec2[];
  pathIndex: number;
  waitLeft: number;
  /** Open suspicious event, if the NPC is currently in a tagged step. */
  active?: { id: string; behavior: SuspiciousBehavior };
  done: boolean;
}

export class WorldSim {
  readonly map: WorldMap;
  private rng: Rng;
  private npcs: Npc[] = [];
  private nextNpc = 1;
  private nextEvent = 1;
  private t = 0;
  private nextNormalAt = 0;
  private shiftSeconds: number;
  private schedule: { at: number; behavior: SuspiciousBehavior }[];
  private camSets: { cam: CameraDef; tiles: Set<number> }[];
  private seenAny: Uint8Array;

  constructor(
    map: WorldMap,
    private listener: SimListener,
    opts: SimOptions = {},
  ) {
    this.map = map;
    this.rng = new Rng(opts.seed ?? Date.now());
    this.shiftSeconds = opts.shiftSeconds ?? 300;
    this.camSets = map.cameras.map((cam) => ({
      cam,
      tiles: new Set(cam.visibleTiles),
    }));
    this.seenAny = new Uint8Array(map.width * map.height);
    for (const c of map.cameras)
      for (const i of c.visibleTiles) this.seenAny[i] = 1;
    this.schedule = this.buildSchedule();
  }

  /** Suspicious events spread across the shift, gaps shrinking toward the end. */
  private buildSchedule(): { at: number; behavior: SuspiciousBehavior }[] {
    const count = Math.max(3, Math.round(this.shiftSeconds / 40));
    const start = Math.min(15, this.shiftSeconds * 0.1);
    const usable = Math.max(1, this.shiftSeconds - start - 60);
    let order: SuspiciousBehavior[] = [];
    const out: { at: number; behavior: SuspiciousBehavior }[] = [];
    for (let i = 0; i < count; i++) {
      if (order.length === 0)
        order = this.rng.shuffle([...SUSPICIOUS_BEHAVIORS]);
      // sqrt spacing: more events packed into the later part of the shift.
      const frac = Math.sqrt((i + this.rng.range(0, 0.6)) / count);
      out.push({ at: start + frac * usable, behavior: order.pop()! });
    }
    return out.sort((a, b) => a.at - b.at);
  }

  get time(): number {
    return this.t;
  }

  update(dt: number, t: number): void {
    this.t = t;
    if (t < this.shiftSeconds - 20) {
      if (t >= this.nextNormalAt) {
        const alive = this.npcs.length;
        if (alive < MAX_NORMAL_NPCS)
          this.spawn(normalPlan(this.map, this.rng));
        this.nextNormalAt = t + this.rng.range(4, 9);
      }
    }
    while (this.schedule.length > 0 && this.schedule[0].at <= t) {
      this.spawnSuspicious(this.schedule.shift()!.behavior);
    }
    for (const npc of this.npcs) this.step(npc, dt);
    this.npcs = this.npcs.filter((n) => !n.done);
  }

  spawnSuspicious(behavior: SuspiciousBehavior): string {
    return this.spawn(suspiciousPlan(this.map, this.rng, behavior));
  }

  private spawn(plan: Plan): string {
    const npc: Npc = {
      id: `npc${this.nextNpc++}`,
      x: plan.spawn.x + 0.5,
      y: plan.spawn.y + 0.5,
      facingDeg: 0,
      speed: plan.speed,
      color: this.rng.pick(SHIRT_COLORS),
      steps: plan.steps,
      stepIndex: -1,
      path: [],
      pathIndex: 0,
      waitLeft: 0,
      done: false,
    };
    this.npcs.push(npc);
    this.advance(npc);
    return npc.id;
  }

  /** Move to the next plan step, opening/closing suspicious events as tags change. */
  private advance(npc: Npc): void {
    npc.stepIndex++;
    const step = npc.steps[npc.stepIndex];
    const tag = step?.tag;
    if (npc.active && npc.active.behavior !== tag) this.closeEvent(npc);
    if (tag && !npc.active) {
      npc.active = { id: `ev${this.nextEvent++}`, behavior: tag };
      this.listener.onStart(this.event(npc));
    }
    if (!step) {
      npc.done = true;
      return;
    }
    if (step.kind === "wait") {
      npc.waitLeft = step.seconds;
      return;
    }
    const from = { x: Math.floor(npc.x), y: Math.floor(npc.y) };
    const extra = step.avoidCameras
      ? (i: number) => (this.seenAny[i] ? CAMERA_AVOID_COST : 0)
      : undefined;
    const path = findPath(this.map, from, step.to, extra);
    npc.path = path ?? [];
    npc.pathIndex = 1; // index 0 is the tile we're standing on
  }

  private step(npc: Npc, dt: number): void {
    let budget = dt;
    // Loop so a big dt can finish several steps in one tick.
    for (let guard = 0; guard < 64 && budget > 0 && !npc.done; guard++) {
      const step = npc.steps[npc.stepIndex];
      if (step.kind === "wait") {
        const used = Math.min(budget, npc.waitLeft);
        npc.waitLeft -= used;
        budget -= used;
        if (npc.waitLeft <= 0) this.advance(npc);
        continue;
      }
      if (npc.pathIndex >= npc.path.length) {
        this.advance(npc);
        continue;
      }
      const target = npc.path[npc.pathIndex];
      const dx = target.x + 0.5 - npc.x;
      const dy = target.y + 0.5 - npc.y;
      const dist = Math.hypot(dx, dy);
      const move = npc.speed * budget;
      if (dist > 0) npc.facingDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (move >= dist) {
        npc.x = target.x + 0.5;
        npc.y = target.y + 0.5;
        npc.pathIndex++;
        budget -= dist / npc.speed;
      } else {
        npc.x += (dx / dist) * move;
        npc.y += (dy / dist) * move;
        budget = 0;
      }
    }
  }

  private closeEvent(npc: Npc): void {
    this.listener.onEnd(this.event(npc));
    npc.active = undefined;
  }

  private event(npc: Npc): WorldEvent {
    return {
      id: npc.active!.id,
      npcId: npc.id,
      behavior: npc.active!.behavior,
      t: this.t,
      x: npc.x,
      y: npc.y,
      cameraIds: this.camerasSeeing(npc.x, npc.y),
    };
  }

  camerasSeeing(x: number, y: number): string[] {
    const i = idx(this.map, Math.floor(x), Math.floor(y));
    return this.camSets.filter((c) => c.tiles.has(i)).map((c) => c.cam.id);
  }

  snapshot(): WorldSnapshot {
    const npcs: NpcSnapshot[] = this.npcs.map((n) => {
      const step = n.steps[n.stepIndex];
      return {
        id: n.id,
        x: n.x,
        y: n.y,
        facingDeg: n.facingDeg,
        moving: step?.kind === "walk" && n.pathIndex < n.path.length,
        color: n.color,
        cameraIds: this.camerasSeeing(n.x, n.y),
      };
    });
    return { t: this.t, npcs };
  }
}
