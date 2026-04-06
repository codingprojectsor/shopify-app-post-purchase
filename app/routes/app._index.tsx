import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type {
  ActionFunctionArgs,
  HeadersArgs,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useCallback, useRef, useState } from "react";

interface OfferSummary {
  id: string;
  title: string;
  productTitle: string;
  productImage: string | null;
  productPrice: string;
  discountType: string;
  discountValue: number;
  enabled: boolean; // derived from status;
  testMode: boolean;
  priority: number;
  views: number;
  accepts: number;
  declines: number;
  revenue: number;
  conversionRate: number;
  createdAt: string;
}

interface DashboardStats {
  totalOffers: number;
  activeOffers: number;
  totalViews: number;
  totalAccepts: number;
  totalDeclines: number;
  totalRevenue: number;
  overallConversion: number;
}

const PAGE_SIZE = 10;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

  // Get total count for pagination
  const totalCount = await db.upsellOffer.count({
    where: { shop: session.shop },
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Paginated offers
  const offers = await db.upsellOffer.findMany({
    where: { shop: session.shop },
    orderBy: { priority: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      analyticsEvents: {
        select: { eventType: true, revenue: true },
      },
    },
  });

  const offersWithStats: OfferSummary[] = offers.map((offer) => {
    const views = offer.analyticsEvents.filter(
      (e) => e.eventType === "view",
    ).length;
    const accepts = offer.analyticsEvents.filter(
      (e) => e.eventType === "accept",
    ).length;
    const declines = offer.analyticsEvents.filter(
      (e) => e.eventType === "decline",
    ).length;
    const revenue = offer.analyticsEvents
      .filter((e) => e.eventType === "accept" && e.revenue)
      .reduce((sum, e) => sum + (e.revenue || 0), 0);

    return {
      id: offer.id,
      title: offer.title,
      productTitle: offer.productTitle,
      productImage: offer.productImage,
      productPrice: offer.productPrice,
      discountType: offer.discountType,
      discountValue: offer.discountValue,
      enabled: offer.status === "active",
      testMode: offer.testMode,
      priority: offer.priority,
      views,
      accepts,
      declines,
      revenue,
      conversionRate: views > 0 ? Math.round((accepts / views) * 100) : 0,
      createdAt: offer.createdAt.toISOString(),
    };
  });

  // Stats from ALL offers (not paginated)
  const allOffers = await db.upsellOffer.findMany({
    where: { shop: session.shop },
    include: {
      analyticsEvents: {
        select: { eventType: true, revenue: true },
      },
    },
  });

  const allStats = allOffers.map((offer) => {
    const views = offer.analyticsEvents.filter((e) => e.eventType === "view").length;
    const accepts = offer.analyticsEvents.filter((e) => e.eventType === "accept").length;
    const revenue = offer.analyticsEvents
      .filter((e) => e.eventType === "accept" && e.revenue)
      .reduce((sum, e) => sum + (e.revenue || 0), 0);
    return { views, accepts, revenue, enabled: offer.status === "active" };
  });

  const totalViews = allStats.reduce((s, o) => s + o.views, 0);
  const totalAccepts = allStats.reduce((s, o) => s + o.accepts, 0);

  const stats: DashboardStats = {
    totalOffers: totalCount,
    activeOffers: allStats.filter((o) => o.enabled).length,
    totalViews,
    totalAccepts,
    totalDeclines: allOffers.flatMap((o) => o.analyticsEvents).filter((e) => e.eventType === "decline").length,
    totalRevenue: allStats.reduce((s, o) => s + o.revenue, 0),
    overallConversion:
      totalViews > 0 ? Math.round((totalAccepts / totalViews) * 100) : 0,
  };

  return { offers: offersWithStats, stats, page, totalPages, totalCount };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle") {
    const offerId = formData.get("offerId") as string;
    const enabled = formData.get("enabled") === "true";

    await db.upsellOffer.updateMany({
      where: { id: offerId, shop: session.shop },
      data: { status: enabled ? "active" : "paused" },
    });

    return { success: true, toggled: true };
  }

  if (intent === "delete") {
    const offerId = formData.get("offerId") as string;

    await db.upsellOffer.deleteMany({
      where: { id: offerId, shop: session.shop },
    });

    return { success: true, deleted: true };
  }

  if (intent === "duplicate") {
    const offerId = formData.get("offerId") as string;

    const original = await db.upsellOffer.findFirst({
      where: { id: offerId, shop: session.shop },
      include: { targetingRules: true },
    });

    if (!original) return { success: false };

    await db.upsellOffer.create({
      data: {
        shop: session.shop,
        title: `${original.title} (Copy)`,
        description: original.description,
        ctaText: original.ctaText,
        productId: original.productId,
        variantId: original.variantId,
        productTitle: original.productTitle,
        productImage: original.productImage,
        productPrice: original.productPrice,
        discountType: original.discountType,
        discountValue: original.discountValue,
        timeLimitMinutes: original.timeLimitMinutes,
        status: "paused",
        testMode: original.testMode,
        priority: original.priority,
        targetingRules: {
          create: original.targetingRules.map((r) => ({
            ruleType: r.ruleType,
            operator: r.operator,
            value: r.value,
          })),
        },
      },
    });

    return { success: true, duplicated: true };
  }

  if (intent === "seed") {
    const { admin } = await authenticate.admin(request);
    const shop = session.shop;

    const response = await admin.graphql(
      `#graphql
      query {
        products(first: 10) {
          edges {
            node {
              id
              title
              featuredMedia { preview { image { url } } }
              variants(first: 1) {
                edges { node { id price } }
              }
            }
          }
        }
      }`,
    );

    const data = await response.json();
    const products = data.data?.products?.edges?.map((e: any) => e.node) || [];

    if (products.length < 3) {
      return { error: "Need at least 3 products in your store" };
    }

    const gp = (i: number) => {
      const p = products[i % products.length];
      return {
        id: p.id,
        variantId: p.variants.edges[0]?.node?.id || "",
        title: p.title,
        image: p.featuredMedia?.preview?.image?.url || null,
        price: p.variants.edges[0]?.node?.price || "0.00",
      };
    };

    // A/B Test
    const abTest = await db.aBTest.create({
      data: { shop, name: "Homepage vs Urgency CTA", description: "Testing which CTA style converts better", status: "running", splitPercent: 50, startedAt: new Date() },
    });

    // Offer 1: Percentage + timer + funnel start
    const p0 = gp(0);
    const offer1 = await db.upsellOffer.create({
      data: { shop, title: "VIP Customer Offer", description: `Get ${p0.title} at a special price — only available right now!`, ctaText: "Claim Now!", productId: p0.id, variantId: p0.variantId, productTitle: p0.title, productImage: p0.image, productPrice: p0.price, discountType: "percentage", discountValue: 25, timeLimitMinutes: 5, status: "active", priority: 10 },
    });

    // Offer 2: Fixed discount, no timer (funnel fallback)
    const p1 = gp(1);
    const offer2 = await db.upsellOffer.create({
      data: { shop, title: "Special Thank-You Discount", description: `Add ${p1.title} to your order and save!`, ctaText: "Add & Save $10", productId: p1.id, variantId: p1.variantId, productTitle: p1.title, productImage: p1.image, productPrice: p1.price, discountType: "fixed", discountValue: 10, timeLimitMinutes: null, status: "active", priority: 9 },
    });

    // Offer 3: Big percentage + short timer (funnel end)
    const p2 = gp(2);
    const offer3 = await db.upsellOffer.create({
      data: { shop, title: "Flash Sale — Last Chance!", description: `30% off ${p2.title} — this deal expires fast!`, ctaText: "Get 30% Off!", productId: p2.id, variantId: p2.variantId, productTitle: p2.title, productImage: p2.image, productPrice: p2.price, discountType: "percentage", discountValue: 30, timeLimitMinutes: 2, status: "active", priority: 8 },
    });

    // Offer 4: A/B variant A
    const p3 = gp(3);
    const offerA = await db.upsellOffer.create({
      data: { shop, title: "Complete Your Look", description: `${p3.title} pairs perfectly with your purchase.`, ctaText: "Yes, Add This!", productId: p3.id, variantId: p3.variantId, productTitle: p3.title, productImage: p3.image, productPrice: p3.price, discountType: "percentage", discountValue: 15, timeLimitMinutes: 3, status: "active", priority: 7, abTestId: abTest.id },
    });

    // Offer 5: A/B variant B
    const p4 = gp(4);
    const offerB = await db.upsellOffer.create({
      data: { shop, title: "Exclusive Bundle Deal", description: `Save $5 when you add ${p4.title} now!`, ctaText: "Grab This Deal!", productId: p4.id, variantId: p4.variantId, productTitle: p4.title, productImage: p4.image, productPrice: p4.price, discountType: "fixed", discountValue: 5, timeLimitMinutes: null, status: "active", priority: 6, abTestId: abTest.id },
    });

    // Offer 6: Scheduled (tomorrow → next week)
    const p5 = gp(5);
    const tmrw = new Date(); tmrw.setDate(tmrw.getDate() + 1);
    const nxtWk = new Date(); nxtWk.setDate(nxtWk.getDate() + 7);
    await db.upsellOffer.create({
      data: { shop, title: "Weekend Special", description: "This offer is only available this weekend!", ctaText: "Get Weekend Deal!", productId: p5.id, variantId: p5.variantId, productTitle: p5.title, productImage: p5.image, productPrice: p5.price, discountType: "percentage", discountValue: 20, timeLimitMinutes: 10, status: "active", priority: 5, scheduledStart: tmrw, scheduledEnd: nxtWk },
    });

    // Offer 7: Draft
    const p6 = gp(6);
    await db.upsellOffer.create({
      data: { shop, title: "Draft — Coming Soon Offer", description: "This offer is still being prepared.", ctaText: "Add to Order", productId: p6.id, variantId: p6.variantId, productTitle: p6.title, productImage: p6.image, productPrice: p6.price, discountType: "percentage", discountValue: 10, timeLimitMinutes: null, status: "draft", priority: 1 },
    });

    // Offer 8: Paused
    const p7 = gp(7);
    await db.upsellOffer.create({
      data: { shop, title: "Paused Holiday Deal", description: "Paused until the next holiday season.", ctaText: "Claim Holiday Discount!", productId: p7.id, variantId: p7.variantId, productTitle: p7.title, productImage: p7.image, productPrice: p7.price, discountType: "fixed", discountValue: 15, timeLimitMinutes: 5, status: "paused", priority: 2 },
    });

    // Offer 9: Test mode
    const p8 = gp(8);
    await db.upsellOffer.create({
      data: { shop, title: "Test Mode — Dev Only", description: "Only visible in test mode.", ctaText: "Test Add", productId: p8.id, variantId: p8.variantId, productTitle: p8.title, productImage: p8.image, productPrice: p8.price, discountType: "percentage", discountValue: 50, timeLimitMinutes: 1, status: "active", testMode: true, priority: 0 },
    });

    // Offer 10: No discount (pure recommendation)
    const p9 = gp(9);
    await db.upsellOffer.create({
      data: { shop, title: "Customers Also Bought", description: `Other customers loved ${p9.title} — you might too!`, ctaText: "Add to My Order", productId: p9.id, variantId: p9.variantId, productTitle: p9.title, productImage: p9.image, productPrice: p9.price, discountType: "percentage", discountValue: 0, timeLimitMinutes: null, status: "active", priority: 3 },
    });

    // Funnel chain: 1 → 2 → 3
    await db.upsellOffer.update({ where: { id: offer1.id }, data: { fallbackOfferId: offer2.id } });
    await db.upsellOffer.update({ where: { id: offer2.id }, data: { fallbackOfferId: offer3.id } });

    // Targeting rules (all types)
    await db.targetingRule.createMany({
      data: [
        { offerId: offer1.id, ruleType: "cart_value", operator: "greater_than", value: "50" },
        { offerId: offer1.id, ruleType: "shipping_country", operator: "equals", value: "US" },
        { offerId: offer2.id, ruleType: "quantity", operator: "greater_than", value: "1" },
        { offerId: offer3.id, ruleType: "customer_tag", operator: "equals", value: "VIP" },
        { offerId: offerA.id, ruleType: "product", operator: "contains", value: p0.id },
        { offerId: offerB.id, ruleType: "order_count", operator: "greater_than", value: "0" },
      ],
    });

    // Widgets
    const widgetTypes = ["upsell", "social_share", "survey", "reorder", "custom_message"];
    for (let i = 0; i < widgetTypes.length; i++) {
      await db.widgetConfig.upsert({
        where: { shop_widgetType: { shop, widgetType: widgetTypes[i] } },
        update: { enabled: i < 4, position: i },
        create: { shop, widgetType: widgetTypes[i], enabled: i < 4, position: i, settings: widgetTypes[i] === "social_share" ? JSON.stringify({ shareMessage: "I just got an amazing deal! Check this out:" }) : "{}" },
      });
    }

    // Survey questions
    const existingQ = await db.surveyQuestion.count({ where: { shop } });
    if (existingQ === 0) {
      await db.surveyQuestion.createMany({
        data: [
          { shop, question: "How was your checkout experience?", questionType: "rating", position: 0 },
          { shop, question: "How did you hear about us?", questionType: "multiple_choice", options: JSON.stringify(["Instagram", "Google", "Friend", "Ad", "Other"]), position: 1 },
          { shop, question: "Anything we can improve?", questionType: "text", position: 2 },
        ],
      });
    }

    // Branding
    await db.brandingConfig.upsert({
      where: { shop },
      update: {},
      create: { shop, primaryColor: "#2563eb", accentColor: "#16a34a", buttonStyle: "rounded", showTrustBadges: true, customMessage: "Thank you for your purchase! We appreciate your business." },
    });

    // Analytics events (50 events over 14 days)
    const evTypes = ["view", "accept", "decline"];
    const evData = [];
    for (let i = 0; i < 50; i++) {
      const d = new Date(); d.setDate(d.getDate() - Math.floor(Math.random() * 14));
      const et = evTypes[Math.floor(Math.random() * 3)];
      evData.push({ shop, offerId: [offer1.id, offer2.id, offer3.id, offerA.id, offerB.id][i % 5], eventType: et, revenue: et === "accept" ? Math.round(Math.random() * 100 * 100) / 100 : null, funnelStep: Math.floor(Math.random() * 3) + 1, abTestId: i % 5 >= 3 ? abTest.id : null, createdAt: d });
    }
    await db.analyticsEvent.createMany({ data: evData });

    return { success: true, seeded: 10 };
  }

  return { success: false };
};

export default function OffersIndex() {
  const { offers, stats, page, totalPages, totalCount } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteModalRef = useRef<any>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && typeof fetcher.data === "object") {
      if ("deleted" in fetcher.data) {
        shopify.toast.show("Offer deleted successfully");
        setDeleteId(null);
      }
      if ("toggled" in fetcher.data) {
        shopify.toast.show("Offer updated");
      }
      if ("duplicated" in fetcher.data) {
        shopify.toast.show("Offer duplicated");
      }
      if ("seeded" in fetcher.data) {
        shopify.toast.show(`${fetcher.data.seeded} demo offers created!`);
      }
      if ("error" in fetcher.data) {
        shopify.toast.show(fetcher.data.error as string);
      }
    }
  }, [fetcher.state, fetcher.data, shopify]);

  // Empty state
  if (offers.length === 0) {
    return (
      <s-page heading="Post-Purchase Upsells">
        <s-button
          variant="primary" slot="primary-action"
          onClick={() => navigate("/app/offers/new")}
        >
          Create offer
        </s-button>

        <s-section>
          <s-box padding="large-200" borderWidth="base" borderRadius="large">
            <s-stack gap="large" alignItems="center">
              <s-box padding="base" borderRadius="large" background="subdued">
                <s-icon type="rocket" />
              </s-box>
              <s-stack gap="base" alignItems="center">
                <s-text type="strong">
                  Start boosting your revenue today
                </s-text>
                <s-paragraph color="subdued">
                  Create your first post-purchase upsell offer. Show targeted
                  product offers on the thank-you page — customers can add items
                  with one click, no re-entering payment details needed.
                </s-paragraph>
              </s-stack>
              <s-stack direction="inline" gap="large">
                <s-stack direction="inline" gap="small-100" alignItems="center">
                  <s-icon type="cart-sale" color="subdued" size="small" />
                  <s-text color="subdued">One-click upsells</s-text>
                </s-stack>
                <s-stack direction="inline" gap="small-100" alignItems="center">
                  <s-icon type="target" color="subdued" size="small" />
                  <s-text color="subdued">Smart targeting</s-text>
                </s-stack>
                <s-stack direction="inline" gap="small-100" alignItems="center">
                  <s-icon type="chart-line" color="subdued" size="small" />
                  <s-text color="subdued">Built-in analytics</s-text>
                </s-stack>
              </s-stack>
              <s-stack direction="inline" gap="base">
                <s-button onClick={() => navigate("/app/offers/new")}>
                  Create your first offer
                </s-button>
                <s-button
                  variant="secondary"
                  icon="wand"
                  accessibilityLabel="Generate demo data"
                  loading={fetcher.state !== "idle" || undefined}
                  onClick={() =>
                    fetcher.submit({ intent: "seed" }, { method: "POST" })
                  }
                >
                  Auto-generate demo offers
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        </s-section>
      </s-page>
    );
  }

  const deleteOffer = offers.find((o) => o.id === deleteId);

  return (
    <s-page heading="Post-Purchase Upsells">
      <s-button
        variant="primary" slot="primary-action"
        onClick={() => navigate("/app/offers/new")}
        icon="plus"
      >
        Create offer
      </s-button>
      {/* Quick Actions */}
      <s-section>
        <s-stack direction="inline" gap="small-200">
          <s-button
            variant="secondary"
            icon="wand"
            accessibilityLabel="Generate demo data"
            loading={fetcher.state !== "idle" || undefined}
            onClick={() =>
              fetcher.submit({ intent: "seed" }, { method: "POST" })
            }
          >
            Generate demo data
          </s-button>
        </s-stack>
      </s-section>

      {/* Stats Overview */}
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="base">
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="large">
              <s-stack gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="cash-dollar" color="subdued" size="small" />
                  <s-text color="subdued">Revenue</s-text>
                </s-stack>
                <s-text type="strong" fontVariantNumeric="tabular-nums">
                  ${stats.totalRevenue.toFixed(2)}
                </s-text>
                <s-text color="subdued">from upsells</s-text>
              </s-stack>
            </s-box>
          </s-grid-item>
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="large">
              <s-stack gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="chart-funnel" color="subdued" size="small" />
                  <s-text color="subdued">Conversion</s-text>
                </s-stack>
                <s-text type="strong" fontVariantNumeric="tabular-nums">
                  {stats.overallConversion}%
                </s-text>
                <s-text color="subdued">
                  {stats.totalAccepts} of {stats.totalViews} views
                </s-text>
              </s-stack>
            </s-box>
          </s-grid-item>
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="large">
              <s-stack gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="status-active" color="subdued" size="small" />
                  <s-text color="subdued">Active</s-text>
                </s-stack>
                <s-text type="strong" fontVariantNumeric="tabular-nums">
                  {stats.activeOffers} / {stats.totalOffers}
                </s-text>
                <s-text color="subdued">offers running</s-text>
              </s-stack>
            </s-box>
          </s-grid-item>
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="large">
              <s-stack gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="check-circle" color="subdued" size="small" />
                  <s-text color="subdued">Accepts</s-text>
                </s-stack>
                <s-text type="strong" fontVariantNumeric="tabular-nums">
                  {stats.totalAccepts}
                </s-text>
                <s-text color="subdued">orders upsold</s-text>
              </s-stack>
            </s-box>
          </s-grid-item>
        </s-grid>
      </s-section>

      {/* Offers Table */}
      <s-section heading="All Offers">
        <s-table>
          <s-table-header-row>
            <s-table-header>Offer</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Discount</s-table-header>
            <s-table-header>Views</s-table-header>
            <s-table-header>Accepts</s-table-header>
            <s-table-header>Conv.</s-table-header>
            <s-table-header>Revenue</s-table-header>
            <s-table-header>Actions</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {offers.map((offer) => (
              <OfferRow
                key={offer.id}
                offer={offer}
                fetcher={fetcher}
                onEdit={() => navigate(`/app/offers/${offer.id}`)}
                onDuplicate={() =>
                  fetcher.submit(
                    { intent: "duplicate", offerId: offer.id },
                    { method: "POST" },
                  )
                }
                onDelete={() => {
                  setDeleteId(offer.id);
                  deleteModalRef.current?.showOverlay();
                }}
              />
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      {/* Pagination */}
      {totalPages > 1 && (
        <s-section>
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="center">
            <s-button
              variant="tertiary"
              icon="chevron-left"
              disabled={page <= 1 || undefined}
              onClick={() => navigate(`/app?page=${page - 1}`)}
            >
              Previous
            </s-button>
            <s-text color="subdued">
              Page {page} of {totalPages} ({totalCount} offers)
            </s-text>
            <s-button
              variant="tertiary"
              icon="chevron-right"
              disabled={page >= totalPages || undefined}
              onClick={() => navigate(`/app?page=${page + 1}`)}
            >
              Next
            </s-button>
          </s-stack>
        </s-section>
      )}

      {/* Delete Confirmation Modal */}
      <s-modal accessibilityLabel="Dialog"
        id="delete-modal"
        ref={deleteModalRef}
        heading="Delete offer?"
        onHide={() => setDeleteId(null)}
      >
        <s-stack gap="base">
          {deleteOffer && (
            <s-stack gap="small-200">
              <s-paragraph>
                Are you sure you want to delete{" "}
                <s-text type="strong">{deleteOffer.title}</s-text>? This will
                also remove all analytics data for this offer. This action
                cannot be undone.
              </s-paragraph>
            </s-stack>
          )}
        </s-stack>
        <s-button
          variant="primary" slot="primary-action"
          tone="critical"
          onClick={() => {
            if (deleteId) {
              fetcher.submit(
                { intent: "delete", offerId: deleteId },
                { method: "POST" },
              );
              deleteModalRef.current?.hideOverlay();
            }
          }}
        >
          Delete offer
        </s-button>
        <s-button
          slot="secondary-action"
          onClick={() => deleteModalRef.current?.hideOverlay()}
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

function OfferRow({
  offer,
  fetcher,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  offer: OfferSummary;
  fetcher: ReturnType<typeof useFetcher>;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const discountLabel =
    offer.discountType === "percentage"
      ? `${offer.discountValue}% off`
      : `$${offer.discountValue} off`;

  const handleToggle = useCallback(() => {
    fetcher.submit(
      {
        intent: "toggle",
        offerId: offer.id,
        enabled: offer.enabled ? "false" : "true",
      },
      { method: "POST" },
    );
  }, [fetcher, offer.id, offer.enabled]);

  return (
    <s-table-row>
      {/* Offer info with thumbnail */}
      <s-table-cell>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          {offer.productImage ? (
            <s-thumbnail
              src={offer.productImage}
              alt={offer.productTitle}
              size="small-200"
            />
          ) : (
            <s-box
              padding="small-200"
              borderRadius="base"
              background="subdued"
            >
              <s-icon type="product" color="subdued" size="small" />
            </s-box>
          )}
          <s-stack gap="small-100">
            <s-text type="strong">{offer.title}</s-text>
            <s-text color="subdued">{offer.productTitle}</s-text>
          </s-stack>
        </s-stack>
      </s-table-cell>

      {/* Status */}
      <s-table-cell>
        <s-stack gap="small-100">
          <s-stack direction="inline" gap="small-100">
            <s-switch
              checked={offer.enabled}
              onChange={handleToggle}
              label={offer.enabled ? "Active" : "Off"}
              labelAccessibilityVisibility="exclusive"
            />
            <s-badge tone={offer.enabled ? "success" : "neutral"}>
              {offer.enabled ? "Active" : "Off"}
            </s-badge>
          </s-stack>
          {offer.testMode && (
            <s-badge tone="info" icon="sandbox" size="base">
              Test
            </s-badge>
          )}
        </s-stack>
      </s-table-cell>

      {/* Discount */}
      <s-table-cell>
        <s-badge tone="success" icon="discount">
          {discountLabel}
        </s-badge>
      </s-table-cell>

      {/* Metrics */}
      <s-table-cell>
        <s-text fontVariantNumeric="tabular-nums">{offer.views}</s-text>
      </s-table-cell>
      <s-table-cell>
        <s-text fontVariantNumeric="tabular-nums">{offer.accepts}</s-text>
      </s-table-cell>
      <s-table-cell>
        <s-text fontVariantNumeric="tabular-nums">
          {offer.conversionRate}%
        </s-text>
      </s-table-cell>
      <s-table-cell>
        <s-text type="strong" fontVariantNumeric="tabular-nums">
          ${offer.revenue.toFixed(2)}
        </s-text>
      </s-table-cell>

      {/* Actions */}
      <s-table-cell>
        <s-stack direction="inline" gap="small-200">
          <s-button
            onClick={onEdit}
            variant="tertiary"
            icon="edit"
            accessibilityLabel="Edit offer"
          />
          <s-button
            onClick={onDuplicate}
            variant="tertiary"
            icon="duplicate"
            accessibilityLabel="Duplicate offer"
          />
          <s-button
            onClick={onDelete}
            variant="tertiary"
            tone="critical"
            icon="delete"
            accessibilityLabel="Delete offer"
          />
        </s-stack>
      </s-table-cell>
    </s-table-row>
  );
}

export const headers = (headersArgs: HeadersArgs) => {
  return boundary.headers(headersArgs);
};
