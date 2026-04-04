import type { ActionFunctionArgs } from "react-router";
import { verifyExtensionToken } from "../utils/verify-extension-token.server";
import { handleCors, corsJson, corsError } from "../utils/cors.server";
import db from "../db.server";

export const loader = () => new Response(null, {
  status: 204,
  headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" },
});

interface TrackRequest {
  offerId: string;
  eventType: "view" | "decline";
  funnelStep?: number;
}

export const action = async ({ request }: ActionFunctionArgs) => {
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

  const body: TrackRequest = await request.json();
  const { offerId, eventType, funnelStep = 1 } = body;

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
};
