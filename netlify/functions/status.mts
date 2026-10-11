// GET /api/status → { voice, ai }: which paid features still work, so the game
// can grey out the ones that don't (see src/audio/premium.ts). Never returns
// keys. Not cached: a stale "unavailable" would hide a key that was just fixed.
//
// voice: ElevenLabs key and voice set, key valid, characters left this period
//        (needs the key's User → Read permission).
// ai:    HF_TOKEN set and valid. Running out of credits shows up at runtime as
//        a 402 from /api/dispatch.
import { withCors } from "../lib/cors";

const CHECK_TIMEOUT_MS = 4000;

export default withCors(async (req: Request): Promise<Response> => {
  if (req.method !== "GET") {
    return json({ error: "Use GET." }, 405);
  }
  const [voice, ai] = await Promise.all([voiceWorks(), aiWorks()]);
  return json({ voice, ai }, 200);
});

export const config = { path: "/api/status" };

async function voiceWorks(): Promise<boolean> {
  const apiKey = Netlify.env.get("ELEVENLABS_API_KEY");
  if (!apiKey || !Netlify.env.get("ELEVENLABS_VOICE_ID")) return false;
  try {
    const response = await fetch(
      "https://api.elevenlabs.io/v1/user/subscription",
      {
        headers: { "xi-api-key": apiKey },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      },
    );
    if (!response.ok) return false;
    const { character_count, character_limit } = (await response.json()) as {
      character_count?: unknown;
      character_limit?: unknown;
    };
    return (
      typeof character_count !== "number" ||
      typeof character_limit !== "number" ||
      character_count < character_limit
    );
  } catch {
    return false;
  }
}

async function aiWorks(): Promise<boolean> {
  const token = Netlify.env.get("HF_TOKEN");
  if (!token) return false;
  try {
    const response = await fetch("https://huggingface.co/api/whoami-v2", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": cache },
  });
}
