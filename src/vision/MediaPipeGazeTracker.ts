import type {
  BoundingBox,
  FaceDetector,
  FaceLandmarker,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import {
  BlinkDetector,
  EYE_LANDMARKS,
  extractGazeFeatures,
} from "./gazeFeatures";
import { playSfx } from "../audio/sfx";
import { gazeController } from "./gazeController";
import {
  NOT_ALIGNED,
  checkHeadAlignment,
  headGuide,
  type HeadAlignment,
  type HeadPosition,
} from "./headAlignment";
import "./cameraPreview.css";

export type TrackerPhase =
  | "idle"
  | "requesting"
  | "loading"
  | "running"
  | "no-face"
  | "no-eyes"
  | "error";

export interface TrackerStatus {
  phase: TrackerPhase;
  message: string;
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TASKS_VERSION = "1.1.0";
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const FACE_DETECTOR_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const SVG_NS = "http://www.w3.org/2000/svg";
const PREVIEW_POSITION_KEY = "night-watch:camera-preview-position";
const PREVIEW_HIDDEN_KEY = "night-watch:camera-preview-hidden";
const PREVIEW_MARGIN = 8;

interface PreviewPosition {
  left: number;
  top: number;
}

function readPreviewPosition(): PreviewPosition | null {
  try {
    const stored = globalThis.localStorage?.getItem(PREVIEW_POSITION_KEY);
    if (!stored) return null;
    const value = JSON.parse(stored) as Partial<PreviewPosition> | null;
    return Number.isFinite(value?.left) && Number.isFinite(value?.top)
      ? { left: value!.left!, top: value!.top! }
      : null;
  } catch {
    return null;
  }
}

function savePreviewPosition(position: PreviewPosition | null): void {
  try {
    if (position) {
      localStorage.setItem(PREVIEW_POSITION_KEY, JSON.stringify(position));
    }
  } catch (error) {
    console.error("Could not save the camera preview position.", error);
  }
}

function readPreviewHidden(): boolean {
  try {
    return globalThis.localStorage?.getItem(PREVIEW_HIDDEN_KEY) === "true";
  } catch {
    return false;
  }
}

function savePreviewHidden(hidden: boolean): void {
  try {
    localStorage.setItem(PREVIEW_HIDDEN_KEY, String(hidden));
  } catch (error) {
    console.error("Could not save the camera preview setting.", error);
  }
}

function previewButton(
  className: string,
  label: string,
  text: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  className: string,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  element.setAttribute("class", className);
  return element;
}

export function faceBoxFromLandmarks(
  landmarks: NormalizedLandmark[],
  frameWidth: number,
  frameHeight: number,
): FaceBox | null {
  if (
    !landmarks.length ||
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    !landmarks.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  ) {
    return null;
  }

  const xs = landmarks.map((p) => p.x * frameWidth);
  const ys = landmarks.map((p) => p.y * frameHeight);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const padX = (right - left) * 0.08;
  const padY = (bottom - top) * 0.08;
  const x = Math.max(0, left - padX);
  const y = Math.max(0, top - padY);
  const r = Math.min(frameWidth, right + padX);
  const b = Math.min(frameHeight, bottom + padY);

  if (r <= x || b <= y) return null;
  return { x, y, width: r - x, height: b - y };
}

export function faceBoxFromDetection(
  box: BoundingBox | undefined,
  frameWidth: number,
  frameHeight: number,
): FaceBox | null {
  if (
    !box ||
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    ![box.originX, box.originY, box.width, box.height].every(Number.isFinite) ||
    box.width <= 0 ||
    box.height <= 0
  ) {
    return null;
  }

  const x = Math.max(0, box.originX);
  const y = Math.max(0, box.originY);
  const right = Math.min(frameWidth, box.originX + box.width);
  const bottom = Math.min(frameHeight, box.originY + box.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lowLightBrightness(image: Pick<ImageData, "data">): number {
  if (image.data.length < 4) return 1.8;
  let totalLuminance = 0;
  const pixelCount = image.data.length / 4;

  for (let index = 0; index < image.data.length; index += 4) {
    totalLuminance +=
      image.data[index] * 0.2126 +
      image.data[index + 1] * 0.7152 +
      image.data[index + 2] * 0.0722;
  }

  return clamp(118 / (totalLuminance / pixelCount), 1, 1.8);
}

function cameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Camera permission was blocked. Allow camera access in your browser, then try again.";
    }
    if (
      error.name === "NotFoundError" ||
      error.name === "OverconstrainedError"
    ) {
      return "No compatible camera was found. Connect or select a webcam.";
    }
    if (error.name === "NotReadableError") {
      return "The camera is busy. Close other apps or tabs using it, then retry.";
    }
  }
  return error instanceof Error
    ? `Face tracking failed: ${error.message}`
    : "Face tracking failed. Check camera access and your internet connection.";
}

export class MediaPipeGazeTracker {
  private status: TrackerStatus = {
    phase: "idle",
    message: "Camera tracking is off.",
  };
  private listeners = new Set<(status: TrackerStatus) => void>();
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private preview: HTMLDivElement | null = null;
  private overlay: SVGSVGElement | null = null;
  private landmarker: FaceLandmarker | null = null;
  private faceDetector: FaceDetector | null = null;
  private inferenceCanvas: HTMLCanvasElement | null = null;
  private inferenceContext: CanvasRenderingContext2D | null = null;
  private lightSampleCanvas: HTMLCanvasElement | null = null;
  private lightSampleContext: CanvasRenderingContext2D | null = null;
  private lastBrightness = 1;
  private blinkDetector = new BlinkDetector();
  private alignment: HeadAlignment = NOT_ALIGNED;
  /** The calibrated head position the preview's guide is drawn at. */
  private guideHead: HeadPosition | null = null;
  private previewVisible = true;
  /** The player's choice to hide the preview, kept across sessions. */
  private previewHidden = readPreviewHidden();
  private previewHiddenListeners = new Set<(hidden: boolean) => void>();
  private showPreviewButton: HTMLButtonElement | null = null;
  private previewPosition: PreviewPosition | null = readPreviewPosition();
  private removePreviewDrag: (() => void) | null = null;
  private rafId = 0;
  private generation = 0;
  private lastVideoTime = -1;

  getStatus(): TrackerStatus {
    return { ...this.status };
  }

  onStatusChange(listener: (status: TrackerStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  /**
   * Whether the head is well in view and facing the screen, as of the last
   * frame. The gaze model handles head movement within that.
   */
  getAlignment(): HeadAlignment {
    return { ...this.alignment };
  }

  /** The live camera stream, e.g. to show a larger view while aligning. */
  getStream(): MediaStream | null {
    return this.stream;
  }

  async start(): Promise<void> {
    if (
      ["requesting", "loading", "running", "no-face", "no-eyes"].includes(
        this.status.phase,
      )
    ) {
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      const message =
        "Camera access requires HTTPS or localhost. Open the app on localhost or an HTTPS site.";
      this.setStatus({ phase: "error", message });
      throw new Error(message);
    }

    const generation = ++this.generation;
    this.setStatus({
      phase: "requesting",
      message: "Requesting camera permission…",
    });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24, max: 30 },
          autoGainControl: true,
        },
      });

      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.stream = stream;
      // A small retro camera window: title bar, the mirrored feed with the
      // head guide drawn over it, and a status line. Styles: cameraPreview.css.
      const preview = document.createElement("div");
      preview.className = "cam-preview";
      preview.title = "Drag to move";

      const titleBar = document.createElement("div");
      titleBar.className = "cam-preview-bar";
      const rec = document.createElement("i");
      rec.className = "cam-preview-rec";
      rec.setAttribute("aria-hidden", "true");
      const title = document.createElement("span");
      title.className = "cam-preview-title";
      title.textContent = "CAM_00 · OPERATOR";
      const hideButton = previewButton(
        "cam-preview-btn",
        "Hide camera preview",
        "_",
      );
      hideButton.addEventListener("click", () => {
        playSfx("click");
        this.setPreviewHidden(true);
      });
      const stopButton = previewButton("cam-preview-btn", "Stop camera", "×");
      stopButton.addEventListener("click", () => {
        playSfx("click");
        this.stop();
      });
      titleBar.append(rec, title, hideButton, stopButton);

      const screen = document.createElement("div");
      screen.className = "cam-preview-screen";
      const video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("aria-label", "Live face and eye tracking camera");
      video.srcObject = stream;
      const overlay = this.createOverlay();
      screen.append(video, overlay);

      const label = document.createElement("div");
      label.className = "cam-preview-status";
      label.setAttribute("role", "status");
      label.dataset.trackerStatus = "true";

      // Stands in for the hidden preview so it can be brought back any time.
      const showButton = previewButton(
        "cam-preview-show",
        "Show camera preview",
        "▣ SHOW CAM",
      );
      showButton.addEventListener("click", () => {
        playSfx("click");
        this.setPreviewHidden(false);
      });

      preview.append(titleBar, screen, label);
      document.body.append(preview, showButton);
      this.video = video;
      this.preview = preview;
      this.showPreviewButton = showButton;
      this.overlay = overlay;
      this.renderPreviewStatus();
      this.applyPreviewVisibility();
      this.enablePreviewDrag(preview);

      await video.play();
      await new Promise<void>((resolve) => {
        if (
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth > 0
        ) {
          resolve();
        } else {
          video.addEventListener("loadeddata", () => resolve(), { once: true });
        }
      });
      if (generation !== this.generation) return;
      screen.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      this.drawGuide();
      // The new aspect ratio changes the preview height; keep it on screen.
      if (this.previewPosition) this.placePreview(this.previewPosition);
      this.inferenceCanvas = document.createElement("canvas");
      this.inferenceContext = this.inferenceCanvas.getContext("2d", {
        willReadFrequently: true,
      });
      this.lightSampleCanvas = document.createElement("canvas");
      this.lightSampleCanvas.width = 64;
      this.lightSampleCanvas.height = 48;
      this.lightSampleContext = this.lightSampleCanvas.getContext("2d", {
        willReadFrequently: true,
      });
      if (!this.inferenceContext || !this.lightSampleContext) {
        throw new Error(
          "This browser could not create the webcam image-processing canvas.",
        );
      }

      this.setStatus({
        phase: "loading",
        message: "Loading face and eye tracking models…",
      });
      const { FaceDetector, FaceLandmarker, FilesetResolver } =
        await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      try {
        const faceDetector = await FaceDetector.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: FACE_DETECTOR_MODEL_URL,
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.12,
          minSuppressionThreshold: 0.3,
        });
        if (generation !== this.generation) {
          faceDetector.close();
          return;
        }
        this.faceDetector = faceDetector;
      } catch (error) {
        console.error("BlazeFace fallback could not be loaded.", error);
      }

      if (generation !== this.generation) return;
      const landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.12,
        minFacePresenceConfidence: 0.12,
        minTrackingConfidence: 0.12,
        outputFaceBlendshapes: false,
        // Head pose for gaze features comes from this matrix.
        outputFacialTransformationMatrixes: true,
      });

      if (generation !== this.generation) {
        landmarker.close();
        return;
      }

      this.landmarker = landmarker;
      this.lastVideoTime = -1;
      this.setStatus({
        phase: "running",
        message: "Face and iris tracking are starting…",
      });
      this.processFrame(generation);
    } catch (error) {
      if (generation === this.generation) {
        this.releaseResources();
        const message = cameraError(error);
        this.setStatus({ phase: "error", message });
        console.error("MediaPipe face/eye tracking failed:", error);
      }
      throw error;
    }
  }

  stop(): void {
    this.generation += 1;
    this.releaseResources();
    this.setStatus({ phase: "idle", message: "Camera tracking is off." });
  }

  /**
   * Hides the preview without pausing the camera, e.g. so it does not cover or
   * distract from calibration targets. Opacity keeps the video decoding.
   */
  setPreviewVisible(visible: boolean): void {
    this.previewVisible = visible;
    this.applyPreviewVisibility();
  }

  isPreviewHidden(): boolean {
    return this.previewHidden;
  }

  /**
   * The player's own show/hide choice, saved on this device. Tracking keeps
   * running while hidden; a small "Show camera" button takes the preview's place.
   */
  setPreviewHidden(hidden: boolean): void {
    if (hidden === this.previewHidden) return;
    this.previewHidden = hidden;
    savePreviewHidden(hidden);
    this.applyPreviewVisibility();
    for (const listener of this.previewHiddenListeners) listener(hidden);
  }

  onPreviewHiddenChange(listener: (hidden: boolean) => void): () => void {
    this.previewHiddenListeners.add(listener);
    return () => this.previewHiddenListeners.delete(listener);
  }

  /** Lets the player drag the preview anywhere in the window, except by its buttons. */
  private enablePreviewDrag(preview: HTMLDivElement): void {
    let drag: { pointerId: number; offsetX: number; offsetY: number } | null =
      null;

    preview.addEventListener("pointerdown", (event) => {
      if (
        event.button !== 0 ||
        (event.target instanceof Element && event.target.closest("button"))
      ) {
        return;
      }
      const rect = preview.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      preview.setPointerCapture(event.pointerId);
      preview.classList.add("is-dragging");
      event.preventDefault();
    });
    preview.addEventListener("pointermove", (event) => {
      if (drag?.pointerId !== event.pointerId) return;
      this.placePreview({
        left: event.clientX - drag.offsetX,
        top: event.clientY - drag.offsetY,
      });
    });
    const endDrag = (event: PointerEvent) => {
      if (drag?.pointerId !== event.pointerId) return;
      drag = null;
      preview.classList.remove("is-dragging");
      savePreviewPosition(this.previewPosition);
    };
    preview.addEventListener("pointerup", endDrag);
    preview.addEventListener("pointercancel", endDrag);

    const onResize = () => {
      if (this.previewPosition) this.placePreview(this.previewPosition);
    };
    window.addEventListener("resize", onResize);
    this.removePreviewDrag = () =>
      window.removeEventListener("resize", onResize);

    if (this.previewPosition) this.placePreview(this.previewPosition);
  }

  private placePreview(position: PreviewPosition): void {
    const preview = this.preview;
    if (!preview) return;
    const { width, height } = preview.getBoundingClientRect();
    const left = clamp(
      position.left,
      PREVIEW_MARGIN,
      Math.max(PREVIEW_MARGIN, window.innerWidth - width - PREVIEW_MARGIN),
    );
    const top = clamp(
      position.top,
      PREVIEW_MARGIN,
      Math.max(PREVIEW_MARGIN, window.innerHeight - height - PREVIEW_MARGIN),
    );
    this.previewPosition = { left, top };
    Object.assign(preview.style, {
      left: `${left}px`,
      top: `${top}px`,
      right: "auto",
      bottom: "auto",
    });
  }

  private applyPreviewVisibility(): void {
    if (!this.preview) return;
    const shown = this.previewVisible && !this.previewHidden;
    this.preview.style.opacity = shown ? "1" : "0";
    this.preview.style.pointerEvents = shown ? "" : "none";
    if (this.showPreviewButton) {
      this.showPreviewButton.style.display =
        this.previewVisible && this.previewHidden ? "" : "none";
    }
  }

  private processFrame(generation: number): void {
    if (
      generation !== this.generation ||
      !this.video ||
      !this.landmarker ||
      this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      if (generation === this.generation) {
        this.rafId = requestAnimationFrame(() => this.processFrame(generation));
      }
      return;
    }

    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      try {
        const frame = this.prepareInferenceFrame();
        const timestamp = performance.now();
        const result = this.landmarker.detectForVideo(frame, timestamp);
        const face = result.faceLandmarks[0] ?? null;
        const features = face
          ? extractGazeFeatures(
              face,
              frame.width,
              frame.height,
              timestamp,
              result.facialTransformationMatrixes?.[0],
            )
          : null;
        if (features) {
          features.blink = this.blinkDetector.update(features.openness);
        }
        const detection = face
          ? null
          : this.faceDetector?.detectForVideo(frame, performance.now())
              .detections[0];
        const detectorBox = face
          ? null
          : faceBoxFromDetection(
              detection?.boundingBox,
              this.video.videoWidth,
              this.video.videoHeight,
            );
        // Once calibrated, keep the face near where it was calibrated.
        const anchor = gazeController.getModel()?.head ?? null;
        this.setAlignment(
          checkHeadAlignment(features, this.alignment.aligned, anchor),
        );
        if (anchor !== this.guideHead) this.drawGuide();
        this.drawOverlay(face, detectorBox);
        gazeController.setTrackerFeatures(features);

        if (!face && !detectorBox) {
          this.setStatus({
            phase: "no-face",
            message: `No face found (low-light boost ${this.lastBrightness.toFixed(1)}×). Move closer, face the camera, and add light in front of you.`,
          });
        } else if (!face && detectorBox) {
          this.setStatus({
            phase: "no-eyes",
            message:
              "BlazeFace found your face (box shown); iris tracking did not. Keep both eyes visible and well lit.",
          });
        } else if (!features) {
          this.setStatus({
            phase: "no-eyes",
            message:
              "Face found, but iris landmarks are unclear. Look toward the camera and keep both eyes visible.",
          });
        } else {
          this.setStatus({
            phase: "running",
            message: "Face and both irises tracked.",
          });
        }
      } catch (error) {
        const message = cameraError(error);
        this.releaseResources();
        this.setStatus({ phase: "error", message });
        console.error("Could not process camera frame:", error);
        return;
      }
    }
    this.rafId = requestAnimationFrame(() => this.processFrame(generation));
  }

  private createOverlay(): SVGSVGElement {
    const svg = svgElement("svg", "cam-preview-overlay");
    svg.setAttribute("aria-hidden", "true");
    // The head guide: where the face should sit for calibration.
    const guide = svgElement("ellipse", "cam-guide");
    guide.dataset.guide = "true";
    const eyeLine = svgElement("line", "cam-guide-eyes");
    eyeLine.dataset.guideEyes = "true";
    const faceBox = svgElement("rect", "cam-face-box");
    faceBox.dataset.faceBox = "true";
    svg.append(guide, eyeLine, faceBox);

    for (const eye of EYE_LANDMARKS) {
      for (const index of eye.corners) {
        const corner = svgElement("circle", "cam-eye-corner");
        corner.dataset.landmark = String(index);
        corner.setAttribute("r", "4");
        svg.append(corner);
      }
      const iris = svgElement("circle", "cam-iris");
      iris.dataset.iris = String(eye.iris[0]);
      iris.setAttribute("r", "7");
      svg.append(iris);
    }
    return svg;
  }

  /**
   * Sizes the overlay to the camera frame and draws the head guide where the
   * head sat during calibration. Before calibrating there is no guide: the
   * face only needs to be in view, at any distance.
   */
  private drawGuide(): void {
    const width = this.video?.videoWidth ?? 0;
    const height = this.video?.videoHeight ?? 0;
    if (!this.overlay || !width || !height) return;
    this.overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const head = gazeController.getModel()?.head ?? null;
    this.guideHead = head;
    const guide = this.overlay.querySelector("[data-guide]");
    const eyes = this.overlay.querySelector("[data-guide-eyes]");
    for (const element of [guide, eyes]) {
      element?.setAttribute("visibility", head ? "visible" : "hidden");
    }
    if (!head) return;
    const { cx, cy, rx, ry, eyeY } = headGuide(width, height, head);
    guide?.setAttribute("cx", String(cx));
    guide?.setAttribute("cy", String(cy));
    guide?.setAttribute("rx", String(rx));
    guide?.setAttribute("ry", String(ry));
    eyes?.setAttribute("x1", String(cx - rx * 0.75));
    eyes?.setAttribute("x2", String(cx + rx * 0.75));
    eyes?.setAttribute("y1", String(eyeY));
    eyes?.setAttribute("y2", String(eyeY));
  }

  private setAlignment(alignment: HeadAlignment): void {
    if (
      alignment.aligned === this.alignment.aligned &&
      alignment.issue === this.alignment.issue
    ) {
      return;
    }
    this.alignment = alignment;
    this.renderPreviewStatus();
  }

  /** The preview's status line: tracker state first, then head alignment. */
  private renderPreviewStatus(): void {
    const preview = this.preview;
    const label = preview?.querySelector<HTMLElement>("[data-tracker-status]");
    if (!preview || !label) return;
    const { phase, message } = this.status;
    const [tone, text] =
      phase === "running" && this.alignment.aligned
        ? ["ok", "● FACE IN VIEW"]
        : phase === "running"
          ? ["warn", `▲ ALIGN: ${this.alignment.hint}`]
          : phase === "no-face"
            ? ["warn", "■ NO FACE · face the camera, add light"]
            : phase === "no-eyes"
              ? ["warn", "■ EYES NOT TRACKED · keep both visible"]
              : phase === "error"
                ? ["error", `■ ${message}`]
                : ["off", message];
    preview.dataset.aligned = String(
      phase === "running" && this.alignment.aligned,
    );
    label.dataset.tone = tone;
    label.textContent = text;
    label.title = message;
  }

  private prepareInferenceFrame(): HTMLCanvasElement {
    const video = this.video;
    const canvas = this.inferenceCanvas;
    const context = this.inferenceContext;
    const sampleCanvas = this.lightSampleCanvas;
    const sampleContext = this.lightSampleContext;
    if (
      !video ||
      !canvas ||
      !context ||
      !sampleCanvas ||
      !sampleContext ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      throw new Error("The webcam frame is not ready for face detection.");
    }

    sampleContext.drawImage(
      video,
      0,
      0,
      sampleCanvas.width,
      sampleCanvas.height,
    );
    const sample = sampleContext.getImageData(
      0,
      0,
      sampleCanvas.width,
      sampleCanvas.height,
    );
    this.lastBrightness = lowLightBrightness(sample);

    if (
      canvas.width !== video.videoWidth ||
      canvas.height !== video.videoHeight
    ) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    context.filter = `brightness(${this.lastBrightness}) contrast(1.12)`;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    context.filter = "none";
    return canvas;
  }

  private drawOverlay(
    face: NormalizedLandmark[] | null,
    detectorBox: FaceBox | null,
  ): void {
    if (!this.overlay || !this.video) return;
    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    this.overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const box = this.overlay.querySelector<SVGRectElement>("[data-face-box]");
    if (!face || !width || !height) {
      if (box && detectorBox) {
        box.setAttribute("x", String(detectorBox.x));
        box.setAttribute("y", String(detectorBox.y));
        box.setAttribute("width", String(detectorBox.width));
        box.setAttribute("height", String(detectorBox.height));
      } else {
        box?.setAttribute("width", "0");
        box?.setAttribute("height", "0");
      }
      this.overlay
        .querySelectorAll("[data-landmark], [data-iris]")
        .forEach((element) => element.setAttribute("visibility", "hidden"));
      return;
    }

    const bounds = faceBoxFromLandmarks(face, width, height);
    if (box && bounds) {
      box.setAttribute("x", String(bounds.x));
      box.setAttribute("y", String(bounds.y));
      box.setAttribute("width", String(bounds.width));
      box.setAttribute("height", String(bounds.height));
    }

    for (const marker of this.overlay.querySelectorAll<SVGCircleElement>(
      "[data-landmark], [data-iris]",
    )) {
      const index = Number(marker.dataset.landmark ?? marker.dataset.iris);
      const point = face[index];
      if (!point) {
        marker.setAttribute("visibility", "hidden");
        continue;
      }
      marker.setAttribute("cx", String(point.x * width));
      marker.setAttribute("cy", String(point.y * height));
      marker.setAttribute("visibility", "visible");
    }
  }

  private releaseResources(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.landmarker?.close();
    this.landmarker = null;
    this.faceDetector?.close();
    this.faceDetector = null;
    this.inferenceCanvas = null;
    this.inferenceContext = null;
    this.lightSampleCanvas = null;
    this.lightSampleContext = null;
    this.lastBrightness = 1;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video = null;
    }
    this.removePreviewDrag?.();
    this.removePreviewDrag = null;
    this.preview?.remove();
    this.preview = null;
    this.showPreviewButton?.remove();
    this.showPreviewButton = null;
    this.overlay = null;
    this.blinkDetector.reset();
    this.alignment = NOT_ALIGNED;
    gazeController.clearTracker();
  }

  private setStatus(status: TrackerStatus): void {
    // Frames arrive ~30 times a second; only notify listeners on real changes.
    if (
      status.phase === this.status.phase &&
      status.message === this.status.message
    ) {
      return;
    }
    this.status = status;
    this.renderPreviewStatus();
    for (const listener of this.listeners) listener(this.getStatus());
  }
}

export const mediaPipeGazeTracker = new MediaPipeGazeTracker();
