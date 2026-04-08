import type { ActionFunctionArgs } from "react-router";
import { verifyExtensionToken } from "../utils/verify-extension-token.server";
import { handleCors, corsJson, corsError } from "../utils/cors.server";
import { checkRateLimit } from "../utils/rate-limit.server";
import { getActivePlanLimits } from "../utils/billing.server";
import db from "../db.server";

export const loader = () => new Response(null, {
  status: 204,
  headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" },
});

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
  declinedOfferId?: string;
  funnelStep?: number;
  customerTags?: string[];
  orderCount?: number;
  shippingCountry?: string;
  collectionIds?: string[];
  totalQuantity?: number;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
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

  // Get plan limits for this shop
  const planLimits = await getActivePlanLimits(shop);

  // Rate limit: 30 requests per minute per shop
  if (!checkRateLimit(`offer:${shop}`, 30)) {
    return corsError("Too many requests", 429);
  }

  let body: OfferRequest;
  try {
    body = await request.json();
  } catch {
    return corsError("Invalid JSON body", 400);
  }

  // Input validation
  if (!body.orderId || typeof body.orderId !== "string") {
    return corsError("Missing or invalid orderId", 400);
  }
  if (!Array.isArray(body.lineItems)) {
    body.lineItems = [];
  }
  if (typeof body.orderTotal !== "number" || isNaN(body.orderTotal)) {
    body.orderTotal = 0;
  }

  const { lineItems, orderTotal, declinedOfferId, funnelStep = 1, customerTags = [], orderCount, shippingCountry = "", collectionIds = [], totalQuantity } = body;

  // If a specific offer was declined, check for its fallback
  if (declinedOfferId) {
    const declinedOffer = await db.upsellOffer.findFirst({
      where: { id: declinedOfferId, shop },
    });

    if (declinedOffer?.fallbackOfferId) {
      const fallback = await db.upsellOffer.findFirst({
        where: { id: declinedOffer.fallbackOfferId, shop, status: "active" },
      });

      if (fallback) {
        // Don't offer a product already purchased
        const alreadyPurchased = lineItems.some(
          (item) =>
            item.productId === fallback.productId ||
            item.variantId === fallback.variantId,
        );

        if (!alreadyPurchased) {
          return corsJson({
            offer: formatOffer(fallback, funnelStep + 1, planLimits),
          });
        }
      }
    }

    // No fallback available
    return corsJson({ offer: null });
  }

  // First offer: find best matching offer (respecting schedule)
  const now = new Date();
  const offers = await db.upsellOffer.findMany({
    where: {
      shop,
      status: "active",
      OR: [
        { scheduledStart: null },
        { scheduledStart: { lte: now } },
      ],
    },
    include: { targetingRules: true, abTest: true },
    orderBy: { priority: "desc" },
  });

  // Filter out offers past their scheduled end
  const activeOffers = offers.filter(
    (o) => !o.scheduledEnd || new Date(o.scheduledEnd) >= now,
  );

  // Filter out products already in the order
  const eligibleOffers = activeOffers.filter(
    (o) =>
      !lineItems.some(
        (item) =>
          item.productId === o.productId || item.variantId === o.variantId,
      ),
  );

  // Find first matching offer from eligible ones
  let matchedOffer = findMatchingOffer(eligibleOffers, lineItems, orderTotal, customerTags, orderCount, shippingCountry, collectionIds, totalQuantity);

  // A/B test support: if matched offer is in a running test, randomly pick variant
  if (matchedOffer?.abTest && matchedOffer.abTest.status === "running") {
    const testOffers = eligibleOffers.filter(
      (o) => o.abTestId === matchedOffer!.abTest!.id,
    );
    if (testOffers.length >= 2) {
      const rand = Math.random() * 100;
      matchedOffer =
        rand < matchedOffer.abTest.splitPercent
          ? testOffers[0]
          : testOffers[1];
    }
  }

  if (!matchedOffer) {
    // Smart recommendation: fallback to any eligible offer without targeting rules
    const fallbackOffer = eligibleOffers.find(
      (o) => o.targetingRules.length === 0,
    );
    if (fallbackOffer) {
      return corsJson({ offer: formatOffer(fallbackOffer, 1, planLimits) });
    }
    return corsJson({ offer: null });
  }

  return corsJson({
    offer: formatOffer(matchedOffer, 1, planLimits),
  });
  } catch (err) {
    return corsError(String(err), 500);
  }
};

function formatOffer(offer: any, funnelStep: number, planLimits?: any) {
  const originalPrice = parseFloat(offer.productPrice);
  const discountedPrice =
    offer.discountType === "percentage"
      ? originalPrice * (1 - offer.discountValue / 100)
      : originalPrice - offer.discountValue;

  return {
    id: offer.id,
    title: offer.title,
    description: offer.description,
    ctaText: offer.ctaText,
    productId: offer.productId,
    variantId: offer.variantId,
    productTitle: offer.productTitle,
    productImage: offer.productImage,
    productPrice: offer.productPrice,
    discountType: offer.discountType,
    discountValue: offer.discountValue,
    discountedPrice: Math.max(0, discountedPrice).toFixed(2),
    // Timer only if plan allows scheduled/timed offers
    timeLimitMinutes: planLimits?.scheduledOffers ? offer.timeLimitMinutes : null,
    // Funnel only if plan allows
    hasFallback: planLimits?.funnelChaining ? !!offer.fallbackOfferId : false,
    funnelStep,
  };
}

function findMatchingOffer(
  offers: any[],
  lineItems: LineItem[],
  orderTotal: number,
  customerTags: string[],
  orderCount?: number,
  shippingCountry?: string,
  collectionIds?: string[],
  totalQuantity?: number,
) {
  return offers.find((offer) => {
    if (offer.targetingRules.length === 0) return true;

    return offer.targetingRules.every((rule: any) => {
      switch (rule.ruleType) {
        case "product":
          return evaluateProductRule(rule, lineItems);
        case "collection":
          return evaluateCollectionRule(rule, collectionIds || []);
        case "cart_value":
          return evaluateCartValueRule(rule, orderTotal);
        case "quantity":
          return evaluateQuantityRule(rule, totalQuantity);
        case "customer_tag":
          return evaluateCustomerTagRule(rule, customerTags);
        case "order_count":
          return evaluateOrderCountRule(rule, orderCount);
        case "shipping_country":
          return evaluateShippingCountryRule(rule, shippingCountry || "");
        default:
          return false;
      }
    });
  });
}

function evaluateProductRule(
  rule: { operator: string; value: string },
  lineItems: LineItem[],
): boolean {
  const targetProductId = rule.value;
  switch (rule.operator) {
    case "contains":
    case "equals":
      return lineItems.some((item) => item.productId === targetProductId);
    case "not_equals":
      return !lineItems.some((item) => item.productId === targetProductId);
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

function evaluateCustomerTagRule(
  rule: { operator: string; value: string },
  customerTags: string[],
): boolean {
  const targetTag = rule.value.toLowerCase();
  switch (rule.operator) {
    case "equals":
    case "contains":
      return customerTags.some((t) => t.toLowerCase() === targetTag);
    case "not_equals":
      return !customerTags.some((t) => t.toLowerCase() === targetTag);
    default:
      return false;
  }
}

function evaluateOrderCountRule(
  rule: { operator: string; value: string },
  orderCount?: number,
): boolean {
  if (orderCount === undefined) return true;
  const threshold = parseInt(rule.value, 10);
  if (isNaN(threshold)) return false;
  switch (rule.operator) {
    case "greater_than":
      return orderCount > threshold;
    case "less_than":
      return orderCount < threshold;
    case "equals":
      return orderCount === threshold;
    default:
      return false;
  }
}

function evaluateCollectionRule(
  rule: { operator: string; value: string },
  collectionIds: string[],
): boolean {
  switch (rule.operator) {
    case "equals":
    case "contains":
      return collectionIds.some((id) => id === rule.value);
    case "not_equals":
      return !collectionIds.some((id) => id === rule.value);
    default:
      return false;
  }
}

function evaluateQuantityRule(
  rule: { operator: string; value: string },
  totalQuantity?: number,
): boolean {
  if (totalQuantity === undefined) return true;
  const threshold = parseInt(rule.value, 10);
  if (isNaN(threshold)) return false;
  switch (rule.operator) {
    case "greater_than":
      return totalQuantity > threshold;
    case "less_than":
      return totalQuantity < threshold;
    case "equals":
      return totalQuantity === threshold;
    default:
      return false;
  }
}

function evaluateShippingCountryRule(
  rule: { operator: string; value: string },
  shippingCountry: string,
): boolean {
  const target = rule.value.toUpperCase();
  const country = shippingCountry.toUpperCase();
  switch (rule.operator) {
    case "equals":
      return country === target;
    case "not_equals":
      return country !== target;
    default:
      return false;
  }
}
