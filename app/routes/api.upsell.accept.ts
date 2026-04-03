import type { ActionFunctionArgs } from "react-router";
import { verifyExtensionToken } from "../utils/verify-extension-token.server";
import { unauthenticated } from "../shopify.server";
import db from "../db.server";

interface AcceptRequest {
  offerId: string;
  orderId: string;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { shop } = await verifyExtensionToken(request);
  const body: AcceptRequest = await request.json();
  const { offerId, orderId } = body;

  if (!offerId || !orderId) {
    return Response.json(
      { error: "Missing offerId or orderId" },
      { status: 400 },
    );
  }

  // Look up the offer
  const offer = await db.upsellOffer.findFirst({
    where: { id: offerId, shop, enabled: true },
  });

  if (!offer) {
    return Response.json({ error: "Offer not found" }, { status: 404 });
  }

  // Get admin API client for this shop (offline token)
  const { admin } = await unauthenticated.admin(shop);

  try {
    // Step 1: Begin order edit
    const beginResponse = await admin.graphql(
      `#graphql
      mutation orderEditBegin($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { id: orderId } },
    );

    const beginData = await beginResponse.json();
    const beginErrors = beginData.data?.orderEditBegin?.userErrors;
    if (beginErrors?.length) {
      console.error("orderEditBegin errors:", beginErrors);
      return Response.json(
        { error: beginErrors[0].message },
        { status: 422 },
      );
    }

    const calculatedOrderId =
      beginData.data.orderEditBegin.calculatedOrder.id;

    // Step 2: Add the variant to the order
    const addVariantResponse = await admin.graphql(
      `#graphql
      mutation orderEditAddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
        orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
          calculatedOrder {
            id
          }
          calculatedLineItem {
            id
          }
          userErrors {
            field
            message
          }
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
      console.error("orderEditAddVariant errors:", addErrors);
      return Response.json({ error: addErrors[0].message }, { status: 422 });
    }

    const calculatedLineItemId =
      addData.data.orderEditAddVariant.calculatedLineItem.id;

    // Step 3: Apply discount if configured
    if (offer.discountValue > 0) {
      const discountInput =
        offer.discountType === "percentage"
          ? {
              percentValue: offer.discountValue,
              description: `${offer.discountValue}% upsell discount`,
            }
          : {
              fixedValue: offer.discountValue,
              description: `${offer.discountValue} upsell discount`,
            };

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
            calculatedOrder {
              id
            }
            userErrors {
              field
              message
            }
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
        console.error("orderEditAddLineItemDiscount errors:", discountErrors);
        // Continue anyway — the item is added, just without discount
      }
    }

    // Step 4: Commit the order edit
    const commitResponse = await admin.graphql(
      `#graphql
      mutation orderEditCommit($id: ID!) {
        orderEditCommit(id: $id) {
          order {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { id: calculatedOrderId } },
    );

    const commitData = await commitResponse.json();
    const commitErrors = commitData.data?.orderEditCommit?.userErrors;
    if (commitErrors?.length) {
      console.error("orderEditCommit errors:", commitErrors);
      return Response.json(
        { error: commitErrors[0].message },
        { status: 422 },
      );
    }

    // Calculate revenue for analytics
    const originalPrice = parseFloat(offer.productPrice);
    const revenue =
      offer.discountType === "percentage"
        ? originalPrice * (1 - offer.discountValue / 100)
        : originalPrice - offer.discountValue;

    // Record analytics event
    await db.analyticsEvent.create({
      data: {
        shop,
        offerId: offer.id,
        eventType: "accept",
        orderId,
        revenue: Math.max(0, revenue),
      },
    });

    return Response.json({ success: true });
  } catch (err) {
    console.error("Order edit failed:", err);
    return Response.json(
      { error: "Failed to modify order. Please try again." },
      { status: 500 },
    );
  }
};
