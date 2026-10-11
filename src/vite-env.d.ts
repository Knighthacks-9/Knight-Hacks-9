/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" to transcribe push-to-talk with ElevenLabs instead of the browser. */
  readonly VITE_ELEVENLABS_STT?: string;
}
