// Retro desktop windows: bevelled chrome, title-bar buttons, and dragging by
// the title bar with pointer capture (mouse, touch, and pen).
import { playSfx } from "../audio";
import { clamp, h, icon } from "./dom";
import { ICONS } from "./icons";

let topZ = 20;

/** Raises a floating window above the others. */
export function bringToFront(win: HTMLElement): void {
  win.style.zIndex = String(++topZ);
}

export interface RetroWindowOptions {
  title: string;
  className?: string;
  /** Extra content in the middle of the title bar (e.g. a timer). */
  titleExtra?: Node;
  onMinimize?: () => void;
  /** True for a working maximize toggle; "static" for a decorative one. */
  maximize?: boolean | "static";
  onClose?: () => void;
  closeLabel?: string;
  /** Accessible role; dialogs get role="dialog". */
  role?: string;
}

export interface RetroWindow {
  root: HTMLElement;
  titleBar: HTMLElement;
  body: HTMLElement;
}

let windowIds = 0;

function titleButton(
  label: string,
  glyph: string,
  onClick: (() => void) | undefined,
): HTMLButtonElement {
  return h(
    "button",
    {
      type: "button",
      class: `tb-btn tb-${glyph}`,
      "aria-label": label,
      title: label,
      "aria-disabled": onClick ? null : "true",
      onclick: () => {
        if (!onClick) return playSfx("deny");
        playSfx("click");
        onClick();
      },
    },
    h("span", { class: "tb-glyph", "aria-hidden": "true" }),
  );
}

export function createWindow(options: RetroWindowOptions): RetroWindow {
  const titleId = `rw-title-${++windowIds}`;
  const root = h("section", {
    class: `rw ${options.className ?? ""}`,
    role: options.role ?? "region",
    "aria-labelledby": titleId,
  });
  const buttons = h("div", { class: "tb-buttons" });
  if (options.onMinimize || options.maximize) {
    buttons.append(titleButton("Minimize", "min", options.onMinimize));
  }
  if (options.maximize) {
    buttons.append(
      titleButton(
        "Maximize",
        "max",
        options.maximize === true
          ? () => root.classList.toggle("is-maximized")
          : undefined,
      ),
    );
  }
  if (options.onClose) {
    buttons.append(
      titleButton(options.closeLabel ?? "Close", "close", options.onClose),
    );
  }
  const titleBar = h(
    "header",
    { class: "rw-titlebar" },
    icon(ICONS.app, "rw-app-icon"),
    h("h2", { class: "rw-title", id: titleId }, options.title),
    options.titleExtra ?? null,
    buttons,
  );
  const body = h("div", { class: "rw-body" });
  root.append(titleBar, body);
  return { root, titleBar, body };
}

/** Moves a window (left/top in its offset parent's box), keeping its title bar reachable. */
export function placeWindow(win: HTMLElement, left: number, top: number): void {
  const parent = (win.offsetParent as HTMLElement | null) ?? document.body;
  const maxLeft = parent.clientWidth - Math.min(win.offsetWidth, 120);
  const minLeft = -win.offsetWidth + Math.min(win.offsetWidth, 120);
  const maxTop = Math.max(0, parent.clientHeight - 32);
  win.style.left = `${Math.round(clamp(left, minLeft, maxLeft))}px`;
  win.style.top = `${Math.round(clamp(top, 0, maxTop))}px`;
}

/** Centers a window in its offset parent, optionally nudged. */
export function centerWindow(win: HTMLElement, dx = 0, dy = 0): void {
  const parent = (win.offsetParent as HTMLElement | null) ?? document.body;
  placeWindow(
    win,
    (parent.clientWidth - win.offsetWidth) / 2 + dx,
    Math.max(8, (parent.clientHeight - win.offsetHeight) / 2 + dy),
  );
}

const NO_DRAG = "button, a, input, select, textarea, [data-no-drag]";

/**
 * Lets the window be dragged by `handle`. Buttons on the handle stay
 * clickable. Arrow keys move the window while the handle has focus.
 * Returns a cleanup function.
 */
export function makeDraggable(
  win: HTMLElement,
  handle: HTMLElement,
): () => void {
  let drag: { id: number; dx: number; dy: number } | null = null;
  handle.classList.add("is-draggable");
  handle.tabIndex = 0;
  handle.setAttribute("aria-roledescription", "Window title bar");
  handle.title = "Drag to move · arrow keys move when focused";

  const position = () => {
    const parent = (win.offsetParent as HTMLElement | null) ?? document.body;
    const own = win.getBoundingClientRect();
    const box = parent.getBoundingClientRect();
    return { left: own.left - box.left, top: own.top - box.top, box };
  };

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 || win.classList.contains("is-maximized")) return;
    if ((event.target as Element).closest(NO_DRAG)) return;
    const { left, top, box } = position();
    drag = {
      id: event.pointerId,
      dx: event.clientX - box.left - left,
      dy: event.clientY - box.top - top,
    };
    handle.setPointerCapture(event.pointerId);
    win.classList.add("is-dragging");
    bringToFront(win);
    event.preventDefault();
  };
  const onMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const { box } = position();
    placeWindow(
      win,
      event.clientX - box.left - drag.dx,
      event.clientY - box.top - drag.dy,
    );
  };
  const onUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    win.classList.remove("is-dragging");
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.target !== handle) return;
    const step = event.shiftKey ? 40 : 10;
    const move = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key];
    if (!move || win.classList.contains("is-maximized")) return;
    event.preventDefault();
    const { left, top } = position();
    placeWindow(win, left + move[0], top + move[1]);
  };
  const onFront = () => bringToFront(win);
  const onResize = () => {
    if (!win.isConnected) return;
    const { left, top } = position();
    placeWindow(win, left, top);
  };

  handle.addEventListener("pointerdown", onDown);
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);
  handle.addEventListener("keydown", onKey);
  win.addEventListener("pointerdown", onFront, true);
  window.addEventListener("resize", onResize);
  return () => {
    handle.removeEventListener("pointerdown", onDown);
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onUp);
    handle.removeEventListener("keydown", onKey);
    win.removeEventListener("pointerdown", onFront, true);
    window.removeEventListener("resize", onResize);
  };
}

/** Creates a floating, draggable window in `layer`, centered. */
export function openFloatingWindow(
  layer: HTMLElement,
  options: RetroWindowOptions,
  build: (body: HTMLElement) => void,
  offset: { x: number; y: number } = { x: 0, y: 0 },
): RetroWindow & { destroy(): void } {
  const win = createWindow(options);
  win.root.classList.add("rw-floating");
  build(win.body);
  layer.append(win.root);
  bringToFront(win.root);
  centerWindow(win.root, offset.x, offset.y);
  const stopDrag = makeDraggable(win.root, win.titleBar);
  return {
    ...win,
    destroy() {
      stopDrag();
      win.root.remove();
    },
  };
}
