import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
  // Netlify sets BASE_PATH=/ (see netlify.toml); GitHub Pages serves the
  // production build from the custom domain root.
  const { BASE_PATH } = loadEnv(mode, ".", "BASE_PATH");
  return {
    base: command === "serve" ? "/" : (BASE_PATH ?? "/"),
  };
});
