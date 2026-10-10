# Night Watch

A small browser-game skeleton for a four-person team. The project currently
contains only a runnable Phaser scene flow and placeholders for each work area.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Getting started

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Click through Title, Calibration, Shift,
and Debrief; each screen is intentionally just a scene name and a navigation
prompt.

## Scripts

- `npm run dev` — start the Vite development server
- `npm run build` — type-check and create the production build
- `npm run preview` — serve the production build locally
- `npm run lint` — run ESLint
- `npm run format` — format the project with Prettier
- `npm run format:check` — check formatting without changing files
- `npm test` — run Vitest

## Team ownership

- **Person 1 — Vision:** `src/vision/` — webcam and eye-tracking placeholder
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
