import type { ActionFunctionArgs } from "react-router";
import { verifyExtensionToken } from "../utils/verify-extension-token.server";
import { handleCors, corsJson, corsError } from "../utils/cors.server";
import { unauthenticated } from "../shopify.server";
import db from "../db.server";
import { logger } from "../utils/logger.server";

const log = logger.for("api.upsell.accept");

export const loader = () => new Response(null, {
  status: 204,
  headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" },
});

interface AcceptRequest {
  offerId: string;
  orderId: string;
  funnelStep?: number;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return corsError("Method not allowed", 405);
  }

  const preflight = handleCors(request);
  if (preflight) return preflight;

  let shop: string;
  try {
    const result = await verifyExtensionToken(request);
    shop = result.shop;
  } catch (err) {
    const status = err instanceof Response ? err.status : 500;
    const msg = err instanceof Response ? await err.text() : "Auth failed";
    return corsError(msg, status);
  }

  const body: AcceptRequest = await request.json();
  const { offerId, orderId, funnelStep = 1 } = body;

  if (!offerId || !orderId) {
    return corsJson(
      { error: "Missing offerId or orderId" },
      { status: 400 },
    );
  }

  // Look up the offer
  const offer = await db.upsellOffer.findFirst({
    where: { id: offerId, shop, status: "active" },
  });

  if (!offer) {
    return corsJson({ error: "Offer not found" }, { status: 404 });
  }

  // Normalize order ID to gid://shopify/Order/xxx format
  let orderGid = orderId;
  if (orderGid.includes("OrderIdentity")) {
    orderGid = orderGid.replace("OrderIdentity", "Order");
  } else if (!orderGid.startsWith("gid://")) {
    orderGid = `gid://shopify/Order/${orderGid}`;
  }

  // Get admin API client for this shop (offline token)
  const { admin } = await unauthenticated.admin(shop);

  try {
    // Step 1: Begin order edit
    const beginResponse = await admin.graphql(
      `#graphql
      mutation orderEditBegin($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder { id }
          userErrors { field message }
        }
      }`,
      { variables: { id: orderGid } },
    );

    const beginData = await beginResponse.json();
    const beginErrors = beginData.data?.orderEditBegin?.userErrors;
    if (beginErrors?.length) {
      return corsJson(
        { error: beginErrors[0].message },
        { status: 422 },
      );
    }

    const calculatedOrderId =
      beginData.data?.orderEditBegin?.calculatedOrder?.id;
    if (!calculatedOrderId) {
      return corsJson(
        { error: "Failed to begin order edit" },
        { status: 500 },
      );
    }

    // Step 2: Add the variant to the order
    const addVariantResponse = await admin.graphql(
      `#graphql
      mutation orderEditAddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
        orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
          calculatedOrder { id }
          calculatedLineItem { id }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          id: calculatedOrderId,
          variantId: offer.variantId,
          quantity: 1,
        },
      },
    );

    const addData = await addVariantResponse.json();
    const addErrors = addData.data?.orderEditAddVariant?.userErrors;
    if (addErrors?.length) {
      log.error("orderEditAddVariant errors", addErrors);
      return corsJson({ error: addErrors[0].message }, { status: 422 });
    }

    const calculatedLineItemId =
      addData.data?.orderEditAddVariant?.calculatedLineItem?.id;
    if (!calculatedLineItemId) {
      return corsJson(
        { error: "Failed to add item to order" },
        { status: 500 },
      );
    }

    // Step 3: Apply discount if configured
    if (offer.discountValue > 0 && calculatedLineItemId) {
      const discountDesc =
        offer.discountType === "percentage"
          ? `${offer.discountValue}% off — ${offer.title}`
          : `$${offer.discountValue} off — ${offer.title}`;

      const discountInput =
        offer.discountType === "percentage"
          ? { percentValue: offer.discountValue, description: discountDesc }
          : { fixedValue: offer.discountValue, description: discountDesc };

      try {
        const discountResponse = await admin.graphql(
          `#graphql
          mutation orderEditAddLineItemDiscount(
            $id: ID!
            $lineItemId: ID!
            $discount: OrderEditAppliedDiscountInput!
          ) {
            orderEditAddLineItemDiscount(
              id: $id
              lineItemId: $lineItemId
              discount: $discount
            ) {
              calculatedOrder { id }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              id: calculatedOrderId,
              lineItemId: calculatedLineItemId,
              discount: discountInput,
            },
          },
        );

        const discountData = await discountResponse.json();
        const discountErrors =
          discountData.data?.orderEditAddLineItemDiscount?.userErrors;
        if (discountErrors?.length) {
          log.warn("Discount errors (item still added)", discountErrors);
        }
      } catch (discountErr) {
        log.warn("Discount application failed (item still added)", discountErr);
      }
    }

    // Step 4: Commit the order edit
    const commitResponse = await admin.graphql(
      `#graphql
      mutation orderEditCommit($id: ID!) {
        orderEditCommit(id: $id) {
          order { id }
          userErrors { field message }
        }
      }`,
      { variables: { id: calculatedOrderId } },
    );

    const commitData = await commitResponse.json();
    const commitErrors = commitData.data?.orderEditCommit?.userErrors;
    if (commitErrors?.length) {
      log.error("orderEditCommit errors", commitErrors);
      return corsJson(
        { error: commitErrors[0].message },
        { status: 422 },
      );
    }

    // Step 5: Tag the order with upsell info
    const committedOrderId = commitData.data?.orderEditCommit?.order?.id || orderGid;
    try {
      // Add tags: "upsell", offer title, discount info
      const tags = [
        "upsell",
        `upsell:${offer.title}`,
        offer.discountValue > 0
          ? `upsell-discount:${offer.discountType === "percentage" ? offer.discountValue + "%" : "$" + offer.discountValue}`
          : null,
      ].filter(Boolean);

      await admin.graphql(
        `#graphql
        mutation addOrderTags($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            userErrors { field message }
          }
        }`,
        { variables: { id: committedOrderId, tags } },
      );

      // Also add a note attribute via order update
      await admin.graphql(
        `#graphql
        mutation addOrderNote($input: OrderInput!) {
          orderUpdate(input: $input) {
            userErrors { field message }
          }
        }`,
        {
          variables: {
            input: {
              id: committedOrderId,
              note: `UpsellHive: "${offer.title}" — ${offer.productTitle}${offer.discountValue > 0 ? ` (${offer.discountType === "percentage" ? offer.discountValue + "% off" : "$" + offer.discountValue + " off"})` : ""}`,
            },
          },
        },
      );
    } catch (tagErr) {
      // Non-critical — don't fail the accept if tagging fails
      log.warn("Order tagging failed (non-critical)", tagErr);
    }

    // Calculate revenue for analytics
    const originalPrice = parseFloat(offer.productPrice);
    const revenue =
      offer.discountType === "percentage"
        ? originalPrice * (1 - offer.discountValue / 100)
        : originalPrice - offer.discountValue;

    // Record analytics event with funnel step and A/B test tracking
    await db.analyticsEvent.create({
      data: {
        shop,
        offerId: offer.id,
        eventType: "accept",
        orderId,
        revenue: Math.max(0, revenue),
        funnelStep,
        abTestId: offer.abTestId,
      },
    });

    return corsJson({ success: true });
  } catch (err) {
    log.error("Order edit failed", { error: err instanceof Error ? err.message : err, shop, offerId, orderId });
    const errMsg = err instanceof Error ? err.message : String(err);
    return corsJson(
      { error: `Order edit failed: ${errMsg}` },
      { status: 500 },
    );
  }
};
