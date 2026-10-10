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

- **Person 1 — Vision:** `src/vision/` — webcam capture, MediaPipe face/eye
  tracking, gaze mapping, calibration, tuning, and mouse fallback
- **Person 2 — World:** `src/world/` — map, NPC, and pathfinding placeholder
- **Person 3 — Game:** `src/game/` — Phaser scenes and scene-flow placeholder
- **Person 4 — Analytics:** `src/analytics/` — logging, scoring, and debrief
  data placeholder
- **Shared:** `src/shared/` — types and the shared event bus

Modules should communicate through `src/shared/eventBus.ts` and the shared types
in `src/shared/types.ts`, rather than importing one another's internals.

## GitHub Pages

Vite uses `/` while serving locally and `/Knight-Hacks-9/` for production
builds, so the generated files can be deployed directly to this repository's
GitHub Pages project site.
