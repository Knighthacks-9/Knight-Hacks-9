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

Open the local URL printed by Vite. From Calibration, adjust gaze sensitivity
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

## Scripts

- `npm run dev` — start the Vite development server
- `npm run build` — type-check and create the production build
- `npm run preview` — serve the production build locally
- `npm run lint` — run ESLint
- `npm run format` — format the project with Prettier
- `npm run format:check` — check formatting without changing files
- `npm test` — run Vitest

## Team ownership

| Folder           | Owner    | What lives there                                                          |
| ---------------- | -------- | ------------------------------------------------------------------------- |
| `src/vision/`    | Person 1 | Webcam, MediaPipe tracking, gaze model, calibration scene, mouse fallback |
| `src/world/`     | Person 2 | Map, cameras, A\* pathfinding, NPC routines and suspicious behaviors      |
| `src/game/`      | Person 3 | Title, Shift, and Debrief scenes, camera feeds, levels                    |
| `src/analytics/` | Person 4 | Shift logging, catch/miss classification, debrief report and panel        |
| `src/shared/`    | Everyone | `types.ts` (the contract) and `eventBus.ts`                               |

`src/main.ts` boots Phaser, registers the scenes, installs analytics, and
attaches the mouse fallback.

## How the modules fit together

The Shift scene owns the clock. Each frame it emits `sim:tick`; the world
answers with `world:snapshot`, the feeds draw the NPCs each camera sees, and
the scene turns the vision module's gaze point into the watched feed and emits
`gaze:sample`. Analytics listens to everything and answers `shift:end` with
`analytics:report`, which the Debrief scene and the HTML debrief panel show.

```text
ShiftScene ── sim:tick ──▶ world ── world:snapshot, world:suspiciousStart/End ──▶ feeds, analytics
    │  gazeController.getPoint() → watched feed ── gaze:sample ──▶ analytics
    │  click an NPC ── flag:created ──▶ analytics
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

Dev shortcuts: `/?level=4` starts at level 4, and `/src/world/world-debug.html`
runs the world on its own with a top-down view.

## GitHub Pages

Vite uses `/` while serving locally and `/Knight-Hacks-9/` for production
builds, so the generated files can be deployed directly to this repository's
GitHub Pages project site.
