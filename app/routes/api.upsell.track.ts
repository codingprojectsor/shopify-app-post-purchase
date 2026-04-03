import type { ActionFunctionArgs } from "react-router";
import { verifyExtensionToken } from "../utils/verify-extension-token.server";
import db from "../db.server";

interface TrackRequest {
  offerId: string;
  eventType: "view" | "decline";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { shop } = await verifyExtensionToken(request);
  const body: TrackRequest = await request.json();
  const { offerId, eventType } = body;

  if (!offerId || !eventType) {
    return Response.json(
      { error: "Missing offerId or eventType" },
      { status: 400 },
    );
  }

  // Only allow view and decline events through this endpoint
  // (accept events are recorded in the accept endpoint)
  if (eventType !== "view" && eventType !== "decline") {
    return Response.json({ error: "Invalid eventType" }, { status: 400 });
  }

  // Verify the offer exists
  const offer = await db.upsellOffer.findFirst({
    where: { id: offerId, shop },
  });

  if (!offer) {
    return Response.json({ error: "Offer not found" }, { status: 404 });
  }

  await db.analyticsEvent.create({
    data: {
      shop,
      offerId,
      eventType,
    },
  });

  return Response.json({ success: true });
};
