import type {
  EventOutcome,
  GazeSegment,
  ShiftReport,
  SuspiciousBehavior,
} from "../shared/types";

const OUTCOME_LABELS: Record<EventOutcome | "false-flag", string> = {
  caught: "Caught",
  "missed-not-looking": "Missed (not looking)",
  "missed-looking": "Missed (looking)",
  "false-flag": "False flag",
};

const BEHAVIOR_LABELS: Record<SuspiciousBehavior, string> = {
  loitering: "Loitering",
  revisitingDoors: "Revisiting doors",
  restrictedZone: "Entered restricted zone",
  avoidingCameras: "Avoiding cameras",
};

const seconds = (value: number) => `${value.toFixed(1)}s`;
const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Glances shorter than this (tracker jitter, passing over a feed) don't break a span. */
export const MIN_GLANCE_SECONDS = 0.3;

/** One unbroken stretch of attention on a single feed. */
export interface AttentionSpan {
  cameraId: string;
  start: number;
  seconds: number;
}

/** Turns the gaze timeline into attention spans, ignoring brief glances. */
export function attentionSpans(
  timeline: readonly GazeSegment[],
): AttentionSpan[] {
  const spans: { cameraId: string | null; start: number; seconds: number }[] =
    [];
  for (const segment of timeline) {
    if (segment.end - segment.start < MIN_GLANCE_SECONDS) continue;
    const last = spans.at(-1);
    if (last && last.cameraId === segment.cameraId) {
      last.seconds = segment.end - last.start;
    } else {
      spans.push({
        cameraId: segment.cameraId,
        start: segment.start,
        seconds: segment.end - segment.start,
      });
    }
  }
  // Time off every feed ends a span but isn't one itself.
  return spans.filter((span): span is AttentionSpan => span.cameraId !== null);
}

/** Smallest step from `steps` that splits `max` into at most `count` ticks. */
const tickStep = (max: number, count: number, steps: number[]) =>
  steps.find((step) => max / step <= count) ?? steps.at(-1)!;

interface ChartPoint {
  t: number;
  value: number;
  tip: string;
}

interface LineChartOptions {
  label: string;
  duration: number;
  /** Each run is drawn as its own line, so gaps between runs stay empty. */
  runs: ChartPoint[][];
  unit: string;
  yTickSteps: number[];
  /** Dashed reference line, e.g. the average. */
  reference?: { value: number; label: string };
  /** Short vertical markers along the bottom, e.g. when you flagged. */
  marks?: { t: number; tip: string }[];
}

/** Inline SVG line chart with time on the x-axis; hover a point for its tip. */
function lineChart({
  label,
  duration,
  runs,
  unit,
  yTickSteps,
  reference,
  marks = [],
}: LineChartOptions): string {
  const W = 640;
  const H = 200;
  const left = 44;
  const right = 12;
  const top = 12;
  const bottom = 26;
  const spanX = Math.max(duration, 0.01);
  const largest = Math.max(0.01, ...runs.flat().map((p) => p.value));
  const yStep = tickStep(largest, 4, yTickSteps);
  const yMax = Math.ceil(largest / yStep) * yStep;
  const xStep = tickStep(spanX, 6, [5, 10, 15, 30, 60, 120, 300]);
  const x = (t: number) => left + (t / spanX) * (W - left - right);
  const y = (v: number) => top + (1 - v / yMax) * (H - top - bottom);

  const yTicks: string[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += yStep) {
    yTicks.push(`
      <line class="grid" x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" />
      <text class="tick" x="${left - 6}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${v}${unit}</text>`);
  }
  const xTicks: string[] = [];
  for (let t = 0; t <= spanX + 1e-9; t += xStep) {
    xTicks.push(
      `<text class="tick" x="${x(t)}" y="${H - 8}" text-anchor="middle">${t}s</text>`,
    );
  }

  const lines = runs
    .map((run) =>
      run
        .map(
          (p, i) =>
            `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`,
        )
        .join(""),
    )
    .map((d) => `<path class="line" d="${d}" />`)
    .join("");
  const points = runs
    .flat()
    .map(
      (p) => `
      <g class="chart-point">
        <circle class="hit" cx="${x(p.t)}" cy="${y(p.value)}" r="9" />
        <circle class="dot" cx="${x(p.t)}" cy="${y(p.value)}" r="4" />
        <title>${p.tip}</title>
      </g>`,
    )
    .join("");
  const markLines = marks
    .map(
      (m) => `
      <g class="chart-mark">
        <line x1="${x(m.t)}" x2="${x(m.t)}" y1="${top}" y2="${H - bottom}" />
        <line class="mark-hit" x1="${x(m.t)}" x2="${x(m.t)}" y1="${top}" y2="${H - bottom}" />
        <title>${m.tip}</title>
      </g>`,
    )
    .join("");
  const ref = reference
    ? `
      <line class="avg" x1="${left}" x2="${W - right}" y1="${y(reference.value)}" y2="${y(reference.value)}" />
      <text class="tick" x="${W - right}" y="${y(reference.value) - 5}" text-anchor="end">${reference.label}</text>`
    : "";

  return `
    <svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
      ${yTicks.join("")}
      ${xTicks.join("")}
      ${markLines}
      ${ref}
      ${lines}
      ${points}
    </svg>`;
}

/** Line chart of attention span length over the shift. */
function attentionChart(
  spans: AttentionSpan[],
  duration: number,
  name: (id: string | null) => string,
): string {
  if (spans.length < 2) {
    return '<p class="empty">Not enough gaze data to chart your attention span.</p>';
  }
  const longest = Math.max(...spans.map((s) => s.seconds));
  const average = spans.reduce((sum, s) => sum + s.seconds, 0) / spans.length;
  return lineChart({
    label: `Attention span over the shift: ${spans.length} spans, average ${seconds(average)}, longest ${seconds(longest)}`,
    duration,
    unit: "s",
    yTickSteps: [1, 2, 5, 10, 15, 30, 60, 120],
    runs: [
      spans.map((s) => ({
        t: s.start,
        value: s.seconds,
        tip: `${name(s.cameraId)} at ${seconds(s.start)}: stayed ${seconds(s.seconds)}`,
      })),
    ],
    reference: { value: average, label: `avg ${seconds(average)}` },
  });
}

/** Samples further apart than this start a new line (no suspect was visible in between). */
const DISTANCE_GAP_SECONDS = 1;

/** Line chart of how far the gaze was from the nearest visible suspect. */
function distanceChart(report: ShiftReport): string {
  const runs: ChartPoint[][] = [];
  let run: ChartPoint[] = [];
  let lastT = -Infinity;
  for (const sample of report.gazeDistance) {
    if (sample.tiles === null || sample.t - lastT > DISTANCE_GAP_SECONDS) {
      if (run.length) runs.push(run);
      run = [];
    }
    lastT = sample.t;
    if (sample.tiles === null) continue;
    run.push({
      t: sample.t,
      value: sample.tiles,
      tip: `${seconds(sample.t)}: ${sample.tiles.toFixed(1)} tiles from the suspect`,
    });
  }
  if (run.length) runs.push(run);

  const values = runs.flat().map((p) => p.value);
  if (values.length < 2) {
    return '<p class="empty">No suspect was on your feeds while your gaze was tracked.</p>';
  }
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;
  return lineChart({
    label: `Distance from your gaze to the nearest suspect: average ${average.toFixed(1)} tiles, closest ${Math.min(...values).toFixed(1)} tiles`,
    duration: report.duration,
    unit: "",
    yTickSteps: [1, 2, 5, 10, 20, 50],
    runs,
    reference: { value: average, label: `avg ${average.toFixed(1)} tiles` },
    marks: report.events
      .filter((e) => e.flaggedAt !== null)
      .map((e) => ({
        t: e.flaggedAt!,
        tip: `Flagged at ${seconds(e.flaggedAt!)}`,
      })),
  });
}

/** HTML for the debrief panel. `cameraNames` maps camera ids to display names. */
export function buildDebriefMarkup(
  report: ShiftReport,
  cameraNames: ReadonlyMap<string, string> = new Map(),
): string {
  const name = (id: string | null) =>
    id === null ? "Off feeds" : (cameraNames.get(id) ?? id);
  const caught = report.events.filter((e) => e.outcome === "caught").length;

  const eventItems = [
    ...report.events.map((event) => ({
      t: event.start,
      html: `
        <li>
          <span class="label">${BEHAVIOR_LABELS[event.behavior]}</span>
          <span class="pill ${event.outcome}">${OUTCOME_LABELS[event.outcome]}</span>
          <span class="meta">${event.cameraIds.map(name).join(", ")} · ${seconds(event.start)}–${event.end === null ? "end" : seconds(event.end)} · watched ${seconds(event.watchedSeconds)}</span>
        </li>`,
    })),
    ...report.falseFlags.map((flag) => ({
      t: flag.t,
      html: `
        <li>
          <span class="label">Flagged an innocent person</span>
          <span class="pill false-flag">${OUTCOME_LABELS["false-flag"]}</span>
          <span class="meta">${name(flag.cameraId)} · ${seconds(flag.t)}</span>
        </li>`,
    })),
  ]
    .sort((a, b) => a.t - b.t)
    .map((item) => item.html)
    .join("");

  const maxShare = Math.max(0.01, ...report.feeds.map((feed) => feed.share));
  const neglect = report.feeds
    .map(
      (feed) => `
        <div class="stat">
          <span>${name(feed.cameraId)}</span>
          <strong>${percent(feed.share)}</strong>
          <small>${feed.missed} missed / ${feed.events} events</small>
        </div>`,
    )
    .join("");
  const heat = report.feeds
    .map(
      (feed) => `
        <div class="heat-cell" title="${seconds(feed.watchedSeconds)} watched" style="--heat: ${(feed.share / maxShare).toFixed(2)}">
          <span class="heat-scene">${name(feed.cameraId)}</span>
          <span class="heat-value">${seconds(feed.watchedSeconds)}</span>
        </div>`,
    )
    .join("");

  // One lane per feed: where the gaze was over the shift, with event windows.
  const span = Math.max(report.duration, 0.01);
  const lanes = [...report.feeds.map((feed) => feed.cameraId), null]
    .map((cameraId) => {
      const gaze = report.timeline
        .filter((s) => s.cameraId === cameraId && s.end > s.start)
        .map(
          (s) =>
            `<i class="gaze" style="left:${(100 * s.start) / span}%;width:${(100 * (s.end - s.start)) / span}%"></i>`,
        )
        .join("");
      const windows = report.events
        .filter((e) => cameraId !== null && e.cameraIds.includes(cameraId))
        .map(
          (e) =>
            `<i class="event ${e.outcome}" style="left:${(100 * e.start) / span}%;width:${(100 * ((e.end ?? span) - e.start)) / span}%"></i>`,
        )
        .join("");
      return `
        <div class="lane">
          <span class="lane-label">${name(cameraId)}</span>
          <div class="lane-track">${windows}${gaze}</div>
        </div>`;
    })
    .join("");

  return `
    <section class="analytics-panel">
      <h2>Shift debrief · Level ${report.level}</h2>
      <div class="summary-grid">
        <div class="metric"><span>Score</span><strong>${report.score}</strong></div>
        <div class="metric"><span>Caught</span><strong>${caught} / ${report.events.length}</strong></div>
        <div class="metric"><span>False flags</span><strong>${report.falseFlags.length}</strong></div>
        <div class="metric"><span>Eye tracked</span><strong>${percent(report.duration > 0 ? report.trackerSeconds / report.duration : 0)}</strong></div>
      </div>

      <div class="panel-block">
        <h3>Suspicious events</h3>
        <ul class="event-list">${eventItems || '<li class="empty">Nothing suspicious appeared on your feeds.</li>'}</ul>
      </div>

      <div class="panel-block">
        <h3>Attention per feed</h3>
        <div class="stat-grid">${neglect}</div>
      </div>

      <div class="panel-block">
        <h3>Heatmap</h3>
        <div class="heat-grid">${heat}</div>
      </div>

      <div class="panel-block">
        <h3>Attention span</h3>
        <p class="meta">How long you stayed on one feed before looking away, through the shift. Hover a point for details.</p>
        ${attentionChart(attentionSpans(report.timeline), report.duration, name)}
      </div>

      <div class="panel-block">
        <h3>Distance from suspect</h3>
        <p class="meta">How far your gaze was from the nearest suspicious person on your feeds, in building tiles. Lower is closer; gaps mean no suspect was visible or you looked off the feeds. Dashed lines mark when you flagged someone.</p>
        ${distanceChart(report)}
      </div>

      <div class="panel-block">
        <h3>Timeline</h3>
        <p class="meta">Bright bars: where you were looking. Coloured windows: suspicious behavior on that feed.</p>
        <div class="timeline">${lanes}</div>
      </div>
    </section>
  `;
}
