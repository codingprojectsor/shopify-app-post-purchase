const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

/** Handle OPTIONS preflight — use as loader on API routes */
export async function handleCorsPreflightLoader() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/** Add CORS headers to a JSON response */
export function corsJson(data: unknown, init?: { status?: number }) {
  return new Response(JSON.stringify(data), {
    status: init?.status || 200,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

/** Add CORS headers to an error response */
export function corsError(message: string, status: number) {
  return corsJson({ error: message }, { status });
}

/** Check if request is OPTIONS preflight and return CORS response */
export function handleCors(request: Request): Response | null {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return null;
}
