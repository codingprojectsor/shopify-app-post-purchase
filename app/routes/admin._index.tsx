import { useLoaderData, useNavigate, useNavigation } from "react-router";
import { useState, useCallback } from "react";
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import {
  Page, Layout, Card, Text, IndexTable, IndexFilters, useSetIndexFiltersMode,
  BlockStack, InlineStack, Pagination, ProgressBar, Badge, Divider,
} from "@shopify/polaris";
import type { IndexFiltersProps, TabProps } from "@shopify/polaris";
import { AdminPageLoading } from "../components/AdminPageLoading";
import { formatPrice } from "../utils/format";
import { convertToUSD } from "../utils/exchange-rates.server";

const PAGE_SIZE = 20;

interface ShopSummary {
  shop: string;
  totalOffers: number;
  activeOffers: number;
  totalViews: number;
  totalAccepts: number;
  totalDeclines: number;
  totalRevenue: number; // converted to USD
  currency: string; // original shop currency
  conversionRate: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

  const allSessions = await db.session.findMany({ select: { shop: true }, distinct: ["shop"] });
  const totalShops = allSessions.length;
  const totalPages = Math.max(1, Math.ceil(totalShops / PAGE_SIZE));
  const paginatedShops = allSessions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Get all shop currencies from subscriptions
  const allSubs = await db.subscription.findMany({ select: { shop: true, currency: true } });
  const shopCurrencyMap: Record<string, string> = {};
  for (const sub of allSubs) shopCurrencyMap[sub.shop] = sub.currency;

  const shops: ShopSummary[] = [];
  for (const { shop } of paginatedShops) {
    const offers = await db.upsellOffer.findMany({
      where: { shop },
      include: { analyticsEvents: { select: { eventType: true, revenue: true } } },
    });
    const allEvents = offers.flatMap((o) => o.analyticsEvents);
    const views = allEvents.filter((e) => e.eventType === "view").length;
    const accepts = allEvents.filter((e) => e.eventType === "accept").length;
    const declines = allEvents.filter((e) => e.eventType === "decline").length;
    const rawRevenue = allEvents.filter((e) => e.eventType === "accept" && e.revenue).reduce((sum, e) => sum + (e.revenue || 0), 0);
    const shopCurrency = shopCurrencyMap[shop] || "USD";
    const revenueUSD = await convertToUSD(rawRevenue, shopCurrency);

    shops.push({
      shop, totalOffers: offers.length,
      activeOffers: offers.filter((o) => o.status === "active").length,
      totalViews: views, totalAccepts: accepts, totalDeclines: declines,
      totalRevenue: Math.round(revenueUSD * 100) / 100,
      currency: shopCurrency,
      conversionRate: views > 0 ? Math.round((accepts / views) * 100) : 0,
    });
  }

  // Global stats — convert all shop revenues to USD
  const allOfferCount = await db.upsellOffer.count();
  const activeOfferCount = await db.upsellOffer.count({ where: { status: "active" } });

  const allShopsList = await db.session.findMany({ select: { shop: true }, distinct: ["shop"] });
  let gViews = 0, gAccepts = 0, gRevenue = 0;
  for (const { shop } of allShopsList) {
    const events = await db.analyticsEvent.findMany({ where: { shop }, select: { eventType: true, revenue: true } });
    gViews += events.filter((e) => e.eventType === "view").length;
    gAccepts += events.filter((e) => e.eventType === "accept").length;
    const rawRev = events.filter((e) => e.eventType === "accept" && e.revenue).reduce((sum, e) => sum + (e.revenue || 0), 0);
    const cur = shopCurrencyMap[shop] || "USD";
    gRevenue += await convertToUSD(rawRev, cur);
  }
  gRevenue = Math.round(gRevenue * 100) / 100;

  return {
    shops, page, totalPages, totalShops,
    globalStats: {
      totalShops, totalOffers: allOfferCount, activeOffers: activeOfferCount,
      totalViews: gViews, totalAccepts: gAccepts, totalRevenue: gRevenue,
      overallConversion: gViews > 0 ? Math.round((gAccepts / gViews) * 100) : 0,
    },
  };
};

export default function AdminDashboard() {
  const { shops, globalStats, page, totalPages } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  const [queryValue, setQueryValue] = useState("");
  const { mode, setMode } = useSetIndexFiltersMode();
  const handleQueryChange = useCallback((value: string) => setQueryValue(value), []);
  const handleQueryClear = useCallback(() => setQueryValue(""), []);
  const handleFiltersClearAll = useCallback(() => setQueryValue(""), []);

  const filtered = queryValue
    ? (shops as ShopSummary[]).filter((s) => s.shop.toLowerCase().includes(queryValue.toLowerCase()))
    : (shops as ShopSummary[]);

  const stats = globalStats as typeof globalStats;
  const resourceName = { singular: "merchant", plural: "merchants" };

  const tabs: TabProps[] = [];

  return (
    <Page title="Platform Overview">
      <BlockStack gap="400">
        {/* Stats */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card><BlockStack gap="200"><Text variant="bodySm" as="p" tone="subdued">Merchants</Text><Text variant="headingXl" as="p">{String(stats.totalShops)}</Text></BlockStack></Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card><BlockStack gap="200"><Text variant="bodySm" as="p" tone="subdued">Active Offers</Text><Text variant="headingXl" as="p">{`${stats.activeOffers} / ${stats.totalOffers}`}</Text></BlockStack></Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card><BlockStack gap="200"><Text variant="bodySm" as="p" tone="subdued">Revenue</Text><Text variant="headingXl" as="p">{formatPrice(stats.totalRevenue)}</Text></BlockStack></Card>
          </Layout.Section>
        </Layout>

        {/* Conversion */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text variant="bodyMd" as="p" fontWeight="semibold">Platform Conversion</Text>
              <Text variant="headingLg" as="p">{`${stats.overallConversion}%`}</Text>
            </InlineStack>
            <ProgressBar progress={Math.min(100, stats.overallConversion)} size="small"
              tone={stats.overallConversion > 10 ? "success" : stats.overallConversion > 5 ? "highlight" : "critical"} />
            <Text variant="bodySm" as="p" tone="subdued">
              {`${stats.totalAccepts} accepts from ${stats.totalViews} views`}
            </Text>
          </BlockStack>
        </Card>

        {/* Merchants table */}
        <Card padding="0">
          <IndexFilters
            queryValue={queryValue}
            queryPlaceholder="Search merchants..."
            onQueryChange={handleQueryChange}
            onQueryClear={handleQueryClear}
            tabs={tabs}
            selected={0}
            onSelect={() => {}}
            filters={[]}
            onClearAll={handleFiltersClearAll}
            mode={mode}
            setMode={setMode}
            cancelAction={{ onAction: () => {} }}
          />
          {isLoading ? (
            <AdminPageLoading text="Loading merchants..." />
          ) : (
            <IndexTable
              resourceName={resourceName}
              itemCount={filtered.length}
              headings={[
                { title: "Shop" },
                { title: "Offers" },
                { title: "Active" },
                { title: "Views" },
                { title: "Accepts" },
                { title: "Conv." },
                { title: "Revenue" },
              ]}
              selectable={false}
            >
              {filtered.map((shop: ShopSummary, i: number) => (
                <IndexTable.Row id={shop.shop} key={shop.shop} position={i}>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" as="span" fontWeight="semibold">{shop.shop}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{String(shop.totalOffers)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={shop.activeOffers > 0 ? "success" : undefined}>
                      {String(shop.activeOffers)}
                    </Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{String(shop.totalViews)}</IndexTable.Cell>
                  <IndexTable.Cell>{String(shop.totalAccepts)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" as="span" fontWeight="semibold">{`${shop.conversionRate}%`}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Text variant="bodyMd" as="span" fontWeight="bold">{formatPrice(shop.totalRevenue)}</Text>
                      {shop.currency !== "USD" && (
                        <Text variant="bodySm" as="span" tone="subdued">{shop.currency}</Text>
                      )}
                    </BlockStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
          {totalPages > 1 && (
            <>
              <Divider />
              <div style={{ padding: "16px", display: "flex", justifyContent: "center" }}>
                <Pagination
                  hasPrevious={page > 1}
                  hasNext={page < totalPages}
                  onPrevious={() => navigate(`/admin?page=${page - 1}`)}
                  onNext={() => navigate(`/admin?page=${page + 1}`)}
                  label={`Page ${page} of ${totalPages}`}
                />
              </div>
            </>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
