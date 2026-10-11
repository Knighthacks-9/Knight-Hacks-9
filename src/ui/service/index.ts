// The one NightwatchService the UI uses. Swap the implementation here to point
// the desktop UI at a different backend.
import { createLocalNightwatchService } from "./localService";

export { LEVELS, levelConfig } from "./localService";
export { MISSED_PREFIX, buildShiftResult, gradeFor } from "./shiftResult";
export type * from "./types";

export const nightwatchService = createLocalNightwatchService();
