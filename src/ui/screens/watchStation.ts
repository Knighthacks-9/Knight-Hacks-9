// Screen 3: WATCH_STATION.EXE, the maximized shift window. Camera workspace
// on the left (2 to 6 feeds, focus mode, report mode, pop-ups, glitches);
// side console on the right (report control, dispatch radio, end shift).
//
// The feeds follow the dispatcher's script as each line is heard: the
// reported person is MARKED, an officer appears on scene, and a caught
// suspect is boxed as CAPTURED and held. When the shift ends the feeds
// freeze and dispatch closes out every open call before the debrief.
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
import { DistractionManager } from "../watch/distractions";
import { FeedRenderer, type PersonMark } from "../watch/feedRenderer";
import { GlitchScheduler } from "../watch/glitch";
import { createMinimap } from "../watch/minimap";
import { DispatchRadio, type RadioMessage } from "../watch/radio";
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
  en_route: "DISPATCH · UNIT EN ROUTE",
  on_scene: "DISPATCH · UNIT ON SCENE",
  closed: "DISPATCH · CASE CLOSED",
  late: "DISPATCH · LOGGED",
};

const MARK_TAGS: Record<PersonMark["kind"], string> = {
  marked: "MARKED",
  captured: "CAPTURED",
  cleared: "CLEARED",
};

/** How long a closed case's badge stays on its feed. */
const BADGE_LINGER_MS = 4000;
/** After the shift, give up waiting on dispatch if nothing happens for this long. */
const WRAP_UP_STALL_MS = 45_000;

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
  let lastDispatchProgress = 0;
  /** Dispatch's marks on people, by NPC id. */
  const marks = new Map<string, PersonMark>();
  let lastSnapshot: WorldSnapshot | null = null;
  let shownSecond = -1;
  let reportMode = false;
  let focused: FeedView | null = null;
  let views: FeedView[] = [];
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
    "Press REPORT SIGHTING (or R), then click the feed where something changed. Number keys 1–9 pick a feed. ESC cancels.",
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
    h("p", { class: "rc-hint" }, "Use when anything in a feed changes."),
    help,
  );

  const radio = new DispatchRadio({
    onUnmute: (delay) => telemetry.unmuteDelaysMs.push(delay),
    onTranscript: (text, provider) => {
      eventBus.emit("radio:report", { text, t: shiftT, provider });
      const n = parseCameraCommand(text, views.length);
      if (!session || finished || wrapping) return "SHIFT NOT ACTIVE";
      if (n === null) return `"${text.toUpperCase()}" · CAMERA NOT RECOGNIZED`;
      void submit(views[n - 1], "voice", text);
      return `VOICE REPORT FILED: ${views[n - 1].feed.label}`;
    },
  });
  const radioPanel = panel("AI DISPATCH RADIO", null, radio.root);

  // Each filed report is investigated over the radio; the world decides the
  // outcome, the AI dispatcher only words it. Every report gets the full
  // investigation: the shift waits for dispatch to finish (see beginWrapUp).
  const desk = new InvestigationDesk({
    shiftSeconds: config.durationSeconds,
    fitToShift: false,
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
  ctx.setTask("WATCH_STATION.EXE");
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

  // --- Following the dispatcher's script --------------------------------------
  /** Updates the feeds as the player hears each investigation line. */
  function followScript(line: InvestigationLine): void {
    const c = line.case;
    const view = views[line.camera - 1];
    const npc = c.npcId;
    const mark = npc ? marks.get(npc) : undefined;
    switch (line.stage) {
      case "acknowledged":
      case "late":
        if (npc) marks.set(npc, { kind: "marked", unit: false });
        break;
      case "on_scene":
        // The officer appears beside the subject (wherever they are now), or
        // checks the reported area when there was nobody to point at.
        if (mark) mark.unit = true;
        else if (!npc) view?.renderer.setUnitOnScene(true);
        break;
      case "resolved":
        if (npc && c.suspect) {
          session?.detain?.(npc);
          marks.set(npc, { kind: "captured", unit: true });
          playSfx("send");
        } else if (npc) {
          marks.set(npc, { kind: "cleared", unit: true });
        }
        break;
      case "closed":
        // Cleared people go about their business; a captured suspect stays
        // boxed until they're led out of view.
        if (npc && mark?.kind === "cleared") marks.delete(npc);
        view?.renderer.setUnitOnScene(false);
        break;
    }
    if (view) setBadge(view, line);
  }

  function setBadge(view: FeedView, line: InvestigationLine): void {
    const { stage } = line;
    const caught = line.case.suspect !== null;
    view.badge.textContent =
      stage === "resolved"
        ? caught
          ? "DISPATCH · SUSPECT CAPTURED"
          : "DISPATCH · FALSE REPORT, CLEARED"
        : STAGE_BADGES[stage];
    view.badge.dataset.tone =
      stage === "resolved" || stage === "closed"
        ? caught
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
    for (const view of views) {
      view.renderer.draw(lastSnapshot, shiftT, marks);
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
      // The world holds still on its last frame; dispatch keeps going.
      deskT += dt;
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

    for (const view of views)
      view.root.classList.toggle("is-watched", view === watched);
    drawFeeds();
    reticle.hidden = source !== "tracker";
    if (source === "tracker")
      reticle.style.transform = `translate(${gx - box.left}px, ${gy - box.top}px)`;

    distractions.update(t, onPopup);
    if (plan.glitches) glitches.update(t);
    updateTimer(t);
    if (t >= config.durationSeconds) beginWrapUp(true);
  }

  // --- End of shift -------------------------------------------------------------
  /**
   * Ends the watch: no more reports, the feeds freeze, and every dispatch
   * line still to come is played (auto-play is forced on). The debrief opens
   * once dispatch has closed every call and signed off (checkWrapUp).
   */
  function beginWrapUp(completed: boolean): void {
    if (wrapping || finished || !session) return;
    setReportMode(false);
    wrapping = true;
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
    radio.drain();
  }

  function checkWrapUp(now: number): void {
    if (finished) return;
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
