import { useLoaderData, useNavigate } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";

const PAGE_SIZE = 20;

interface ShopSummary {
  shop: string;
  totalOffers: number;
  activeOffers: number;
  totalViews: number;
  totalAccepts: number;
  totalDeclines: number;
  totalRevenue: number;
  conversionRate: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (key !== process.env.ADMIN_SECRET) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

  // Get all unique shops
  const allSessions = await db.session.findMany({
    select: { shop: true },
    distinct: ["shop"],
  });

  const totalShops = allSessions.length;
  const totalPages = Math.max(1, Math.ceil(totalShops / PAGE_SIZE));

  // Paginate shops
  const paginatedShops = allSessions.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  const shops: ShopSummary[] = [];

  for (const { shop } of paginatedShops) {
    const offers = await db.upsellOffer.findMany({
      where: { shop },
      include: {
        analyticsEvents: {
          select: { eventType: true, revenue: true },
        },
      },
    });

    const allEvents = offers.flatMap((o) => o.analyticsEvents);
    const views = allEvents.filter((e) => e.eventType === "view").length;
    const accepts = allEvents.filter((e) => e.eventType === "accept").length;
    const declines = allEvents.filter((e) => e.eventType === "decline").length;
    const revenue = allEvents
      .filter((e) => e.eventType === "accept" && e.revenue)
      .reduce((sum, e) => sum + (e.revenue || 0), 0);

    shops.push({
      shop,
      totalOffers: offers.length,
      activeOffers: offers.filter((o) => o.status === "active").length,
      totalViews: views,
      totalAccepts: accepts,
      totalDeclines: declines,
      totalRevenue: revenue,
      conversionRate: views > 0 ? Math.round((accepts / views) * 100) : 0,
    });
  }

  // Global stats (from all shops, not paginated)
  const allOfferCount = await db.upsellOffer.count();
  const activeOfferCount = await db.upsellOffer.count({ where: { status: "active" } });
  const allEventsAgg = await db.analyticsEvent.findMany({
    select: { eventType: true, revenue: true },
  });
  const gViews = allEventsAgg.filter((e) => e.eventType === "view").length;
  const gAccepts = allEventsAgg.filter((e) => e.eventType === "accept").length;
  const gRevenue = allEventsAgg
    .filter((e) => e.eventType === "accept" && e.revenue)
    .reduce((sum, e) => sum + (e.revenue || 0), 0);

  const globalStats = {
    totalShops,
    totalOffers: allOfferCount,
    activeOffers: activeOfferCount,
    totalViews: gViews,
    totalAccepts: gAccepts,
    totalRevenue: gRevenue,
    overallConversion:
      gViews > 0 ? Math.round((gAccepts / gViews) * 100) : 0,
  };

  return { shops, globalStats, page, totalPages, totalShops, key };
};

export default function AdminDashboard() {
  const { shops, globalStats, page, totalPages, totalShops, key } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <div>
      <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "24px" }}>
        Platform Overview
      </h1>

      {/* Global Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px", marginBottom: "32px" }}>
        <StatCard label="Total Merchants" value={String(globalStats.totalShops)} icon="🏪" />
        <StatCard label="Total Offers" value={String(globalStats.totalOffers)} icon="🎯" />
        <StatCard label="Active Offers" value={String(globalStats.activeOffers)} icon="✅" />
        <StatCard label="Total Views" value={String(globalStats.totalViews)} icon="👁" />
        <StatCard label="Total Accepts" value={String(globalStats.totalAccepts)} icon="🛒" />
        <StatCard label="Platform Revenue" value={`$${globalStats.totalRevenue.toFixed(2)}`} icon="💰" />
      </div>

      {/* Conversion bar */}
      <div style={{ background: "#fff", borderRadius: "12px", padding: "20px", marginBottom: "32px", border: "1px solid #e1e3e5" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
          <span style={{ fontWeight: 600 }}>Platform Conversion Rate</span>
          <span style={{ fontWeight: 700, fontSize: "20px" }}>{globalStats.overallConversion}%</span>
        </div>
        <div style={{ background: "#e4e5e7", borderRadius: "8px", height: "8px", overflow: "hidden" }}>
          <div
            style={{
              background: globalStats.overallConversion > 10 ? "#22c55e" : globalStats.overallConversion > 5 ? "#eab308" : "#ef4444",
              height: "100%",
              width: `${Math.min(100, globalStats.overallConversion)}%`,
              borderRadius: "8px",
            }}
          />
        </div>
      </div>

      {/* Merchants Table */}
      <div style={{ background: "#fff", borderRadius: "12px", border: "1px solid #e1e3e5", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e1e3e5" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>
            All Merchants ({totalShops})
          </h2>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              <Th>Shop</Th>
              <Th>Offers</Th>
              <Th>Active</Th>
              <Th>Views</Th>
              <Th>Accepts</Th>
              <Th>Conv.</Th>
              <Th>Revenue</Th>
            </tr>
          </thead>
          <tbody>
            {shops.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "40px", textAlign: "center", color: "#6b7280" }}>
                  No merchants have installed the app yet.
                </td>
              </tr>
            ) : (
              shops.map((shop) => (
                <tr key={shop.shop} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <Td><div style={{ fontWeight: 600 }}>{shop.shop}</div></Td>
                  <Td>{shop.totalOffers}</Td>
                  <Td>
                    <span style={{
                      background: shop.activeOffers > 0 ? "#dcfce7" : "#f3f4f6",
                      color: shop.activeOffers > 0 ? "#166534" : "#6b7280",
                      padding: "2px 8px", borderRadius: "12px", fontSize: "13px",
                    }}>
                      {shop.activeOffers}
                    </span>
                  </Td>
                  <Td>{shop.totalViews}</Td>
                  <Td>{shop.totalAccepts}</Td>
                  <Td>
                    <span style={{ fontWeight: 600, color: shop.conversionRate > 10 ? "#166534" : "#6b7280" }}>
                      {shop.conversionRate}%
                    </span>
                  </Td>
                  <Td><span style={{ fontWeight: 600 }}>${shop.totalRevenue.toFixed(2)}</span></Td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ padding: "16px 20px", borderTop: "1px solid #e1e3e5", display: "flex", justifyContent: "center", alignItems: "center", gap: "16px" }}>
            <button
              disabled={page <= 1}
              onClick={() => navigate(`/admin?key=${key}&page=${page - 1}`)}
              style={{ padding: "6px 16px", borderRadius: "8px", border: "1px solid #d1d5db", background: page <= 1 ? "#f3f4f6" : "#fff", cursor: page <= 1 ? "default" : "pointer", color: page <= 1 ? "#9ca3af" : "#111" }}
            >
              Previous
            </button>
            <span style={{ color: "#6b7280", fontSize: "14px" }}>
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => navigate(`/admin?key=${key}&page=${page + 1}`)}
              style={{ padding: "6px 16px", borderRadius: "8px", border: "1px solid #d1d5db", background: page >= totalPages ? "#f3f4f6" : "#fff", cursor: page >= totalPages ? "default" : "pointer", color: page >= totalPages ? "#9ca3af" : "#111" }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div style={{ background: "#fff", borderRadius: "12px", padding: "20px", border: "1px solid #e1e3e5" }}>
      <div style={{ fontSize: "24px", marginBottom: "8px" }}>{icon}</div>
      <div style={{ color: "#6b7280", fontSize: "13px", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "24px", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 500, color: "#6b7280" }}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: "12px 16px", fontSize: "14px" }}>
      {children}
    </td>
  );
}
