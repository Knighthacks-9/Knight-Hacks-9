/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" to transcribe push-to-talk with ElevenLabs instead of the browser. */
  readonly VITE_ELEVENLABS_STT?: string;
  /** Origin of the Netlify functions when the game is hosted elsewhere (GitHub Pages). */
  readonly VITE_API_BASE?: string;
}
