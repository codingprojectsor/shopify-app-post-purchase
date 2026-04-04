import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "offers";

  if (type === "offers") {
    const offers = await db.upsellOffer.findMany({
      where: { shop: session.shop },
      include: {
        analyticsEvents: {
          select: { eventType: true, revenue: true },
        },
      },
    });

    const rows = offers.map((offer) => {
      const views = offer.analyticsEvents.filter((e) => e.eventType === "view").length;
      const accepts = offer.analyticsEvents.filter((e) => e.eventType === "accept").length;
      const declines = offer.analyticsEvents.filter((e) => e.eventType === "decline").length;
      const revenue = offer.analyticsEvents
        .filter((e) => e.eventType === "accept" && e.revenue)
        .reduce((sum, e) => sum + (e.revenue || 0), 0);

      return [
        offer.title,
        offer.productTitle,
        offer.discountType === "percentage"
          ? `${offer.discountValue}%`
          : `$${offer.discountValue}`,
        offer.status === "active" ? "Active" : "Off",
        views,
        accepts,
        declines,
        views > 0 ? Math.round((accepts / views) * 100) : 0,
        revenue.toFixed(2),
        offer.createdAt.toISOString().slice(0, 10),
      ].join(",");
    });

    const csv = [
      "Offer,Product,Discount,Status,Views,Accepts,Declines,Conversion%,Revenue,Created",
      ...rows,
    ].join("\n");

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="upsell-offers-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  if (type === "daily") {
    const days = parseInt(url.searchParams.get("days") || "30", 10);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const events = await db.analyticsEvent.findMany({
      where: {
        shop: session.shop,
        createdAt: { gte: startDate },
      },
      select: { eventType: true, revenue: true, createdAt: true },
    });

    const dailyMap = new Map<string, { views: number; accepts: number; declines: number; revenue: number }>();

    for (const event of events) {
      const key = event.createdAt.toISOString().slice(0, 10);
      const day = dailyMap.get(key) || { views: 0, accepts: 0, declines: 0, revenue: 0 };
      if (event.eventType === "view") day.views++;
      if (event.eventType === "accept") {
        day.accepts++;
        day.revenue += event.revenue || 0;
      }
      if (event.eventType === "decline") day.declines++;
      dailyMap.set(key, day);
    }

    const rows = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) =>
        [
          date,
          d.views,
          d.accepts,
          d.declines,
          d.views > 0 ? Math.round((d.accepts / d.views) * 100) : 0,
          d.revenue.toFixed(2),
        ].join(","),
      );

    const csv = [
      "Date,Views,Accepts,Declines,Conversion%,Revenue",
      ...rows,
    ].join("\n");

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="upsell-daily-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return new Response("Unknown export type", { status: 400 });
};
