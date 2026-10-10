// Pre-generates dispatcher lines with ElevenLabs so the game can play them
// without spending credits at runtime.
//
//   npm run voice:generate
//
// Reads ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID from .env (or the
// environment), the lines from scripts/voice-lines.json, and writes
// public/audio/dispatch_<id>.mp3. Files that already exist are skipped, so
// re-running only pays for new lines. Delete a file to regenerate it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const envFile = `${root}.env`;
if (existsSync(envFile)) process.loadEnvFile(envFile);

const apiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = process.env.ELEVENLABS_VOICE_ID;
if (!apiKey || !voiceId) {
  console.error(
    "Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env (see .env.example).",
  );
  process.exit(1);
}

const lines = JSON.parse(
  readFileSync(`${root}scripts/voice-lines.json`, "utf8"),
);
const outDir = `${root}public/audio`;
mkdirSync(outDir, { recursive: true });

let made = 0;
let skipped = 0;
for (const { id, text } of lines) {
  if (!/^[a-z0-9_-]+$/i.test(id) || typeof text !== "string" || !text) {
    console.error(`Skipping invalid line: ${JSON.stringify({ id, text })}`);
    process.exitCode = 1;
    continue;
  }
  const file = `${outDir}/dispatch_${id}.mp3`;
  if (existsSync(file)) {
    skipped += 1;
    continue;
  }

  const response = await fetch(
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
  if (!response.ok) {
    console.error(`Failed ${id}: ${response.status} ${await response.text()}`);
    process.exitCode = 1;
    // Bad key or out of credits: every remaining line would fail too.
    if (response.status === 401 || response.status === 429) break;
    continue;
  }
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  made += 1;
  console.log(`Wrote public/audio/dispatch_${id}.mp3`);
}

console.log(`Done: ${made} generated, ${skipped} already existed.`);
