import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { HeadersArgs, LoaderFunctionArgs } from "react-router";

const OFFERS_PER_PAGE = 10;

interface OfferAnalytics {
  id: string;
  title: string;
  productTitle: string;
  enabled: boolean;
  views: number;
  accepts: number;
  declines: number;
  revenue: number;
  conversionRate: number;
}

interface DailyData {
  date: string;
  views: number;
  accepts: number;
  revenue: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const days = Math.min(365, Math.max(7, parseInt(url.searchParams.get("days") || "30", 10)));

  // Total offers count
  const totalOffers = await db.upsellOffer.count({
    where: { shop: session.shop },
  });
  const totalPages = Math.max(1, Math.ceil(totalOffers / OFFERS_PER_PAGE));

  // Paginated offers for the per-offer table
  const paginatedOffers = await db.upsellOffer.findMany({
    where: { shop: session.shop },
    skip: (page - 1) * OFFERS_PER_PAGE,
    take: OFFERS_PER_PAGE,
    include: {
      analyticsEvents: {
        select: { eventType: true, revenue: true },
      },
    },
  });

  const offerAnalytics: OfferAnalytics[] = paginatedOffers.map((offer) => {
    const views = offer.analyticsEvents.filter((e) => e.eventType === "view").length;
    const accepts = offer.analyticsEvents.filter((e) => e.eventType === "accept").length;
    const declines = offer.analyticsEvents.filter((e) => e.eventType === "decline").length;
    const revenue = offer.analyticsEvents
      .filter((e) => e.eventType === "accept" && e.revenue)
      .reduce((sum, e) => sum + (e.revenue || 0), 0);

    return {
      id: offer.id,
      title: offer.title,
      productTitle: offer.productTitle,
      enabled: offer.status === "active",
      views,
      accepts,
      declines,
      revenue,
      conversionRate: views > 0 ? Math.round((accepts / views) * 100) : 0,
    };
  });

  // All events for totals + daily breakdown (not paginated)
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const allEvents = await db.analyticsEvent.findMany({
    where: { shop: session.shop, createdAt: { gte: startDate } },
    select: { eventType: true, revenue: true, createdAt: true },
  });

  const dailyMap = new Map<string, DailyData>();
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dailyMap.set(key, { date: key, views: 0, accepts: 0, revenue: 0 });
  }

  for (const event of allEvents) {
    const key = new Date(event.createdAt).toISOString().slice(0, 10);
    const day = dailyMap.get(key);
    if (!day) continue;
    if (event.eventType === "view") day.views++;
    if (event.eventType === "accept") {
      day.accepts++;
      day.revenue += event.revenue || 0;
    }
  }

  const dailyData = Array.from(dailyMap.values()).reverse();

  const totalViews = allEvents.filter((e) => e.eventType === "view").length;
  const totalAccepts = allEvents.filter((e) => e.eventType === "accept").length;
  const totalDeclines = allEvents.filter((e) => e.eventType === "decline").length;
  const totalRevenue = allEvents
    .filter((e) => e.eventType === "accept" && e.revenue)
    .reduce((sum, e) => sum + (e.revenue || 0), 0);

  return {
    offerAnalytics,
    dailyData,
    totals: {
      views: totalViews,
      accepts: totalAccepts,
      declines: totalDeclines,
      revenue: totalRevenue,
      conversion:
        totalViews > 0 ? Math.round((totalAccepts / totalViews) * 100) : 0,
    },
    page,
    totalPages,
    totalOffers,
    days,
  };
};

export default function Analytics() {
  const { offerAnalytics, dailyData, totals, page, totalPages, totalOffers, days } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const changeDays = (d: number) => navigate(`/app/analytics?days=${d}`);

  const peakDay = dailyData.reduce(
    (best, d) => (d.revenue > best.revenue ? d : best),
    dailyData[0] || { date: "-", revenue: 0, views: 0, accepts: 0 },
  );

  return (
    <s-page heading="Analytics">
      {/* Breadcrumb */}
      <s-box paddingBlockEnd="base">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-link href="/app">
            <s-icon type="arrow-left" size="small" />
          </s-link>
          <s-link href="/app">Offers</s-link>
          <s-text color="subdued">/</s-text>
          <s-text color="subdued">Analytics</s-text>
        </s-stack>
      </s-box>

      {/* Date Range + Export */}
      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-icon type="calendar" color="subdued" size="small" />
            <s-text type="strong">Date Range:</s-text>
          </s-stack>
          <s-button
            variant={days === 7 ? "primary" : "secondary"}
            onClick={() => changeDays(7)}
          >
            7 days
          </s-button>
          <s-button
            variant={days === 30 ? "primary" : "secondary"}
            onClick={() => changeDays(30)}
          >
            30 days
          </s-button>
          <s-button
            variant={days === 90 ? "primary" : "secondary"}
            onClick={() => changeDays(90)}
          >
            90 days
          </s-button>
          <s-button
            variant={days === 365 ? "primary" : "secondary"}
            onClick={() => changeDays(365)}
          >
            1 year
          </s-button>

          <s-button
            variant="tertiary"
            icon="export"
            href={`/api/analytics/export?type=offers`}
            target="_blank"
          >
            Export Offers CSV
          </s-button>
          <s-button
            variant="tertiary"
            icon="export"
            href={`/api/analytics/export?type=daily&days=${days}`}
            target="_blank"
          >
            Export Daily CSV
          </s-button>
        </s-stack>
      </s-section>

      {/* Summary Cards */}
      <s-section>
        <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr 1fr" gap="base">
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="large">
              <s-stack gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="cash-dollar" color="subdued" size="small" />
                  <s-text color="subdued">Revenue</s-text>
                </s-stack>
                <s-text type="strong" fontVariantNumeric="tabular-nums">
                  ${totals.revenue.toFixed(2)}
                </s-text>
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
                  {totals.conversion}%
                </s-text>
              </s-stack>
            </s-box>
          </s-grid-item>
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="large">
              <s-stack gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="view" color="subdued" size="small" />
                  <s-text color="subdued">Views</s-text>
                </s-stack>
                <s-text type="strong" fontVariantNumeric="tabular-nums">
                  {totals.views}
                </s-text>
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
                  {totals.accepts}
                </s-text>
              </s-stack>
            </s-box>
          </s-grid-item>
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="large">
              <s-stack gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="x-circle" color="subdued" size="small" />
                  <s-text color="subdued">Declines</s-text>
                </s-stack>
                <s-text type="strong" fontVariantNumeric="tabular-nums">
                  {totals.declines}
                </s-text>
              </s-stack>
            </s-box>
          </s-grid-item>
        </s-grid>
      </s-section>

      {/* Conversion Funnel */}
      <s-section heading="Conversion Funnel">
        <s-box padding="base" borderWidth="base" borderRadius="large">
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon type="chart-funnel" color="subdued" size="small" />
              <s-text type="strong">Funnel Breakdown</s-text>
            </s-stack>
            <s-divider />
            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
              <s-grid-item>
                <s-box padding="base" borderWidth="base" borderRadius="large">
                  <s-stack gap="small-200" alignItems="center">
                    <s-icon type="view" color="subdued" />
                    <s-text type="strong" fontVariantNumeric="tabular-nums">
                      {totals.views}
                    </s-text>
                    <s-text color="subdued">Views</s-text>
                    <s-badge tone="info">100%</s-badge>
                  </s-stack>
                </s-box>
              </s-grid-item>
              <s-grid-item>
                <s-box padding="base" borderWidth="base" borderRadius="large">
                  <s-stack gap="small-200" alignItems="center">
                    <s-icon type="check-circle" color="subdued" />
                    <s-text type="strong" fontVariantNumeric="tabular-nums">
                      {totals.accepts}
                    </s-text>
                    <s-text color="subdued">Accepts</s-text>
                    <s-badge tone="success">
                      {totals.views > 0
                        ? Math.round((totals.accepts / totals.views) * 100)
                        : 0}
                      %
                    </s-badge>
                  </s-stack>
                </s-box>
              </s-grid-item>
              <s-grid-item>
                <s-box padding="base" borderWidth="base" borderRadius="large">
                  <s-stack gap="small-200" alignItems="center">
                    <s-icon type="x-circle" color="subdued" />
                    <s-text type="strong" fontVariantNumeric="tabular-nums">
                      {totals.declines}
                    </s-text>
                    <s-text color="subdued">Declines</s-text>
                    <s-badge tone="critical">
                      {totals.views > 0
                        ? Math.round((totals.declines / totals.views) * 100)
                        : 0}
                      %
                    </s-badge>
                  </s-stack>
                </s-box>
              </s-grid-item>
            </s-grid>
          </s-stack>
        </s-box>
      </s-section>

      {/* Daily Trend */}
      <s-section heading={`Last ${days} Days` as Lowercase<string>}>
        <s-box padding="base" borderWidth="base" borderRadius="large">
          <s-stack gap="base">
            <s-text color="subdued">
              Peak day: {peakDay.date} (${peakDay.revenue.toFixed(2)} revenue, {peakDay.accepts} accepts)
            </s-text>
            <s-table>
              <s-table-header-row>
                <s-table-header>Date</s-table-header>
                <s-table-header>Views</s-table-header>
                <s-table-header>Accepts</s-table-header>
                <s-table-header>Revenue</s-table-header>
                <s-table-header>Conv.</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {dailyData
                  .filter((d) => d.views > 0 || d.accepts > 0)
                  .slice(-14)
                  .reverse()
                  .map((day) => (
                    <s-table-row key={day.date}>
                      <s-table-cell>{day.date}</s-table-cell>
                      <s-table-cell>{day.views}</s-table-cell>
                      <s-table-cell>{day.accepts}</s-table-cell>
                      <s-table-cell>${day.revenue.toFixed(2)}</s-table-cell>
                      <s-table-cell>
                        {day.views > 0
                          ? Math.round((day.accepts / day.views) * 100)
                          : 0}
                        %
                      </s-table-cell>
                    </s-table-row>
                  ))}
              </s-table-body>
            </s-table>
            {dailyData.every((d) => d.views === 0 && d.accepts === 0) && (
              <s-box padding="base">
                <s-stack gap="base" alignItems="center">
                  <s-icon type="chart-line" color="subdued" />
                  <s-text color="subdued">
                    No activity in the last 30 days. Enable offers to start tracking.
                  </s-text>
                </s-stack>
              </s-box>
            )}
          </s-stack>
        </s-box>
      </s-section>

      {/* Per-Offer Breakdown (Paginated) */}
      <s-section heading="Per-Offer Performance">
        {offerAnalytics.length === 0 && page === 1 ? (
          <s-box padding="base">
            <s-stack gap="base" alignItems="center">
              <s-icon type="target" color="subdued" />
              <s-text color="subdued">No offers yet. Create your first offer to see performance data.</s-text>
            </s-stack>
          </s-box>
        ) : (
          <s-stack gap="base">
            <s-table>
              <s-table-header-row>
                <s-table-header>Offer</s-table-header>
                <s-table-header>Product</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Views</s-table-header>
                <s-table-header>Accepts</s-table-header>
                <s-table-header>Conv.</s-table-header>
                <s-table-header>Revenue</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {offerAnalytics.map((offer) => (
                  <s-table-row key={offer.id}>
                    <s-table-cell>
                      <s-text type="strong">{offer.title}</s-text>
                    </s-table-cell>
                    <s-table-cell>{offer.productTitle}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={offer.enabled ? "success" : "neutral"}>
                        {offer.enabled ? "Active" : "Off"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>{offer.views}</s-table-cell>
                    <s-table-cell>{offer.accepts}</s-table-cell>
                    <s-table-cell>{offer.conversionRate}%</s-table-cell>
                    <s-table-cell>${offer.revenue.toFixed(2)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>

            {totalPages > 1 && (
              <s-stack direction="inline" gap="base" alignItems="center" justifyContent="center">
                <s-button
                  variant="tertiary"
                  icon="chevron-left"
                  disabled={page <= 1 || undefined}
                  onClick={() => navigate(`/app/analytics?page=${page - 1}`)}
                >
                  Previous
                </s-button>
                <s-text color="subdued">
                  Page {page} of {totalPages} ({totalOffers} offers)
                </s-text>
                <s-button
                  variant="tertiary"
                  icon="chevron-right"
                  disabled={page >= totalPages || undefined}
                  onClick={() => navigate(`/app/analytics?page=${page + 1}`)}
                >
                  Next
                </s-button>
              </s-stack>
            )}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs: HeadersArgs) => {
  return boundary.headers(headersArgs);
};
