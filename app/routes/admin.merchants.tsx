import { useLoaderData, useNavigate, useNavigation } from "react-router";
import { useState, useCallback } from "react";
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import {
  Page, Card, Text, Badge, DataTable, TextField, Collapsible,
  BlockStack, InlineStack, Pagination, Divider, Icon,
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";
import { AdminPageLoading } from "../components/AdminPageLoading";
import { formatPrice, formatDiscountShort } from "../utils/format";

const PAGE_SIZE = 10;
const OFFERS_PER_MERCHANT = 10;

interface MerchantOffer {
  id: string; title: string; productTitle: string; discountType: string;
  discountValue: number; enabled: boolean; testMode: boolean;
  views: number; accepts: number; revenue: number; conversionRate: number; createdAt: string;
}

interface MerchantDetail {
  shop: string;
  offers: MerchantOffer[];
  offerCount: number;
  abTests: { id: string; name: string; status: string; offerCount: number }[];
  totalViews: number; totalAccepts: number; totalRevenue: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

  const allSessions = await db.session.findMany({ select: { shop: true }, distinct: ["shop"] });
  const totalMerchants = allSessions.length;
  const totalPages = Math.max(1, Math.ceil(totalMerchants / PAGE_SIZE));
  const paginatedShops = allSessions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const merchants: MerchantDetail[] = [];

  for (const session of paginatedShops) {
    const offerCount = await db.upsellOffer.count({ where: { shop: session.shop } });
    const offers = await db.upsellOffer.findMany({
      where: { shop: session.shop }, take: OFFERS_PER_MERCHANT,
      include: { analyticsEvents: { select: { eventType: true, revenue: true } } },
      orderBy: { priority: "desc" },
    });
    const abTests = await db.aBTest.findMany({
      where: { shop: session.shop },
      include: { _count: { select: { offers: true } } },
      orderBy: { createdAt: "desc" }, take: 5,
    });

    const offerDetails: MerchantOffer[] = offers.map((offer) => {
      const views = offer.analyticsEvents.filter((e) => e.eventType === "view").length;
      const accepts = offer.analyticsEvents.filter((e) => e.eventType === "accept").length;
      const revenue = offer.analyticsEvents.filter((e) => e.eventType === "accept" && e.revenue).reduce((sum, e) => sum + (e.revenue || 0), 0);
      return {
        id: offer.id, title: offer.title, productTitle: offer.productTitle,
        discountType: offer.discountType, discountValue: offer.discountValue,
        enabled: offer.status === "active", testMode: offer.testMode,
        views, accepts, revenue,
        conversionRate: views > 0 ? Math.round((accepts / views) * 100) : 0,
        createdAt: offer.createdAt.toISOString().slice(0, 10),
      };
    });

    const allEvents = await db.analyticsEvent.findMany({ where: { shop: session.shop }, select: { eventType: true, revenue: true } });

    merchants.push({
      shop: session.shop, offers: offerDetails, offerCount,
      abTests: abTests.map((t) => ({ id: t.id, name: t.name, status: t.status, offerCount: t._count.offers })),
      totalViews: allEvents.filter((e) => e.eventType === "view").length,
      totalAccepts: allEvents.filter((e) => e.eventType === "accept").length,
      totalRevenue: allEvents.filter((e) => e.eventType === "accept" && e.revenue).reduce((sum, e) => sum + (e.revenue || 0), 0),
    });
  }

  return { merchants, page, totalPages, totalMerchants };
};

export default function AdminMerchants() {
  const { merchants, page, totalPages, totalMerchants } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isPageLoading = navigation.state === "loading";
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = search
    ? (merchants as MerchantDetail[]).filter((m) => m.shop.toLowerCase().includes(search.toLowerCase()))
    : (merchants as MerchantDetail[]);

  const toggle = useCallback((shop: string) => {
    setExpanded((prev) => (prev === shop ? null : shop));
  }, []);

  return (
    <Page title={`Merchant Details (${totalMerchants})`}>
      <BlockStack gap="400">
        <div style={{ maxWidth: "400px" }}>
          <TextField label="" labelHidden autoComplete="off"
            placeholder="Search merchants..." value={search}
            onChange={setSearch} clearButton onClearButtonClick={() => setSearch("")} />
        </div>

        {isPageLoading ? (
          <AdminPageLoading text="Loading merchants..." />
        ) : filtered.length === 0 ? (
          <Card>
            <Text as="p" tone="subdued" alignment="center">
              {search ? "No merchants match your search." : "No merchants yet."}
            </Text>
          </Card>
        ) : (
          filtered.map((merchant) => {
            const conv = merchant.totalViews > 0
              ? Math.round((merchant.totalAccepts / merchant.totalViews) * 100) : 0;
            const isOpen = expanded === merchant.shop;

            return (
              <Card key={merchant.shop} padding="0">
                {/* Header */}
                <div
                  onClick={() => toggle(merchant.shop)}
                  style={{ padding: "16px", cursor: "pointer", userSelect: "none" }}
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", color: "#6366f1", fontWeight: 700, fontSize: "14px" }}>
                        {merchant.shop.charAt(0).toUpperCase()}
                      </div>
                      <BlockStack gap="050">
                        <Text variant="bodyMd" as="span" fontWeight="semibold">{merchant.shop}</Text>
                        <Text variant="bodySm" as="span" tone="subdued">{merchant.offerCount} offers</Text>
                      </BlockStack>
                    </InlineStack>
                    <InlineStack gap="600" blockAlign="center">
                      <BlockStack gap="050">
                        <Text variant="bodySm" as="span" tone="subdued">Views</Text>
                        <Text variant="bodyMd" as="span" fontWeight="semibold">{merchant.totalViews}</Text>
                      </BlockStack>
                      <BlockStack gap="050">
                        <Text variant="bodySm" as="span" tone="subdued">Accepts</Text>
                        <Text variant="bodyMd" as="span" fontWeight="semibold">{merchant.totalAccepts}</Text>
                      </BlockStack>
                      <BlockStack gap="050">
                        <Text variant="bodySm" as="span" tone="subdued">Conv.</Text>
                        <Text variant="bodyMd" as="span" fontWeight="semibold">{conv}%</Text>
                      </BlockStack>
                      <BlockStack gap="050">
                        <Text variant="bodySm" as="span" tone="subdued">Revenue</Text>
                        <Text variant="bodyMd" as="span" fontWeight="bold">{formatPrice(merchant.totalRevenue)}</Text>
                      </BlockStack>
                      <Icon source={isOpen ? ChevronUpIcon : ChevronDownIcon} tone="subdued" />
                    </InlineStack>
                  </InlineStack>
                </div>

                {/* Collapsible body */}
                <Collapsible open={isOpen} id={`merchant-${merchant.shop}`}>
                  <Divider />
                  {merchant.offers.length > 0 ? (
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text", "numeric", "numeric", "numeric", "numeric", "text"]}
                      headings={["Offer", "Product", "Discount", "Status", "Views", "Accepts", "Conv.", "Revenue", "Created"]}
                      rows={merchant.offers.map((o) => [
                        o.title,
                        o.productTitle,
                        formatDiscountShort(o.discountType, o.discountValue),
                        o.enabled ? "Active" : "Off",
                        o.views, o.accepts, `${o.conversionRate}%`,
                        formatPrice(o.revenue), o.createdAt,
                      ])}
                    />
                  ) : (
                    <div style={{ padding: "24px", textAlign: "center" }}>
                      <Text as="p" tone="subdued">No offers created yet</Text>
                    </div>
                  )}
                  {merchant.abTests.length > 0 && (
                    <>
                      <Divider />
                      <div style={{ padding: "12px 16px" }}>
                        <InlineStack gap="200" blockAlign="center">
                          <Text variant="bodySm" as="span" fontWeight="semibold">A/B Tests:</Text>
                          {merchant.abTests.map((t) => (
                            <Badge key={t.id}
                              tone={t.status === "running" ? "warning" : t.status === "completed" ? "success" : undefined}>
                              {`${t.name} (${t.offerCount} variants)`}
                            </Badge>
                          ))}
                        </InlineStack>
                      </div>
                    </>
                  )}
                </Collapsible>
              </Card>
            );
          })
        )}

        {totalPages > 1 && (
          <InlineStack align="center">
            <Pagination
              hasPrevious={page > 1} hasNext={page < totalPages}
              onPrevious={() => navigate(`/admin/merchants?page=${page - 1}`)}
              onNext={() => navigate(`/admin/merchants?page=${page + 1}`)}
            />
          </InlineStack>
        )}
      </BlockStack>
    </Page>
  );
}
