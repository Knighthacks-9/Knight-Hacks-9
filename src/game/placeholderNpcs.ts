// TODO: Replace with the world module's NPC feed once it exists (Person 2).
export interface PlaceholderNpc {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function spawnPlaceholderNpcs(
  cameraId: number,
  count: number,
  w: number,
  h: number,
) {
  return Array.from({ length: count }, (_, i): PlaceholderNpc => {
    const angle = Math.random() * Math.PI * 2;
    return {
      id: `cam${cameraId}-npc${i}`,
      x: 20 + Math.random() * (w - 40),
      y: 20 + Math.random() * (h - 40),
      vx: Math.cos(angle) * 20,
      vy: Math.sin(angle) * 20,
    };
  });
}

export function stepPlaceholderNpcs(
  npcs: PlaceholderNpc[],
  dt: number,
  w: number,
  h: number,
) {
  for (const n of npcs) {
    n.x += n.vx * dt;
    n.y += n.vy * dt;
    if (n.x < 10 || n.x > w - 10) n.vx = -n.vx;
    if (n.y < 10 || n.y > h - 10) n.vy = -n.vy;
  }
}
