import { describe, expect, it, vi } from "vitest";
import { createPremium } from "./premium";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const statusFetch = (body: unknown, status = 200) =>
  (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("premium features", () => {
  it("are available when /api/status says so, and on by default", async () => {
    const premium = createPremium({
      fetch: statusFetch({ voice: true, ai: true }),
      storage: memoryStorage(),
    });
    expect(premium.state("voice").status).toBe("checking");
    await premium.check();
    expect(premium.state("voice")).toMatchObject({
      status: "available",
      preference: true,
      enabled: true,
    });
    expect(premium.enabled("ai")).toBe(true);
  });

  it("saves the player's choice and reloads it", async () => {
    const storage = memoryStorage();
    const first = createPremium({
      fetch: statusFetch({ voice: true, ai: true }),
      storage,
    });
    first.setPreference("ai", false);
    expect(first.enabled("ai")).toBe(false);

    const later = createPremium({
      fetch: statusFetch({ voice: true, ai: true }),
      storage,
    });
    await later.check();
    expect(later.state("ai")).toMatchObject({
      preference: false,
      enabled: false,
    });
    expect(later.enabled("voice")).toBe(true);
  });

  it("marks a feature unsupported even when the player left it on", async () => {
    const premium = createPremium({
      fetch: statusFetch({ voice: false, ai: true }),
      storage: memoryStorage(),
    });
    await premium.check();
    expect(premium.state("voice")).toMatchObject({
      status: "unsupported",
      preference: true,
      enabled: false,
    });
  });

  it("treats a missing or broken status endpoint as nothing supported", async () => {
    for (const fetchStatus of [
      statusFetch({ error: "not found" }, 404),
      (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
      undefined,
    ]) {
      const premium = createPremium({
        fetch: fetchStatus,
        storage: memoryStorage(),
      });
      await premium.check();
      expect(premium.state("voice").status).toBe("unsupported");
      expect(premium.state("ai").status).toBe("unsupported");
    }
  });

  it("notifies listeners when a feature fails at runtime", async () => {
    const premium = createPremium({
      fetch: statusFetch({ voice: true, ai: true }),
      storage: memoryStorage(),
    });
    await premium.check();
    const listener = vi.fn();
    const stop = premium.onChange(listener);
    premium.markUnsupported("ai");
    premium.markUnsupported("ai"); // already off: no second notice
    expect(listener).toHaveBeenCalledTimes(1);
    expect(premium.enabled("ai")).toBe(false);
    stop();
    premium.setPreference("voice", false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps a runtime failure even if the status check finishes later", async () => {
    const premium = createPremium({
      fetch: statusFetch({ voice: true, ai: true }),
      storage: memoryStorage(),
    });
    premium.markUnsupported("voice");
    await premium.check();
    expect(premium.state("voice").status).toBe("unsupported");
  });

  it("honors the ?voice=free and ?ai=off overrides", async () => {
    const premium = createPremium({
      fetch: statusFetch({ voice: true, ai: true }),
      storage: memoryStorage(),
      search: "?voice=free&ai=off",
    });
    await premium.check();
    expect(premium.state("voice")).toMatchObject({
      forcedOff: true,
      enabled: false,
    });
    expect(premium.enabled("ai")).toBe(false);
  });

  it("asks the server only once", async () => {
    const fetchStatus = vi.fn(statusFetch({ voice: true, ai: false }));
    const premium = createPremium({
      fetch: fetchStatus as unknown as typeof fetch,
      storage: memoryStorage(),
    });
    await Promise.all([premium.check(), premium.check()]);
    await premium.check();
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });
});
