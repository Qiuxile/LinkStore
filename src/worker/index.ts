import { handleApi } from "./router";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }

    // Workers Assets serves the Vue build and handles the /admin SPA fallback.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
