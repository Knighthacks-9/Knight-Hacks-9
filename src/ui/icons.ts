// Low-resolution pixel icons as inline SVG (crisp edges, no emoji).
const svg = (size: number, body: string) =>
  `<svg viewBox="0 0 ${size} ${size}" width="100%" height="100%" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

/** Bevelled tile frame shared by the desktop icons. */
const tile = (inner: string, face = "#b9c2b8") =>
  svg(
    32,
    `<rect x="2" y="2" width="28" height="28" fill="#1d2420"/>` +
      `<rect x="3" y="3" width="26" height="26" fill="${face}"/>` +
      `<rect x="3" y="3" width="26" height="2" fill="#eef2ec"/>` +
      `<rect x="3" y="3" width="2" height="26" fill="#eef2ec"/>` +
      `<rect x="3" y="27" width="26" height="2" fill="#6b736b"/>` +
      `<rect x="27" y="3" width="2" height="26" fill="#6b736b"/>` +
      inner,
  );

export const ICONS = {
  gaze: tile(
    `<rect x="9" y="9" width="14" height="14" fill="#1d2420"/>` +
      `<rect x="11" y="8" width="10" height="16" fill="#1d2420"/>` +
      `<rect x="8" y="11" width="16" height="10" fill="#1d2420"/>` +
      `<rect x="11" y="11" width="10" height="10" fill="#3f8f78"/>` +
      `<rect x="13" y="13" width="6" height="6" fill="#0f1512"/>` +
      `<rect x="13" y="13" width="2" height="2" fill="#d8f5e6"/>`,
  ),
  watch: tile(
    `<rect x="8" y="8" width="16" height="16" fill="#1d2420"/>` +
      `<rect x="10" y="10" width="12" height="12" fill="#b9c2b8"/>` +
      `<rect x="13" y="13" width="6" height="6" fill="#1d2420"/>`,
  ),
  debrief: tile(
    `<rect x="7" y="7" width="18" height="18" fill="#1d2420"/>` +
      `<rect x="9" y="9" width="14" height="14" fill="#3b5d68"/>` +
      `<rect x="11" y="9" width="2" height="14" fill="#1d2420"/>` +
      `<rect x="15" y="9" width="2" height="14" fill="#1d2420"/>` +
      `<rect x="19" y="9" width="2" height="14" fill="#1d2420"/>`,
    "#9fb0b0",
  ),
  readme: tile(
    `<rect x="8" y="7" width="16" height="18" fill="#f3f0e2"/>` +
      `<rect x="10" y="10" width="12" height="2" fill="#1d2420"/>` +
      `<rect x="10" y="14" width="12" height="2" fill="#1d2420"/>` +
      `<rect x="10" y="18" width="12" height="2" fill="#1d2420"/>` +
      `<rect x="10" y="22" width="8" height="1" fill="#1d2420"/>`,
    "#e8e2c8",
  ),
  app: svg(
    8,
    `<rect x="2" y="2" width="4" height="4" fill="#7fe0a0"/><rect x="3" y="1" width="2" height="6" fill="#7fe0a0"/><rect x="1" y="3" width="6" height="2" fill="#7fe0a0"/>`,
  ),
  info: svg(
    16,
    `<rect x="3" y="1" width="10" height="14" fill="#1e3c78"/><rect x="1" y="3" width="14" height="10" fill="#1e3c78"/>` +
      `<rect x="7" y="3" width="2" height="2" fill="#fff"/><rect x="7" y="6" width="2" height="7" fill="#fff"/>`,
  ),
  warning: svg(
    16,
    `<rect x="7" y="1" width="2" height="2" fill="#1d1d1d"/><rect x="6" y="3" width="4" height="2" fill="#1d1d1d"/>` +
      `<rect x="5" y="5" width="6" height="2" fill="#1d1d1d"/><rect x="4" y="7" width="8" height="2" fill="#1d1d1d"/>` +
      `<rect x="3" y="9" width="10" height="2" fill="#1d1d1d"/><rect x="2" y="11" width="12" height="3" fill="#1d1d1d"/>` +
      `<rect x="7" y="3" width="2" height="2" fill="#f2c14e"/><rect x="6" y="5" width="4" height="2" fill="#f2c14e"/>` +
      `<rect x="5" y="7" width="6" height="2" fill="#f2c14e"/><rect x="4" y="9" width="8" height="2" fill="#f2c14e"/>` +
      `<rect x="3" y="11" width="10" height="2" fill="#f2c14e"/>` +
      `<rect x="7" y="6" width="2" height="4" fill="#1d1d1d"/><rect x="7" y="11" width="2" height="1" fill="#1d1d1d"/>`,
  ),
  update: svg(
    16,
    `<rect x="1" y="2" width="14" height="10" fill="#1d2420"/><rect x="2" y="3" width="12" height="8" fill="#3f8f78"/>` +
      `<rect x="5" y="12" width="6" height="2" fill="#1d2420"/><rect x="3" y="14" width="10" height="1" fill="#1d2420"/>` +
      `<rect x="7" y="4" width="2" height="4" fill="#fff"/><rect x="5" y="6" width="6" height="2" fill="#fff"/><rect x="6" y="8" width="4" height="1" fill="#fff"/>`,
  ),
  disk: svg(
    16,
    `<rect x="1" y="5" width="14" height="7" fill="#1d2420"/><rect x="2" y="6" width="12" height="5" fill="#9aa39a"/>` +
      `<rect x="11" y="8" width="2" height="1" fill="#d8463b"/><rect x="3" y="8" width="5" height="1" fill="#1d2420"/>`,
  ),
  note: svg(
    16,
    `<rect x="3" y="1" width="10" height="14" fill="#1d2420"/><rect x="4" y="2" width="8" height="12" fill="#f3f0e2"/>` +
      `<rect x="5" y="4" width="6" height="1" fill="#1d2420"/><rect x="5" y="6" width="6" height="1" fill="#1d2420"/><rect x="5" y="8" width="4" height="1" fill="#1d2420"/>`,
  ),
  // --- Start menu (16px grid, drawn at 2x) ---------------------------------
  play: svg(
    16,
    `<rect x="3" y="2" width="2" height="12" fill="#1d2420"/><rect x="5" y="3" width="2" height="10" fill="#1d2420"/>` +
      `<rect x="7" y="4" width="2" height="8" fill="#1d2420"/><rect x="9" y="5" width="2" height="6" fill="#1d2420"/>` +
      `<rect x="11" y="6" width="2" height="4" fill="#1d2420"/><rect x="13" y="7" width="1" height="2" fill="#1d2420"/>` +
      `<rect x="4" y="4" width="2" height="8" fill="#2f8f5b"/><rect x="6" y="5" width="2" height="6" fill="#2f8f5b"/>` +
      `<rect x="8" y="6" width="2" height="4" fill="#2f8f5b"/><rect x="10" y="7" width="2" height="2" fill="#2f8f5b"/>` +
      `<rect x="4" y="4" width="1" height="6" fill="#7fe0a0"/>`,
  ),
  eye: svg(
    16,
    `<rect x="5" y="4" width="6" height="8" fill="#1d2420"/><rect x="3" y="5" width="10" height="6" fill="#1d2420"/>` +
      `<rect x="1" y="7" width="14" height="2" fill="#1d2420"/>` +
      `<rect x="5" y="5" width="6" height="6" fill="#f3f0e2"/><rect x="3" y="6" width="10" height="4" fill="#f3f0e2"/>` +
      `<rect x="2" y="7" width="12" height="2" fill="#f3f0e2"/>` +
      `<rect x="6" y="5" width="4" height="6" fill="#3f8f78"/><rect x="5" y="6" width="6" height="4" fill="#3f8f78"/>` +
      `<rect x="7" y="7" width="2" height="2" fill="#0f1512"/><rect x="6" y="6" width="1" height="1" fill="#d8f5e6"/>`,
  ),
  cctv: svg(
    16,
    `<rect x="1" y="3" width="11" height="6" fill="#1d2420"/><rect x="2" y="4" width="9" height="4" fill="#b9c2b8"/>` +
      `<rect x="2" y="4" width="9" height="1" fill="#eef2ec"/>` +
      `<rect x="11" y="4" width="4" height="4" fill="#1d2420"/><rect x="12" y="5" width="2" height="2" fill="#3f8f78"/>` +
      `<rect x="3" y="6" width="2" height="1" fill="#d8463b"/>` +
      `<rect x="5" y="9" width="2" height="3" fill="#1d2420"/><rect x="3" y="12" width="6" height="2" fill="#1d2420"/>`,
  ),
  chart: svg(
    16,
    `<rect x="1" y="1" width="14" height="14" fill="#1d2420"/><rect x="2" y="2" width="12" height="12" fill="#f3f0e2"/>` +
      `<rect x="3" y="8" width="2" height="4" fill="#3f8f78"/><rect x="7" y="5" width="2" height="7" fill="#3b5d68"/>` +
      `<rect x="11" y="3" width="2" height="9" fill="#e9b83c"/><rect x="3" y="12" width="10" height="1" fill="#1d2420"/>`,
  ),
  window: svg(
    16,
    `<rect x="1" y="2" width="14" height="12" fill="#1d2420"/><rect x="2" y="3" width="12" height="2" fill="#1f3a73"/>` +
      `<rect x="12" y="3" width="1" height="1" fill="#f1f4ee"/><rect x="2" y="5" width="12" height="8" fill="#b9c2b8"/>` +
      `<rect x="7" y="7" width="2" height="4" fill="#2f8f5b"/><rect x="6" y="8" width="4" height="2" fill="#2f8f5b"/>`,
  ),
  crt: svg(
    16,
    `<rect x="1" y="1" width="14" height="11" fill="#1d2420"/><rect x="2" y="2" width="12" height="9" fill="#e8e2c8"/>` +
      `<rect x="3" y="3" width="10" height="7" fill="#1d2420"/>` +
      `<rect x="4" y="4" width="4" height="1" fill="#7fe0a0"/><rect x="4" y="6" width="6" height="1" fill="#7fe0a0"/>` +
      `<rect x="4" y="8" width="2" height="1" fill="#7fe0a0"/>` +
      `<rect x="5" y="12" width="6" height="1" fill="#1d2420"/><rect x="3" y="13" width="10" height="2" fill="#1d2420"/>` +
      `<rect x="4" y="13" width="8" height="1" fill="#e8e2c8"/>`,
  ),
  restart: svg(
    16,
    `<rect x="5" y="2" width="5" height="2" fill="#2f8f5b"/><rect x="10" y="0" width="1" height="6" fill="#2f8f5b"/>` +
      `<rect x="11" y="1" width="1" height="4" fill="#2f8f5b"/><rect x="12" y="2" width="1" height="2" fill="#2f8f5b"/>` +
      `<rect x="3" y="3" width="2" height="2" fill="#2f8f5b"/><rect x="2" y="5" width="2" height="6" fill="#2f8f5b"/>` +
      `<rect x="3" y="11" width="2" height="2" fill="#2f8f5b"/><rect x="5" y="12" width="6" height="2" fill="#2f8f5b"/>` +
      `<rect x="11" y="11" width="2" height="2" fill="#2f8f5b"/><rect x="12" y="7" width="2" height="4" fill="#2f8f5b"/>`,
  ),
  power: svg(
    16,
    `<rect x="7" y="1" width="2" height="7" fill="#d8463b"/>` +
      `<rect x="5" y="3" width="1" height="2" fill="#d8463b"/><rect x="3" y="4" width="2" height="2" fill="#d8463b"/>` +
      `<rect x="10" y="3" width="1" height="2" fill="#d8463b"/><rect x="11" y="4" width="2" height="2" fill="#d8463b"/>` +
      `<rect x="2" y="6" width="2" height="5" fill="#d8463b"/><rect x="12" y="6" width="2" height="5" fill="#d8463b"/>` +
      `<rect x="3" y="11" width="2" height="2" fill="#d8463b"/><rect x="11" y="11" width="2" height="2" fill="#d8463b"/>` +
      `<rect x="5" y="12" width="6" height="2" fill="#d8463b"/>`,
  ),
  focus: svg(
    8,
    `<rect x="0" y="0" width="8" height="8" fill="currentColor"/><rect x="1" y="2" width="6" height="5" fill="#2a2f2b"/>`,
  ),
  restore: svg(
    8,
    `<rect x="2" y="0" width="6" height="6" fill="currentColor"/><rect x="3" y="2" width="4" height="3" fill="#2a2f2b"/>` +
      `<rect x="0" y="2" width="6" height="6" fill="currentColor"/><rect x="1" y="4" width="4" height="3" fill="#2a2f2b"/>`,
  ),
};
