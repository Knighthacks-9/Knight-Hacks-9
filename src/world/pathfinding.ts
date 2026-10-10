import type { Vec2, WorldMap } from "../shared/types";
import { idx, isWalkable } from "./map";

/** Extra cost for entering a tile (on top of 1). Used to make NPCs avoid cameras. */
export type ExtraCost = (tileIndex: number) => number;

const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * A* over the tile grid (4-directional, Manhattan heuristic).
 * Returns tiles from start to goal inclusive, or null if unreachable.
 */
export function findPath(
  map: WorldMap,
  start: Vec2,
  goal: Vec2,
  extraCost?: ExtraCost,
): Vec2[] | null {
  if (!isWalkable(map, start.x, start.y) || !isWalkable(map, goal.x, goal.y))
    return null;

  const n = map.width * map.height;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (x: number, y: number) =>
    Math.abs(x - goal.x) + Math.abs(y - goal.y);

  const startI = idx(map, start.x, start.y);
  const goalI = idx(map, goal.x, goal.y);
  g[startI] = 0;
  const open = new MinHeap();
  open.push(startI, h(start.x, start.y));

  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goalI) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % map.width;
    const cy = (cur - cx) / map.width;
    for (const d of DIRS) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (!isWalkable(map, nx, ny)) continue;
      const ni = idx(map, nx, ny);
      if (closed[ni]) continue;
      const cost = g[cur] + 1 + (extraCost ? extraCost(ni) : 0);
      if (cost < g[ni]) {
        g[ni] = cost;
        came[ni] = cur;
        open.push(ni, cost + h(nx, ny));
      }
    }
  }

  if (g[goalI] === Infinity) return null;
  const path: Vec2[] = [];
  for (let i = goalI; i !== -1; i = came[i]) {
    path.push({ x: i % map.width, y: Math.floor(i / map.width) });
  }
  return path.reverse();
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, p: number): void {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastPrio = this.prio.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.items.length && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}
