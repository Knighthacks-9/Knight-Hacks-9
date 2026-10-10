import { gazeController, type GazeController } from "./gazeController";

/**
 * Feeds the mouse position over `element` (the game canvas) to the gaze
 * controller, so every scene gets mouse-as-gaze without its own handlers.
 * Returns a function that detaches the listeners.
 */
export function attachMouseFallback(
  element: HTMLElement,
  controller: GazeController = gazeController,
): () => void {
  const update = (event: PointerEvent) => {
    const bounds = element.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    controller.setMousePoint({
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    });
  };
  element.addEventListener("pointermove", update);
  element.addEventListener("pointerdown", update);
  return () => {
    element.removeEventListener("pointermove", update);
    element.removeEventListener("pointerdown", update);
  };
}
