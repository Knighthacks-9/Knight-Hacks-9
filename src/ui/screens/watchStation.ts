// Screen 3: WATCH_STATION.EXE, the maximized shift window. Camera workspace
// on the left (2 to 6 feeds, focus mode, report mode, pop-ups, glitches);
// side console on the right (report control, dispatch radio, end shift).
//
// Dispatch also checks in now and then with a question about the feeds, which
// the player answers over push-to-talk (see ../watch/dispatchQuestions).
//
// Each report sends a knight into the building. A reported suspect is
// MARKED right away and boxed as CAPTURED when the knight reaches them, on
// the feeds, whether or not the player has the radio unmuted; dispatch
// narrates the knight's progress. When the watch ends no one new walks in,
// but the building keeps moving so knights can finish, and dispatch closes
// out every open call before the debrief, signing off no more than
// OVERRUN_LIMIT_S after the shift.
import { ATTENTION_LAPSE_PENALTY, AttentionWatch } from "../../analytics";
import {
  InvestigationDesk,
  dispatchText,
  locateNpc,
  playSfx,
  sayDispatch,
  speak,
  type InvestigationLine,
} from "../../audio";
import { eventBus } from "../../shared/eventBus";
import type { WorldSnapshot } from "../../shared/types";
import { gazeController } from "../../vision";
import type { Screen } from "../context";
import { h, icon, mmss, pad2 } from "../dom";
import { ICONS } from "../icons";
import {
  levelConfig,
  type AnomalyReport,
  type CameraFeed,
  type ShiftConfig,
  type ShiftSession,
  type ShiftTelemetry,
} from "../service";
import { planShift } from "../shiftSettings";
import {
  QuestionWindow,
  TIMEOUT_REPLY,
  feedCounts,
  isSightingReport,
  parseAnswer,
  pickQuestion,
} from "../watch/dispatchQuestions";
import { DistractionManager } from "../watch/distractions";
import { FeedRenderer, type PersonMark } from "../watch/feedRenderer";
import { GlitchScheduler } from "../watch/glitch";
import { createMinimap } from "../watch/minimap";
import {
  DispatchRadio,
  speechSeconds,
  voiceInputAvailable,
  type RadioMessage,
} from "../watch/radio";
import { parseCameraCommand } from "../watch/voiceCommand";
import { createWindow } from "../window";

/** Longest frame step fed to the sim, so a backgrounded tab doesn't jump ahead. */
const MAX_DT = 0.1;

/** LCD headline prefix for each investigation stage. */
const STAGE_HEADLINES: Record<InvestigationLine["stage"], string> = {
  acknowledged: "ACK",
  en_route: "EN ROUTE",
  on_scene: "ON SCENE",
  resolved: "RESOLVED",
  closed: "CLOSED",
  late: "LOGGED",
};

/** The feed's dispatch badge for each stage; `resolved` depends on the outcome. */
const STAGE_BADGES: Record<
  Exclude<InvestigationLine["stage"], "resolved">,
  string
> = {
  acknowledged: "DISPATCH · REPORT ACK",
  en_route: "DISPATCH · KNIGHT EN ROUTE",
  on_scene: "DISPATCH · KNIGHT ON SCENE",
  closed: "DISPATCH · CASE CLOSED",
  late: "DISPATCH · LOGGED",
};

const MARK_TAGS: Record<PersonMark["kind"], string> = {
  marked: "MARKED",
  captured: "CAPTURED",
};

/** How long a closed case's badge stays on its feed. */
const BADGE_LINGER_MS = 4000;
/** After the shift, give up waiting on dispatch if nothing happens for this long. */
const WRAP_UP_STALL_MS = 45_000;
/** Dispatch's audio, sign-off included, ends at most this long after the shift. */
const OVERRUN_LIMIT_S = 30;
/**
 * Room left for the line playing when dispatch stops queueing new ones, and
 * a rough length for each outcome line still to come.
 */
const LINE_ALLOWANCE_S = 8;
/** Shift seconds before dispatch's first check-in, and between check-ins. */
const FIRST_QUESTION_AT = 25;
const QUESTION_GAP: [number, number] = [40, 70];
/** No new check-ins this close to the end of the shift. */
const QUESTION_CUTOFF = 20;
/** How long the player has to answer once the question has played. */
const ANSWER_SECONDS = 20;
/** How long the feeds flash red after an attention lapse. */
const LAPSE_FLASH_MS = 1400;
/** LCD line while dispatch waits for an answer. */
const ANSWER_PROMPT = "DISPATCH ASKED YOU · HOLD SPACE TO ANSWER";

interface FeedView {
  feed: CameraFeed;
  index: number;
  root: HTMLElement;
  renderer: FeedRenderer;
  rec: HTMLElement;
  focusButton: HTMLButtonElement;
  /** Overlay holding the MARKED / CAPTURED boxes. */
  marks: HTMLElement;
  markBoxes: Map<string, HTMLElement>;
  /** What dispatch is doing about this feed's report. */
  badge: HTMLElement;
  badgeTimer: number;
}

export const mountWatchStation: Screen = (ctx, params) => {
  const { service } = ctx;
  const level = levelConfig(params.level ?? ctx.state.level);
  ctx.state.level = level.level;
  // The level plus whatever the player changed in Shift Setup.
  const plan = planShift(level, ctx.state.shiftSeconds, ctx.state.settings);
  const config: ShiftConfig = plan.config;

  let session: ShiftSession | null = null;
  let disposed = false;
  let finished = false;
  let raf = 0;
  let shiftT = 0;
  /** Dispatch's clock: the shift clock, and it keeps running after the shift. */
  let deskT = 0;
  /** The shift is over and dispatch is closing out its calls. */
  let wrapping = false;
  let completedShift = false;
  let signedOff = false;
  /** When the shift's watch ended (performance.now()). */
  let wrapStartedAt = 0;
  /** Seconds the sign-off takes; it must start by OVERRUN_LIMIT_S minus this. */
  const signOffSeconds = speechSeconds(dispatchText("shift_end")) + 0.6;
  /** 0 on time, 1 queue dropped, 2 the line playing cut off too. */
  let cutStage = 0;
  let lastDispatchProgress = 0;
  /** Dispatch's open check-in question, if any. */
  let question: {
    window: QuestionWindow;
    /** The player has started hearing it; feeds are being sampled. */
    heard: boolean;
    /** Shift time the answer is due; set once the question has played. */
    due: number;
  } | null = null;
  let nextQuestionAt = FIRST_QUESTION_AT;
  /** Dispatch's marks on people, by NPC id. */
  const marks = new Map<string, PersonMark>();
  let lastSnapshot: WorldSnapshot | null = null;
  let shownSecond = -1;
  let reportMode = false;
  let focused: FeedView | null = null;
  let views: FeedView[] = [];
  /** Same lapse rule analytics scores with, so the alarm matches the penalty. */
  const attention = new AttentionWatch();
  let lapseFlashTimer = 0;
  const telemetry: ShiftTelemetry = {
    reports: [],
    popupsDisplayed: 0,
    popupsDismissed: 0,
    popupGaze: [],
    unmuteDelaysMs: [],
    focusModeUses: 0,
    webcamUsed: false,
  };

  // --- Title bar --------------------------------------------------------------
  const timer = h("span", {
    class: "ws-timer",
    role: "timer",
    "aria-live": "off",
  });
  const win = createWindow({
    title: "WATCH_STATION.EXE",
    className: "ws",
    titleExtra: timer,
    maximize: "static",
    onClose: () => exitToDesktop(),
    closeLabel: "Close Watch Station and return to desktop",
  });
  win.root.setAttribute("aria-label", "Watch Station");

  // --- Camera workspace -------------------------------------------------------
  // Difficulty is picked in shift setup, so the toolbar only has the map.
  const online = h("span", { class: "ws-online" }, "CONNECTING...");
  const restoreButton = h(
    "button",
    {
      type: "button",
      class: "btn95 ws-restore",
      hidden: true,
      onclick: () => {
        playSfx("click");
        setFocus(null);
      },
    },
    "RESTORE GRID",
  );
  const cancelReport = h(
    "button",
    { type: "button", class: "btn95", onclick: () => setReportMode(false) },
    "CANCEL REPORT",
  );
  const banner = h(
    "div",
    { class: "ws-banner", role: "status", hidden: true },
    h(
      "span",
      { class: "ws-banner-text" },
      "SELECT THE CAMERA WHERE YOU SAW AN ANOMALY",
    ),
    cancelReport,
  );
  const wrapBanner = h(
    "div",
    { class: "ws-banner ws-banner-wrap", role: "status", hidden: true },
    h(
      "span",
      { class: "ws-banner-text" },
      "SHIFT OVER · STAND BY WHILE DISPATCH CLOSES OUT OPEN CALLS",
    ),
  );
  const grid = h("div", {
    class: "ws-grid",
    "data-count": String(config.cameraCount),
  });
  const popups = h("div", { class: "ws-popups" });
  const minimap = createMinimap(() => playSfx("click"));
  minimap.setMap(null); // enabled once the shift has its map
  const stage = h("div", { class: "ws-stage" }, grid, popups, minimap.panel);
  const workspace = h(
    "div",
    { class: "ws-workspace" },
    h(
      "div",
      { class: "ws-toolbar" },
      h("div", { class: "ws-toolbar-left" }, minimap.button),
      h("div", { class: "ws-toolbar-right" }, restoreButton, online),
    ),
    banner,
    wrapBanner,
    stage,
  );

  // --- Side console -----------------------------------------------------------
  const count = h("span", { class: "rc-count" });
  const meter = h("div", {
    class: "pixel-meter",
    role: "progressbar",
    "aria-label": "Sightings reported",
    "aria-valuemin": "0",
    "aria-valuemax": String(config.expectedAnomalies),
  });
  for (let i = 0; i < config.expectedAnomalies; i++) meter.append(h("i"));
  meter.hidden = !plan.reportCounter;
  const reportButton = h("button", {
    type: "button",
    class: "report-btn",
    "aria-keyshortcuts": "R",
    onclick: () => setReportMode(!reportMode),
  });
  const help = h(
    "p",
    { class: "rc-help", hidden: true },
    `Press REPORT SIGHTING (or R), then click the feed where someone is acting suspicious. Number keys 1–${config.cameraCount} pick a feed. ESC cancels. A knight goes after them: report quickly, before they leave.`,
  );
  const reportPanel = panel(
    "REPORT CONTROL",
    h(
      "button",
      {
        type: "button",
        class: "panel-btn",
        "aria-label": "How to report",
        title: "How to report",
        "aria-expanded": "false",
        onclick: (event: MouseEvent) => {
          help.hidden = !help.hidden;
          (event.currentTarget as HTMLElement).setAttribute(
            "aria-expanded",
            String(!help.hidden),
          );
        },
      },
      "?",
    ),
    // Shift Setup can hide the count (it is off on Normal and Hard).
    h(
      "div",
      { class: "rc-row", hidden: !plan.reportCounter },
      h("span", { class: "rc-label" }, "SIGHTINGS"),
      count,
    ),
    meter,
    reportButton,
    h("p", { class: "rc-hint" }, "Use when someone on a feed acts suspicious."),
    help,
  );

  const radio = new DispatchRadio({
    onUnmute: (delay) => telemetry.unmuteDelaysMs.push(delay),
    onTranscript: (text, provider) => {
      eventBus.emit("radio:report", { text, t: shiftT, provider });
      if (!session || finished || wrapping) return "SHIFT NOT ACTIVE";
      if (question?.heard && !isSightingReport(text)) return answer(text);
      const n = parseCameraCommand(text, views.length);
      if (n === null) return `"${text.toUpperCase()}" · CAMERA NOT RECOGNIZED`;
      void submit(views[n - 1], "voice", text);
      return `VOICE REPORT FILED: ${views[n - 1].feed.label}`;
    },
  });
  const radioPanel = panel("AI DISPATCH RADIO", null, radio.root);

  // --- Dispatch check-ins -------------------------------------------------------
  /** A short dispatcher transmission outside any investigation. */
  function say(headline: string, text: string): void {
    radio.receive({
      headline,
      text,
      play: () => speak(text),
      optional: true,
    });
  }

  /** Asks a question about the feeds; graded as the player hears it. */
  function ask(counts: number[]): void {
    const asked = pickQuestion(viewFeeds(), counts);
    const open = {
      window: new QuestionWindow(asked, views.length),
      heard: false,
      due: Infinity,
    };
    question = open;
    radio.receive({
      headline: asked.headline,
      text: asked.text,
      play: () => speak(asked.text),
      discardOnDrain: true,
      onStart: () => {
        open.heard = true;
        open.window.observe(feedCounts(lastSnapshot, viewFeeds()));
      },
      onEnd: () => {
        if (question !== open) return;
        open.due = shiftT + ANSWER_SECONDS;
        radio.setPrompt(ANSWER_PROMPT);
      },
    });
  }

  /** Grades the player's spoken answer; returns the LCD line. */
  function answer(text: string): string {
    const open = question!;
    const parsed = parseAnswer(open.window.question, text, views.length);
    if (!parsed) {
      // Keep the question open and give them time to try again.
      open.due = Math.max(open.due, shiftT + ANSWER_SECONDS / 2);
      radio.receive({
        headline: "SAY AGAIN",
        text: dispatchText("say_again"),
        play: () => sayDispatch("say_again"),
        optional: true,
      });
      return `"${text.toUpperCase()}" · DISPATCH DIDN'T COPY`;
    }
    const verdict = open.window.grade(parsed);
    closeQuestion();
    say(
      verdict.correct ? "CHECK-IN: COPY" : "CHECK-IN: NEGATIVE",
      verdict.reply,
    );
    return `ANSWER SENT: "${text.toUpperCase()}"`;
  }

  function closeQuestion(): void {
    question = null;
    radio.setPrompt("");
    const [min, max] = QUESTION_GAP;
    nextQuestionAt = shiftT + min + Math.random() * (max - min);
  }

  /** Samples the feeds for an open question, times it out, or asks the next. */
  function updateQuestions(t: number): void {
    const counts = feedCounts(lastSnapshot, viewFeeds());
    if (question) {
      if (question.heard) question.window.observe(counts);
      if (t > question.due) {
        closeQuestion();
        say("CHECK-IN: NO ANSWER", TIMEOUT_REPLY);
      }
      return;
    }
    if (
      t >= nextQuestionAt &&
      t < config.durationSeconds - QUESTION_CUTOFF &&
      views.length > 0 &&
      !radio.busy &&
      !reportMode &&
      voiceInputAvailable()
    ) {
      ask(counts);
    }
  }

  function viewFeeds(): CameraFeed[] {
    return views.map((v) => v.feed);
  }

  // Each filed report sends a knight and is narrated over the radio; the
  // world decides the outcome (caught, escaped, nobody there), the AI
  // dispatcher only words it. The shift waits for dispatch to finish (see
  // beginWrapUp).
  const desk = new InvestigationDesk({
    shiftSeconds: config.durationSeconds,
    fitToShift: false,
    unit: {
      dispatch: (c) =>
        session?.dispatchKnight?.(
          c.npcId,
          views[c.camera - 1]?.feed.id ?? "",
        ) ?? null,
      status: (id) => session?.knightStatus?.(id) ?? null,
    },
    locate: (npcId) =>
      locateNpc(
        lastSnapshot,
        session?.map ?? null,
        views.map((v) => ({ id: v.feed.id, location: v.feed.location })),
        npcId,
      ),
    deliver: (line) => {
      lastDispatchProgress = performance.now();
      const view = views[line.camera - 1];
      const label = view?.feed.label ?? `CAM ${line.camera}`;
      radio.receive(
        {
          headline: `${STAGE_HEADLINES[line.stage]}: ${label}`,
          text: line.text,
          play: () => speak(line.text),
          // The outcome always gets said; the rest can go if time is short.
          optional: line.stage !== "resolved" && line.stage !== "late",
          onStart: () => {
            lastDispatchProgress = performance.now();
            view?.root.classList.add("is-radio");
            followScript(line);
          },
          onEnd: () => {
            lastDispatchProgress = performance.now();
            view?.root.classList.remove("is-radio");
          },
        } satisfies RadioMessage,
        0,
      );
    },
  });

  const statusText = h("span", null, "CONNECTING...");
  const endButton = h(
    "button",
    {
      type: "button",
      class: "btn95 ws-end",
      onclick: () => {
        playSfx("click");
        beginWrapUp(shiftT >= config.durationSeconds);
      },
    },
    "END SHIFT / DEBRIEF",
  );
  const console_ = h(
    "aside",
    { class: "ws-console", "aria-label": "Side console" },
    reportPanel,
    radioPanel,
    endButton,
    h(
      "div",
      { class: "ws-statusbar" },
      h("span", { class: "status-led", "aria-hidden": "true" }),
      statusText,
      h("span", { class: "ws-version" }, "v1.04"),
    ),
  );

  const reticle = h("div", {
    class: "gaze-reticle",
    "aria-hidden": "true",
    hidden: true,
  });
  win.body.append(h("div", { class: "ws-main" }, workspace, console_), reticle);
  ctx.overlay.append(win.root);
  ctx.setTask("WATCH_STATION.EXE", undefined, win.root);
  updateTimer(0);
  updateReportPanel();

  const distractions = new DistractionManager(
    popups,
    plan.distractionFrequency,
  );
  const glitches = new GlitchScheduler(() =>
    views.map((v) => ({
      element: v.root,
      setGlitch: (kind, reduced) => v.renderer.setGlitch(kind, reduced),
    })),
  );

  // --- Helpers ----------------------------------------------------------------
  function panel(
    title: string,
    extra: Node | null,
    ...content: Node[]
  ): HTMLElement {
    return h(
      "section",
      { class: "panel", "aria-label": title },
      h("header", { class: "panel-title" }, h("h3", null, title), extra),
      h("div", { class: "panel-body" }, ...content),
    );
  }

  function setStatus(text: string): void {
    statusText.textContent = text;
  }

  function updateTimer(t: number): void {
    const second = Math.floor(t);
    if (second === shownSecond) return;
    shownSecond = second;
    timer.textContent = `SHIFT TIMER ${mmss(t)}`;
    timer.title = `${mmss(Math.max(0, config.durationSeconds - t))} remaining of ${mmss(config.durationSeconds)}`;
    timer.classList.toggle("is-ending", config.durationSeconds - t <= 15);
    for (const view of views)
      view.rec.textContent = `REC ${mmss(t + view.index + 2)}`;
  }

  function updateReportPanel(): void {
    const filed = telemetry.reports.length;
    count.innerHTML = "";
    count.append(
      h("b", null, pad2(filed)),
      h("span", null, ` / ${pad2(config.expectedAnomalies)}`),
    );
    count.setAttribute(
      "aria-label",
      `${filed} of ${config.expectedAnomalies} expected sightings reported`,
    );
    meter.setAttribute(
      "aria-valuenow",
      String(Math.min(filed, config.expectedAnomalies)),
    );
    [...meter.children].forEach((cell, i) =>
      cell.classList.toggle("on", i < filed),
    );
    reportButton.innerHTML = "";
    reportButton.append(
      h(
        "span",
        { class: "report-bang", "aria-hidden": "true" },
        reportMode ? "×" : "!",
      ),
      reportMode ? "CANCEL REPORT" : "REPORT SIGHTING",
    );
    reportButton.classList.toggle("is-active", reportMode);
    reportButton.setAttribute("aria-pressed", String(reportMode));
  }

  function setReportMode(on: boolean): void {
    if (finished || wrapping || !session) return;
    if (on === reportMode) return;
    reportMode = on;
    playSfx(on ? "select" : "cancel");
    workspace.classList.toggle("is-reporting", on);
    banner.hidden = !on;
    for (const view of views) {
      view.root.tabIndex = on ? 0 : -1;
      view.root.setAttribute("role", on ? "button" : "group");
      view.root.setAttribute(
        "aria-label",
        on
          ? `Report anomaly on ${view.feed.label} ${view.feed.location}`
          : `${view.feed.label} ${view.feed.location}`,
      );
    }
    setStatus(on ? "REPORT MODE · SELECT A FEED" : "SYSTEM READY");
    updateReportPanel();
    if (on) (focused ?? views[0])?.root.focus();
  }

  function setFocus(view: FeedView | null): void {
    if (view && view === focused) return;
    if (view && !focused) telemetry.focusModeUses += 1;
    focused = view;
    grid.classList.toggle("is-focus", view !== null);
    grid.style.setProperty("--dock", String(Math.max(1, views.length - 1)));
    for (const v of views) {
      const isFocused = v === view;
      v.root.classList.toggle("is-focused", isFocused);
      v.root.classList.toggle("is-docked", view !== null && !isFocused);
      v.focusButton.replaceChildren(
        icon(isFocused ? ICONS.restore : ICONS.focus),
      );
      const label = isFocused
        ? "Restore grid"
        : `Focus ${v.feed.label} ${v.feed.location}`;
      v.focusButton.setAttribute("aria-label", label);
      v.focusButton.title = label;
      v.focusButton.setAttribute("aria-pressed", String(isFocused));
    }
    restoreButton.hidden = view === null;
  }

  async function submit(
    view: FeedView | undefined,
    source: AnomalyReport["source"],
    transcript?: string,
  ): Promise<void> {
    if (!view || !session || finished || wrapping) return;
    setReportMode(false);
    const report: AnomalyReport = {
      cameraId: view.feed.id,
      timestamp: shiftT,
      source,
      transcript,
    };
    let receipt;
    try {
      receipt = await service.submitReport(session.shiftId, report);
    } catch (error) {
      console.error("Report failed.", error);
      setStatus("REPORT FAILED · CHECK CONNECTION");
      return;
    }
    if (receipt.duplicate) {
      // Same anomaly reported again: it doesn't count.
      playSfx("deny");
      setStatus(`ALREADY REPORTED · ${view.feed.label}`);
      return;
    }
    telemetry.reports.push(report);
    updateReportPanel();
    playSfx("send");
    view.root.classList.remove("is-reported");
    void view.root.offsetWidth; // restart the stamp animation
    view.root.classList.add("is-reported");
    window.setTimeout(() => view.root.classList.remove("is-reported"), 1800);
    setStatus(`REPORT SENT · ${view.feed.label}`);
    if (receipt.suspect) marks.set(receipt.suspect.npcId, { kind: "marked" });
    desk.start(
      {
        camera: view.index + 1,
        location: view.feed.location,
        reportedBehavior: null,
        description: transcript ?? null,
        suspect: receipt.suspect?.behavior ?? null,
        npcId: receipt.suspect?.npcId ?? null,
      },
      deskT,
    );
  }

  // --- Knights and the dispatcher's script -----------------------------------
  /**
   * Follows the knights in the world: a marked suspect turns CAPTURED when a
   * knight reaches them, and loses the box once they've left the building.
   */
  function updateMarks(): void {
    if (!lastSnapshot) return;
    const here = new Map(lastSnapshot.npcs.map((n) => [n.id, n]));
    for (const [id, mark] of marks) {
      const npc = here.get(id);
      if (!npc) marks.delete(id);
      else if (npc.detained && mark.kind !== "captured") {
        marks.set(id, { kind: "captured" });
        playSfx("send");
      }
    }
  }

  /** Updates a feed's dispatch badge as the player hears each line. */
  function followScript(line: InvestigationLine): void {
    const view = views[line.camera - 1];
    if (view) setBadge(view, line);
  }

  function setBadge(view: FeedView, line: InvestigationLine): void {
    const { stage } = line;
    const outcome =
      line.outcome ?? (line.case.suspect !== null ? "caught" : "nothing");
    view.badge.textContent =
      stage === "resolved"
        ? outcome === "caught"
          ? "DISPATCH · SUSPECT CAPTURED"
          : outcome === "escaped"
            ? "DISPATCH · SUSPECT ESCAPED"
            : "DISPATCH · FALSE REPORT, CLEARED"
        : STAGE_BADGES[stage];
    view.badge.dataset.tone =
      stage === "resolved" || stage === "closed"
        ? outcome === "caught"
          ? "good"
          : "bad"
        : "info";
    view.badge.hidden = false;
    window.clearTimeout(view.badgeTimer);
    if (stage === "closed" || stage === "late") {
      view.badgeTimer = window.setTimeout(() => {
        view.badge.hidden = true;
      }, BADGE_LINGER_MS);
    }
  }

  /** Positions the MARKED / CAPTURED boxes over the people the feed drew. */
  function syncMarks(view: FeedView): void {
    const seen = new Set<string>();
    for (const box of view.renderer.markBoxes) {
      seen.add(box.npcId);
      let el = view.markBoxes.get(box.npcId);
      if (!el) {
        el = h(
          "div",
          { class: "feed-mark" },
          h("span", { class: "feed-mark-tag" }),
        );
        view.marks.append(el);
        view.markBoxes.set(box.npcId, el);
      }
      if (el.dataset.kind !== box.mark.kind) {
        el.dataset.kind = box.mark.kind;
        el.firstElementChild!.textContent = MARK_TAGS[box.mark.kind];
      }
      el.style.transform = `translate(${Math.round(box.left)}px, ${Math.round(box.top)}px)`;
      el.style.width = `${Math.round(box.width)}px`;
      el.style.height = `${Math.round(box.height)}px`;
    }
    for (const [id, el] of view.markBoxes) {
      if (seen.has(id)) continue;
      el.remove();
      view.markBoxes.delete(id);
    }
  }

  function drawFeeds(): void {
    updateMarks();
    for (const view of views) {
      // deskT keeps running after the watch, so people still walk.
      view.renderer.draw(lastSnapshot, deskT, marks);
      syncMarks(view);
    }
  }

  function buildFeeds(s: ShiftSession): void {
    minimap.setMap(s.map);
    views = s.cameras.map((feed, index) => {
      const canvas = h("canvas", {
        class: "feed-canvas",
        "aria-hidden": "true",
      });
      const rec = h("span", { class: "feed-rec" });
      const marksLayer = h("div", {
        class: "feed-marks",
        "aria-hidden": "true",
      });
      const badge = h("span", {
        class: "feed-dispatch",
        role: "status",
        hidden: true,
      });
      const focusButton = h("button", {
        type: "button",
        class: "feed-focus",
        "aria-pressed": "false",
      });
      const root = h(
        "article",
        {
          class: "feed",
          role: "group",
          tabindex: "-1",
          "data-camera": feed.id,
        },
        h(
          "header",
          { class: "feed-title" },
          h(
            "span",
            { class: "rec-dot", title: "Recording" },
            h("span", { class: "sr-only" }, "Recording"),
          ),
          h("span", { class: "feed-id" }, `${feed.label}.LIVE`),
          focusButton,
        ),
        h(
          "div",
          { class: "feed-view" },
          canvas,
          marksLayer,
          h("div", { class: "feed-scan", "aria-hidden": "true" }),
          h(
            "div",
            { class: "feed-corners", "aria-hidden": "true" },
            h("i"),
            h("i"),
            h("i"),
            h("i"),
          ),
          h("span", { class: "feed-loc" }, feed.location.toUpperCase()),
          rec,
          h("span", { class: "feed-glitch-label" }, "SYNC LOSS"),
          h("span", { class: "feed-stamp" }, "REPORT SENT"),
          badge,
          feed.online
            ? null
            : h("span", { class: "feed-offline" }, "NO SIGNAL"),
        ),
      );
      const view: FeedView = {
        feed,
        index,
        root,
        rec,
        focusButton,
        marks: marksLayer,
        markBoxes: new Map(),
        badge,
        badgeTimer: 0,
        renderer: new FeedRenderer(
          canvas,
          feed,
          s.map,
          config.level,
          plan.highlight,
          plan.aura,
        ),
      };
      focusButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (reportMode) return void submit(view, "manual");
        playSfx("click");
        setFocus(focused === view ? null : view);
      });
      root.addEventListener("click", () => {
        if (reportMode) void submit(view, "manual");
        else if (focused && focused !== view) {
          playSfx("blip");
          setFocus(view);
        }
      });
      root.addEventListener("keydown", (event) => {
        if (reportMode && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.stopPropagation();
          void submit(view, "manual");
        }
      });
      return view;
    });
    grid.append(...views.map((v) => v.root));
    setFocus(null);
    const live = s.cameras.filter((c) => c.online).length;
    online.replaceChildren(
      h("i", { class: "status-led", "aria-hidden": "true" }),
      `${live} CAMERAS ONLINE`,
    );
    updateTimer(0);
  }

  // --- Frame loop -------------------------------------------------------------
  let last = performance.now();
  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (!session) return;
    const dt = Math.min((now - last) / 1000, MAX_DT);
    last = now;
    if (wrapping) {
      // No more reports or attention tracking, but the building keeps moving
      // so knights can finish their jobs while dispatch closes out.
      const ticked = session.tick(dt);
      deskT = ticked.t;
      lastSnapshot = ticked.snapshot;
      desk.update(deskT);
      drawFeeds();
      checkWrapUp(now);
      return;
    }
    const { t, snapshot } = session.tick(dt);
    shiftT = deskT = t;
    lastSnapshot = snapshot;
    desk.update(t);

    const source = gazeController.getSource(now);
    const point = gazeController.getPoint(now);
    const box = ctx.root.getBoundingClientRect();
    const gx = point ? box.left + point.x * box.width : -1;
    const gy = point ? box.top + point.y * box.height : -1;
    const onPopup = point !== null && distractions.hitTest(gx, gy);
    let watched: FeedView | null = null;
    if (point && !onPopup) {
      watched =
        views.find((v) => {
          const r = v.root.getBoundingClientRect();
          return (
            r.width > 0 &&
            gx >= r.left &&
            gx < r.right &&
            gy >= r.top &&
            gy < r.bottom
          );
        }) ?? null;
    }
    session.recordGaze({
      x: point?.x ?? null,
      y: point?.y ?? null,
      source,
      cameraId: watched?.feed.id ?? null,
      world: watched ? watched.renderer.toWorld(gx, gy) : null,
    });
    if (source === "tracker") telemetry.webcamUsed = true;
    if (attention.update({ t, source, cameraId: watched?.feed.id ?? null }))
      attentionLapse();

    for (const view of views)
      view.root.classList.toggle("is-watched", view === watched);
    drawFeeds();
    reticle.hidden = source !== "tracker";
    if (source === "tracker")
      reticle.style.transform = `translate(${gx - box.left}px, ${gy - box.top}px)`;

    distractions.update(t, onPopup);
    if (plan.glitches) glitches.update(t);
    updateQuestions(t);
    updateTimer(t);
    if (t >= config.durationSeconds) beginWrapUp(true);
  }

  /** The gaze has been off every feed too long: ring the alarm and flash. */
  function attentionLapse(): void {
    playSfx("attentionAlarm");
    setStatus(`ATTENTION LOST · -${ATTENTION_LAPSE_PENALTY} POINTS`);
    stage.classList.remove("is-attention-lost");
    void stage.offsetWidth; // restart the flash
    stage.classList.add("is-attention-lost");
    window.clearTimeout(lapseFlashTimer);
    lapseFlashTimer = window.setTimeout(() => {
      stage.classList.remove("is-attention-lost");
      if (!wrapping && !reportMode) setStatus("SYSTEM READY");
    }, LAPSE_FLASH_MS);
  }

  // --- End of shift -------------------------------------------------------------
  /**
   * Ends the watch: no more reports or walk-ins, knights finish their jobs,
   * and every dispatch line still to come is played (auto-play is forced on).
   * The debrief opens once dispatch has closed every call and signed off
   * (checkWrapUp).
   */
  function beginWrapUp(completed: boolean): void {
    if (wrapping || finished || !session) return;
    setReportMode(false);
    wrapping = true;
    session.endWatch?.(shiftT);
    completedShift = completed;
    lastDispatchProgress = performance.now();
    glitches.destroy();
    reticle.hidden = true;
    for (const view of views) view.root.classList.remove("is-watched");
    reportButton.disabled = true;
    endButton.disabled = true;
    endButton.textContent = "WAITING FOR DISPATCH...";
    wrapBanner.hidden = false;
    workspace.classList.add("is-wrapping");
    timer.textContent = "SHIFT OVER";
    timer.classList.remove("is-ending");
    setStatus("SHIFT OVER · DISPATCH CLOSING OUT CALLS");
    // An open check-in can't be answered any more.
    question = null;
    radio.setPrompt("");
    // Fit dispatch's remaining audio into OVERRUN_LIMIT_S: investigations go
    // straight to their outcomes, and filler lines nobody heard yet are
    // dropped until the rest fits before the sign-off.
    wrapStartedAt = performance.now();
    desk.hurry(deskT);
    radio.drain(
      OVERRUN_LIMIT_S -
        signOffSeconds -
        LINE_ALLOWANCE_S * (desk.remainingLines + 1),
    );
  }

  function checkWrapUp(now: number): void {
    if (finished) return;
    // Last resort when the estimates ran long: stop queueing, then cut off
    // whatever is playing, so the sign-off still ends in time.
    const signOffDue = OVERRUN_LIMIT_S - signOffSeconds;
    const since = (now - wrapStartedAt) / 1000;
    if (!signedOff && cutStage < 1 && since > signOffDue - LINE_ALLOWANCE_S) {
      cutStage = 1;
      console.warn("[dispatch] Out of time after the shift; dropping lines.");
      desk.destroy();
      radio.cut(false);
    }
    if (!signedOff && cutStage < 2 && since > signOffDue) {
      cutStage = 2;
      radio.cut(true);
    }
    if (now - lastDispatchProgress > WRAP_UP_STALL_MS) {
      console.warn(
        "[dispatch] No radio progress after the shift; filing the debrief.",
      );
      void finish(completedShift);
      return;
    }
    if (desk.busy || radio.busy) return;
    if (!signedOff) {
      // Every call is closed: dispatch signs off, then the debrief opens.
      signedOff = true;
      lastDispatchProgress = now;
      radio.receive(
        {
          headline: "SHIFT END",
          text: dispatchText("shift_end"),
          play: () => sayDispatch("shift_end"),
          onStart: () => (lastDispatchProgress = performance.now()),
        },
        600,
      );
      return;
    }
    void finish(completedShift);
  }

  // --- Keyboard ---------------------------------------------------------------
  const typing = (target: EventTarget | null) =>
    target instanceof HTMLElement && target.closest("input, textarea, select");
  function onKeyDown(event: KeyboardEvent): void {
    if (finished || typing(event.target)) return;
    if (event.code === "Space") {
      // Hold Space to talk on the radio.
      event.preventDefault();
      if (!event.repeat) radio.spaceDown();
      return;
    }
    if (event.key === "Escape") {
      if (reportMode) setReportMode(false);
      else if (focused) setFocus(null);
      return;
    }
    if (event.key === "r" || event.key === "R") {
      if (!event.ctrlKey && !event.metaKey && !event.altKey)
        setReportMode(!reportMode);
      return;
    }
    const n = Number(event.key);
    if (reportMode && Number.isInteger(n) && n >= 1 && n <= views.length) {
      void submit(views[n - 1], "manual");
    }
  }
  function onKeyUp(event: KeyboardEvent): void {
    if (event.code === "Space" && !typing(event.target)) {
      event.preventDefault();
      radio.spaceUp();
    }
  }
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // --- Lifecycle --------------------------------------------------------------
  function stopRuntime(): void {
    cancelAnimationFrame(raf);
    window.clearTimeout(lapseFlashTimer);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    distractions.destroy();
    glitches.destroy();
    desk.destroy();
    radio.destroy();
    for (const view of views) view.renderer.destroy();
  }

  async function finish(completed: boolean): Promise<void> {
    if (finished || !session) return;
    finished = true;
    telemetry.popupsDisplayed = distractions.displayed;
    telemetry.popupsDismissed = distractions.dismissed;
    telemetry.popupGaze = distractions.gaze.map((span) => ({ ...span }));
    stopRuntime();
    setStatus("FILING DEBRIEF...");
    try {
      const result = await service.completeShift(session.shiftId, {
        completed,
        telemetry,
      });
      session = null;
      if (!disposed) ctx.go("debrief", { result, announce: true });
    } catch (error) {
      console.error("Could not complete the shift.", error);
      setStatus("DEBRIEF FAILED · RETURNING TO DESKTOP");
      window.setTimeout(() => !disposed && ctx.go("desktop"), 1500);
    }
  }

  function exitToDesktop(): void {
    ctx.go("desktop");
  }

  void service
    .startShift(config)
    .then((s) => {
      if (disposed) return service.abandonShift(s.shiftId);
      session = s;
      buildFeeds(s);
      setStatus("SYSTEM READY");
      last = performance.now();
      raf = requestAnimationFrame(frame);
      radio.receive(
        {
          headline: "SHIFT START",
          optional: true,
          text: dispatchText("shift_start"),
          play: () => sayDispatch("shift_start"),
        },
        1800,
      );
    })
    .catch((error) => {
      console.error("Could not start the shift.", error);
      setStatus("SHIFT FAILED TO START");
      online.textContent = "0 CAMERAS ONLINE";
    });

  return () => {
    disposed = true;
    if (!finished) {
      stopRuntime();
      if (session) service.abandonShift(session.shiftId);
    }
    win.root.remove();
  };
};
