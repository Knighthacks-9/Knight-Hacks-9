import Phaser from "phaser";
import {
  debriefFacts,
  debriefInput,
  debriefTemplate,
  speak,
  stopSpeaking,
  writeDispatchLine,
} from "../audio";
import type { ShiftReport } from "../shared/types";
import { buildMap } from "../world";
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
      this.dispatcherSummary(report);
      if (!passed) {
        addText(
          this,
          302,
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
      addText(this, 302, `Next shift: ${next} screens`, 20, "#fbbf24");
      addButton(this, 360, "Next level", "Shift", () =>
        this.registry.set(LEVEL_KEY, level + 1),
      );
    } else {
      addButton(this, 360, passed ? "Replay level" : "Retry level", "Shift");
    }
    addButton(this, 420, "Back to title", "Title");
    if (report) {
      // The full debrief is the HTML panel under the canvas; scroll to it.
      addText(this, 490, "Full debrief below ↓", 16, "#9ca3af")
        .setPadding(12, 6)
        .setInteractive({ useHandCursor: true })
        .on("pointerover", function (this: Phaser.GameObjects.Text) {
          this.setColor("#f3f4f6");
        })
        .on("pointerout", function (this: Phaser.GameObjects.Text) {
          this.setColor("#9ca3af");
        })
        .on("pointerdown", () =>
          document
            .getElementById("analytics-panel")
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        );
    }
  }

  /** The dispatcher's end-of-shift line: shown under the score and spoken. */
  private dispatcherSummary(report: ShiftReport): void {
    // report.feeds lists the shown cameras in grid order.
    const names = new Map(buildMap().cameras.map((c) => [c.id, c.name]));
    const input = debriefInput(
      report,
      report.feeds.map((f) => ({
        id: f.cameraId,
        location: names.get(f.cameraId) ?? f.cameraId,
      })),
    );
    const template = debriefTemplate(input);
    const line = addText(this, 266, `DISPATCH: ${template}`, 14, "#93c5fd");
    line.setWordWrapWidth(this.scale.width - 80);
    let left = false;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      left = true;
      stopSpeaking();
    });
    void writeDispatchLine("debrief", debriefFacts(input), template).then(
      (text) => {
        if (left) return;
        line.setText(`DISPATCH: ${text}`);
        void speak(text).catch(() => undefined);
      },
    );
  }
}
