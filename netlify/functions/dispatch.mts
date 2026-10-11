// POST /api/dispatch { stage, facts } → { text }: one dispatcher radio line
// written by a Hugging Face Inference Providers chat model. The game decides
// what happened (facts); the model only words it. Keeps HF_TOKEN on the
// server and passes Hugging Face error statuses (401, 402, 429) through so the
// client can fall back to its template line.
import {
  DEFAULT_MODEL,
  SYSTEM_PROMPT,
  cleanDispatchLine,
} from "../lib/dispatchPrompt";

const HF_URL = "https://router.huggingface.co/v1/chat/completions";
const MAX_STAGE_LENGTH = 40;
const MAX_FACTS_LENGTH = 1500;
/** The client gives up after 2 s; don't hold the function open much longer. */
const UPSTREAM_TIMEOUT_MS = 8000;

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return json({ error: "Use POST." }, 405);
  }

  const token = Netlify.env.get("HF_TOKEN");
  if (!token) {
    return json({ error: "HF_TOKEN must be set." }, 500);
  }
  const model = Netlify.env.get("HF_MODEL") || DEFAULT_MODEL;

  let stage: unknown;
  let facts: unknown;
  try {
    ({ stage, facts } = (await req.json()) as {
      stage?: unknown;
      facts?: unknown;
    });
  } catch {
    return json({ error: "Body must be JSON: { stage, facts }." }, 400);
  }
  if (
    typeof stage !== "string" ||
    stage.trim() === "" ||
    stage.length > MAX_STAGE_LENGTH
  ) {
    return json({ error: "stage must be a short non-empty string." }, 400);
  }
  if (typeof facts !== "string" || facts.trim() === "") {
    return json({ error: "facts must be a non-empty string." }, 400);
  }
  if (facts.length > MAX_FACTS_LENGTH) {
    return json(
      { error: `facts must be at most ${MAX_FACTS_LENGTH} characters.` },
      413,
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(HF_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Stage: ${stage}\nFacts:\n${facts}` },
        ],
        max_tokens: 80,
        temperature: 0.8,
        // Reasoning models (like the default Gemma) otherwise spend all 80
        // tokens thinking and return no line.
        reasoning_effort: "none",
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return json({ error: "Hugging Face did not respond in time." }, 504);
  }

  if (!upstream.ok) {
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  }

  const body = (await upstream.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[];
  } | null;
  const content = body?.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? cleanDispatchLine(content) : "";
  return json({ text }, 200);
};

export const config = { path: "/api/dispatch" };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
