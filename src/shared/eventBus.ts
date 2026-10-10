import mitt from "mitt";
import type { AppEvents } from "./types";

export const eventBus = mitt<AppEvents>();
