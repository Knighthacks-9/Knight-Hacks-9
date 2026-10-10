// Radio voice: ElevenLabs through the Netlify functions (/api/tts, /api/stt),
// with the free browser speech APIs as a fallback. The API key never reaches
// the browser.
//
// - After ElevenLabs answers 401 (bad key) or 429 (out of credits), it is not
//   called again this session.
// - ?voice=free in the URL skips ElevenLabs entirely, to save credits.
// - Every call logs the provider it used (console.info) for demos.
import type { VoiceProvider } from "../shared/types";

const TTS_URL = "/api/tts";
const STT_URL = "/api/stt";

let elevenLabsOff = forcedFree();
if (elevenLabsOff) {
  console.info("[voice] ?voice=free: using browser speech only.");
}

function forcedFree(): boolean {
  return (
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("voice") === "free"
  );
}

function noteFailure(service: string, status: number): void {
  if (status === 401 || status === 429) {
    elevenLabsOff = true;
    console.warn(
      `[voice] ElevenLabs ${service} returned ${status}; using browser speech for the rest of this session.`,
    );
  } else {
    console.warn(`[voice] ElevenLabs ${service} failed (${status}).`);
  }
}

/** Speaks a line in the dispatcher voice. Resolves when playback finishes. */
export async function speak(text: string): Promise<VoiceProvider> {
  if (!elevenLabsOff) {
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
 * Starts recording the microphone (for ElevenLabs) and running the browser's
 * speech recognition at the same time, so a transcript is ready either way.
 */
export function startListening(): Transmission {
  const recognizer = startRecognition();
  const recording = elevenLabsOff ? Promise.resolve(null) : startRecording();
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

      if (audio && audio.size > 0 && !elevenLabsOff) {
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
