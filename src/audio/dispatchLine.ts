// AI-worded dispatcher lines: the game builds the facts (what happened) and a
// template line; /api/dispatch (Hugging Face, see netlify/functions) only
// rewords them. Any timeout, error, or empty reply uses the template, so the
// dispatcher never stalls and never says anything the game didn't decide.
// The AI is a premium feature (see ./premium.ts): the player can turn it off,
// and ?ai=off skips it.
import { apiUrl } from "./api";
import { premium } from "./premium";
import { speak } from "./voice";

const DISPATCH_URL = apiUrl("/api/dispatch");
export const DISPATCH_TIMEOUT_MS = 2000;

/**
 * Statuses that mean asking again won't help this session: function missing
 * (404, e.g. GitHub Pages or plain `npm run dev`), token rejected, out of
 * credits (402) or rate-limited, or not configured (500).
 */
const PERMANENT_FAILURES = [401, 402, 403, 404, 429, 500];

/** Returns the dispatcher's line for this stage: Hugging Face's, or the template. */
export async function writeDispatchLine(
  stage: string,
  facts: string,
  template: string,
): Promise<string> {
  const text = premium.enabled("ai") ? await fetchLine(stage, facts) : "";
  console.info(`[dispatch] ${stage}: ${text ? "hf" : "template"}`);
  return text || template;
}

/** Writes the line (see writeDispatchLine), speaks it, and returns its text. */
export async function dispatchLine(
  stage: string,
  facts: string,
  template: string,
): Promise<string> {
  const text = await writeDispatchLine(stage, facts, template);
  await speak(text);
  return text;
}

async function fetchLine(stage: string, facts: string): Promise<string> {
  if (typeof fetch === "undefined") return "";
  try {
    const response = await fetch(DISPATCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, facts }),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      if (PERMANENT_FAILURES.includes(response.status)) {
        premium.markUnsupported("ai");
        console.warn(
          `[dispatch] /api/dispatch returned ${response.status}; using template lines for the rest of this session.`,
        );
      } else {
        console.warn(`[dispatch] /api/dispatch failed (${response.status}).`);
      }
      return "";
    }
    const body = (await response.json()) as { text?: unknown };
    return typeof body.text === "string" ? body.text.trim() : "";
  } catch (error) {
    console.warn("[dispatch] /api/dispatch unavailable.", error);
    return "";
  }
}
