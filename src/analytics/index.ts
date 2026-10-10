import { eventBus } from "../shared/eventBus";
import type {
  Attention,
  Flag,
  SceneKey,
  WorldEvent,
} from "../shared/types";

export type EventClassification =
  | "caught"
  | "missed-not-looking"
  | "missed-looking"
  | "false-flag";

export interface GazeSample extends Attention {
  source?: "vision" | "gaze-tracker";
}

export interface SuspiciousEvent {
  id: string;
  source: "world" | "flag" | "vision";
  label: string;
  scene: SceneKey;
  timestamp: number;
  focus: number;
  lookedAtTarget: boolean;
  classification: EventClassification;
  severity: number;
  notes: string;
}

export interface TimelineEntry {
  timestamp: number;
  scene: SceneKey;
  feed: "gaze" | "event" | "flag";
  label: string;
  value: number;
  intensity: number;
}

export interface FeedNeglectStats {
  feed: "vision" | "world" | "flags";
  total: number;
  caught: number;
  missed: number;
  falseFlags: number;
  neglectRate: number;
}

export interface DebriefHeatmapCell {
  scene: SceneKey;
  heat: number;
  label: string;
}

export interface DebriefSummary {
  scene: SceneKey | null;
  focus: number;
  score: number;
  events: number;
  flags: string[];
  timeline: TimelineEntry[];
  suspiciousEvents: SuspiciousEvent[];
  neglectStats: FeedNeglectStats[];
  heatmap: DebriefHeatmapCell[];
}

export interface AnalyticsStore {
  recordScene: (scene: SceneKey) => void;
  recordAttention: (attention: Attention) => void;
  recordGazeSample: (sample: GazeSample) => void;
  recordWorldEvent: (worldEvent: WorldEvent) => void;
  recordFlag: (flag: Flag) => void;
  classifyEvent: (worldEvent: WorldEvent, attention?: Attention) => SuspiciousEvent | null;
  getScore: () => number;
  getDebrief: () => DebriefSummary;
  reset: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatClassification(classification: EventClassification): string {
  switch (classification) {
    case "caught":
      return "Caught";
    case "missed-not-looking":
      return "Missed (not looking)";
    case "missed-looking":
      return "Missed (looking)";
    case "false-flag":
      return "False flag";
    default:
      return classification;
  }
}

export function createAnalyticsStore(): AnalyticsStore {
  const attentionSamples: GazeSample[] = [];
  const worldEvents: WorldEvent[] = [];
  const flags: Flag[] = [];
  const suspiciousEvents: SuspiciousEvent[] = [];
  let currentScene: SceneKey | null = null;

  const recordScene = (scene: SceneKey): void => {
    currentScene = scene;
  };

  const recordAttention = (attention: Attention): void => {
    attentionSamples.push({ ...attention, source: "vision" });
  };

  const recordGazeSample = (sample: GazeSample): void => {
    attentionSamples.push(sample);
  };

  const recordWorldEvent = (worldEvent: WorldEvent): void => {
    worldEvents.push(worldEvent);

    const relatedAttention = getNearestAttention(worldEvent.timestamp, worldEvent.scene);
    const classified = classifyEvent(worldEvent, relatedAttention);

    if (classified) {
      suspiciousEvents.push(classified);
    }
  };

  const recordFlag = (flag: Flag): void => {
    flags.push(flag);

    const relatedAttention = getNearestAttention(flag.timestamp, flag.scene);
    const classification = classifyFlag(flag, relatedAttention);

    if (classification) {
      suspiciousEvents.push(classification);
    }
  };

  const getNearestAttention = (
    timestamp: number,
    scene: SceneKey,
  ): Attention | undefined => {
    const candidates = attentionSamples.filter(
      (sample) => sample.scene === scene && Math.abs(sample.timestamp - timestamp) <= 250,
    );

    if (candidates.length === 0) {
      return undefined;
    }

    return candidates.sort(
      (left, right) => Math.abs(left.timestamp - timestamp) - Math.abs(right.timestamp - timestamp),
    )[0];
  };

  const classifyEvent = (
    worldEvent: WorldEvent,
    attention?: Attention,
  ): SuspiciousEvent | null => {
    const focus = attention ? clamp(attention.focus, 0, 1) : 0;
    const lookedAtTarget = attention ? Boolean(attention.lookingAtTarget) : false;

    if (!attention) {
      return {
        id: `${worldEvent.type}-${worldEvent.timestamp}`,
        source: "world",
        label: worldEvent.label ?? worldEvent.type,
        scene: worldEvent.scene,
        timestamp: worldEvent.timestamp,
        focus,
        lookedAtTarget: false,
        classification: "missed-not-looking",
        severity: 0.8,
        notes: "Threat was not visible in gaze history during the event window.",
      };
    }

    if (lookedAtTarget && focus >= 0.55) {
      return {
        id: `${worldEvent.type}-${worldEvent.timestamp}`,
        source: "world",
        label: worldEvent.label ?? worldEvent.type,
        scene: worldEvent.scene,
        timestamp: worldEvent.timestamp,
        focus,
        lookedAtTarget: true,
        classification: "caught",
        severity: 0.35,
        notes: "The player was looking at the scene and caught the event.",
      };
    }

    if (!lookedAtTarget && focus >= 0.55) {
      return {
        id: `${worldEvent.type}-${worldEvent.timestamp}`,
        source: "world",
        label: worldEvent.label ?? worldEvent.type,
        scene: worldEvent.scene,
        timestamp: worldEvent.timestamp,
        focus,
        lookedAtTarget: false,
        classification: "missed-looking",
        severity: 0.7,
        notes: "The player was looking in the general direction but missed the threat.",
      };
    }

    return {
      id: `${worldEvent.type}-${worldEvent.timestamp}`,
      source: "world",
      label: worldEvent.label ?? worldEvent.type,
      scene: worldEvent.scene,
      timestamp: worldEvent.timestamp,
      focus,
      lookedAtTarget: false,
      classification: "missed-not-looking",
      severity: 0.9,
      notes: "The player was not looking at the event and missed it.",
    };
  };

  const classifyFlag = (flag: Flag, attention?: Attention): SuspiciousEvent | null => {
    const focus = attention ? clamp(attention.focus, 0, 1) : 0;
    const lookedAtTarget = attention ? Boolean(attention.lookingAtTarget) : false;

    if (!flag.value) {
      return {
        id: `flag-${flag.id}-${flag.timestamp}`,
        source: "flag",
        label: `False flag: ${flag.id}`,
        scene: flag.scene,
        timestamp: flag.timestamp,
        focus,
        lookedAtTarget,
        classification: "false-flag",
        severity: 0.6,
        notes: "The alert was raised but did not correspond to a real suspicious event.",
      };
    }

    if (!attention || focus < 0.5 || !lookedAtTarget) {
      return {
        id: `flag-${flag.id}-${flag.timestamp}`,
        source: "flag",
        label: `Flag: ${flag.id}`,
        scene: flag.scene,
        timestamp: flag.timestamp,
        focus,
        lookedAtTarget: Boolean(lookedAtTarget),
        classification: "missed-not-looking",
        severity: 0.75,
        notes: "The event was flagged without enough visual confirmation.",
      };
    }

    return null;
  };

  const buildTimeline = (): TimelineEntry[] => {
    const entries: TimelineEntry[] = [];

    attentionSamples.forEach((sample) => {
      entries.push({
        timestamp: sample.timestamp,
        scene: sample.scene,
        feed: "gaze",
        label: sample.targetId ? `gaze:${sample.targetId}` : "gaze",
        value: sample.focus,
        intensity: clamp(sample.focus, 0, 1),
      });
    });

    worldEvents.forEach((event) => {
      entries.push({
        timestamp: event.timestamp,
        scene: event.scene,
        feed: "event",
        label: event.label ?? event.type,
        value: 1,
        intensity: 0.7,
      });
    });

    flags.forEach((flag) => {
      entries.push({
        timestamp: flag.timestamp,
        scene: flag.scene,
        feed: "flag",
        label: `flag:${flag.id}`,
        value: flag.value ? 1 : 0,
        intensity: flag.value ? 0.9 : 0.4,
      });
    });

    return entries.sort((left, right) => left.timestamp - right.timestamp);
  };

  const buildHeatmap = (): DebriefHeatmapCell[] => {
    const perScene = new Map<SceneKey, number>();

    attentionSamples.forEach((sample) => {
      const current = perScene.get(sample.scene) ?? 0;
      perScene.set(sample.scene, current + clamp(sample.focus, 0, 1));
    });

    worldEvents.forEach((event) => {
      const current = perScene.get(event.scene) ?? 0;
      perScene.set(event.scene, current + 0.5);
    });

    return (Object.keys({ Title: 0, Calibration: 0, Shift: 0, Debrief: 0 }) as SceneKey[]).map(
      (scene) => ({
        scene,
        heat: Number((perScene.get(scene) ?? 0).toFixed(2)),
        label: `${scene} attention`,
      }),
    );
  };

  const buildNeglectStats = (): FeedNeglectStats[] => {
    const worldMisses = suspiciousEvents.filter(
      (event) => event.source === "world" && event.classification !== "caught",
    ).length;
    const flagMisses = suspiciousEvents.filter(
      (event) => event.source === "flag" && event.classification !== "caught",
    ).length;
    const falseFlags = suspiciousEvents.filter((event) => event.classification === "false-flag").length;

    const visionTotal = attentionSamples.length;
    const worldTotal = worldEvents.length;
    const flagTotal = flags.length;

    return [
      {
        feed: "vision",
        total: visionTotal,
        caught: suspiciousEvents.filter((event) => event.source === "vision").length,
        missed: Math.max(0, visionTotal - Math.min(visionTotal, suspiciousEvents.length)),
        falseFlags: 0,
        neglectRate: visionTotal === 0 ? 0 : Number(((worldMisses + flagMisses) / (visionTotal + 1)).toFixed(2)),
      },
      {
        feed: "world",
        total: worldTotal,
        caught: suspiciousEvents.filter((event) => event.source === "world" && event.classification === "caught").length,
        missed: worldMisses,
        falseFlags: 0,
        neglectRate: worldTotal === 0 ? 0 : Number((worldMisses / worldTotal).toFixed(2)),
      },
      {
        feed: "flags",
        total: flagTotal,
        caught: suspiciousEvents.filter((event) => event.source === "flag" && event.classification === "caught").length,
        missed: flagMisses,
        falseFlags,
        neglectRate:
          flagTotal === 0 ? 0 : Number(((falseFlags + flagMisses) / flagTotal).toFixed(2)),
      },
    ];
  };

  const getScore = (): number => {
    const focusAverage = average(attentionSamples.map((sample) => clamp(sample.focus, 0, 1)));
    const eventCount = worldEvents.length;
    const flagCount = flags.filter((flag) => flag.value).length;
    const missPenalty = suspiciousEvents.filter(
      (event) => event.classification !== "caught" && event.classification !== "false-flag",
    ).length;

    const score =
      focusAverage * 70 + eventCount * 4 + flagCount * 6 - missPenalty * 8;

    return Math.round(clamp(score, 0, 100));
  };

  const getDebrief = (): DebriefSummary => {
    const averageFocus = average(attentionSamples.map((sample) => clamp(sample.focus, 0, 1)));

    return {
      scene: currentScene,
      focus: Number(averageFocus.toFixed(2)),
      score: getScore(),
      events: worldEvents.length,
      flags: flags.filter((flag) => flag.value).map((flag) => flag.id),
      timeline: buildTimeline(),
      suspiciousEvents: [...suspiciousEvents],
      neglectStats: buildNeglectStats(),
      heatmap: buildHeatmap(),
    };
  };

  const reset = (): void => {
    attentionSamples.length = 0;
    worldEvents.length = 0;
    flags.length = 0;
    suspiciousEvents.length = 0;
    currentScene = null;
  };

  return {
    recordScene,
    recordAttention,
    recordGazeSample,
    recordWorldEvent,
    recordFlag,
    classifyEvent,
    getScore,
    getDebrief,
    reset,
  };
}

export const analyticsStore = createAnalyticsStore();

export const buildDebriefMarkup = (summary = analyticsStore.getDebrief()): string => {
  const suspiciousBlocks = summary.suspiciousEvents.length
    ? summary.suspiciousEvents
        .map(
          (event) => `
            <li>
              <span class="label">${event.label}</span>
              <span class="pill ${event.classification}">${formatClassification(event.classification)}</span>
              <span class="meta">${event.scene} · ${event.timestamp}ms</span>
            </li>
          `,
        )
        .join("")
    : "<li class=\"empty\">No suspicious events recorded.</li>";

  const timelineBlocks = summary.timeline.length
    ? summary.timeline
        .map(
          (entry) => `
            <li>
              <span class="timeline-time">${entry.timestamp}ms</span>
              <span class="timeline-label">${entry.label}</span>
              <span class="timeline-feed">${entry.feed}</span>
            </li>
          `,
        )
        .join("")
    : "<li class=\"empty\">No timeline data yet.</li>";

  const neglectBlocks = summary.neglectStats
    .map(
      (stat) => `
        <div class=\"stat\">
          <span>${stat.feed}</span>
          <strong>${stat.neglectRate}</strong>
          <small>${stat.missed} missed / ${stat.total} total</small>
        </div>
      `,
    )
    .join("");

  const heatBlocks = summary.heatmap
    .map(
      (cell) => `
        <div class=\"heat-cell\" title=\"${cell.label}\">
          <span class=\"heat-scene\">${cell.scene}</span>
          <span class=\"heat-value\">${cell.heat.toFixed(2)}</span>
        </div>
      `,
    )
    .join("");

  return `
    <section class="analytics-panel">
      <h2>Analytics / Debrief</h2>
      <div class="summary-grid">
        <div class="metric"><span>Focus</span><strong>${summary.focus.toFixed(2)}</strong></div>
        <div class="metric"><span>Score</span><strong>${summary.score}</strong></div>
        <div class="metric"><span>Events</span><strong>${summary.events}</strong></div>
        <div class="metric"><span>Flags</span><strong>${summary.flags.length}</strong></div>
      </div>

      <div class="panel-block">
        <h3>Suspicious events</h3>
        <ul class="event-list">${suspiciousBlocks}</ul>
      </div>

      <div class="panel-block">
        <h3>Per-feed neglect</h3>
        <div class="stat-grid">${neglectBlocks}</div>
      </div>

      <div class="panel-block">
        <h3>Heatmap</h3>
        <div class="heat-grid">${heatBlocks}</div>
      </div>

      <div class="panel-block">
        <h3>Timeline</h3>
        <ul class="timeline-list">${timelineBlocks}</ul>
      </div>
    </section>
  `;
};

export const renderDebriefPanel = (containerId = "analytics-panel"): void => {
  if (typeof document === "undefined") {
    return;
  }

  const container = document.getElementById(containerId);

  if (!container) {
    return;
  }

  container.innerHTML = buildDebriefMarkup();
};

export const installAnalyticsListeners = (): void => {
  eventBus.on("scene:navigate", analyticsStore.recordScene);
  eventBus.on("vision:attention", analyticsStore.recordAttention);
  eventBus.on("vision:gaze", analyticsStore.recordGazeSample);
  eventBus.on("analytics:attention", analyticsStore.recordAttention);
  eventBus.on("world:event", analyticsStore.recordWorldEvent);
  eventBus.on("analytics:world-event", analyticsStore.recordWorldEvent);
  eventBus.on("world:flag", analyticsStore.recordFlag);
  eventBus.on("analytics:flag", analyticsStore.recordFlag);

  if (typeof document !== "undefined") {
    eventBus.on("scene:navigate", () => renderDebriefPanel());
    eventBus.on("vision:attention", () => renderDebriefPanel());
    eventBus.on("vision:gaze", () => renderDebriefPanel());
    eventBus.on("world:event", () => renderDebriefPanel());
    eventBus.on("world:flag", () => renderDebriefPanel());
  }

  return undefined;
};

installAnalyticsListeners();
