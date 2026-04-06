import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { ActionFunctionArgs } from "react-router";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Shopify requires a response to customer data requests.
  // Return all customer-related data stored by the app.
  const customerId = (payload as any)?.customer?.id;
  if (!customerId) return new Response();

  const orderId = String(customerId);

  // Gather analytics events tied to the customer's orders
  const analyticsEvents = await db.analyticsEvent.findMany({
    where: { shop, orderId },
    select: { id: true, eventType: true, createdAt: true, metadata: true },
  });

  // Gather survey responses tied to the customer's orders
  const surveyResponses = await db.surveyResponse.findMany({
    where: { shop, orderId },
    select: { id: true, questionId: true, answer: true, createdAt: true },
  });

  console.log(
    `Customer data request for ${shop}: ${analyticsEvents.length} events, ${surveyResponses.length} survey responses`,
  );

  // In production, you would send this data to the merchant or Shopify.
  // For now, we log it — Shopify requires the endpoint to exist and return 200.
  return new Response();
};
