// Where the server functions (netlify/functions) live. Empty means this site
// (Netlify, `npm run dev:netlify`); the GitHub Pages build sets VITE_API_BASE
// to the Netlify site's URL so it can use the functions cross-origin.
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

export const apiUrl = (path: string): string => `${API_BASE}${path}`;
