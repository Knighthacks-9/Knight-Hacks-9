// The dispatcher's default lines: a few radio-style variants per stage and
// debrief clip, used whenever live AI is off or fails. The game decides what
// happened and which line id fits; the variants only change the wording.
//
// Placeholders are filled from game state: {CAM} the reported feed number,
// {ROOM} a location name, {NEW_CAM} the feed a subject moved to, {BEHAVIOR} a
// behavior phrase. Lines have no other digits and invent no names or times.

export type Placeholder = "CAM" | "ROOM" | "NEW_CAM" | "BEHAVIOR";
export type LineSlots = Partial<Record<Placeholder, string>>;

export const DEFAULT_LINES = {
  // --- Investigation --------------------------------------------------------
  acknowledged: [
    "Copy, control. Report on camera {CAM}, {ROOM}, acknowledged.",
    "Dispatch copies. Camera {CAM}, {ROOM}. Report logged.",
    "Roger that, control. We have your report from {ROOM}, camera {CAM}.",
  ],
  en_route: [
    "Unit en route to {ROOM}, camera {CAM}. Stand by.",
    "Sending a unit to {ROOM} now. Keep eyes on camera {CAM}.",
    "Unit moving to camera {CAM}, {ROOM}. Stand by, control.",
  ],
  on_scene_still: [
    "Unit on scene at {ROOM}. Eyes on the subject.",
    "Unit has arrived at {ROOM}, camera {CAM}. Subject is still there.",
    "We're on scene at {ROOM}. Subject in sight.",
  ],
  // {ROOM} is where the subject is now; {NEW_CAM} only when a feed shows them.
  on_scene_moved: [
    "Unit on scene, but the subject moved to {ROOM}, camera {NEW_CAM}. Following.",
    "Subject has relocated to camera {NEW_CAM}, {ROOM}. Unit is following.",
    "Unit arrived, subject is gone from there. Last seen heading toward {ROOM}. Following.",
  ],
  on_scene_gone: [
    "Unit on scene at {ROOM}. Subject has left the monitored area.",
    "Unit arrived at camera {CAM}, {ROOM}. Subject is out of the building view.",
    "We're at {ROOM}, control. Subject has cleared the monitored area.",
  ],
  on_scene_nobody: [
    "Unit on scene at {ROOM}. No one matching.",
    "Unit checked camera {CAM}, {ROOM}. Nobody there fits the report.",
    "We're at {ROOM}, control. Area is empty.",
  ],
  resolved_suspect: [
    "Subject detained. Confirmed {BEHAVIOR}. Good call, control.",
    "We have the subject in custody. They were {BEHAVIOR}. Nice catch.",
    "Subject detained for {BEHAVIOR}. Good eyes, control.",
  ],
  resolved_innocent: [
    "False report. Subject checked out and has been cleared.",
    "Subject is clean, control. They've been cleared and released.",
    "Nothing suspicious there. Subject has been cleared.",
  ],
  resolved_nobody: [
    "False report. Nothing out of place at {ROOM}. Area cleared.",
    "Area at {ROOM} is clear. Nothing to report.",
    "Unit swept {ROOM}. All clear, control.",
  ],
  closed: [
    "Incident on camera {CAM} closed. Back to your feeds, control.",
    "Closing out camera {CAM}. Stay on your feeds.",
    "Camera {CAM} incident is closed. Eyes back on the monitors.",
  ],
  late: [
    "Copy, control. Too late for a unit on camera {CAM}. Log it for the next crew.",
    "No unit can reach {ROOM} before shift change. Log it for the next crew.",
    "Camera {CAM} noted, control. Out of time tonight, so log it for the next crew.",
  ],

  // --- End-of-shift debrief clips -------------------------------------------
  debrief_quiet: [
    "Quiet night, control. Nothing came across the feeds.",
    "Nothing to report tonight, control. A quiet shift.",
  ],
  debrief_all_caught: [
    "Good work, control. Every suspect caught: {BEHAVIOR}.",
    "Clean sweep tonight, control. You caught them all: {BEHAVIOR}.",
    "Nothing got past you, control. Caught: {BEHAVIOR}.",
  ],
  debrief_some_caught: [
    "Control, you caught some of them, but not all.",
    "Mixed night, control. A few got past us.",
  ],
  debrief_none_caught: [
    "Rough night, control. Nobody was caught.",
    "Tough shift, control. Every suspect got away.",
  ],
  debrief_missed_loitering: [
    "We missed someone {BEHAVIOR} on camera {CAM}, {ROOM}. There was a break-in later that night.",
    "Someone {BEHAVIOR} slipped by. It ended in a break-in later that night.",
  ],
  debrief_missed_restrictedZone: [
    "We missed someone {BEHAVIOR} on camera {CAM}, {ROOM}. The server room was accessed without authorization.",
    "Someone {BEHAVIOR} got past us. That meant unauthorized access to the server room.",
  ],
  debrief_missed_revisitingDoors: [
    "We missed someone {BEHAVIOR} on camera {CAM}, {ROOM}. A door was found propped open.",
    "Someone {BEHAVIOR} went unreported. Morning crew found a door propped open.",
  ],
  debrief_missed_avoidingCameras: [
    "We missed someone {BEHAVIOR} on camera {CAM}, {ROOM}. A theft was discovered in the morning.",
    "Someone {BEHAVIOR} got through. The morning crew discovered a theft.",
  ],
  debrief_unwatched: [
    "You weren't watching camera {CAM}.",
    "Nobody was watching camera {CAM} at the time.",
  ],
  debrief_more_missed: [
    "And more got past us besides that.",
    "Others slipped through as well.",
  ],
  debrief_false_one: [
    "Also one false report. Take a second look before calling it in.",
    "One false report tonight. Be sure before you call it in.",
  ],
  debrief_false_many: [
    "Also a few false reports. Take a second look before calling it in.",
    "Several false reports tonight. Be sure before you call it in.",
  ],
} as const satisfies Record<string, readonly string[]>;

export type LineId = keyof typeof DEFAULT_LINES;

/** Slots the game always provides for each line id; the rest are optional. */
export const REQUIRED_SLOTS: Readonly<Record<LineId, readonly Placeholder[]>> =
  {
    acknowledged: ["CAM", "ROOM"],
    en_route: ["CAM", "ROOM"],
    on_scene_still: ["CAM", "ROOM"],
    on_scene_moved: ["ROOM"],
    on_scene_gone: ["CAM", "ROOM"],
    on_scene_nobody: ["CAM", "ROOM"],
    resolved_suspect: ["BEHAVIOR"],
    resolved_innocent: [],
    resolved_nobody: ["ROOM"],
    closed: ["CAM"],
    late: ["CAM", "ROOM"],
    debrief_quiet: [],
    debrief_all_caught: ["BEHAVIOR"],
    debrief_some_caught: [],
    debrief_none_caught: [],
    debrief_missed_loitering: ["BEHAVIOR"],
    debrief_missed_restrictedZone: ["BEHAVIOR"],
    debrief_missed_revisitingDoors: ["BEHAVIOR"],
    debrief_missed_avoidingCameras: ["BEHAVIOR"],
    debrief_unwatched: ["CAM"],
    debrief_more_missed: [],
    debrief_false_one: [],
    debrief_false_many: [],
  };

const PLACEHOLDER = /\{(CAM|ROOM|NEW_CAM|BEHAVIOR)\}/g;

/** The placeholders a line uses. */
export function placeholdersIn(line: string): Placeholder[] {
  return [...line.matchAll(PLACEHOLDER)].map((m) => m[1] as Placeholder);
}

/**
 * Picks a random variant whose placeholders can all be filled from `slots`
 * and fills them in. A slot that's undefined or empty can't be filled.
 */
export function fillLine(
  id: LineId,
  slots: LineSlots,
  random: () => number = Math.random,
): string {
  const variants: readonly string[] = DEFAULT_LINES[id];
  const fits = variants.filter((line) =>
    placeholdersIn(line).every((p) => slots[p]),
  );
  // Tests guarantee a fit for the required slots; this is only a safety net.
  const pool = fits.length ? fits : variants;
  const index = Math.min(Math.floor(random() * pool.length), pool.length - 1);
  return pool[index].replace(
    PLACEHOLDER,
    (_, p: Placeholder) => slots[p] ?? "",
  );
}
