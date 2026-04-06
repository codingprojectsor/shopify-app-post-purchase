import type { ActionFunctionArgs } from "react-router";
import { verifyExtensionToken } from "../utils/verify-extension-token.server";
import { handleCors, corsJson, corsError } from "../utils/cors.server";
import { checkRateLimit } from "../utils/rate-limit.server";
import db from "../db.server";

export const loader = () => new Response(null, {
  status: 204,
  headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" },
});

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const preflight = handleCors(request);
    if (preflight) return preflight;

    if (request.method !== "POST") {
      return corsError("Method not allowed", 405);
    }

    let shop: string;
    try {
      const result = await verifyExtensionToken(request);
      shop = result.shop;
    } catch (err) {
      const status = err instanceof Response ? err.status : 500;
      const msg = err instanceof Response ? await err.text() : "Auth failed";
      return corsError(msg, status);
    }

    // Rate limit: 60 requests per minute per shop
    if (!checkRateLimit(`track:${shop}`, 60)) {
      return corsError("Too many requests", 429);
    }

    let body: { offerId?: string; eventType?: string; funnelStep?: number };
    try {
      body = await request.json();
    } catch {
      return corsError("Invalid JSON body", 400);
    }

    const offerId = typeof body.offerId === "string" ? body.offerId : "";
    const eventType = typeof body.eventType === "string" ? body.eventType : "";
    const funnelStep = typeof body.funnelStep === "number" && !isNaN(body.funnelStep) ? body.funnelStep : 1;

    if (!offerId || !eventType) {
      return corsError("Missing offerId or eventType", 400);
    }

    if (eventType !== "view" && eventType !== "decline") {
      return corsError("Invalid eventType", 400);
    }

    const offer = await db.upsellOffer.findFirst({
      where: { id: offerId, shop },
    });

    if (!offer) {
      return corsError("Offer not found", 404);
    }

    await db.analyticsEvent.create({
      data: {
        shop,
        offerId,
        eventType,
        funnelStep,
        abTestId: offer.abTestId,
      },
    });

    return corsJson({ success: true });
  } catch (err) {
    return corsError(String(err), 500);
  }
};
