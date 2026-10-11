# Knight's Eye

A small browser game for a four-person team, built with Phaser and Vite.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Getting started

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The game opens on the Knight's Eye desktop
(see [Desktop UI](#desktop-ui)); the original Phaser version is still available
at `/?ui=classic`. From Calibration, adjust gaze sensitivity
and smoothing, enable or disable mouse fallback, or run the nine-point gaze
calibration. Settings and the fitted calibration are saved in browser storage.

Select **Enable webcam** on Calibration and grant camera permission to start
MediaPipe Face Landmarker and the independent BlazeFace detector. On first use,
the browser downloads the MediaPipe WASM runtime and both models; an internet
connection is required. Webcam frames are analyzed locally in the browser and
are not uploaded. The camera requests auto-gain control and a higher-resolution
stream where supported; low-light frames are brightened for detection without
changing the visible preview. This can help in dim rooms but cannot replace
light on your face. A mirrored live preview appears in the lower-right corner
while the camera is active and disappears when it is stopped. A face box is
shown whenever either detector finds a face, with eye corners and iris markers.
Camera access requires HTTPS or localhost.

### Gaze calibration

Once the webcam tracks both eyes, select **Start 9-point calibration** and
follow the dot. Each point takes about two seconds and needs no key presses:
the dot glides to a spot, waits for your eyes to settle, then records about a
second of frames (blinks are skipped). Look at the dot the way you normally
look at the screen, including turning your head if that is natural.

Calibration fits a ridge regression from per-frame features (iris position
inside each eye, eyelid opening, head yaw and pitch from MediaPipe's facial
transformation matrix, and head position) to canvas coordinates. Each point is
also predicted with that point left out, giving the **estimated error** shown
afterwards; toggle the debug overlay (**D**) on the test screen to see those
held-out predictions. The test screen lights up whichever of six stand-in
camera feeds you are looking at.

Recalibrate after changing seat, screen, lighting, window size, or browser
zoom, since the mapping is tied to where the canvas sits on your screen.

Other modules read gaze from `gazeController` in `src/vision`: `getPoint()`
returns a smoothed canvas point (0..1), `getSource()` reports `tracker`,
`mouse`, or `none`, and `isBlinking()` reports blinks. Gaze is held for up to
350 ms through blinks and dropped frames before falling back to the mouse.

### Desktop UI

The default interface is a late-90s desktop built with plain TypeScript and
DOM (`src/ui/`): Desktop → Gaze Calibration → Watch Station → Shift Debrief.

- **Desktop:** double-click the shortcuts or use **START**. Set the shift length
  and press **BEGIN SHIFT** (or **Skip calibration**). Windows drag by their
  title bars (arrow keys move a focused title bar).
- **Gaze Calibration:** same settings and webcam pipeline as the classic scene.
  Without a webcam, the nine-point run is a pointer calibration: click each
  target. **TEST GAZE** lights up the feed under your gaze or mouse.
- **Watch Station:** `LEVEL_1`–`LEVEL_3` show 4, 6, or 9 feeds with 3, 5,
  or 8 expected anomalies (switching restarts the shift). The world has six
  cameras, so level 3's last three feeds are placeholders with no anomalies.
  The corner button on a feed focuses it; **RESTORE GRID** or ESC returns.
  **REPORT SIGHTING** (or R), then click the feed where you saw something.
  Number keys 1–9 also work, and ESC cancels. Dispatch answers on the radio,
  muted until you press **UNMUTE DISPATCH**. **PUSH TO TALK** (click, or hold
  Space) and say "Camera 3, sighting" to report by voice. Pop-ups and feed
  glitches show up during the shift; drag or close the pop-ups.
- **Shift Debrief:** grade, detection, false reports, attention per feed, a
  per-camera timeline, and coaching. The last debrief is saved for the
  **Last Debrief** shortcut.

A camera report counts as a catch when that feed showed a suspect during their
suspicious behavior (or up to 5 s after); otherwise it is a false report. The UI
talks to the game only through `NightwatchService` (`src/ui/service/`), so a
different backend can replace `localService.ts`.

### Reporting suspicious people (classic)

The side panel in a shift has two tabs. A report only counts once dispatch
has your spoken description:

1. **REPORT** starts a report. Click the camera feed showing the activity.
2. Click the person acting suspicious on that feed.
3. Pick what they are doing (loitering, revisiting doors, restricted zone,
   avoiding cameras) and **Send report**.
4. The panel switches to **DISPATCH**. The AI dispatcher acknowledges and asks
   for a description. Click **TALK**, describe the subject, and click
   **STOP** (or hold Space while talking). Once your words are transcribed
   the report is filed (`flag:created`) and dispatch sends a unit (see
   [AI dispatcher](#ai-dispatcher-hugging-face)).

If dispatch didn't catch anything, it asks you to say again. A report still
waiting for its follow-up when the shift ends is not counted. The debrief
shows each report's incident type (✓ or ✗) and your description.

### Radio voice (ElevenLabs)

The dispatcher voice uses ElevenLabs, with the free browser speech APIs as an
automatic fallback. Each line plays the first of these that works:
pre-generated MP3 → live ElevenLabs → browser voice. Push-to-talk uses the
browser's speech recognition. During a shift, use **TALK** in the DISPATCH tab
or **hold Space**; a `● TRANSMITTING` indicator shows while you talk, and each
transcript is published on the event bus as `radio:report`. Dispatcher lines
(text and audio) live in `scripts/voice-lines.json`.

The ElevenLabs key never reaches the browser. Two Netlify Functions proxy the
API: `/api/tts` (text to speech, max 500 characters) and `/api/stt` (speech
to text with the `scribe_v2` model, off unless `VITE_ELEVENLABS_STT=true`).
ElevenLabs error codes pass through; after one that retrying won't fix (bad
key, out of credits, not configured) the game uses browser speech for the rest
of the session. The browser console logs which provider handled each line
(`[voice] TTS provider: …`).

**Set up the keys.** Copy `.env.example` to `.env` (git-ignored). In
ElevenLabs, create an API key with **Text to Speech** and **User → Read**
access (`/api/status` reads the subscription to see if credits are left), and
copy a voice's **Voice ID**. Fill in `ELEVENLABS_API_KEY` and
`ELEVENLABS_VOICE_ID`. On Netlify, add the same two variables under Site
configuration → Environment variables.

**Run with the functions locally.** `npm run dev:netlify` starts Netlify's
dev server (via `npx netlify-cli`) at <http://localhost:8888>, which serves the
Vite app and the functions and reads `.env`. Plain `npm run dev` has no
functions, so voice falls back to the browser APIs.

**Save credits.** Add `?voice=free` to the URL to skip ElevenLabs entirely.

**Pre-generate dispatcher lines.** `npm run voice:generate` reads
`scripts/voice-lines.json` and writes `public/audio/dispatch_<id>.mp3` using
the key in `.env`. Existing files are skipped, so re-running only pays for new
or deleted lines. Commit the MP3s so deploys play them without spending
credits. Play one in code with `playDispatchLine(id, text)` from `src/audio`,
which costs nothing and falls back to `speak(text)`.

Voice needs the Netlify functions: the Netlify site, `npm run dev:netlify`,
or the GitHub Pages build pointed at Netlify (see [GitHub Pages](#github-pages)).
Without them it uses the browser fallbacks.

### AI dispatcher (Hugging Face)

After you file a report, dispatch runs an investigation over the radio:
acknowledged → en route → on scene → resolved → closed. At the end of a shift
the dispatcher sums it up on the debrief screen and reads it aloud.

The game decides **what** happens; the AI only decides **how** it's said. The
facts come from game state: the reported feed, whether the person really was
suspicious (world ground truth), where they are when the unit arrives (so
dispatch says if they moved), and, for the debrief, the analytics report
(caught suspects, false reports, and each miss with its consequence). A real
suspect is always detained and an innocent person is always cleared as a
false report. Every line has a template, used whenever the AI is unavailable.

- `netlify/functions/dispatch.mts` (`POST /api/dispatch { stage, facts }` →
  `{ text }`) calls Hugging Face Inference Providers
  (`router.huggingface.co/v1/chat/completions`). `HF_TOKEN` stays on the
  server; Hugging Face error statuses pass through.
- `src/audio/dispatchLine.ts` waits at most 2 s, then uses the template. The
  console logs which one was used (`[dispatch] <stage>: hf` or `template`).
  Lines are prefetched before they're due, so the radio doesn't lag.
- Investigations are squeezed to finish before the shift timer ends. Reports in
  the last 10 seconds get a "log it for the next crew" line instead.

**Set up.** Create a token at <https://huggingface.co/settings/tokens> with the
**Make calls to Inference Providers** permission. Add `HF_TOKEN` (and
optionally `HF_MODEL`, default `google/gemma-4-26B-A4B-it`) to `.env`, and to
Netlify's environment variables for deploys. Run with `npm run dev:netlify`;
plain `npm run dev` has no functions, so it uses the templates. Add `?ai=off` to the URL to skip the AI.

### Premium features and fallbacks

The realistic voice and the AI dispatcher are paid ("premium") features, and
the game is built to keep working without them (`src/audio/premium.ts`):

- On load, `GET /api/status` (`netlify/functions/status.mts`) reports which
  ones the server can still provide: keys set and valid, and ElevenLabs
  characters left. No server (plain `npm run dev`, or GitHub Pages without
  `VITE_API_BASE`) means neither.
- A feature that fails mid-game (out of credits, key removed) is switched off
  for the rest of the session.
- The main menu has **Realistic voice** and **AI dispatcher** ON/OFF settings,
  saved in the browser. A feature that no longer works is greyed out with
  "This feature is no longer supported."
- Without them, the game uses the browser voice and the template lines.

**To stop paying:** delete the ElevenLabs and Hugging Face variables in
Netlify (or let the keys lapse). The game switches to free mode by itself; no
code changes needed.

## Scripts

- `npm run dev` — start the Vite development server
- `npm run dev:netlify` — run Vite plus the voice functions (Netlify dev)
- `npm run voice:generate` — pre-generate dispatcher lines with ElevenLabs
- `npm run build` — type-check and create the production build
- `npm run preview` — serve the production build locally
- `npm run lint` — run ESLint
- `npm run format` — format the project with Prettier
- `npm run format:check` — check formatting without changing files
- `npm test` — run Vitest

## Team ownership

| Folder           | Owner    | What lives there                                                           |
| ---------------- | -------- | -------------------------------------------------------------------------- |
| `src/vision/`    | Person 1 | Webcam, MediaPipe tracking, gaze model, calibration scene, mouse fallback  |
| `src/world/`     | Person 2 | Map, cameras, A\* pathfinding, NPC routines and suspicious behaviors       |
| `src/game/`      | Person 3 | Title, Shift, and Debrief scenes, camera feeds, levels                     |
| `src/analytics/` | Person 4 | Shift logging, catch/miss classification, debrief report and panel         |
| `src/audio/`     | Shared   | Dispatcher voice and push-to-talk (`netlify/functions` proxies ElevenLabs) |
| `src/shared/`    | Everyone | `types.ts` (the contract) and `eventBus.ts`                                |
| `src/ui/`        | Shared   | Knight's Eye desktop UI; `service/` adapts it to the modules above         |

`src/main.ts` installs analytics and starts the desktop UI (`src/ui`), or
with `?ui=classic` loads `src/classic.ts`, which boots Phaser, registers the
scenes, and attaches the mouse fallback.

## How the modules fit together

The Shift scene owns the clock. Each frame it emits `sim:tick`; the world
answers with `world:snapshot`, the feeds draw the NPCs each camera sees, and
the scene turns the vision module's gaze point into the watched feed and emits
`gaze:sample`. Analytics listens to everything and answers `shift:end` with
`analytics:report`, which the Debrief scene and the HTML debrief panel show.

```text
ShiftScene ── sim:tick ──▶ world ── world:snapshot, world:suspiciousStart/End ──▶ feeds, analytics
    │  gazeController.getPoint() → watched feed ── gaze:sample ──▶ analytics
    │  report + spoken follow-up ── flag:created, radio:report ──▶ analytics
    └─ shift:start / shift:end ──▶ analytics ── analytics:report ──▶ DebriefScene, debrief panel
```

| Event                           | Payload         | Emitted by | Used by                      |
| ------------------------------- | --------------- | ---------- | ---------------------------- |
| `scene:navigate`                | `SceneKey`      | any scene  | `main.ts`, analytics (panel) |
| `shift:start`                   | `ShiftStart`    | game       | analytics                    |
| `sim:tick`                      | `SimTick`       | game       | world                        |
| `world:map`                     | `WorldMap`      | world      | game, analytics              |
| `world:snapshot`                | `WorldSnapshot` | world      | game, analytics              |
| `world:suspiciousStart` / `End` | `WorldEvent`    | world      | analytics                    |
| `gaze:sample`                   | `GazeSample`    | game       | analytics                    |
| `flag:created`                  | `Flag`          | game       | analytics                    |
| `shift:end`                     | `ShiftEnd`      | game       | analytics                    |
| `analytics:report`              | `ShiftReport`   | analytics  | game                         |

Rules:

- Change `src/shared/types.ts` together: it is the only thing every module
  depends on, and a payload change needs both the sender and the listeners.
- Import another module only through its `index.ts` (`../vision`,
  `../world`, `../analytics`), never its internal files. Phaser scenes are the
  one exception: `main.ts` imports them directly so each `index.ts` stays
  loadable in tests.
- Times in payloads are shift seconds from `sim:tick`, so gaze, world events,
  and flags share one timeline.
- Work on feature branches and open pull requests.

Dev shortcuts: `/?level=4` starts at level 4 (`?level=1`–`3` in the desktop
UI), `/?screen=calibration`, `watch`, or `debrief` opens a desktop UI screen
directly, and `/src/world/world-debug.html`
runs the world on its own with a top-down view.

## GitHub Pages

Vite uses `/` while serving locally and `/Knight-Hacks-9/` for production
builds, so the generated files can be deployed directly to this repository's
GitHub Pages project site.

Pages only serves static files, so the voice and AI functions stay on Netlify
and the Pages build calls them cross-origin:

1. In the GitHub repo, add an Actions **variable** (not a secret) named
   `VITE_API_BASE` set to the Netlify site URL, e.g.
   `https://your-site.netlify.app`. The deploy workflow passes it to the build.
2. In Netlify, add `ALLOWED_ORIGINS` with the Pages origin (scheme and host
   only, comma-separated if more than one). It defaults to
   `https://knighthacks-9.github.io`; set it if Pages uses a custom domain.
   Other origins get no CORS headers (`netlify/lib/cors.ts`).
3. Keep the API keys in Netlify only. Never put them in a `VITE_` variable:
   those are built into the public JavaScript.
