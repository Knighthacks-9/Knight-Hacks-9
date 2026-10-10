import Phaser from "phaser";
import type { ShiftReport } from "../shared/types";
import {
  FEED_LIMIT_KEY,
  LEVELS,
  LEVEL_KEY,
  REPORT_KEY,
  getFeedLayout,
} from "./levels";
import { addButton, addText } from "./ui";

export class DebriefScene extends Phaser.Scene {
  constructor() {
    super("Debrief");
  }

  create(): void {
    const level = (this.registry.get(LEVEL_KEY) as number | undefined) ?? 1;
    const report = this.registry.get(REPORT_KEY) as ShiftReport | undefined;
    const passed = report?.passed ?? false;
    const isLastLevel = level >= LEVELS.length;

    addText(
      this,
      110,
      passed ? `Level ${level} complete` : "Level not passed",
      48,
      "#f3f4f6",
      true,
    );

    if (!report) {
      addText(this, 200, "No analytics report was recorded.", 20, "#fbbf24");
    } else {
      const caught = report.events.filter((e) => e.outcome === "caught").length;
      addText(
        this,
        190,
        `Caught ${caught} of ${report.events.length} suspicious ${report.events.length === 1 ? "person" : "people"} · ${report.falseFlags.length} false ${report.falseFlags.length === 1 ? "report" : "reports"}`,
        22,
      );
      addText(this, 232, `Score ${report.score}`, 20, "#9ca3af");
      if (!passed) {
        addText(
          this,
          290,
          report.completed
            ? "Report at least half of them, with no more false reports than correct ones."
            : "You ended the shift early.",
          18,
          "#fbbf24",
        );
      }
    }

    if (passed && !isLastLevel) {
      const feedLimit =
        (this.registry.get(FEED_LIMIT_KEY) as number | undefined) ?? Infinity;
      const next = getFeedLayout(level + 1, feedLimit).screens;
      addText(this, 290, `Next shift: ${next} screens`, 20, "#fbbf24");
      addButton(this, 360, "Next level", "Shift", () =>
        this.registry.set(LEVEL_KEY, level + 1),
      );
    } else {
      addButton(this, 360, passed ? "Replay level" : "Retry level", "Shift");
    }
    addButton(this, 420, "Back to title", "Title");
    if (report) {
      addText(this, 490, "Full debrief below ↓", 14, "#6b7383");
    }
  }
}
