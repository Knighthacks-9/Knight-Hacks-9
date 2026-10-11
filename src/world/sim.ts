import type {
  CameraDef,
  CaptureEvent,
  KnightOutcome,
  KnightStatus,
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
import { EXITS, idx } from "./map";
import { findPath } from "./pathfinding";
import { Rng } from "./rng";

const CAMERA_AVOID_COST = 25;
const MAX_NORMAL_NPCS = 8;
/** NPCs that spawn ~1s apart at the start of a shift, before the normal pace. */
const QUICK_START_NPCS = 4;
/** How long a detained NPC is held in place before being escorted out. */
export const DETAIN_SECONDS = 10;

/** Knights walk faster than anyone in the building (1.6 to 2.6). */
export const KNIGHT_SPEED = 3.4;
/** A knight this close (tiles) to the person has caught them. */
const KNIGHT_REACH = 1.1;
/** How often a knight re-plans the route to a moving person. */
const KNIGHT_REPATH_SECONDS = 0.5;
/** A knight who hasn't reached the person by now reports them escaped. */
export const KNIGHT_GIVE_UP_SECONDS = 30;
/** A caught person is held this long before the knight leads them out. */
export const CAPTURE_HOLD_SECONDS = 3;
/** A knight sent to an empty report looks around this long. */
export const SEARCH_SECONDS = 3;
/** The front entrance, where knights come in. */
const KNIGHT_POST = EXITS[0];

const SHIRT_COLORS = [
  0x4f81bd, 0xc0504d, 0x9bbb59, 0x8064a2, 0x4bacc6, 0xf79646, 0xd9d9d9,
  0x7f6000,
];

export interface SimOptions {
  seed?: number;
  /** Shift length in seconds. Suspicious events are spread across it. */
  shiftSeconds?: number;
  /** Suspicious events to schedule. Defaults to one per ~40s, at least 3. */
  anomalyCount?: number;
  /** Multiplier on the walk-in pace and crowd size. 1 is the normal pace. */
  spawnRate?: number;
}

export interface SimListener {
  onStart(ev: WorldEvent): void;
  onEnd(ev: WorldEvent): void;
  /** A knight's job reached its outcome. */
  onCapture?(ev: CaptureEvent): void;
}

/** What a knight was sent to do, and how far they've got. */
interface KnightJob extends KnightStatus {
  /** Where to look when there's nobody to chase (tile). */
  spot: Vec2;
  sentAt: number;
  repathAt: number;
  /** The tile the knight is currently heading for. */
  goal: Vec2 | null;
  /** Where the person was last seen (tile), for when they get away. */
  lastSeen: Vec2 | null;
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
  /** Caught: held, then led out. */
  detained?: boolean;
  /** Set on knights. */
  job?: KnightJob;
  done: boolean;
}

const tileOf = (n: { x: number; y: number }): Vec2 => ({
  x: Math.floor(n.x),
  y: Math.floor(n.y),
});

function nearestExit(from: Vec2): Vec2 {
  return EXITS.reduce((best, e) =>
    Math.abs(e.x - from.x) + Math.abs(e.y - from.y) <
    Math.abs(best.x - from.x) + Math.abs(best.y - from.y)
      ? e
      : best,
  );
}

export class WorldSim {
  readonly map: WorldMap;
  private rng: Rng;
  private npcs: Npc[] = [];
  private nextNpc = 1;
  private nextKnight = 1;
  private nextEvent = 1;
  private t = 0;
  private nextNormalAt = 0;
  private normalsSpawned = 0;
  private shiftSeconds: number;
  private anomalyCount: number;
  private spawnRate: number;
  /** False once the watch is over: nobody new walks in. */
  private spawning = true;
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
    this.anomalyCount =
      opts.anomalyCount ?? Math.max(3, Math.round(this.shiftSeconds / 40));
    this.spawnRate = Math.max(0.1, opts.spawnRate ?? 1);
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
    const count = this.anomalyCount;
    const start = Math.min(15, this.shiftSeconds * 0.1);
    // Leave time at the end to finish each event. Unchanged (60s) for shifts
    // of 90s or more; on shorter ones half the shift, since NPCs need time
    // to walk to their spot before the suspicious part begins.
    const s = this.shiftSeconds;
    const endMargin = Math.min(60, Math.max(s - 30, s * 0.5));
    const usable = Math.max(1, this.shiftSeconds - start - endMargin);
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
    const s = this.shiftSeconds;
    // Stop spawning walk-ins near the end (20s, less on very short shifts).
    if (this.spawning && t < s - Math.min(20, Math.max(s - 70, s * 0.3))) {
      if (t >= this.nextNormalAt) {
        const alive = this.npcs.filter((n) => !n.job).length;
        if (alive < Math.round(MAX_NORMAL_NPCS * this.spawnRate)) {
          this.spawn(normalPlan(this.map, this.rng));
          this.normalsSpawned++;
        }
        // The first few arrive quickly so the feeds aren't empty at the start.
        this.nextNormalAt =
          this.normalsSpawned < QUICK_START_NPCS
            ? t + this.rng.range(0.75, 1.5)
            : t + this.rng.range(4, 9) / this.spawnRate;
      }
    }
    while (
      this.spawning &&
      this.schedule.length > 0 &&
      this.schedule[0].at <= t
    ) {
      this.spawnSuspicious(this.schedule.shift()!.behavior);
    }
    for (const npc of this.npcs) {
      if (npc.job) this.updateKnight(npc, dt);
      else this.step(npc, dt);
    }
    this.npcs = this.npcs.filter((n) => !n.done);
  }

  /** The watch is over: no more walk-ins or scheduled suspects. */
  stopSpawning(): void {
    this.spawning = false;
  }

  spawnSuspicious(behavior: SuspiciousBehavior): string {
    return this.spawn(suspiciousPlan(this.map, this.rng, behavior));
  }

  /**
   * Security caught this NPC: any suspicious event ends now, they stop where
   * they are, and they're escorted out (removed) after DETAIN_SECONDS.
   * Returns false when the NPC has already left.
   */
  detain(npcId: string): boolean {
    const npc = this.npcs.find((n) => n.id === npcId && !n.done && !n.job);
    if (!npc) return false;
    if (npc.active) this.closeEvent(npc);
    npc.detained = true;
    this.setSteps(npc, [{ kind: "wait", seconds: DETAIN_SECONDS }]);
    return true;
  }

  /**
   * Sends a knight in from the front entrance. With a person to catch, the
   * knight chases them, holds them, then leads them out; if they leave the
   * building first they've escaped. With nobody (npcId null), the knight
   * checks `spot` (a tile) and leaves. Returns the knight's id.
   */
  dispatchKnight(target: { npcId: string | null; spot: Vec2 }): string {
    const id = `knight${this.nextKnight++}`;
    const knight: Npc = {
      id,
      x: KNIGHT_POST.x + 0.5,
      y: KNIGHT_POST.y + 0.5,
      facingDeg: -90,
      speed: KNIGHT_SPEED,
      color: 0xc8d0d8,
      steps: [],
      stepIndex: 0,
      path: [],
      pathIndex: 0,
      waitLeft: 0,
      job: {
        targetId: target.npcId,
        phase: "en_route",
        outcome: null,
        spot: target.spot,
        sentAt: this.t,
        repathAt: this.t,
        goal: null,
        lastSeen: null,
      },
      done: false,
    };
    this.npcs.push(knight);
    return id;
  }

  /** A knight's job, or null once they've left the building. */
  knightStatus(knightId: string): KnightStatus | null {
    const job = this.npcs.find((n) => n.id === knightId)?.job;
    return job
      ? { targetId: job.targetId, phase: job.phase, outcome: job.outcome }
      : null;
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

  /** Replaces what an NPC is doing with `steps`, starting now. */
  private setSteps(npc: Npc, steps: Step[]): void {
    npc.steps = steps;
    npc.stepIndex = -1;
    npc.path = [];
    npc.pathIndex = 0;
    npc.waitLeft = 0;
    this.advance(npc);
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
    const from = tileOf(npc);
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
      budget = this.moveToward(npc, budget);
    }
  }

  /** Walks toward the next tile on the path; returns the unused time. */
  private moveToward(npc: Npc, budget: number): number {
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
      return budget - dist / npc.speed;
    }
    npc.x += (dx / dist) * move;
    npc.y += (dy / dist) * move;
    return 0;
  }

  private updateKnight(knight: Npc, dt: number): void {
    const job = knight.job!;
    if (job.phase !== "en_route") {
      // Holding, searching, or walking out: an ordinary plan.
      this.step(knight, dt);
      if (job.phase === "on_scene" && knight.stepIndex >= 1) {
        // The hold or the search is over.
        if (job.outcome === null) this.settle(knight, "nothing");
        job.phase = "leaving";
      }
      return;
    }

    const target = job.targetId
      ? this.npcs.find((n) => n.id === job.targetId && !n.done)
      : undefined;
    if (job.targetId && !target) return this.giveUp(knight, "escaped");
    if (this.t - job.sentAt > KNIGHT_GIVE_UP_SECONDS) {
      return this.giveUp(knight, job.targetId ? "escaped" : "nothing");
    }
    if (target) job.lastSeen = tileOf(target);

    const goalCenter = target ?? { x: job.spot.x + 0.5, y: job.spot.y + 0.5 };
    if (
      Math.hypot(goalCenter.x - knight.x, goalCenter.y - knight.y) <=
      KNIGHT_REACH
    ) {
      knight.facingDeg =
        (Math.atan2(goalCenter.y - knight.y, goalCenter.x - knight.x) * 180) /
        Math.PI;
      if (target) this.capture(knight, target);
      else {
        job.phase = "on_scene";
        this.setSteps(knight, [
          { kind: "wait", seconds: SEARCH_SECONDS },
          { kind: "walk", to: nearestExit(tileOf(knight)) },
        ]);
      }
      return;
    }

    // Chase: re-plan now and then, or when the person changes tiles.
    const goal = target ? tileOf(target) : job.spot;
    const moved = !job.goal || job.goal.x !== goal.x || job.goal.y !== goal.y;
    if (
      this.t >= job.repathAt ||
      (moved && knight.pathIndex >= knight.path.length)
    ) {
      job.repathAt = this.t + KNIGHT_REPATH_SECONDS;
      job.goal = goal;
      knight.steps = [{ kind: "walk", to: goal }];
      knight.stepIndex = 0;
      knight.path = findPath(this.map, tileOf(knight), goal) ?? [];
      knight.pathIndex = 1;
    }
    let budget = dt;
    for (
      let guard = 0;
      guard < 64 && budget > 0 && knight.pathIndex < knight.path.length;
      guard++
    ) {
      budget = this.moveToward(knight, budget);
    }
  }

  /** The knight reached the person: hold them, then lead them out together. */
  private capture(knight: Npc, target: Npc): void {
    const job = knight.job!;
    job.phase = "on_scene";
    this.settle(knight, "caught");
    if (target.active) this.closeEvent(target);
    target.detained = true;
    const exit = nearestExit(tileOf(target));
    // Walk out side by side, at the person's pace.
    knight.speed = target.speed;
    this.setSteps(target, [
      { kind: "wait", seconds: CAPTURE_HOLD_SECONDS },
      { kind: "walk", to: exit },
    ]);
    this.setSteps(knight, [
      { kind: "wait", seconds: CAPTURE_HOLD_SECONDS },
      { kind: "walk", to: exit },
    ]);
  }

  /** Nobody to catch any more: look where they were last seen, then leave. */
  private giveUp(knight: Npc, outcome: KnightOutcome): void {
    const job = knight.job!;
    this.settle(knight, outcome);
    job.phase = "leaving";
    const look = job.lastSeen ?? job.spot;
    this.setSteps(knight, [
      { kind: "walk", to: look },
      { kind: "wait", seconds: 1.5 },
      { kind: "walk", to: nearestExit(look) },
    ]);
  }

  private settle(knight: Npc, outcome: KnightOutcome): void {
    const job = knight.job!;
    if (job.outcome !== null) return;
    job.outcome = outcome;
    this.listener.onCapture?.({
      knightId: knight.id,
      npcId: job.targetId,
      t: this.t,
      outcome,
    });
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
      const snap: NpcSnapshot = {
        id: n.id,
        x: n.x,
        y: n.y,
        facingDeg: n.facingDeg,
        moving: step?.kind === "walk" && n.pathIndex < n.path.length,
        color: n.color,
        cameraIds: this.camerasSeeing(n.x, n.y),
        suspicious: n.active !== undefined,
        acting: n.active !== undefined && step?.act === true,
      };
      if (n.detained) snap.detained = true;
      if (n.job) {
        snap.role = "knight";
        snap.knight = {
          targetId: n.job.targetId,
          phase: n.job.phase,
          outcome: n.job.outcome,
        };
      }
      return snap;
    });
    return { t: this.t, npcs };
  }
}
