const TRAINING_DOC_URL = "https://docs.google.com/document/d/1DhOgDF50lSf9apOvZDI4BgFju26APOTbIWW2yEZgFGA/export?format=txt";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/training-plan") {
      try {
        const response = await fetch(TRAINING_DOC_URL, {
          headers: { "User-Agent": "DistancePending/1.0" }
        });

        if (!response.ok) {
          return new Response("Training plan unavailable", { status: 502 });
        }

        return new Response(await response.text(), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=60"
          }
        });
      } catch (error) {
        return new Response("Training plan unavailable", { status: 502 });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
