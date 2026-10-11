import { installAnalytics } from "./analytics";
import { startNightwatchUi } from "./ui";

// Analytics must listen before the first shift starts.
installAnalytics();

const app = document.getElementById("app")!;

// The retro desktop UI is the default. ?ui=classic runs the original Phaser
// scenes (loaded on demand, so the desktop UI doesn't download Phaser).
if (new URLSearchParams(location.search).get("ui") === "classic") {
  void import("./classic").then(({ startClassic }) => startClassic(app));
} else {
  startNightwatchUi(app);
}
