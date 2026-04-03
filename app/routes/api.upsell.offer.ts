import type { ActionFunctionArgs } from "react-router";
import { verifyExtensionToken } from "../utils/verify-extension-token.server";
import db from "../db.server";

interface LineItem {
  productId: string;
  variantId: string;
  quantity: number;
}

interface OfferRequest {
  orderId: string;
  orderNumber: string;
  lineItems: LineItem[];
  orderTotal: number;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { shop } = await verifyExtensionToken(request);
  const body: OfferRequest = await request.json();
  const { lineItems, orderTotal } = body;

  // Fetch all enabled offers for this shop with their targeting rules
  const offers = await db.upsellOffer.findMany({
    where: {
      shop,
      enabled: true,
    },
    include: {
      targetingRules: true,
    },
    orderBy: {
      priority: "desc",
    },
  });

  // Find the first offer whose targeting rules match
  const matchedOffer = offers.find((offer) => {
    // If no targeting rules, the offer matches all orders
    if (offer.targetingRules.length === 0) return true;

    // All rules must match (AND logic)
    return offer.targetingRules.every((rule) => {
      if (rule.ruleType === "product") {
        return evaluateProductRule(rule, lineItems);
      }
      if (rule.ruleType === "cart_value") {
        return evaluateCartValueRule(rule, orderTotal);
      }
      return false;
    });
  });

  if (!matchedOffer) {
    return Response.json({ offer: null });
  }

  // Don't offer a product the customer already purchased
  const alreadyPurchased = lineItems.some(
    (item) =>
      item.productId === matchedOffer.productId ||
      item.variantId === matchedOffer.variantId,
  );
  if (alreadyPurchased) {
    return Response.json({ offer: null });
  }

  // Compute discounted price
  const originalPrice = parseFloat(matchedOffer.productPrice);
  const discountedPrice =
    matchedOffer.discountType === "percentage"
      ? originalPrice * (1 - matchedOffer.discountValue / 100)
      : originalPrice - matchedOffer.discountValue;

  return Response.json({
    offer: {
      id: matchedOffer.id,
      title: matchedOffer.title,
      description: matchedOffer.description,
      ctaText: matchedOffer.ctaText,
      productId: matchedOffer.productId,
      variantId: matchedOffer.variantId,
      productTitle: matchedOffer.productTitle,
      productImage: matchedOffer.productImage,
      productPrice: matchedOffer.productPrice,
      discountType: matchedOffer.discountType,
      discountValue: matchedOffer.discountValue,
      discountedPrice: Math.max(0, discountedPrice).toFixed(2),
      timeLimitMinutes: matchedOffer.timeLimitMinutes,
    },
  });
};

function evaluateProductRule(
  rule: { operator: string; value: string },
  lineItems: LineItem[],
): boolean {
  const targetProductId = rule.value;

  switch (rule.operator) {
    case "contains":
    case "equals":
      return lineItems.some((item) => item.productId === targetProductId);
    default:
      return false;
  }
}

function evaluateCartValueRule(
  rule: { operator: string; value: string },
  orderTotal: number,
): boolean {
  const threshold = parseFloat(rule.value);
  if (isNaN(threshold)) return false;

  switch (rule.operator) {
    case "greater_than":
      return orderTotal > threshold;
    case "less_than":
      return orderTotal < threshold;
    case "equals":
      return orderTotal === threshold;
    default:
      return false;
  }
}
