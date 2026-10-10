import type {
  EventOutcome,
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
        <h3>Timeline</h3>
        <p class="meta">Bright bars: where you were looking. Coloured windows: suspicious behavior on that feed.</p>
        <div class="timeline">${lanes}</div>
      </div>
    </section>
  `;
}
