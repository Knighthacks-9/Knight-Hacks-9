import Phaser from "phaser";
import { LEVELS, LEVEL_COMPLETED_KEY, LEVEL_KEY } from "./levels";
import { FLAG_COUNT_KEY } from "./ShiftScene";
import { addButton, addText } from "./ui";

export class DebriefScene extends Phaser.Scene {
  constructor() {
    super("Debrief");
  }

  create(): void {
    const flags =
      (this.registry.get(FLAG_COUNT_KEY) as number | undefined) ?? 0;
    const level = (this.registry.get(LEVEL_KEY) as number | undefined) ?? 1;
    const completed =
      (this.registry.get(LEVEL_COMPLETED_KEY) as boolean | undefined) ?? false;
    const isLastLevel = level >= LEVELS.length;

    addText(
      this,
      130,
      completed ? `Level ${level} complete` : "Level not passed",
      48,
      "#f3f4f6",
      true,
    );
    addText(
      this,
      220,
      `You flagged ${flags} ${flags === 1 ? "person" : "people"}.`,
      24,
    );
    // TODO: show analytics debrief (heatmap, timeline) once the analytics module lands.
    addText(this, 270, "Detailed debrief coming soon.", 16, "#9ca3af");

    if (!completed) {
      addText(
        this,
        330,
        "Flag at least one person and finish the shift to pass.",
        18,
        "#fbbf24",
      );
    }

    if (completed && !isLastLevel) {
      const next = LEVELS[level].screens;
      addText(this, 330, `Next shift: ${next} screens`, 20, "#fbbf24");
      addButton(this, 400, "Next level", "Shift", () =>
        this.registry.set(LEVEL_KEY, level + 1),
      );
    } else {
      addButton(this, 400, completed ? "Replay level" : "Retry level", "Shift");
    }
    addButton(this, 460, "Back to title", "Title");
  }
}
