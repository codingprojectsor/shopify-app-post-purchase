import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Seed comprehensive demo data: offers with all discount types,
 * targeting rules, funnels, A/B tests, widgets, survey, branding.
 * Visit /api/seed-offers in the browser while the app is running.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Check if offers already exist
  const existing = await db.upsellOffer.count({ where: { shop } });
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

  if (products.length < 3) {
    return Response.json({
      error: "Need at least 3 products in your store to seed demo offers",
    });
  }

  const getProduct = (i: number) => {
    const p = products[i % products.length];
    return {
      id: p.id,
      variantId: p.variants.edges[0]?.node?.id || "",
      title: p.title,
      image: p.featuredMedia?.preview?.image?.url || null,
      price: p.variants.edges[0]?.node?.price || "0.00",
    };
  };

  // ─── 1. Create A/B Test ───
  const abTest = await db.aBTest.create({
    data: {
      shop,
      name: "Homepage vs Urgency CTA",
      description: "Testing which CTA style converts better",
      status: "running",
      splitPercent: 50,
      startedAt: new Date(),
    },
  });

  // ─── 2. Create Offers (all types) ───

  // Offer 1: Percentage discount + timer + funnel start (high priority)
  const p0 = getProduct(0);
  const offer1 = await db.upsellOffer.create({
    data: {
      shop,
      title: "VIP Customer Offer",
      description: `Get ${p0.title} at a special price — only available right now!`,
      ctaText: "Claim Now!",
      productId: p0.id,
      variantId: p0.variantId,
      productTitle: p0.title,
      productImage: p0.image,
      productPrice: p0.price,
      discountType: "percentage",
      discountValue: 25,
      timeLimitMinutes: 5,
      status: "active",
      priority: 10,
    },
  });

  // Offer 2: Fixed discount + no timer (funnel fallback for offer 1)
  const p1 = getProduct(1);
  const offer2 = await db.upsellOffer.create({
    data: {
      shop,
      title: "Special Thank-You Discount",
      description: `Add ${p1.title} to your order and save!`,
      ctaText: "Add & Save $10",
      productId: p1.id,
      variantId: p1.variantId,
      productTitle: p1.title,
      productImage: p1.image,
      productPrice: p1.price,
      discountType: "fixed",
      discountValue: 10,
      timeLimitMinutes: null,
      status: "active",
      priority: 9,
    },
  });

  // Offer 3: Big percentage + short timer (funnel fallback for offer 2)
  const p2 = getProduct(2);
  const offer3 = await db.upsellOffer.create({
    data: {
      shop,
      title: "Flash Sale — Last Chance!",
      description: `30% off ${p2.title} — this deal expires fast!`,
      ctaText: "Get 30% Off!",
      productId: p2.id,
      variantId: p2.variantId,
      productTitle: p2.title,
      productImage: p2.image,
      productPrice: p2.price,
      discountType: "percentage",
      discountValue: 30,
      timeLimitMinutes: 2,
      status: "active",
      priority: 8,
    },
  });

  // Offer 4: A/B test variant A (percentage, with timer)
  const p3 = getProduct(3);
  const offerA = await db.upsellOffer.create({
    data: {
      shop,
      title: "Complete Your Look",
      description: `${p3.title} pairs perfectly with your purchase.`,
      ctaText: "Yes, Add This!",
      productId: p3.id,
      variantId: p3.variantId,
      productTitle: p3.title,
      productImage: p3.image,
      productPrice: p3.price,
      discountType: "percentage",
      discountValue: 15,
      timeLimitMinutes: 3,
      status: "active",
      priority: 7,
      abTestId: abTest.id,
    },
  });

  // Offer 5: A/B test variant B (fixed, no timer, different CTA)
  const p4 = getProduct(4);
  const offerB = await db.upsellOffer.create({
    data: {
      shop,
      title: "Exclusive Bundle Deal",
      description: `Save $5 when you add ${p4.title} now!`,
      ctaText: "Grab This Deal!",
      productId: p4.id,
      variantId: p4.variantId,
      productTitle: p4.title,
      productImage: p4.image,
      productPrice: p4.price,
      discountType: "fixed",
      discountValue: 5,
      timeLimitMinutes: null,
      status: "active",
      priority: 6,
      abTestId: abTest.id,
    },
  });

  // Offer 6: Scheduled offer (starts tomorrow, ends in 7 days)
  const p5 = getProduct(5);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  await db.upsellOffer.create({
    data: {
      shop,
      title: "Weekend Special",
      description: `This offer is only available this weekend!`,
      ctaText: "Get Weekend Deal!",
      productId: p5.id,
      variantId: p5.variantId,
      productTitle: p5.title,
      productImage: p5.image,
      productPrice: p5.price,
      discountType: "percentage",
      discountValue: 20,
      timeLimitMinutes: 10,
      status: "active",
      priority: 5,
      scheduledStart: tomorrow,
      scheduledEnd: nextWeek,
    },
  });

  // Offer 7: Draft offer (not shown to customers)
  const p6 = getProduct(6);
  await db.upsellOffer.create({
    data: {
      shop,
      title: "Draft — Coming Soon Offer",
      description: "This offer is still being prepared.",
      ctaText: "Add to Order",
      productId: p6.id,
      variantId: p6.variantId,
      productTitle: p6.title,
      productImage: p6.image,
      productPrice: p6.price,
      discountType: "percentage",
      discountValue: 10,
      timeLimitMinutes: null,
      status: "draft",
      priority: 1,
    },
  });

  // Offer 8: Paused offer
  const p7 = getProduct(7);
  await db.upsellOffer.create({
    data: {
      shop,
      title: "Paused Holiday Deal",
      description: "This deal is paused until the next holiday season.",
      ctaText: "Claim Holiday Discount!",
      productId: p7.id,
      variantId: p7.variantId,
      productTitle: p7.title,
      productImage: p7.image,
      productPrice: p7.price,
      discountType: "fixed",
      discountValue: 15,
      timeLimitMinutes: 5,
      status: "paused",
      priority: 2,
    },
  });

  // Offer 9: Test mode offer
  const p8 = getProduct(8);
  await db.upsellOffer.create({
    data: {
      shop,
      title: "Test Mode — Dev Only",
      description: "Only visible in test mode.",
      ctaText: "Test Add",
      productId: p8.id,
      variantId: p8.variantId,
      productTitle: p8.title,
      productImage: p8.image,
      productPrice: p8.price,
      discountType: "percentage",
      discountValue: 50,
      timeLimitMinutes: 1,
      status: "active",
      testMode: true,
      priority: 0,
    },
  });

  // Offer 10: No discount, no timer (pure recommendation)
  const p9 = getProduct(9);
  await db.upsellOffer.create({
    data: {
      shop,
      title: "Customers Also Bought",
      description: `Other customers loved ${p9.title} — you might too!`,
      ctaText: "Add to My Order",
      productId: p9.id,
      variantId: p9.variantId,
      productTitle: p9.title,
      productImage: p9.image,
      productPrice: p9.price,
      discountType: "percentage",
      discountValue: 0,
      timeLimitMinutes: null,
      status: "active",
      priority: 3,
    },
  });

  // ─── 3. Set up Funnel Chain: Offer 1 → Offer 2 → Offer 3 ───
  await db.upsellOffer.update({
    where: { id: offer1.id },
    data: { fallbackOfferId: offer2.id },
  });
  await db.upsellOffer.update({
    where: { id: offer2.id },
    data: { fallbackOfferId: offer3.id },
  });

  // ─── 4. Add Targeting Rules (all types) ───
  await db.targetingRule.createMany({
    data: [
      // Offer 1: cart value > $50 AND shipping to US
      { offerId: offer1.id, ruleType: "cart_value", operator: "greater_than", value: "50" },
      { offerId: offer1.id, ruleType: "shipping_country", operator: "equals", value: "US" },
      // Offer 2: quantity >= 2
      { offerId: offer2.id, ruleType: "quantity", operator: "greater_than", value: "1" },
      // Offer 3: customer tag = VIP
      { offerId: offer3.id, ruleType: "customer_tag", operator: "equals", value: "VIP" },
      // A/B variant A: product-based (contains specific product)
      { offerId: offerA.id, ruleType: "product", operator: "contains", value: p0.id },
      // A/B variant B: order count > 0 (returning customers)
      { offerId: offerB.id, ruleType: "order_count", operator: "greater_than", value: "0" },
    ],
  });

  // ─── 5. Widget Configuration ───
  await db.widgetConfig.createMany({
    data: [
      { shop, widgetType: "upsell", enabled: true, position: 0, settings: "{}" },
      { shop, widgetType: "social_share", enabled: true, position: 1, settings: JSON.stringify({ shareMessage: "I just got an amazing deal! Check this out:" }) },
      { shop, widgetType: "survey", enabled: true, position: 2, settings: "{}" },
      { shop, widgetType: "reorder", enabled: true, position: 3, settings: "{}" },
      { shop, widgetType: "custom_message", enabled: false, position: 4, settings: "{}" },
    ],
  });

  // ─── 6. Survey Questions (all types) ───
  await db.surveyQuestion.createMany({
    data: [
      { shop, question: "How was your checkout experience?", questionType: "rating", options: "[]", position: 0, enabled: true },
      { shop, question: "How did you hear about us?", questionType: "multiple_choice", options: JSON.stringify(["Instagram", "Google", "Friend", "Ad", "Other"]), position: 1, enabled: true },
      { shop, question: "Anything we can improve?", questionType: "text", options: "[]", position: 2, enabled: true },
    ],
  });

  // ─── 7. Branding Configuration ───
  await db.brandingConfig.create({
    data: {
      shop,
      primaryColor: "#2563eb",
      accentColor: "#16a34a",
      buttonStyle: "rounded",
      showTrustBadges: true,
      customMessage: "Thank you for your purchase! We appreciate your business.",
    },
  });

  // ─── 8. Seed some analytics events ───
  const eventTypes = ["view", "accept", "decline"];
  const analyticsData = [];
  for (let i = 0; i < 50; i++) {
    const daysAgo = Math.floor(Math.random() * 14);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const eventType = eventTypes[Math.floor(Math.random() * 3)];
    analyticsData.push({
      shop,
      offerId: [offer1.id, offer2.id, offer3.id, offerA.id, offerB.id][i % 5],
      eventType,
      revenue: eventType === "accept" ? Math.round(Math.random() * 100 * 100) / 100 : null,
      funnelStep: Math.floor(Math.random() * 3) + 1,
      abTestId: i % 5 >= 3 ? abTest.id : null,
      createdAt: date,
    });
  }
  await db.analyticsEvent.createMany({ data: analyticsData });

  return Response.json({
    message: "Demo data seeded successfully!",
    summary: {
      offers: 10,
      funnelChain: "Offer 1 → Offer 2 → Offer 3",
      abTest: "Offer 4 vs Offer 5 (50/50 split)",
      targetingRules: 6,
      statuses: ["active (7)", "draft (1)", "paused (1)", "test-mode (1)"],
      discountTypes: ["percentage (7)", "fixed (3)", "none (1)"],
      timers: ["5min", "3min", "2min", "10min", "1min", "none"],
      widgets: 5,
      surveyQuestions: 3,
      analyticsEvents: 50,
      scheduling: "1 scheduled offer (tomorrow → next week)",
    },
  });
};
