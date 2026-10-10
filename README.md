# Night Watch

A small browser game for a four-person team, built with Phaser and Vite.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Getting started

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The game opens on the NIGHTWATCH desktop
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
   the report is filed (`flag:created`) and dispatch sends a unit.

If dispatch didn't catch anything, it asks you to say again. A report still
waiting for its follow-up when the shift ends is not counted. The debrief
shows each report's incident type (✓ or ✗) and your description.

### Radio voice (ElevenLabs)

The dispatcher voice and push-to-talk use ElevenLabs, with the free browser
speech APIs as an automatic fallback. During a shift, use **TALK** in the
DISPATCH tab or **hold Space**; a `● TRANSMITTING` indicator shows while you
talk, and each transcript is published on the event bus as `radio:report`.
Dispatcher lines (text and audio) live in `scripts/voice-lines.json`.

The ElevenLabs key never reaches the browser. Two Netlify Functions proxy the
API: `/api/tts` (text to speech, max 500 characters) and `/api/stt`
(speech to text with the `scribe_v2` model). ElevenLabs error codes pass
through; after a 401 (bad key) or 429 (out of credits) the game uses browser
speech for the rest of the session. The browser console logs which provider
handled each line (`[voice] TTS provider: …`).

**Set up the keys.** Copy `.env.example` to `.env` (git-ignored) and fill in
`ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`. On Netlify, add the same two
variables under Site configuration → Environment variables.

**Run with the functions locally.** `npm run dev:netlify` starts Netlify's
dev server (via `npx netlify-cli`) at <http://localhost:8888>, which serves the
Vite app and the functions and reads `.env`. Plain `npm run dev` has no
functions, so voice falls back to the browser APIs.

**Save credits.** Add `?voice=free` to the URL to skip ElevenLabs entirely.

**Pre-generate dispatcher lines.** `npm run voice:generate` reads
`scripts/voice-lines.json` and writes `public/audio/dispatch_<id>.mp3` using
the key in `.env`. Existing files are skipped, so re-running only pays for new
or deleted lines. Play one in code with `playDispatchLine(id, text)` from
`src/audio`, which costs nothing and falls back to `speak(text)`.

Voice needs Netlify (or `npm run dev:netlify`). The GitHub Pages build has no
functions, so there it always uses the browser fallbacks.

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
| `src/ui/`        | Shared   | NIGHTWATCH desktop UI; `service/` adapts it to the modules above           |

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
