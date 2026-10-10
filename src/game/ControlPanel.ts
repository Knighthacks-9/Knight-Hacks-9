import Phaser from "phaser";
import {
  dispatchText,
  playSfx,
  sayDispatch,
  startListening,
  stopSpeaking,
  type DispatchLineId,
  type SfxName,
  type Transmission,
} from "../audio";
import { eventBus } from "../shared/eventBus";
import type { Flag, SuspiciousBehavior, VoiceProvider } from "../shared/types";
import { ReportFlow } from "./reportFlow";

const FONT = "Arial, sans-serif";
const PAD = 12;

const BEHAVIORS: { id: SuspiciousBehavior; label: string }[] = [
  { id: "loitering", label: "Loitering" },
  { id: "revisitingDoors", label: "Revisiting doors" },
  { id: "restrictedZone", label: "Restricted zone" },
  { id: "avoidingCameras", label: "Avoiding cameras" },
];
const BEHAVIOR_LABEL = new Map(BEHAVIORS.map((b) => [b.id, b.label]));

const COLORS = {
  panel: 0x111827,
  border: 0x374151,
  button: 0x293141,
  hover: 0x364156,
  active: 0x1f3b33,
  go: 0x166534,
  live: 0x7f1d1d,
};

export interface ControlPanelDeps {
  /** Display name for a camera feed, e.g. "CAM 2 · HALL WEST". */
  feedLabel(cameraId: string): string;
  /** Current shift time in seconds. */
  now(): number;
}

/** Rectangle + label button with enabled / selected states. */
class PanelButton {
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly text: Phaser.GameObjects.Text;
  private enabled = true;
  private fill: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    onClick: () => void,
    fill = COLORS.button,
    /** Played on press; null when onClick plays its own sound. */
    sound: SfxName | null = "click",
  ) {
    this.fill = fill;
    this.bg = scene.add
      .rectangle(x, y, width, height, fill)
      .setOrigin(0)
      .setStrokeStyle(1, 0x465267)
      .setInteractive({ useHandCursor: true })
      .on(
        "pointerover",
        () => this.enabled && this.bg.setFillStyle(COLORS.hover),
      )
      .on("pointerout", () => this.bg.setFillStyle(this.fill))
      .on("pointerdown", () => {
        if (!this.enabled) return playSfx("deny");
        if (sound) playSfx(sound);
        onClick();
      });
    this.text = scene.add
      .text(x + width / 2, y + height / 2, label, {
        color: "#f3f4f6",
        fontFamily: FONT,
        fontSize: "13px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
  }

  setLabel(label: string): this {
    this.text.setText(label);
    return this;
  }

  setFill(fill: number): this {
    this.fill = fill;
    this.bg.setFillStyle(fill);
    return this;
  }

  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    this.bg.setAlpha(enabled ? 1 : 0.4);
    this.text.setAlpha(enabled ? 1 : 0.5);
    return this;
  }

  setVisible(visible: boolean): this {
    this.bg.setVisible(visible);
    this.text.setVisible(visible);
    return this;
  }
}

/**
 * The side panel during a shift. REPORT walks the player through sending a
 * report for investigation (feed → person → incident → send); DISPATCH is the
 * radio, where the AI dispatcher talks and the player answers by voice. A
 * report only counts once the player radios in a description.
 *
 * Emits flag:created (a completed report) and radio:report (every
 * transmission) on the event bus.
 */
export class ControlPanel {
  readonly flow = new ReportFlow();
  private view: "report" | "dispatch" = "report";
  private talk: "idle" | "live" | "busy" = "idle";
  private transmission: Transmission | null = null;
  private transmissionStart = 0;
  private log: string[] = [];
  private filed: Flag[] = [];
  private radioQueue: Promise<void> = Promise.resolve();
  private destroyed = false;

  private readonly reportTab: PanelButton;
  private readonly dispatchTab: PanelButton;
  private readonly reportObjects: (PanelButton | Phaser.GameObjects.Text)[];
  private readonly dispatchObjects: (PanelButton | Phaser.GameObjects.Text)[];
  private readonly stepText: Phaser.GameObjects.Text;
  private readonly noticeText: Phaser.GameObjects.Text;
  private readonly behaviorButtons: PanelButton[];
  private readonly startButton: PanelButton;
  private readonly sendButton: PanelButton;
  private readonly backButton: PanelButton;
  private readonly cancelButton: PanelButton;
  private readonly answerButton: PanelButton;
  private readonly historyText: Phaser.GameObjects.Text;
  private readonly bannerText: Phaser.GameObjects.Text;
  private readonly logText: Phaser.GameObjects.Text;
  private readonly talkButton: PanelButton;
  /** The radio log fills the space between the banner and the TALK button. */
  private readonly logBottom: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    private readonly deps: ControlPanelDeps,
  ) {
    const left = x + PAD;
    const inner = width - 2 * PAD;
    const half = (inner - 6) / 2;
    const text = (ty: number, size = 13, color = "#d1d5db") =>
      scene.add.text(left, ty, "", {
        color,
        fontFamily: FONT,
        fontSize: `${size}px`,
        wordWrap: { width: inner },
        lineSpacing: 3,
      });

    scene.add
      .rectangle(x, y, width, height, COLORS.panel)
      .setOrigin(0)
      .setStrokeStyle(1, COLORS.border);
    this.reportTab = new PanelButton(
      scene,
      left,
      y + 10,
      half,
      30,
      "REPORT",
      () => this.openReport(),
    );
    this.dispatchTab = new PanelButton(
      scene,
      left + half + 6,
      y + 10,
      half,
      30,
      "DISPATCH",
      () => this.openDispatch(),
    );

    // Report view.
    this.stepText = text(y + 54);
    this.noticeText = text(y + 122, 12, "#fbbf24");
    this.startButton = new PanelButton(
      scene,
      left,
      y + 132,
      inner,
      34,
      "New report",
      () => this.openReport(),
      COLORS.go,
    );
    this.behaviorButtons = BEHAVIORS.map(
      (behavior, i) =>
        new PanelButton(
          scene,
          left,
          y + 146 + i * 34,
          inner,
          28,
          behavior.label,
          () => {
            this.flow.chooseBehavior(behavior.id);
            this.render();
          },
        ),
    );
    this.sendButton = new PanelButton(
      scene,
      left,
      y + 290,
      inner,
      34,
      "Send report ▸",
      () => this.sendReport(),
      COLORS.go,
      "send",
    );
    this.backButton = new PanelButton(
      scene,
      left,
      y + 334,
      half,
      28,
      "◂ Back",
      () => {
        this.flow.back();
        this.render();
      },
    );
    this.cancelButton = new PanelButton(
      scene,
      left + half + 6,
      y + 334,
      half,
      28,
      "Cancel",
      () => {
        this.flow.cancel();
        this.render();
      },
    );
    this.answerButton = new PanelButton(
      scene,
      left,
      y + 150,
      inner,
      34,
      "Answer dispatch ▸",
      () => this.openDispatch(),
      COLORS.go,
    );
    this.historyText = text(y + 384, 11, "#9ca3af");

    // Dispatch view.
    this.bannerText = text(y + 54, 12);
    this.logText = text(y + 104, 12);
    this.logBottom = y + height - 90;
    this.talkButton = new PanelButton(
      scene,
      left,
      y + height - 78,
      inner,
      40,
      "● TALK",
      () => this.toggleTalk(),
      COLORS.button,
      null,
    );
    const hint = text(y + height - 30, 11, "#6b7383").setText(
      "or hold Space to talk",
    );

    this.reportObjects = [
      this.stepText,
      this.noticeText,
      this.startButton,
      ...this.behaviorButtons,
      this.sendButton,
      this.backButton,
      this.cancelButton,
      this.answerButton,
      this.historyText,
    ];
    this.dispatchObjects = [
      this.bannerText,
      this.logText,
      this.talkButton,
      hint,
    ];
    this.render();
  }

  /** True while the microphone is open. */
  get isTransmitting(): boolean {
    return this.talk === "live";
  }

  /** Feed and person to highlight on the camera grid. */
  get selection(): { cameraId: string | null; npcId: string | null } {
    const { step, cameraId, npcId, pending } = this.flow;
    return {
      cameraId:
        step === "person" || step === "incident"
          ? cameraId
          : (pending?.cameraId ?? null),
      npcId: npcId ?? pending?.npcId ?? null,
    };
  }

  /** People already reported this shift. */
  get reported(): ReadonlySet<string> {
    return this.flow.reported;
  }

  /** The player clicked somewhere on a camera feed. */
  handleFeedClick(cameraId: string): void {
    if (!this.flow.chooseFeed(cameraId)) return;
    playSfx("select");
    this.render();
  }

  /** The player clicked a person on a camera feed. */
  handlePersonClick(cameraId: string, npcId: string): void {
    if (this.flow.choosePerson(cameraId, npcId)) playSfx("select");
    else if (this.flow.notice) playSfx("deny");
    this.render();
  }

  /** Queues a dispatcher line: shown in the radio log and spoken. */
  dispatch(id: DispatchLineId): void {
    this.radioQueue = this.radioQueue.then(async () => {
      if (this.destroyed) return;
      this.addLog(`DISPATCH: ${dispatchText(id)}`);
      await sayDispatch(id).catch(() => undefined);
    });
  }

  spaceDown(): void {
    if (this.talk === "idle") this.startTalk();
  }

  spaceUp(): void {
    if (this.talk === "live") void this.finishTalk();
  }

  /** Stops audio and drops any open transmission (the shift is over). */
  destroy(): void {
    this.destroyed = true;
    void this.transmission?.stop();
    this.transmission = null;
    stopSpeaking();
  }

  private openReport(): void {
    this.view = "report";
    if (this.flow.step === "idle") this.flow.start();
    this.render();
  }

  private openDispatch(): void {
    this.view = "dispatch";
    this.render();
  }

  private sendReport(): void {
    const report = this.flow.send(this.deps.now());
    if (!report) return;
    this.addLog(
      `YOU: Reporting ${this.deps.feedLabel(report.cameraId)}, ${BEHAVIOR_LABEL.get(report.behavior)?.toLowerCase()}.`,
    );
    this.view = "dispatch";
    this.dispatch("report_received");
    this.dispatch("describe_subject");
    this.render();
  }

  private toggleTalk(): void {
    if (this.talk === "idle") this.startTalk();
    else if (this.talk === "live") void this.finishTalk();
  }

  private startTalk(): void {
    if (this.destroyed) return;
    playSfx("talkOn");
    this.transmission = startListening();
    this.transmissionStart = this.deps.now();
    this.talk = "live";
    this.render();
  }

  private async finishTalk(): Promise<void> {
    const transmission = this.transmission;
    if (!transmission) return;
    playSfx("talkOff");
    this.transmission = null;
    this.talk = "busy";
    this.render();
    const text = await transmission.stop();
    if (this.destroyed) return;
    this.talk = "idle";
    this.handleTranscript(text, transmission.provider ?? "browser");
    this.render();
  }

  private handleTranscript(text: string, provider: VoiceProvider): void {
    if (!text) {
      if (this.flow.step === "follow-up") this.dispatch("say_again");
      else this.addLog("YOU: (nothing heard)");
      return;
    }
    this.addLog(`YOU: ${text}`);
    eventBus.emit("radio:report", {
      text,
      t: this.transmissionStart,
      provider,
    });

    const flag = this.flow.completeFollowUp(text);
    if (flag) {
      this.filed.push(flag);
      playSfx("success");
      eventBus.emit("flag:created", flag);
      this.dispatch("unit_dispatched");
    }
  }

  private addLog(line: string): void {
    this.log.push(line);
    this.renderLog();
  }

  private renderLog(): void {
    // Start under the banner (its height changes) and keep the newest lines that fit.
    this.logText.setY(this.bannerText.y + this.bannerText.height + 14);
    const maxHeight = this.logBottom - this.logText.y;
    let lines = this.log.slice(-12);
    this.logText.setText(lines.join("\n\n"));
    while (lines.length > 1 && this.logText.height > maxHeight) {
      lines = lines.slice(1);
      this.logText.setText(lines.join("\n\n"));
    }
  }

  private render(): void {
    const { step, behavior, cameraId, notice } = this.flow;
    const followUp = step === "follow-up";
    const onReport = this.view === "report";

    this.reportTab.setFill(onReport ? COLORS.active : COLORS.button);
    this.dispatchTab
      .setFill(onReport ? COLORS.button : COLORS.active)
      .setLabel(followUp ? "DISPATCH ●" : "DISPATCH");
    for (const object of this.reportObjects) object.setVisible(onReport);
    for (const object of this.dispatchObjects) object.setVisible(!onReport);

    if (onReport) {
      this.stepText.setText(
        {
          idle: "Spotted something suspicious? Send a report to dispatch for investigation.",
          feed: "Step 1 of 4\nClick the camera feed showing the suspicious activity.",
          person: `Step 2 of 4\nClick the person acting suspicious on ${cameraId ? this.deps.feedLabel(cameraId) : "that feed"}.`,
          incident: "Step 3 of 4\nWhat are they doing?",
          "follow-up":
            "Step 4 of 4\nReport sent. Dispatch needs your description of the subject over the radio.",
        }[step],
      );
      this.noticeText.setText(notice);
      this.startButton.setVisible(step === "idle");
      this.behaviorButtons.forEach((button, i) =>
        button
          .setVisible(step === "incident")
          .setFill(
            BEHAVIORS[i].id === behavior ? COLORS.active : COLORS.button,
          ),
      );
      this.sendButton
        .setVisible(step === "incident")
        .setEnabled(behavior !== null);
      this.backButton.setVisible(step === "person" || step === "incident");
      this.cancelButton.setVisible(
        step === "feed" || step === "person" || step === "incident",
      );
      this.answerButton.setVisible(followUp);
      this.historyText.setText(
        this.filed.length
          ? `Reports filed: ${this.filed.length}\n` +
              this.filed
                .slice(-3)
                .map(
                  (f) =>
                    `• ${this.deps.feedLabel(f.cameraId)}, ${BEHAVIOR_LABEL.get(f.behavior!)}`,
                )
                .join("\n")
          : "",
      );
    } else {
      this.bannerText
        .setText(
          followUp
            ? "Follow-up required: tell dispatch what the subject looks like and what they are doing."
            : "Radio channel open.",
        )
        .setColor(followUp ? "#fca5a5" : "#6b7383");
      this.talkButton
        .setLabel(
          { idle: "● TALK", live: "■ STOP", busy: "Transcribing…" }[this.talk],
        )
        .setFill(
          this.talk === "live"
            ? COLORS.live
            : followUp
              ? COLORS.go
              : COLORS.button,
        )
        .setEnabled(this.talk !== "busy");
      this.renderLog();
    }
  }
}
