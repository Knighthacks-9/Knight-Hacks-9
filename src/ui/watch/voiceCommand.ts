// Parses push-to-talk transcripts such as "Camera 3, sighting" into a feed,
// and numbers in answers to dispatch's questions.

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  won: 1,
  first: 1,
  two: 2,
  second: 2,
  three: 3,
  third: 3,
  tree: 3,
  four: 4,
  fourth: 4,
  five: 5,
  fifth: 5,
  six: 6,
  sixth: 6,
  seven: 7,
  seventh: 7,
  eight: 8,
  eighth: 8,
  nine: 9,
  ninth: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
/** Sound-alikes only trusted right after "camera". */
const HOMOPHONES: Record<string, number> = { to: 2, too: 2, for: 4, ate: 8 };

function toNumber(word: string, loose: boolean): number | null {
  if (/^\d+$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? (loose ? (HOMOPHONES[word] ?? null) : null);
}

function spokenWords(transcript: string): string[] {
  return transcript
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1 $2") // "cam3" → "cam 3"
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** The first number spoken ("three", "3"), or null if there is none. */
export function parseNumber(transcript: string): number | null {
  for (const word of spokenWords(transcript)) {
    const n = toNumber(word, false);
    if (n !== null) return n;
  }
  return null;
}

/**
 * Returns the 1-based camera number the player named, or null if none (or one
 * outside 1..cameraCount) was recognized.
 */
export function parseCameraCommand(
  transcript: string,
  cameraCount: number,
): number | null {
  const words = spokenWords(transcript);
  const valid = (n: number | null) =>
    n !== null && n >= 1 && n <= cameraCount ? n : null;

  // "camera 3", "cam three", "camera number 3", "feed 3"
  for (let i = 0; i < words.length; i++) {
    if (!/^(camera|cameras|cam|cams|feed|monitor|screen)$/.test(words[i])) {
      continue;
    }
    let next = i + 1;
    if (words[next] === "number" || words[next] === "no") next++;
    const n = words[next] ? toNumber(words[next], true) : null;
    if (n !== null) return valid(n);
  }
  // "sighting on three": accept a lone number if it is the only one.
  const numbers = words
    .map((w) => toNumber(w, false))
    .filter((n): n is number => n !== null);
  return numbers.length === 1 ? valid(numbers[0]) : null;
}
