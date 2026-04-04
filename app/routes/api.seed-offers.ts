import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Seed offers by fetching real products from the store.
 * Visit /api/seed-offers in the browser while the app is running.
 * Only works when accessed from the Shopify admin (authenticated).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Check if offers already exist
  const existing = await db.upsellOffer.count({
    where: { shop: session.shop },
  });

  if (existing > 0) {
    return Response.json({
      message: `Already have ${existing} offers. Delete them first or skip seeding.`,
    });
  }

  // Fetch products from the store
  const response = await admin.graphql(
    `#graphql
    query {
      products(first: 10) {
        edges {
          node {
            id
            title
            featuredMedia {
              preview {
                image {
                  url
                }
              }
            }
            variants(first: 1) {
              edges {
                node {
                  id
                  price
                }
              }
            }
          }
        }
      }
    }`,
  );

  const data = await response.json();
  const products = data.data?.products?.edges?.map((e: any) => e.node) || [];

  if (products.length < 2) {
    return Response.json({
      error: "Need at least 2 products in your store to seed offers",
    });
  }

  const discountConfigs = [
    { type: "percentage", value: 15, title: "Complete Your Look", cta: "Yes, Add This!", minutes: 5 },
    { type: "percentage", value: 20, title: "Exclusive Bundle Deal", cta: "Grab This Deal!", minutes: 3 },
    { type: "fixed", value: 5, title: "Add This & Save", cta: "Add to Order", minutes: null },
    { type: "percentage", value: 25, title: "VIP Customer Offer", cta: "Claim Now!", minutes: 10 },
    { type: "percentage", value: 10, title: "Don't Miss This", cta: "Yes Please!", minutes: 2 },
    { type: "fixed", value: 10, title: "Special Thank-You Discount", cta: "Add & Save", minutes: 5 },
    { type: "percentage", value: 30, title: "Flash Sale - Just For You", cta: "Get 30% Off!", minutes: 1 },
    { type: "percentage", value: 15, title: "Customers Also Bought", cta: "Add to My Order", minutes: null },
    { type: "fixed", value: 3, title: "Try Something New", cta: "Sure, Add It!", minutes: null },
    { type: "percentage", value: 20, title: "Last Chance Offer", cta: "Claim Discount!", minutes: 2 },
  ];

  const createdOffers = [];

  for (let i = 0; i < Math.min(products.length, 10); i++) {
    const product = products[i];
    const variant = product.variants.edges[0]?.node;
    const config = discountConfigs[i % discountConfigs.length];
    const imageUrl = product.featuredMedia?.preview?.image?.url || null;

    const offer = await db.upsellOffer.create({
      data: {
        shop: session.shop,
        title: config.title,
        description: `Get ${product.title} at a special price — only available right now!`,
        ctaText: config.cta,
        productId: product.id,
        variantId: variant?.id || "",
        productTitle: product.title,
        productImage: imageUrl,
        productPrice: variant?.price || "0.00",
        discountType: config.type,
        discountValue: config.value,
        timeLimitMinutes: config.minutes,
        status: "active",
        testMode: false,
        priority: 10 - i,
      },
    });

    createdOffers.push({ title: offer.title, product: product.title });
  }

  // Set up a funnel: first offer's fallback = second offer
  if (createdOffers.length >= 2) {
    const allOffers = await db.upsellOffer.findMany({
      where: { shop: session.shop },
      orderBy: { priority: "desc" },
    });
    if (allOffers.length >= 2) {
      await db.upsellOffer.update({
        where: { id: allOffers[0].id },
        data: { fallbackOfferId: allOffers[1].id },
      });
    }
  }

  return Response.json({
    message: `Created ${createdOffers.length} offers!`,
    offers: createdOffers,
  });
};
