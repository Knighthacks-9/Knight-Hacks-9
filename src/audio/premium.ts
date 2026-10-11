// The paid ("premium") features: the realistic ElevenLabs dispatcher voice and
// the Hugging Face AI dispatcher. Both are used automatically while they work;
// when they don't (out of credits, keys removed, no server functions) the game
// falls back to the free browser voice and template lines on its own.
//
// - /api/status, checked once per page load, says which features the server
//   can still provide. A runtime failure marks a feature unsupported for the
//   rest of the session.
// - The player can turn each feature off in the main menu (saved in browser
//   storage). An unsupported feature is shown greyed out.
// - ?voice=free and ?ai=off in the URL force a feature off (dev/demo override).

import { apiUrl } from "./api";

export type PremiumFeature = "voice" | "ai";
export type PremiumStatus = "checking" | "available" | "unsupported";

export interface PremiumFeatureState {
  status: PremiumStatus;
  /** The player's choice; on unless they turned it off. */
  preference: boolean;
  /** Forced off by a URL override. */
  forcedOff: boolean;
  /** Whether the feature should be used right now. */
  enabled: boolean;
}

type PremiumStorage = Pick<Storage, "getItem" | "setItem">;

export interface PremiumOptions {
  fetch?: typeof fetch;
  storage?: PremiumStorage | null;
  /** location.search, for the URL overrides. */
  search?: string;
  timeoutMs?: number;
}

const FEATURES: readonly PremiumFeature[] = ["voice", "ai"];
const STATUS_URL = apiUrl("/api/status");
const STATUS_TIMEOUT_MS = 3000;
const storageKey = (feature: PremiumFeature) =>
  `night-watch:premium-${feature}`;

export function createPremium(options: PremiumOptions = {}) {
  const fetchStatus = options.fetch;
  const storage = options.storage ?? null;
  const params = new URLSearchParams(options.search ?? "");
  const forced: Record<PremiumFeature, boolean> = {
    voice: params.get("voice") === "free",
    ai: params.get("ai") === "off",
  };
  const status: Record<PremiumFeature, PremiumStatus> = {
    voice: "checking",
    ai: "checking",
  };
  const listeners = new Set<() => void>();
  let checking: Promise<void> | null = null;

  const notify = () => listeners.forEach((listener) => listener());

  function preference(feature: PremiumFeature): boolean {
    try {
      return storage?.getItem(storageKey(feature)) !== "off";
    } catch {
      return true;
    }
  }

  function state(feature: PremiumFeature): PremiumFeatureState {
    const pref = preference(feature);
    return {
      status: status[feature],
      preference: pref,
      forcedOff: forced[feature],
      enabled: pref && !forced[feature] && status[feature] !== "unsupported",
    };
  }

  function setStatus(next: Record<PremiumFeature, PremiumStatus>): void {
    let changed = false;
    for (const feature of FEATURES) {
      // A runtime failure this session outranks an older "available".
      if (status[feature] === "unsupported") continue;
      if (status[feature] !== next[feature]) {
        status[feature] = next[feature];
        changed = true;
      }
    }
    if (changed) notify();
  }

  async function runCheck(): Promise<void> {
    let result = { voice: false, ai: false };
    try {
      if (!fetchStatus) throw new Error("fetch is unavailable");
      const response = await fetchStatus(STATUS_URL, {
        // Always ask fresh, so fixing a key shows up on the next page load.
        cache: "no-store",
        signal: AbortSignal.timeout(options.timeoutMs ?? STATUS_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body = (await response.json()) as Record<string, unknown>;
      result = { voice: body.voice === true, ai: body.ai === true };
    } catch (error) {
      // No functions here (GitHub Pages, plain `npm run dev`) or the server
      // is gone: only the free features are available.
      console.info(
        "[premium] /api/status unavailable; using free audio.",
        error,
      );
    }
    setStatus({
      voice: result.voice ? "available" : "unsupported",
      ai: result.ai ? "available" : "unsupported",
    });
    console.info(`[premium] voice: ${status.voice}, ai: ${status.ai}`);
  }

  return {
    /** Asks the server which features work. Runs once; later calls share it. */
    check(): Promise<void> {
      checking ??= runCheck();
      return checking;
    },

    state,

    enabled(feature: PremiumFeature): boolean {
      return state(feature).enabled;
    },

    setPreference(feature: PremiumFeature, on: boolean): void {
      try {
        storage?.setItem(storageKey(feature), on ? "on" : "off");
      } catch (error) {
        console.warn(`[premium] Could not save the ${feature} setting.`, error);
      }
      notify();
    },

    /** The feature failed in a way retrying won't fix; stop using it this session. */
    markUnsupported(feature: PremiumFeature): void {
      if (status[feature] === "unsupported") return;
      status[feature] = "unsupported";
      notify();
    },

    /** Calls listener on any change. Returns a function that unsubscribes. */
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type Premium = ReturnType<typeof createPremium>;

function browserStorage(): PremiumStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The game's shared instance. */
export const premium: Premium = createPremium({
  fetch: typeof fetch === "undefined" ? undefined : (...args) => fetch(...args),
  storage: browserStorage(),
  search: typeof location === "undefined" ? "" : location.search,
});
