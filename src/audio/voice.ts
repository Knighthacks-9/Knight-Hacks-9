// Radio voice: ElevenLabs through the Netlify functions (/api/tts, /api/stt),
// with the free browser speech APIs as a fallback. The API key never reaches
// the browser.
//
// - The realistic voice is a premium feature (see ./premium.ts): the player
//   can turn it off, ?voice=free skips it, and after ElevenLabs answers with a
//   status retrying won't fix (bad key, no credits, not configured) it is not
//   called again this session.
// - Pre-generated lines are the same voice, so they follow the same switch:
//   with it off, every line uses the browser voice.
// - ElevenLabs speech-to-text is opt-in (VITE_ELEVENLABS_STT=true); otherwise
//   push-to-talk uses the browser's speech recognition only.
// - Every call logs the provider it used (console.info) for demos.
import type { VoiceProvider } from "../shared/types";
import { premium } from "./premium";

const TTS_URL = "/api/tts";
const STT_URL = "/api/stt";
const STT_OPT_IN = import.meta.env.VITE_ELEVENLABS_STT === "true";
/** Statuses that mean ElevenLabs won't work this session. */
const PERMANENT_FAILURES = [401, 402, 403, 404, 429, 500];

const voiceOn = () => premium.enabled("voice");
const sttOn = () => STT_OPT_IN && voiceOn();

function noteFailure(service: string, status: number): void {
  if (PERMANENT_FAILURES.includes(status)) {
    premium.markUnsupported("voice");
    console.warn(
      `[voice] ElevenLabs ${service} returned ${status}; using browser speech for the rest of this session.`,
    );
  } else {
    console.warn(`[voice] ElevenLabs ${service} failed (${status}).`);
  }
}

/** True when this browser can take a push-to-talk transcript at all. */
export function voiceInputSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(
    w.SpeechRecognition ||
    w.webkitSpeechRecognition ||
    (STT_OPT_IN &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof MediaRecorder !== "undefined"),
  );
}

/** Speaks a line in the dispatcher voice. Resolves when playback finishes. */
export async function speak(text: string): Promise<VoiceProvider> {
  if (voiceOn()) {
    try {
      const response = await fetch(TTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (
        response.ok &&
        response.headers.get("Content-Type")?.startsWith("audio/")
      ) {
        console.info("[voice] TTS provider: elevenlabs");
        await playBlob(await response.blob());
        return "elevenlabs";
      }
      noteFailure("TTS", response.status);
    } catch (error) {
      console.warn("[voice] ElevenLabs TTS unavailable.", error);
    }
  }
  console.info("[voice] TTS provider: browser");
  await speakWithBrowser(text);
  return "browser";
}

/**
 * Plays a pre-generated dispatcher line (public/audio/dispatch_<id>.mp3, made
 * by `npm run voice:generate`), which costs no credits. Falls back to speak().
 */
export async function playDispatchLine(
  id: string,
  text: string,
): Promise<void> {
  if (!voiceOn()) {
    await speak(text);
    return;
  }
  try {
    const audio = new Audio(
      `${import.meta.env.BASE_URL}audio/dispatch_${id}.mp3`,
    );
    await audio.play();
    console.info(`[voice] TTS provider: pre-generated (${id})`);
    await finished(audio);
  } catch {
    await speak(text);
  }
}

/** Cuts off whatever the dispatcher is saying (e.g. when a shift ends). */
export function stopSpeaking(): void {
  const audio = currentAudio;
  if (audio) {
    audio.pause();
    // Resolve whoever is waiting on this clip.
    audio.dispatchEvent(new Event("ended"));
  }
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

let currentAudio: HTMLAudioElement | null = null;

async function playBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    const audio = new Audio(url);
    await audio.play();
    await finished(audio);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function finished(audio: HTMLAudioElement): Promise<void> {
  currentAudio = audio;
  return new Promise<void>((resolve, reject) => {
    audio.addEventListener("ended", () => resolve(), { once: true });
    audio.addEventListener("error", () => reject(audio.error), { once: true });
  }).finally(() => {
    if (currentAudio === audio) currentAudio = null;
  });
}

function speakWithBrowser(text: string): Promise<void> {
  const synth =
    typeof window === "undefined" ? undefined : window.speechSynthesis;
  if (!synth) return Promise.resolve();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 0.9;
    // Some browsers never fire `end`; don't wait forever.
    const timer = setTimeout(resolve, 2000 + text.length * 120);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    utterance.onend = done;
    utterance.onerror = done;
    synth.speak(utterance);
  });
}

// ---------------------------------------------------------------------------
// Push-to-talk
// ---------------------------------------------------------------------------

export interface Transmission {
  /** Stops listening and resolves with the transcript ("" if nothing was heard). */
  stop(): Promise<string>;
  /** Who produced the transcript; set once stop() resolves. */
  readonly provider: VoiceProvider | null;
}

/**
 * Runs the browser's speech recognition and, when ElevenLabs speech-to-text
 * is opted in, records the microphone at the same time, so a transcript is
 * ready either way.
 */
export function startListening(): Transmission {
  const recognizer = startRecognition();
  const recording = sttOn() ? startRecording() : Promise.resolve(null);
  let provider: VoiceProvider | null = null;

  return {
    get provider() {
      return provider;
    },
    async stop() {
      const [audio, browserText] = await Promise.all([
        recording.then(stopRecording),
        recognizer.stop(),
      ]);

      if (audio && audio.size > 0 && sttOn()) {
        try {
          const response = await fetch(STT_URL, {
            method: "POST",
            headers: { "Content-Type": audio.type || "audio/webm" },
            body: audio,
          });
          if (response.ok) {
            const result = (await response.json()) as { text?: string };
            provider = "elevenlabs";
            console.info("[voice] STT provider: elevenlabs");
            return (result.text ?? "").trim();
          }
          noteFailure("STT", response.status);
        } catch (error) {
          console.warn("[voice] ElevenLabs STT unavailable.", error);
        }
      }
      provider = "browser";
      console.info("[voice] STT provider: browser");
      return browserText;
    },
  };
}

interface Recording {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
}

async function startRecording(): Promise<Recording | null> {
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === "undefined"
  ) {
    return null;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.start();
    return { recorder, stream, chunks };
  } catch (error) {
    console.warn("[voice] Could not record the microphone.", error);
    return null;
  }
}

function stopRecording(recording: Recording | null): Promise<Blob | null> {
  if (!recording) return Promise.resolve(null);
  const { recorder, stream, chunks } = recording;
  return new Promise((resolve) => {
    const finish = () => {
      stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType }));
    };
    if (recorder.state === "inactive") return finish();
    recorder.addEventListener("stop", finish, { once: true });
    recorder.stop();
  });
}

// Minimal typing for the Web Speech API, which TypeScript's DOM lib omits.
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function startRecognition(): { stop(): Promise<string> } {
  const speechWindow = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  const Recognition =
    speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  if (!Recognition) return { stop: async () => "" };

  let transcript = "";
  let ended = false;
  let onEnded: () => void = () => {};
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.onresult = (event) => {
    transcript = Array.from(event.results, (result) => result[0].transcript)
      .join(" ")
      .trim();
  };
  recognition.onerror = (event) => {
    if (event.error !== "no-speech" && event.error !== "aborted") {
      console.warn(`[voice] Browser speech recognition error: ${event.error}`);
    }
  };
  recognition.onend = () => {
    ended = true;
    onEnded();
  };
  try {
    recognition.start();
  } catch (error) {
    console.warn("[voice] Browser speech recognition could not start.", error);
    ended = true;
  }

  return {
    stop() {
      if (ended) return Promise.resolve(transcript);
      return new Promise((resolve) => {
        // Final results arrive just before `end`; give up after a moment.
        const timer = setTimeout(() => resolve(transcript), 1500);
        onEnded = () => {
          clearTimeout(timer);
          resolve(transcript);
        };
        recognition.stop();
      });
    },
  };
}
