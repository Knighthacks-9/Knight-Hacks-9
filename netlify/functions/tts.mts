// POST /api/tts { text } → audio/mpeg from ElevenLabs. Keeps the API key on the
// server. ElevenLabs error statuses (401 bad key, 429 out of credits) are
// passed through so the client can switch to its browser fallback.
import { withCors } from "../lib/cors";

const MAX_TEXT_LENGTH = 500;

export default withCors(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return json({ error: "Use POST." }, 405);
  }

  const apiKey = Netlify.env.get("ELEVENLABS_API_KEY");
  const voiceId = Netlify.env.get("ELEVENLABS_VOICE_ID");
  if (!apiKey || !voiceId) {
    return json(
      { error: "ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set." },
      500,
    );
  }

  let text: unknown;
  try {
    ({ text } = (await req.json()) as { text?: unknown });
  } catch {
    return json({ error: "Body must be JSON: { text }." }, 400);
  }
  if (typeof text !== "string" || text.trim() === "") {
    return json({ error: "text must be a non-empty string." }, 400);
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return json(
      { error: `text must be at most ${MAX_TEXT_LENGTH} characters.` },
      413,
    );
  }

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_22050_32`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text }),
    },
  );

  if (!upstream.ok) {
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
});

export const config = { path: "/api/tts" };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
