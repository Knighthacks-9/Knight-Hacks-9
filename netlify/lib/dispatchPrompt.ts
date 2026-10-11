// Prompt and output cleanup for /api/dispatch (netlify/functions/dispatch.mts).
// Kept outside netlify/functions so Netlify doesn't deploy it as a function
// and Vitest can test it.

export const SYSTEM_PROMPT =
  "You are a night-shift security dispatcher on a radio. Write ONE line, max 25 words, radio style. Use ONLY the facts given. Never invent people, places, times, or outcomes.";

export const DEFAULT_MODEL = "google/gemma-4-26B-A4B-it";

/**
 * Turns a model reply into the line the dispatcher says: drops <think>
 * blocks (including one cut off by max_tokens), keeps the first non-empty
 * line, and removes wrapping quotes. Returns "" when nothing is left.
 */
export function cleanDispatchLine(raw: string): string {
  const withoutThinking = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    // An unclosed block means the reply ran out of tokens while thinking.
    .replace(/<think>[\s\S]*$/i, "");
  const line =
    withoutThinking
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l !== "") ?? "";
  return line.replace(/^["“']+|["”']+$/g, "").trim();
}
