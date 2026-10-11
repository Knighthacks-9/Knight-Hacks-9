// Screen 4: SHIFT_DEBRIEF.LOG, the attention and performance debrief.
import {
  debriefFacts,
  debriefTemplate,
  playSfx,
  speak,
  stopSpeaking,
  writeDispatchLine,
} from "../../audio";
import type { Screen } from "../context";
import { h, mmss } from "../dom";
import { MISSED_PREFIX, type ShiftResult, type TimelineRow } from "../service";
import { openFloatingWindow } from "../window";

const secs = (ms: number | null) =>
  ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;

export const mountDebrief: Screen = (ctx, params) => {
  const result = params.result;
  let minimized = false;
  let closed = false;
  // The dispatcher's summary: the template now, the AI's wording (spoken)
  // once it arrives. Only read aloud right after a shift.
  const dispatcherLine = h("p", null);
  const dispatch = result?.dispatcherDebrief;
  if (dispatch) {
    const template = debriefTemplate(dispatch);
    dispatcherLine.textContent = `> ${template}`;
    if (params.announce) {
      void writeDispatchLine("debrief", debriefFacts(dispatch), template).then(
        (text) => {
          if (closed) return;
          dispatcherLine.textContent = `> ${text}`;
          void speak(text).catch(() => undefined);
        },
      );
    }
  }
  const win = openFloatingWindow(
    ctx.layer,
    {
      title: "SHIFT_DEBRIEF.LOG",
      className: "debrief",
      onMinimize: () => setMinimized(true),
      maximize: true,
      onClose: () => ctx.go("desktop"),
      closeLabel: "Close and return to desktop",
    },
    (body) => body.append(...(result ? content(result) : empty())),
  );
  win.root.setAttribute("aria-label", "Shift debrief");
  function setMinimized(value: boolean): void {
    minimized = value;
    win.root.hidden = value;
  }
  ctx.setTask("SHIFT_DEBRIEF.LOG", () => setMinimized(!minimized));
  win.body
    .querySelector<HTMLButtonElement>(".btn-go")
    ?.focus({ preventScroll: true });

  function actions(): HTMLElement {
    return h(
      "div",
      { class: "db-actions" },
      h(
        "button",
        {
          type: "button",
          class: "btn95",
          onclick: () => {
            playSfx("click");
            ctx.go("desktop");
          },
        },
        "RETURN TO DESKTOP",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn95 btn-go",
          onclick: () => {
            playSfx("start");
            if (result) ctx.state.level = result.level;
            ctx.go("calibration");
          },
        },
        "REPLAY SHIFT",
      ),
    );
  }

  function empty(): Node[] {
    return [
      h(
        "div",
        { class: "db-empty" },
        h("h1", { class: "pixel-title" }, "NO DEBRIEF ON FILE"),
        h(
          "p",
          null,
          "Complete a shift at the Watch Station to generate an attention debrief.",
        ),
      ),
      actions(),
    ];
  }

  function content(r: ShiftResult): Node[] {
    const best =
      r.personalBest === null
        ? "FIRST RUN ON THIS LEVEL"
        : r.score > r.personalBest
          ? `NEW BEST (+${r.score - r.personalBest})`
          : r.score === r.personalBest
            ? "TIED PERSONAL BEST"
            : `BEST ${r.personalBest} (${r.score - r.personalBest})`;
    const tracked = r.trackingLostSeconds !== null;
    return [
      h(
        "header",
        { class: "db-head" },
        h(
          "div",
          null,
          h(
            "p",
            { class: "db-kicker" },
            `${r.completed ? "SHIFT COMPLETE" : "SHIFT ENDED EARLY"} · LEVEL ${r.level} · ${mmss(r.durationSeconds)}`,
          ),
          h("h1", { class: "pixel-title" }, "ATTENTION DEBRIEF"),
          h(
            "p",
            { class: "db-sub" },
            r.passed ? "STATUS: PASSED" : "STATUS: NOT PASSED",
            " · ",
            new Date(r.finishedAt).toLocaleString(),
          ),
        ),
        h(
          "div",
          {
            class: "db-grade",
            "data-grade": r.grade,
            "aria-label": `Overall grade ${r.grade}`,
          },
          h("span", null, "GRADE"),
          h("b", null, r.grade),
        ),
      ),
      h(
        "section",
        { class: "db-stats", "aria-label": "Primary statistics" },
        stat(
          "OVERALL SCORE",
          String(r.score),
          best,
          r.personalBest !== null && r.score > r.personalBest ? "good" : "",
        ),
        stat(
          "ANOMALIES CAUGHT",
          `${r.caught} / ${r.totalAnomalies}`,
          `${r.expectedAnomalies} expected this level`,
        ),
        stat(
          "DETECTION RATE",
          `${r.detectionRate}%`,
          `${r.missed} missed`,
          r.detectionRate >= 50 ? "good" : "warn",
        ),
        stat(
          "FALSE REPORTS",
          String(r.falseFlags),
          `${r.reportsFiled} ${r.reportsFiled === 1 ? "report" : "reports"} filed`,
          r.falseFlags > r.caught ? "bad" : "",
        ),
        stat(
          "EYE-TRACKED",
          tracked ? `${r.eyeTrackedPercent}%` : "N/A",
          tracked ? "of shift time" : "mouse input this shift",
        ),
        stat(
          "VALID TRACKING",
          tracked ? `${r.eyeTrackedSeconds.toFixed(1)}s` : "—",
          tracked ? `${r.trackingLostSeconds}s lost` : "webcam not used",
        ),
      ),
      ...(dispatch
        ? [
            section(
              "DISPATCHER",
              h(
                "div",
                { class: "db-coach", "aria-live": "polite" },
                dispatcherLine,
              ),
            ),
          ]
        : []),
      h(
        "div",
        { class: "db-columns" },
        section("ATTENTION PER FEED", feedBars(r)),
        section("SHIFT METRICS", metrics(r)),
      ),
      section("ATTENTION TIMELINE", timeline(r)),
      section(
        "COACHING NOTE",
        h(
          "div",
          { class: "db-coach" },
          ...r.coaching.map((line) =>
            h(
              "p",
              { class: line.startsWith(MISSED_PREFIX) ? "is-missed" : null },
              `> ${line}`,
            ),
          ),
        ),
      ),
      actions(),
    ];
  }

  return () => {
    closed = true;
    stopSpeaking();
    win.destroy();
  };
};

function stat(
  label: string,
  value: string,
  note: string,
  tone = "",
): HTMLElement {
  return h(
    "div",
    { class: `db-stat ${tone ? `is-${tone}` : ""}` },
    h("span", { class: "db-stat-label" }, label),
    h("b", null, value),
    h("small", null, note),
  );
}

function section(title: string, body: Node): HTMLElement {
  return h(
    "section",
    { class: "db-section", "aria-label": title },
    h("h3", { class: "db-section-title" }, title),
    body,
  );
}

function feedBars(r: ShiftResult): HTMLElement {
  if (r.perFeedAttention.length === 0)
    return h("p", { class: "db-empty-line" }, "No feeds recorded.");
  const max = Math.max(1, ...r.perFeedAttention.map((f) => f.attentionPercent));
  return h(
    "table",
    { class: "db-feeds" },
    h(
      "thead",
      null,
      h(
        "tr",
        null,
        h("th", null, "CAM"),
        h("th", null, "LOCATION"),
        h("th", null, "ATTENTION"),
        h("th", null, "MISSED"),
      ),
    ),
    h(
      "tbody",
      null,
      ...r.perFeedAttention.map((f) =>
        h(
          "tr",
          null,
          h("td", null, f.label.replace("CAM_", "")),
          h("td", null, f.location.toUpperCase()),
          h(
            "td",
            null,
            h(
              "div",
              {
                class: "db-bar",
                role: "img",
                "aria-label": `${f.attentionPercent}% attention`,
              },
              h("i", { style: `width:${(f.attentionPercent / max) * 100}%` }),
              h("span", null, `${f.attentionPercent}%`),
            ),
          ),
          h(
            "td",
            { class: f.missedEvents ? "is-bad" : "" },
            `${f.missedEvents} / ${f.totalEvents}`,
          ),
        ),
      ),
    ),
  );
}

function metrics(r: ShiftResult): HTMLElement {
  const rows: [string, string][] = [
    ["Avg report response", secs(r.averageReportTimeMs)],
    ["Fastest report", secs(r.fastestReportTimeMs)],
    ["Longest focus streak", secs(r.longestFocusStreakMs)],
    ["Camera coverage", `${r.cameraCoveragePercent}%`],
    ["Feed switches", String(r.focusSwitches)],
    ["Focus mode used", `${r.focusModeUses}×`],
    ["Pop-ups displayed", String(r.popupsDisplayed)],
    ["Pop-ups dismissed", String(r.popupsDismissed)],
    ["Time reading pop-ups", secs(r.popupReadingMs)],
    ["Avg dispatch unmute", secs(r.dispatcherResponseTimeMs)],
    [
      "Eye tracking lost",
      r.trackingLostSeconds === null ? "N/A" : `${r.trackingLostSeconds}s`,
    ],
    ["Most-watched", r.mostWatched ?? "—"],
    ["Least-watched", r.leastWatched ?? "—"],
    [
      "Attention in anomaly windows",
      r.anomalyAttentionPercent === null
        ? "—"
        : `${r.anomalyAttentionPercent}%`,
    ],
    ["False-positive rate", `${r.falsePositiveRate}%`],
    [
      "Missed anomalies",
      `${r.missed} (${r.missedWhileLooking} while watching)`,
    ],
  ];
  return h(
    "dl",
    { class: "db-metrics" },
    ...rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]),
  );
}

function timeline(r: ShiftResult): HTMLElement {
  const duration = Math.max(r.durationSeconds, 1);
  const pct = (t: number) =>
    `${Math.min(100, Math.max(0, (t / duration) * 100)).toFixed(2)}%`;
  const lane = (row: TimelineRow) =>
    h(
      "div",
      { class: `tl-row tl-${row.kind}` },
      h("span", { class: "tl-label", title: row.label }, row.label),
      h(
        "div",
        { class: "tl-track" },
        ...row.segments.map((s) =>
          h("i", {
            class: `tl-seg seg-${s.kind}`,
            style: `left:${pct(s.start)};width:${pct(Math.max(s.end - s.start, duration * 0.004))}`,
          }),
        ),
        ...row.reports.map((m) =>
          h("b", {
            class: `tl-mark ${m.correct ? "is-hit" : "is-false"}`,
            style: `left:${pct(m.t)}`,
            title: `${m.correct ? "Correct report" : "False report"} at ${mmss(m.t)}`,
          }),
        ),
      ),
    );
  const hasGaze = r.timeline.some((row) =>
    row.segments.some((s) => s.kind === "gaze"),
  );
  return h(
    "div",
    { class: "tl", role: "img", "aria-label": "Attention timeline by camera" },
    ...r.timeline.map(lane),
    h(
      "div",
      { class: "tl-axis" },
      h("span", null),
      h(
        "div",
        null,
        h("span", null, "00:00"),
        h("span", null, mmss(duration / 2)),
        h("span", null, mmss(duration)),
      ),
    ),
    h(
      "div",
      { class: "tl-legend" },
      legend("seg-gaze", "Observed"),
      legend("seg-anomaly", "Anomaly window"),
      legend("seg-off", "Off-feed"),
      legend("seg-popup", "Reading pop-up"),
      legend("tl-mark is-hit", "Correct report"),
      legend("tl-mark is-false", "False report"),
    ),
    hasGaze
      ? null
      : h(
          "p",
          { class: "db-empty-line" },
          "No gaze samples were recorded this shift.",
        ),
  );
}

function legend(cls: string, text: string): HTMLElement {
  return h(
    "span",
    { class: "tl-key" },
    h("i", { class: cls, "aria-hidden": "true" }),
    text,
  );
}
