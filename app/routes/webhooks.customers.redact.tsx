import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { ActionFunctionArgs } from "react-router";
import { logger } from "../utils/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  logger.for("webhook.customers.redact").info(`Received ${topic} webhook for ${shop}`);

  // Delete all customer-related data when Shopify requests redaction.
  const orders = (payload as any)?.orders_to_redact || [];
  const orderIds = orders.map((o: any) => String(o));

  if (orderIds.length > 0) {
    // Delete analytics events for the customer's orders
    await db.analyticsEvent.deleteMany({
      where: { shop, orderId: { in: orderIds } },
    });

    // Delete survey responses for the customer's orders
    await db.surveyResponse.deleteMany({
      where: { shop, orderId: { in: orderIds } },
    });

    logger.for("webhook.customers.redact").info(
      `Redacted customer data for ${shop}: ${orderIds.length} orders`,
    );
  }

  return new Response();
};
