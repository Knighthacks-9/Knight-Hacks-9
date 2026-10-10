// Tiny DOM helpers for the desktop UI (no framework in this project).

type Child = Node | string | number | null | undefined | false;

/**
 * Creates an element. `on*` function attributes become event listeners,
 * `class` sets className, booleans toggle attributes, null/undefined skip.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === "class") {
      el.className = String(value);
    } else if (key === "style") {
      el.style.cssText = String(value);
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  append(el, ...children);
  return el;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
}

/** An element holding trusted, static SVG markup (icons). */
export function icon(markup: string, className = "px-icon"): HTMLSpanElement {
  const span = h("span", { class: className, "aria-hidden": "true" });
  span.innerHTML = markup;
  return span;
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const pad2 = (value: number): string =>
  String(Math.max(0, Math.floor(value))).padStart(2, "0");

/** 125 → "02:05" */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad2(s / 60)}:${pad2(s % 60)}`;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export const randomBetween = (min: number, max: number): number =>
  min + Math.random() * (max - min);
