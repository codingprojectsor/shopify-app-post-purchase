import { useLoaderData, useFetcher, useNavigate, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type {
  ActionFunctionArgs,
  HeadersArgs,
  LoaderFunctionArgs,
} from "react-router";
import { useCallback, useRef, useState } from "react";
import { useDebounceSearch } from "../hooks/useDebounceSearch";
import { useToast } from "../hooks/useToast";
import { StatsCard } from "../components/StatsCard";
import { PageLoading } from "../components/PageLoading";
import { EmptyState } from "../components/EmptyState";
import { OfferRow } from "../components/OfferRow";
import type { OfferSummary, DashboardStats } from "../types/offers";
import { formatPrice } from "../utils/format";
import { useShopCurrency } from "../hooks/useShopCurrency";
import { usePlanLimits } from "../hooks/usePlanLimits";

const PAGE_SIZE = 10;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const search = url.searchParams.get("search") || "";
  const statusFilter = url.searchParams.get("status") || "all";
  const discountFilter = url.searchParams.get("discount") || "all";
  const sort = url.searchParams.get("sort") || "priority";

  // Build where clause with filters
  const where: any = { shop: session.shop };

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { productTitle: { contains: search, mode: "insensitive" } },
    ];
  }

  if (statusFilter !== "all") {
    where.status = statusFilter;
  }

  if (discountFilter !== "all") {
    where.discountType = discountFilter;
  }

  // Get total count for pagination
  const totalCount = await db.upsellOffer.count({ where });

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Sort mapping
  const orderBy: any =
    sort === "newest" ? { createdAt: "desc" }
    : sort === "revenue" ? { priority: "desc" } // revenue sort done post-query
    : { priority: "desc" };

  // Paginated offers
  const offers = await db.upsellOffer.findMany({
    where,
    orderBy,
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

  // Sort by revenue post-query if needed
  if (sort === "revenue") {
    offersWithStats.sort((a, b) => b.revenue - a.revenue);
  }

  return { offers: offersWithStats, stats, page, totalPages, totalCount, search, statusFilter, discountFilter, sort };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle") {
    const offerId = formData.get("offerId") as string;
    const enabled = formData.get("enabled") === "true";

    // If activating, check plan limit
    if (enabled) {
      const { getActivePlanLimits } = await import("../utils/billing.server");
      const limits = await getActivePlanLimits(session.shop);
      if (limits.maxOffers !== -1) {
        const activeCount = await db.upsellOffer.count({ where: { shop: session.shop, status: "active" } });
        if (activeCount >= limits.maxOffers) {
          return { error: `Offer limit reached (${limits.maxOffers}). Upgrade your plan to activate more offers.` };
        }
      }
    }

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

    // Get plan limits to respect features
    const { getActivePlanLimits } = await import("../utils/billing.server");
    const limits = await getActivePlanLimits(shop);

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

    if (products.length < 2) {
      return { error: "Need at least 2 products in your store" };
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

    // Respect max offers limit
    const existingActive = await db.upsellOffer.count({ where: { shop, status: "active" } });
    const maxNew = limits.maxOffers === -1 ? 10 : Math.max(0, limits.maxOffers - existingActive);

    if (maxNew === 0) {
      return { error: `You've reached your plan limit of ${limits.maxOffers} active offers` };
    }

    const createdOffers: string[] = [];
    let seededCount = 0;

    // Always create: basic offers (up to plan limit)
    const p0 = gp(0);
    const offer1 = await db.upsellOffer.create({
      data: { shop, title: "VIP Customer Offer", description: `Get ${p0.title} at a special price!`, ctaText: "Claim Now!", productId: p0.id, variantId: p0.variantId, productTitle: p0.title, productImage: p0.image, productPrice: p0.price, discountType: "percentage", discountValue: 25, timeLimitMinutes: limits.scheduledOffers ? 5 : null, status: seededCount < maxNew ? "active" : "draft", priority: 10 },
    });
    createdOffers.push(offer1.id);
    if (seededCount < maxNew) seededCount++;

    const p1 = gp(1);
    const offer2 = await db.upsellOffer.create({
      data: { shop, title: "Thank-You Discount", description: `Add ${p1.title} to your order and save!`, ctaText: "Add & Save", productId: p1.id, variantId: p1.variantId, productTitle: p1.title, productImage: p1.image, productPrice: p1.price, discountType: "fixed", discountValue: 10, timeLimitMinutes: null, status: seededCount < maxNew ? "active" : "draft", priority: 5 },
    });
    createdOffers.push(offer2.id);
    if (seededCount < maxNew) seededCount++;

    // Targeting rules (always available)
    await db.targetingRule.createMany({
      data: [
        { offerId: offer1.id, ruleType: "cart_value", operator: "greater_than", value: "50" },
        { offerId: offer2.id, ruleType: "quantity", operator: "greater_than", value: "1" },
      ],
    });

    // A/B Test — only if plan allows
    if (limits.abTesting && products.length >= 4) {
      const abTest = await db.aBTest.create({
        data: { shop, name: "CTA Style Test", description: "Testing urgency vs benefit CTA", status: "running", splitPercent: 50, startedAt: new Date() },
      });
      const p3 = gp(2);
      const offerA = await db.upsellOffer.create({
        data: { shop, title: "Complete Your Look", description: `${p3.title} pairs perfectly.`, ctaText: "Yes, Add This!", productId: p3.id, variantId: p3.variantId, productTitle: p3.title, productImage: p3.image, productPrice: p3.price, discountType: "percentage", discountValue: 15, status: seededCount < maxNew ? "active" : "draft", priority: 7, abTestId: abTest.id },
      });
      createdOffers.push(offerA.id);
      if (seededCount < maxNew) seededCount++;

      const p4 = gp(3);
      await db.upsellOffer.create({
        data: { shop, title: "Bundle Deal", description: `Save when you add ${p4.title}!`, ctaText: "Grab Deal!", productId: p4.id, variantId: p4.variantId, productTitle: p4.title, productImage: p4.image, productPrice: p4.price, discountType: "fixed", discountValue: 5, status: seededCount < maxNew ? "active" : "draft", priority: 6, abTestId: abTest.id },
      });
      if (seededCount < maxNew) seededCount++;
    }

    // Funnel chaining — only if plan allows
    if (limits.funnelChaining) {
      await db.upsellOffer.update({ where: { id: offer1.id }, data: { fallbackOfferId: offer2.id } });
    }

    // Scheduled offer — only if plan allows
    if (limits.scheduledOffers && products.length >= 5) {
      const p5 = gp(4);
      const tmrw = new Date(); tmrw.setDate(tmrw.getDate() + 1);
      const nxtWk = new Date(); nxtWk.setDate(nxtWk.getDate() + 7);
      await db.upsellOffer.create({
        data: { shop, title: "Weekend Special", description: "Available this weekend only!", ctaText: "Get Weekend Deal!", productId: p5.id, variantId: p5.variantId, productTitle: p5.title, productImage: p5.image, productPrice: p5.price, discountType: "percentage", discountValue: 20, timeLimitMinutes: 10, status: "active", priority: 5, scheduledStart: tmrw, scheduledEnd: nxtWk },
      });
      seededCount++;
    }

    // Widgets & branding — only if plan allows
    if (limits.customBranding) {
      const widgetTypes = ["upsell", "social_share", "survey", "reorder", "custom_message"];
      for (let i = 0; i < widgetTypes.length; i++) {
        await db.widgetConfig.upsert({
          where: { shop_widgetType: { shop, widgetType: widgetTypes[i] } },
          update: { enabled: i < 4, position: i },
          create: { shop, widgetType: widgetTypes[i], enabled: i < 4, position: i, settings: widgetTypes[i] === "social_share" ? JSON.stringify({ shareMessage: "I just got an amazing deal!" }) : "{}" },
        });
      }
      await db.brandingConfig.upsert({
        where: { shop },
        update: {},
        create: { shop, primaryColor: "#2563eb", accentColor: "#16a34a", buttonStyle: "rounded", showTrustBadges: true, customMessage: "Thank you for your purchase!" },
      });
    }

    // Analytics events — only if plan allows
    if (limits.analytics && createdOffers.length > 0) {
      const evTypes = ["view", "accept", "decline"];
      const evData = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(); d.setDate(d.getDate() - Math.floor(Math.random() * 14));
        const et = evTypes[Math.floor(Math.random() * 3)];
        evData.push({
          shop,
          offerId: createdOffers[i % createdOffers.length],
          eventType: et,
          revenue: et === "accept" ? Math.round(Math.random() * 100 * 100) / 100 : null,
          funnelStep: 1,
          createdAt: d,
        });
      }
      await db.analyticsEvent.createMany({ data: evData });
    }

    return { success: true, seeded: seededCount };
  }

  return { success: false };
};

export default function OffersIndex() {
  const { offers, stats, page, totalPages, totalCount, search, statusFilter, discountFilter, sort } =
    useLoaderData<typeof loader>();
  const currency = useShopCurrency();
  const { limits, currentPlan, canCreateOffer } = usePlanLimits();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isFiltering = navigation.state === "loading" && navigation.location?.pathname === "/app";
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteModalRef = useRef<any>(null);

  const buildUrl = useCallback(
    (params: Record<string, string>) => {
      const p = new URLSearchParams();
      const merged = { search, status: statusFilter, discount: discountFilter, sort, page: String(page), ...params };
      if (merged.search) p.set("search", merged.search);
      if (merged.status !== "all") p.set("status", merged.status);
      if (merged.discount !== "all") p.set("discount", merged.discount);
      if (merged.sort !== "priority") p.set("sort", merged.sort);
      if ("search" in params || "status" in params || "discount" in params || "sort" in params) {
        // Reset to page 1 on filter change
      } else if (merged.page !== "1") {
        p.set("page", merged.page);
      }
      const qs = p.toString();
      return `/app${qs ? `?${qs}` : ""}`;
    },
    [search, statusFilter, discountFilter, sort, page],
  );

  const { searchInput, setSearchInput, handleSearchChange } = useDebounceSearch(
    search,
    (value) => navigate(buildUrl({ search: value })),
  );

  useToast(fetcher, {
    deleted: "Offer deleted successfully",
    toggled: "Offer updated",
    duplicated: "Offer duplicated",
    seeded: (data: any) => `${data.seeded} demo offers created!`,
    error: (data: any) => data.error,
  }, () => setDeleteId(null));

  const hasActiveFilters = search || statusFilter !== "all" || discountFilter !== "all";

  // Empty state — no offers at all (not filtered)
  if (offers.length === 0 && !hasActiveFilters && stats.totalOffers === 0) {
    return (
      <s-page heading="Post-Purchase Upsells">
        <s-button
          variant="primary" slot="primary-action"
          onClick={() => navigate("/app/offers/new")}
        >
          Create offer
        </s-button>

        <s-section>
          <EmptyState
            icon="rocket"
            heading="Start boosting your revenue today"
            description="Create your first post-purchase upsell offer. Show targeted product offers on the thank-you page — customers can add items with one click, no re-entering payment details needed."
            features={[
              { icon: "cart-sale", label: "One-click upsells" },
              { icon: "target", label: "Smart targeting" },
              { icon: "chart-line", label: "Built-in analytics" },
            ]}
          >
            <s-stack direction="inline" gap="base">
              <s-button onClick={() => navigate("/app/offers/new")}>
                Create your first offer
              </s-button>
              <s-button
                variant="secondary"
                icon="wand"
                accessibilityLabel="Generate demo data"
                loading={fetcher.state !== "idle" || undefined}
                onClick={() => fetcher.submit({ intent: "seed" }, { method: "POST" })}
              >
                Auto-generate demo offers
              </s-button>
            </s-stack>
          </EmptyState>
        </s-section>
      </s-page>
    );
  }

  const deleteOffer = offers.find((o) => o.id === deleteId);

  return (
    <s-page heading="Post-Purchase Upsells">
      <s-button
        variant="primary" slot="primary-action"
        onClick={() => canCreateOffer ? navigate("/app/offers/new") : navigate("/app/pricing")}
        icon="plus"
      >
        {canCreateOffer ? "Create offer" : "Upgrade to add more"}
      </s-button>

      {/* Plan limit warning */}
      {!canCreateOffer && (
        <s-section>
          <s-banner tone="warning">
            <s-text>
              You've reached the limit of {limits.maxOffers} active offers on the {currentPlan} plan.
              <s-link href="/app/pricing"> Upgrade your plan</s-link> to create more offers.
            </s-text>
          </s-banner>
        </s-section>
      )}

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
            <StatsCard icon="cash-dollar" label="Revenue" value={formatPrice(stats.totalRevenue, currency)} subtitle="from upsells" />
          </s-grid-item>
          <s-grid-item>
            <StatsCard icon="chart-funnel" label="Conversion" value={`${stats.overallConversion}%`} subtitle={`${stats.totalAccepts} of ${stats.totalViews} views`} />
          </s-grid-item>
          <s-grid-item>
            <StatsCard icon="status-active" label="Active" value={`${stats.activeOffers} / ${stats.totalOffers}`} subtitle="offers running" />
          </s-grid-item>
          <s-grid-item>
            <StatsCard icon="check-circle" label="Accepts" value={String(stats.totalAccepts)} subtitle="orders upsold" />
          </s-grid-item>
        </s-grid>
      </s-section>

      {/* Search & Filters */}
      <s-section>
        <s-box borderWidth="base" borderRadius="large" overflow="hidden">
          {/* Search + filters in a grid */}
          <s-box padding="base">
            <s-grid gridTemplateColumns="2fr 1fr 1fr 1fr" gap="base">
              <s-grid-item>
                <s-text-field
                  label="Search"
                  placeholder="Search offers..."
                  value={searchInput}
                  onInput={(e: any) => handleSearchChange(e.target.value)}
                />
              </s-grid-item>
              <s-grid-item>
                <s-select
                  label="Status"
                  value={statusFilter}
                  onChange={(e: any) => navigate(buildUrl({ status: e.target.value }))}
                >
                  <s-option value="all">All statuses</s-option>
                  <s-option value="active">Active</s-option>
                  <s-option value="paused">Paused</s-option>
                  <s-option value="draft">Draft</s-option>
                </s-select>
              </s-grid-item>
              <s-grid-item>
                <s-select
                  label="Discount"
                  value={discountFilter}
                  onChange={(e: any) => navigate(buildUrl({ discount: e.target.value }))}
                >
                  <s-option value="all">All discounts</s-option>
                  <s-option value="percentage">Percentage</s-option>
                  <s-option value="fixed">Fixed amount</s-option>
                </s-select>
              </s-grid-item>
              <s-grid-item>
                <s-select
                  label="Sort by"
                  value={sort}
                  onChange={(e: any) => navigate(buildUrl({ sort: e.target.value }))}
                >
                  <s-option value="priority">Priority</s-option>
                  <s-option value="newest">Newest first</s-option>
                  <s-option value="revenue">Top revenue</s-option>
                </s-select>
              </s-grid-item>
            </s-grid>
          </s-box>

          {/* Active filters row */}
          {hasActiveFilters && (
            <s-box padding="small-200">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text color="subdued">
                  {totalCount} {totalCount === 1 ? "result" : "results"}
                </s-text>
                {search && (
                  <s-badge tone="info">Search: {search}</s-badge>
                )}
                {statusFilter !== "all" && (
                  <s-badge tone="info">{statusFilter}</s-badge>
                )}
                {discountFilter !== "all" && (
                  <s-badge tone="info">{discountFilter}</s-badge>
                )}
                <s-button
                  variant="tertiary"
                  onClick={() => {
                    setSearchInput("");
                    navigate("/app");
                  }}
                >
                  Clear all
                </s-button>
              </s-stack>
            </s-box>
          )}

          {/* Table or Loading */}
          {isFiltering ? (
            <PageLoading text="Loading offers..." />
          ) : (
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
              {offers.length === 0 ? (
                <s-table-row>
                  <s-table-cell>
                    <s-box padding="large-200">
                      <s-stack gap="base" alignItems="center">
                        <s-icon type="search" color="subdued" />
                        <s-text color="subdued">No offers match your filters</s-text>
                        <s-button
                          variant="tertiary"
                          onClick={() => {
                            setSearchInput("");
                            navigate("/app");
                          }}
                        >
                          Clear all filters
                        </s-button>
                      </s-stack>
                    </s-box>
                  </s-table-cell>
                </s-table-row>
              ) : (
                offers.map((offer) => (
                  <OfferRow
                    key={offer.id}
                    offer={offer}
                    currency={currency}
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
                ))
              )}
            </s-table-body>
          </s-table>
          )}
        </s-box>
      </s-section>

      {/* Pagination */}
      {totalPages > 1 && (
        <s-section>
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="center">
            <s-button
              variant="tertiary"
              icon="chevron-left"
              disabled={page <= 1 || undefined}
              onClick={() => navigate(buildUrl({ page: String(page - 1) }))}
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
              onClick={() => navigate(buildUrl({ page: String(page + 1) }))}
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


export const headers = (headersArgs: HeadersArgs) => {
  return boundary.headers(headersArgs);
};
