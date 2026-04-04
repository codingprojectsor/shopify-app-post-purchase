import { useLoaderData, useNavigate } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";

const PAGE_SIZE = 10;
const OFFERS_PER_MERCHANT = 10;

interface MerchantDetail {
  shop: string;
  offers: {
    id: string;
    title: string;
    productTitle: string;
    discountType: string;
    discountValue: number;
    enabled: boolean;
    testMode: boolean;
    priority: number;
    views: number;
    accepts: number;
    revenue: number;
    conversionRate: number;
    createdAt: string;
  }[];
  offerCount: number;
  abTests: {
    id: string;
    name: string;
    status: string;
    offerCount: number;
  }[];
  totalViews: number;
  totalAccepts: number;
  totalRevenue: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (key !== process.env.ADMIN_SECRET) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

  const allSessions = await db.session.findMany({
    select: { shop: true },
    distinct: ["shop"],
  });

  const totalMerchants = allSessions.length;
  const totalPages = Math.max(1, Math.ceil(totalMerchants / PAGE_SIZE));

  const paginatedShops = allSessions.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  const merchants: MerchantDetail[] = [];

  for (const session of paginatedShops) {
    const offerCount = await db.upsellOffer.count({
      where: { shop: session.shop },
    });

    // Only fetch first N offers per merchant
    const offers = await db.upsellOffer.findMany({
      where: { shop: session.shop },
      take: OFFERS_PER_MERCHANT,
      include: {
        analyticsEvents: {
          select: { eventType: true, revenue: true },
        },
      },
      orderBy: { priority: "desc" },
    });

    const abTests = await db.aBTest.findMany({
      where: { shop: session.shop },
      include: { _count: { select: { offers: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    const offerDetails = offers.map((offer) => {
      const views = offer.analyticsEvents.filter((e) => e.eventType === "view").length;
      const accepts = offer.analyticsEvents.filter((e) => e.eventType === "accept").length;
      const revenue = offer.analyticsEvents
        .filter((e) => e.eventType === "accept" && e.revenue)
        .reduce((sum, e) => sum + (e.revenue || 0), 0);

      return {
        id: offer.id,
        title: offer.title,
        productTitle: offer.productTitle,
        discountType: offer.discountType,
        discountValue: offer.discountValue,
        enabled: offer.status === "active",
        testMode: offer.testMode,
        priority: offer.priority,
        views,
        accepts,
        revenue,
        conversionRate: views > 0 ? Math.round((accepts / views) * 100) : 0,
        createdAt: offer.createdAt.toISOString().slice(0, 10),
      };
    });

    // Totals from all events (not just paginated offers)
    const allEvents = await db.analyticsEvent.findMany({
      where: { shop: session.shop },
      select: { eventType: true, revenue: true },
    });

    merchants.push({
      shop: session.shop,
      offers: offerDetails,
      offerCount,
      abTests: abTests.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        offerCount: t._count.offers,
      })),
      totalViews: allEvents.filter((e) => e.eventType === "view").length,
      totalAccepts: allEvents.filter((e) => e.eventType === "accept").length,
      totalRevenue: allEvents
        .filter((e) => e.eventType === "accept" && e.revenue)
        .reduce((sum, e) => sum + (e.revenue || 0), 0),
    });
  }

  return { merchants, page, totalPages, totalMerchants, key };
};

export default function AdminMerchants() {
  const { merchants, page, totalPages, totalMerchants, key } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <div>
      <a
        href={`/admin?key=${key}`}
        style={{ display: "inline-flex", alignItems: "center", gap: "8px", color: "#4f46e5", textDecoration: "none", fontSize: "14px", marginBottom: "16px" }}
      >
        ← Dashboard / Merchants
      </a>
      <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "24px" }}>
        Merchant Details ({totalMerchants})
      </h1>

      {merchants.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: "12px", padding: "40px", textAlign: "center", border: "1px solid #e1e3e5" }}>
          <p style={{ color: "#6b7280" }}>No merchants yet.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {merchants.map((merchant) => (
            <MerchantCard key={merchant.shop} merchant={merchant} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ marginTop: "24px", display: "flex", justifyContent: "center", alignItems: "center", gap: "16px" }}>
          <button
            disabled={page <= 1}
            onClick={() => navigate(`/admin/merchants?key=${key}&page=${page - 1}`)}
            style={{ padding: "6px 16px", borderRadius: "8px", border: "1px solid #d1d5db", background: page <= 1 ? "#f3f4f6" : "#fff", cursor: page <= 1 ? "default" : "pointer", color: page <= 1 ? "#9ca3af" : "#111" }}
          >
            Previous
          </button>
          <span style={{ color: "#6b7280", fontSize: "14px" }}>
            Page {page} of {totalPages} ({totalMerchants} merchants)
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => navigate(`/admin/merchants?key=${key}&page=${page + 1}`)}
            style={{ padding: "6px 16px", borderRadius: "8px", border: "1px solid #d1d5db", background: page >= totalPages ? "#f3f4f6" : "#fff", cursor: page >= totalPages ? "default" : "pointer", color: page >= totalPages ? "#9ca3af" : "#111" }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function MerchantCard({ merchant }: { merchant: MerchantDetail }) {
  const conv = merchant.totalViews > 0
    ? Math.round((merchant.totalAccepts / merchant.totalViews) * 100)
    : 0;

  return (
    <div style={{ background: "#fff", borderRadius: "12px", border: "1px solid #e1e3e5", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #e1e3e5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>{merchant.shop}</h3>
        </div>
        <div style={{ display: "flex", gap: "16px" }}>
          <MiniStat label="Offers" value={String(merchant.offerCount)} />
          <MiniStat label="Views" value={String(merchant.totalViews)} />
          <MiniStat label="Accepts" value={String(merchant.totalAccepts)} />
          <MiniStat label="Conv." value={`${conv}%`} />
          <MiniStat label="Revenue" value={`$${merchant.totalRevenue.toFixed(2)}`} highlight />
        </div>
      </div>

      {/* Offers table */}
      {merchant.offers.length > 0 ? (
        <>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                <Th>Offer</Th>
                <Th>Product</Th>
                <Th>Discount</Th>
                <Th>Status</Th>
                <Th>Views</Th>
                <Th>Accepts</Th>
                <Th>Conv.</Th>
                <Th>Revenue</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {merchant.offers.map((offer) => (
                <tr key={offer.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <Td><span style={{ fontWeight: 500 }}>{offer.title}</span></Td>
                  <Td>{offer.productTitle}</Td>
                  <Td>
                    <span style={{ background: "#dcfce7", color: "#166534", padding: "2px 8px", borderRadius: "12px", fontSize: "12px" }}>
                      {offer.discountType === "percentage" ? `${offer.discountValue}% off` : `$${offer.discountValue} off`}
                    </span>
                  </Td>
                  <Td>
                    <span style={{
                      background: offer.enabled ? "#dcfce7" : "#f3f4f6",
                      color: offer.enabled ? "#166534" : "#6b7280",
                      padding: "2px 8px", borderRadius: "12px", fontSize: "12px",
                    }}>
                      {offer.enabled ? "Active" : "Off"}
                    </span>
                    {offer.testMode && (
                      <span style={{ background: "#dbeafe", color: "#1e40af", padding: "2px 8px", borderRadius: "12px", fontSize: "12px", marginLeft: "4px" }}>Test</span>
                    )}
                  </Td>
                  <Td>{offer.views}</Td>
                  <Td>{offer.accepts}</Td>
                  <Td><span style={{ fontWeight: 600 }}>{offer.conversionRate}%</span></Td>
                  <Td>${offer.revenue.toFixed(2)}</Td>
                  <Td style={{ color: "#6b7280", fontSize: "13px" }}>{offer.createdAt}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {merchant.offerCount > OFFERS_PER_MERCHANT && (
            <div style={{ padding: "8px 20px", color: "#6b7280", fontSize: "13px", borderTop: "1px solid #f3f4f6" }}>
              Showing {OFFERS_PER_MERCHANT} of {merchant.offerCount} offers
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: "20px", textAlign: "center", color: "#6b7280" }}>
          No offers created yet
        </div>
      )}

      {/* A/B Tests */}
      {merchant.abTests.length > 0 && (
        <div style={{ borderTop: "1px solid #e1e3e5", padding: "12px 20px" }}>
          <span style={{ fontSize: "13px", color: "#6b7280", fontWeight: 500 }}>A/B Tests: </span>
          {merchant.abTests.map((test) => (
            <span key={test.id} style={{
              background: test.status === "running" ? "#fef3c7" : test.status === "completed" ? "#dcfce7" : "#f3f4f6",
              color: test.status === "running" ? "#854d0e" : test.status === "completed" ? "#166534" : "#6b7280",
              padding: "2px 8px", borderRadius: "12px", fontSize: "12px", marginRight: "8px",
            }}>
              {test.name} ({test.status}, {test.offerCount} variants)
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: "11px", color: "#6b7280", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: "16px", fontWeight: highlight ? 700 : 600 }}>{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "10px 16px", textAlign: "left", fontSize: "12px", fontWeight: 500, color: "#6b7280" }}>{children}</th>;
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: "10px 16px", fontSize: "13px", ...style }}>{children}</td>;
}
