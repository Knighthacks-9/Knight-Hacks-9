// The radio dispatcher's lines. Text lives in scripts/voice-lines.json, the
// same file `npm run voice:generate` turns into public/audio/dispatch_<id>.mp3,
// so what the player reads in the radio log matches what they hear.
import lines from "../../scripts/voice-lines.json";
import { playDispatchLine } from "./voice";

export type DispatchLineId =
  | "shift_start"
  | "shift_end"
  | "check_camera_1"
  | "check_camera_2"
  | "check_camera_3"
  | "check_camera_4"
  | "report_received"
  | "stay_alert"
  | "describe_subject"
  | "unit_dispatched"
  | "say_again";

const TEXT = new Map<string, string>(
  (lines as { id: string; text: string }[]).map((line) => [line.id, line.text]),
);

export function dispatchText(id: DispatchLineId): string {
  return TEXT.get(id) ?? "";
}

/** Plays a dispatcher line (pre-generated if available) and resolves when done. */
export function sayDispatch(id: DispatchLineId): Promise<void> {
  return playDispatchLine(id, dispatchText(id));
}
