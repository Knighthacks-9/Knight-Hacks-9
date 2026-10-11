// Building layout overlay for the watch station: rooms, doors, exits and
// where each camera hangs. No NPCs on purpose, so it can't be used to see
// into blind spots. A MAP button toggles it over the camera grid.
import type { TileType, WorldMap } from "../../shared/types";
import { h } from "../dom";

const TILE = 12;
const COLORS: Record<TileType, string> = {
  wall: "#11161a",
  floor: "#55625a",
  door: "#9a7a3a",
  restricted: "#7a3a3a",
  exit: "#3b8a4a",
};
const CAMERA = "#44ccff";

export interface Minimap {
  button: HTMLButtonElement;
  panel: HTMLElement;
  setMap(map: WorldMap | null): void;
  close(): void;
}

export function createMinimap(onToggle?: () => void): Minimap {
  const canvas = h("canvas", { class: "ws-minimap-canvas" });
  const panel = h(
    "div",
    {
      class: "ws-minimap",
      role: "dialog",
      "aria-label": "Building map",
      hidden: true,
    },
    h("div", { class: "ws-minimap-title" }, "BUILDING MAP"),
    canvas,
  );
  const button = h(
    "button",
    {
      type: "button",
      class: "btn95 ws-map-button",
      "aria-pressed": "false",
      title: "Show the building layout",
      onclick: () => {
        onToggle?.();
        setOpen(panel.hidden);
      },
    },
    "MAP",
  );

  function setOpen(open: boolean): void {
    panel.hidden = !open;
    button.setAttribute("aria-pressed", String(open));
  }

  function draw(map: WorldMap): void {
    canvas.width = map.width * TILE;
    canvas.height = map.height * TILE;
    const g = canvas.getContext("2d")!;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        g.fillStyle = COLORS[map.tiles[y * map.width + x]];
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    // Black diagonal stripes over rooms no camera can see into.
    const watched = new Set(map.cameras.flatMap((c) => c.visibleTiles));
    const unwatched = map.rooms.filter((r) => {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (watched.has(y * map.width + x)) return false;
        }
      }
      return true;
    });
    for (const r of unwatched) {
      const x0 = r.x * TILE;
      const y0 = r.y * TILE;
      const w = r.w * TILE;
      const hgt = r.h * TILE;
      g.save();
      g.beginPath();
      g.rect(x0, y0, w, hgt);
      g.clip();
      g.strokeStyle = "rgba(0,0,0,0.75)";
      g.lineWidth = 4;
      for (let d = -hgt; d < w; d += 10) {
        g.beginPath();
        g.moveTo(x0 + d, y0 + hgt);
        g.lineTo(x0 + d + hgt, y0);
        g.stroke();
      }
      g.restore();
    }

    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "10px monospace";
    for (const r of map.rooms) {
      const cx = (r.x + r.w / 2) * TILE;
      const cy = (r.y + r.h / 2) * TILE;
      const blind = unwatched.includes(r);
      // A dark backing keeps the name readable over the stripes.
      if (blind) {
        const label = `${r.name} · NO CAMERA`;
        const tw = g.measureText(label).width + 8;
        g.fillStyle = "rgba(0,0,0,0.8)";
        g.fillRect(cx - tw / 2, cy - 8, tw, 16);
        g.fillStyle = "#f3f4f6";
        g.fillText(label, cx, cy);
      } else {
        g.fillStyle = "#d1d5db";
        g.fillText(r.name, cx, cy);
      }
    }
    // Cameras, labelled toward the middle of the room they hang in, so labels
    // stay inside the canvas and neighbouring cameras (Office B / Server Room)
    // don't overlap.
    g.font = "9px monospace";
    for (const cam of map.cameras) {
      const cx = (cam.x + 0.5) * TILE;
      const cy = (cam.y + 0.5) * TILE;
      g.fillStyle = CAMERA;
      g.beginPath();
      g.arc(cx, cy, 4, 0, Math.PI * 2);
      g.fill();
      const room = map.rooms.find(
        (r) =>
          cam.x >= r.x &&
          cam.x < r.x + r.w &&
          cam.y >= r.y &&
          cam.y < r.y + r.h,
      ) ?? { x: 0, y: 0, w: map.width, h: map.height };
      const right = cam.x + 0.5 > room.x + room.w / 2;
      const below = cam.y + 0.5 > room.y + room.h / 2;
      g.textAlign = right ? "right" : "left";
      g.textBaseline = below ? "bottom" : "top";
      g.fillText(cam.name, cx + (right ? -6 : 6), cy + (below ? -6 : 6));
    }
  }

  return {
    button,
    panel,
    setMap(map) {
      button.disabled = !map;
      if (map) draw(map);
      else setOpen(false);
    },
    close: () => setOpen(false),
  };
}
