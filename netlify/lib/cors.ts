// Lets the GitHub Pages build call the functions cross-origin. ALLOWED_ORIGINS
// is a comma-separated list of origins (scheme + host, no path); requests from
// any other origin get no CORS headers, so browsers block them. Same-origin
// requests (the Netlify site itself, netlify dev) don't need CORS at all.
// Kept outside netlify/functions so Netlify doesn't deploy it as a function.

const DEFAULT_ALLOWED_ORIGINS = "https://knighthacks-9.github.io";

type Handler = (req: Request) => Promise<Response>;

export function withCors(handler: Handler): Handler {
  return async (req) => {
    const origin = req.headers.get("Origin");
    const allowed = origin !== null && allowedOrigins().includes(origin);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: allowed ? 204 : 403,
        headers: allowed ? corsHeaders(origin) : {},
      });
    }

    const response = await handler(req);
    if (!allowed) return response;
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(corsHeaders(origin))) {
      headers.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  };
}

function allowedOrigins(): string[] {
  return (Netlify.env.get("ALLOWED_ORIGINS") || DEFAULT_ALLOWED_ORIGINS)
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
