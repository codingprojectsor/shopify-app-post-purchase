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
    // Fetch products from store and create demo offers
    const { admin } = await authenticate.admin(request);
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
    const products =
      data.data?.products?.edges?.map((e: any) => e.node) || [];

    if (products.length < 2) {
      return { error: "Need at least 2 products in your store" };
    }

    const configs = [
      { type: "percentage", value: 15, title: "Complete Your Look", cta: "Yes, Add This!", min: 5 },
      { type: "percentage", value: 20, title: "Exclusive Bundle Deal", cta: "Grab This Deal!", min: 3 },
      { type: "fixed", value: 5, title: "Add This & Save", cta: "Add to Order", min: null },
      { type: "percentage", value: 25, title: "VIP Customer Offer", cta: "Claim Now!", min: 10 },
      { type: "percentage", value: 10, title: "Don't Miss This", cta: "Yes Please!", min: 2 },
      { type: "fixed", value: 10, title: "Special Thank-You Discount", cta: "Add & Save", min: 5 },
      { type: "percentage", value: 30, title: "Flash Sale - Just For You", cta: "Get 30% Off!", min: 1 },
      { type: "percentage", value: 15, title: "Customers Also Bought", cta: "Add to My Order", min: null },
      { type: "fixed", value: 3, title: "Try Something New", cta: "Sure, Add It!", min: null },
      { type: "percentage", value: 20, title: "Last Chance Offer", cta: "Claim Discount!", min: 2 },
    ];

    const ids: string[] = [];
    for (let i = 0; i < Math.min(products.length, 10); i++) {
      const p = products[i];
      const v = p.variants.edges[0]?.node;
      const c = configs[i % configs.length];

      const offer = await db.upsellOffer.create({
        data: {
          shop: session.shop,
          title: c.title,
          description: `Get ${p.title} at a special price — only available right now!`,
          ctaText: c.cta,
          productId: p.id,
          variantId: v?.id || "",
          productTitle: p.title,
          productImage: p.featuredMedia?.preview?.image?.url || null,
          productPrice: v?.price || "0.00",
          discountType: c.type,
          discountValue: c.value,
          timeLimitMinutes: c.min,
          status: "active",
          testMode: false,
          priority: 10 - i,
        },
      });
      ids.push(offer.id);
    }

    // Set up funnel: first → second
    if (ids.length >= 2) {
      await db.upsellOffer.update({
        where: { id: ids[0] },
        data: { fallbackOfferId: ids[1] },
      });
    }

    // Seed widgets
    const widgetTypes = ["upsell", "social_share", "survey", "reorder", "custom_message"];
    for (let i = 0; i < widgetTypes.length; i++) {
      await db.widgetConfig.upsert({
        where: { shop_widgetType: { shop: session.shop, widgetType: widgetTypes[i] } },
        update: { enabled: true, position: i },
        create: { shop: session.shop, widgetType: widgetTypes[i], enabled: true, position: i },
      });
    }

    // Seed social share settings
    await db.widgetConfig.update({
      where: { shop_widgetType: { shop: session.shop, widgetType: "social_share" } },
      data: {
        settings: JSON.stringify({
          shareMessage: "I just bought something awesome! Check this store out:",
          twitterUrl: "",
          facebookUrl: "",
          whatsappNumber: "",
        }),
      },
    });

    // Seed survey questions
    const existingQuestions = await db.surveyQuestion.count({ where: { shop: session.shop } });
    if (existingQuestions === 0) {
      await db.surveyQuestion.createMany({
        data: [
          { shop: session.shop, question: "How was your checkout experience?", questionType: "rating", position: 0 },
          { shop: session.shop, question: "How did you hear about us?", questionType: "multiple_choice", options: JSON.stringify(["Social media", "Friend", "Google search", "Ad", "Other"]), position: 1 },
          { shop: session.shop, question: "Any feedback for us?", questionType: "text", position: 2 },
        ],
      });
    }

    // Seed branding
    await db.brandingConfig.upsert({
      where: { shop: session.shop },
      update: {},
      create: {
        shop: session.shop,
        showTrustBadges: true,
        customMessage: "Thank you for your purchase! Here's a special offer just for you.",
      },
    });

    return { success: true, seeded: ids.length };
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
