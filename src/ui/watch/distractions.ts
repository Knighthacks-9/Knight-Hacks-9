// Fake system and investigation pop-ups that cover part of the camera
// workspace during a shift. Each one can be dragged by its title bar and
// closed; the manager counts how many were shown and dismissed.
import { playSfx } from "../../audio";
import { h, icon, randomBetween } from "../dom";
import { ICONS } from "../icons";
import type { TimeSpan } from "../service";
import {
  bringToFront,
  createWindow,
  makeDraggable,
  placeWindow,
} from "../window";

interface Distraction {
  title: string;
  heading: string;
  icon: keyof typeof ICONS;
  lines: string[];
  actions: string[];
}

const DISTRACTIONS: Distraction[] = [
  {
    title: "INVESTIGATION_UPDATE",
    heading: "Investigation update",
    icon: "info",
    lines: [
      "Field unit has reached the west perimeter.",
      "Awaiting access code.",
    ],
    actions: ["Acknowledge", "Remind Me Later"],
  },
  {
    title: "SYSTEM_UPDATE",
    heading: "System update",
    icon: "update",
    lines: ["Camera codec update is ready to install.", "Restart required."],
    actions: ["Remind Me Later", "Dismiss"],
  },
  {
    title: "DISPATCH_NOTE",
    heading: "Dispatch note",
    icon: "note",
    lines: ["Witness statement added to CASE_4417.", "Review when available."],
    actions: ["Mark as Read", "Dismiss"],
  },
  {
    title: "LOW_DISK_SPACE",
    heading: "Low disk space",
    icon: "disk",
    lines: ["Archive drive C: has less than 8% free space remaining."],
    actions: ["Dismiss"],
  },
  {
    title: "INVESTIGATION_UPDATE",
    heading: "Investigation update",
    icon: "info",
    lines: [
      "CASE_4417: subject description revised.",
      "Dark jacket, grey backpack, last seen near loading doors.",
    ],
    actions: ["Acknowledge", "Remind Me Later"],
  },
  {
    title: "BADGE_READER.SYS",
    heading: "Device warning",
    icon: "warning",
    lines: [
      "East door badge reader reporting intermittent faults.",
      "Maintenance ticket #2291 opened.",
    ],
    actions: ["Acknowledge", "Dismiss"],
  },
  {
    title: "ARCHIVE_SYNC",
    heading: "Archive sync",
    icon: "update",
    lines: [
      "2,114 clips queued for off-site backup.",
      "Bandwidth may be reduced.",
    ],
    actions: ["Remind Me Later", "Dismiss"],
  },
  {
    title: "DISPATCH_NOTE",
    heading: "Dispatch note",
    icon: "note",
    lines: [
      "Unit 12 requests plate check on dark sedan.",
      "Reply via terminal when free.",
    ],
    actions: ["Mark as Read", "Dismiss"],
  },
];

/** At most this many pop-ups are open at once. */
const MAX_OPEN = 3;
const FIRST_AT: [number, number] = [8, 13];
const EVERY: [number, number] = [13, 22];
const REMIND_AFTER = 20;

interface OpenPopup {
  root: HTMLElement;
  cleanup(): void;
}

export class DistractionManager {
  displayed = 0;
  dismissed = 0;
  /** When gaze rested on any pop-up. */
  readonly gaze: TimeSpan[] = [];
  private nextAt: number;
  private deck: Distraction[] = [];
  private reminders: { at: number; item: Distraction }[] = [];
  private readonly open = new Set<OpenPopup>();
  private slot = Math.floor(Math.random() * 6);
  private t = 0;

  /** `frequency` scales how often pop-ups appear; 0 turns them off. */
  constructor(
    private readonly layer: HTMLElement,
    private readonly frequency = 1,
  ) {
    this.nextAt =
      frequency > 0 ? randomBetween(...FIRST_AT) / frequency : Infinity;
  }

  /** Called every frame with shift time; spawns pop-ups on schedule. */
  update(t: number, gazeOnPopup: boolean): void {
    const dt = t - this.t;
    this.t = t;
    if (gazeOnPopup && dt > 0) {
      const last = this.gaze.at(-1);
      if (last && t - dt - last.end < 0.2) last.end = t;
      else this.gaze.push({ start: t - dt, end: t });
    }
    const due = this.reminders.findIndex((r) => r.at <= t);
    if (due >= 0 && this.open.size < MAX_OPEN) {
      this.show(this.reminders.splice(due, 1)[0].item);
    }
    if (t >= this.nextAt) {
      this.nextAt = t + randomBetween(...EVERY) / this.frequency;
      if (this.open.size < MAX_OPEN) this.show(this.draw());
    }
  }

  /** True when a viewport point is over an open pop-up. */
  hitTest(x: number, y: number): boolean {
    for (const popup of this.open) {
      const r = popup.root.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
        return true;
    }
    return false;
  }

  destroy(): void {
    for (const popup of this.open) popup.cleanup();
    this.open.clear();
  }

  private draw(): Distraction {
    if (this.deck.length === 0) {
      this.deck = [...DISTRACTIONS].sort(() => Math.random() - 0.5);
    }
    return this.deck.pop()!;
  }

  private show(item: Distraction): void {
    const close = (remind: boolean) => {
      if (!this.open.has(popup)) return;
      this.dismissed += 1;
      if (remind) this.reminders.push({ at: this.t + REMIND_AFTER, item });
      popup.cleanup();
      this.open.delete(popup);
    };
    const win = createWindow({
      title: item.title,
      className: "popup",
      role: "alertdialog",
      onClose: () => close(false),
    });
    win.root.classList.add("rw-floating");
    win.body.append(
      h(
        "div",
        { class: "popup-content" },
        icon(ICONS[item.icon], "popup-icon"),
        h(
          "div",
          null,
          h("p", { class: "popup-heading" }, item.heading),
          ...item.lines.map((line) => h("p", null, line)),
        ),
      ),
      h(
        "div",
        { class: "popup-actions" },
        ...item.actions.map((action, i) =>
          h(
            "button",
            {
              type: "button",
              class: `btn95${i === 0 ? " is-default" : ""}`,
              onclick: () => {
                playSfx("click");
                close(action === "Remind Me Later");
              },
            },
            action,
          ),
        ),
      ),
    );
    this.layer.append(win.root);
    bringToFront(win.root);
    // Spread pop-ups over six zones of the workspace, with some jitter.
    this.slot = (this.slot + 1 + Math.floor(Math.random() * 2)) % 6;
    const zoneX = this.slot % 3;
    const zoneY = Math.floor(this.slot / 3);
    const freeW = Math.max(0, this.layer.clientWidth - win.root.offsetWidth);
    const freeH = Math.max(0, this.layer.clientHeight - win.root.offsetHeight);
    placeWindow(
      win.root,
      freeW * (zoneX / 2) * randomBetween(0.85, 1) + randomBetween(-12, 12),
      freeH *
        (zoneY === 0 ? randomBetween(0.05, 0.3) : randomBetween(0.6, 0.95)),
    );
    const stopDrag = makeDraggable(win.root, win.titleBar);
    const popup: OpenPopup = {
      root: win.root,
      cleanup: () => {
        stopDrag();
        win.root.remove();
      },
    };
    this.open.add(popup);
    this.displayed += 1;
    playSfx(
      item.icon === "warning" || item.icon === "disk" ? "warning" : "blip",
    );
  }
}
