import type {
  EventOutcome,
  GazeSegment,
  ShiftReport,
  SuspiciousBehavior,
} from "../shared/types";
import type { ShiftSummary } from "./history";

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
  /** X-axis range; points use `t` on this scale (shift seconds by default). */
  xMin?: number;
  xMax: number;
  xTickSteps?: number[];
  xFormat?: (value: number) => string;
  /** Each run is drawn as its own line, so gaps between runs stay empty. */
  runs: ChartPoint[][];
  unit: string;
  yTickSteps: number[];
  /** Fixed top of the y-axis (e.g. 100 for percentages); otherwise fits the data. */
  yMax?: number;
  /** Dashed reference line, e.g. the average. */
  reference?: { value: number; label: string };
}

/** Inline SVG line chart; hover a point for its tip. */
function lineChart({
  label,
  xMin = 0,
  xMax,
  xTickSteps = [5, 10, 15, 30, 60, 120, 300],
  xFormat = (t) => `${t}s`,
  runs,
  unit,
  yTickSteps,
  yMax: fixedYMax,
  reference,
}: LineChartOptions): string {
  const W = 640;
  const H = 200;
  const left = 44;
  const right = 12;
  const top = 12;
  const bottom = 26;
  const spanX = Math.max(xMax - xMin, 0.01);
  const largest =
    fixedYMax ?? Math.max(0.01, ...runs.flat().map((p) => p.value));
  const yStep = tickStep(largest, 4, yTickSteps);
  const yMax = Math.ceil(largest / yStep) * yStep;
  const xStep = tickStep(spanX, 6, xTickSteps);
  const x = (t: number) => left + ((t - xMin) / spanX) * (W - left - right);
  const y = (v: number) => top + (1 - v / yMax) * (H - top - bottom);

  const yTicks: string[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += yStep) {
    yTicks.push(`
      <line class="grid" x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" />
      <text class="tick" x="${left - 6}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${v}${unit}</text>`);
  }
  const xTicks: string[] = [];
  for (let t = xMin; t <= xMax + 1e-9; t += xStep) {
    xTicks.push(
      `<text class="tick" x="${x(t)}" y="${H - 8}" text-anchor="middle">${xFormat(t)}</text>`,
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
  const ref = reference
    ? `
      <line class="avg" x1="${left}" x2="${W - right}" y1="${y(reference.value)}" y2="${y(reference.value)}" />
      <text class="tick" x="${W - right}" y="${y(reference.value) - 5}" text-anchor="end">${reference.label}</text>`
    : "";

  return `
    <svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
      ${yTicks.join("")}
      ${xTicks.join("")}
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
    xMax: duration,
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

const when = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** "Your progress": trends across saved shifts. The last entry is this shift. */
function progressSection(history: readonly ShiftSummary[]): string {
  const numbered = history.map((shift, i) => ({ ...shift, n: i + 1 }));
  // Early-ended shifts only cover part of a shift, so they stay out of the trend.
  const completed = numbered.filter((shift) => shift.completed);
  const current = numbered.at(-1);
  const earlier = completed.filter((shift) => shift !== current);
  const best = completed.length
    ? Math.max(...completed.map((shift) => shift.score))
    : null;
  let versus = "—";
  if (current && !current.completed) versus = "Ended early";
  else if (current && earlier.length) {
    const avg =
      earlier.reduce((sum, shift) => sum + shift.score, 0) / earlier.length;
    const diff = Math.round(current.score - avg);
    versus = `${diff >= 0 ? "+" : ""}${diff} vs avg`;
  }

  const xAxis = {
    xMin: 1,
    xMax: Math.max(numbered.length, 2),
    xTickSteps: [1, 2, 5, 10, 20, 50],
    xFormat: (n: number) => `#${n}`,
  };
  const charts =
    completed.length < 2
      ? '<p class="empty">Play another full shift to see your progress.</p>'
      : `
        <h4>Score per shift</h4>
        ${lineChart({
          ...xAxis,
          label: `Score over ${completed.length} completed shifts`,
          unit: "",
          yTickSteps: [25],
          yMax: 100,
          runs: [
            completed.map((shift) => ({
              t: shift.n,
              value: shift.score,
              tip: `Shift #${shift.n} · Level ${shift.level} · score ${shift.score} · ${when(shift.at)}`,
            })),
          ],
        })}
        <h4>Catch rate per shift</h4>
        ${lineChart({
          ...xAxis,
          label: `Share of suspects caught over ${completed.length} completed shifts`,
          unit: "%",
          yTickSteps: [25],
          yMax: 100,
          runs: [
            completed
              .filter((shift) => shift.total > 0)
              .map((shift) => ({
                t: shift.n,
                value: Math.round((100 * shift.caught) / shift.total),
                tip: `Shift #${shift.n} · caught ${shift.caught} of ${shift.total}`,
              })),
          ],
        })}`;

  const rows = numbered
    .slice(-10)
    .reverse()
    .map(
      (shift) => `
        <tr>
          <td>#${shift.n}</td>
          <td>${when(shift.at)}</td>
          <td>${shift.level}</td>
          <td>${shift.score}</td>
          <td>${shift.caught} / ${shift.total}</td>
          <td>${shift.falseFlags}</td>
          <td>${shift.completed ? (shift.passed ? "Passed" : "Not passed") : "Ended early"}</td>
        </tr>`,
    )
    .join("");

  return `
      <div class="panel-block">
        <h3>Your progress</h3>
        <div class="summary-grid">
          <div class="metric"><span>Shifts played</span><strong>${history.length}</strong></div>
          <div class="metric"><span>Best score</span><strong>${best ?? "—"}</strong></div>
          <div class="metric"><span>This shift</span><strong>${versus}</strong></div>
        </div>
        ${charts}
        <h4>Recent shifts</h4>
        <div class="table-scroll">
          <table class="history-table">
            <thead><tr><th>Shift</th><th>When</th><th>Level</th><th>Score</th><th>Caught</th><th>False flags</th><th>Result</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <button type="button" class="history-clear" data-action="clear-history">Clear history</button>
      </div>`;
}

/** Report notes are transcribed player speech, so escape before inserting as HTML. */
function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

/** "Reported as Loitering ✓ · “note”" for a filed report, or "" if none. */
function reportDetails(
  reported: SuspiciousBehavior | null | undefined,
  actual: SuspiciousBehavior | null,
  note: string | null | undefined,
): string {
  const parts: string[] = [];
  if (reported) {
    const verdict = actual === null ? "" : reported === actual ? " ✓" : " ✗";
    parts.push(`Reported as ${BEHAVIOR_LABELS[reported]}${verdict}`);
  }
  if (note) parts.push(`“${escapeHtml(note)}”`);
  return parts.length ? `<span class="meta">${parts.join(" · ")}</span>` : "";
}

/** HTML for the debrief panel. `cameraNames` maps camera ids to display names. */
export function buildDebriefMarkup(
  report: ShiftReport,
  cameraNames: ReadonlyMap<string, string> = new Map(),
  history: readonly ShiftSummary[] = [],
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
          ${reportDetails(event.reportedBehavior, event.behavior, event.reportNote)}
        </li>`,
    })),
    ...report.falseFlags.map((flag) => ({
      t: flag.t,
      html: `
        <li>
          <span class="label">Reported an innocent person</span>
          <span class="pill false-flag">${OUTCOME_LABELS["false-flag"]}</span>
          <span class="meta">${name(flag.cameraId)} · ${seconds(flag.t)}</span>
          ${reportDetails(flag.behavior, null, flag.note)}
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
        <h3>Timeline</h3>
        <p class="meta">Bright bars: where you were looking. Coloured windows: suspicious behavior on that feed.</p>
        <div class="timeline">${lanes}</div>
      </div>
${history.length ? progressSection(history) : ""}
    </section>
  `;
}