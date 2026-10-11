import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
  // The GitHub Pages workflow sets BASE_PATH=./ so the build works on the
  // custom domain and on github.io.
  const { BASE_PATH } = loadEnv(mode, ".", "BASE_PATH");
  return {
    base: command === "serve" ? "/" : (BASE_PATH ?? "/"),
  };
});
