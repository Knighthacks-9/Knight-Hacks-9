// POST /api/stt with a raw audio blob → ElevenLabs Scribe transcription JSON
// ({ text, words, ... }). Keeps the API key on the server and passes
// ElevenLabs error statuses (401, 429) through to the client.

/** Push-to-talk clips are short; this keeps a bad client from uploading huge files. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return json({ error: "Use POST." }, 405);
  }

  const apiKey = Netlify.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) {
    return json({ error: "ELEVENLABS_API_KEY must be set." }, 500);
  }

  const audio = await req.blob();
  if (audio.size === 0) {
    return json({ error: "Send the recording as the request body." }, 400);
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return json({ error: "Recording is too large." }, 413);
  }

  const type = req.headers.get("Content-Type") ?? "audio/webm";
  const form = new FormData();
  form.append("model_id", "scribe_v2");
  form.append("file", new Blob([audio], { type }), "transmission.webm");

  const upstream = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
};

export const config = { path: "/api/stt" };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
