import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { getAppUrl } from "../utils/env.server";
import { logger } from "../utils/logger.server";
import { getActivePlanLimits, ensureSubscription, ensureDefaultPlans } from "../utils/billing.server";
import db from "../db.server";
import type { HeadersArgs, LoaderFunctionArgs } from "react-router";
import type { PlanLimits } from "../types/plan-limits";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  let currency = "USD";

  // Fetch shop info + set metafield
  const appUrl = getAppUrl();
  try {
    const shopResponse = await admin.graphql(
      `#graphql
      query { shop { id currencyCode } }`,
    );
    const shopData = await shopResponse.json();
    const shopId = shopData.data?.shop?.id;
    currency = shopData.data?.shop?.currencyCode || "USD";
    logger.for("app").info("Shop loaded", { shop: session.shop, shopId, currency });

    // Store currency on subscription record
    await db.subscription.upsert({
      where: { shop: session.shop },
      update: { currency },
      create: { shop: session.shop, plan: "free", status: "active", currency },
    });

    if (shopId && appUrl) {
      await admin.graphql(
        `#graphql
        mutation setAppUrl($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
          }
        }`,
        {
          variables: {
            metafields: [
              {
                namespace: "$app",
                key: "app_url",
                ownerId: shopId,
                type: "single_line_text_field",
                value: appUrl,
              },
            ],
          },
        },
      );
    }
  } catch (err) {
    logger.for("app").error("Failed to fetch shop info", err);
  }

  // Ensure default plans exist
  await ensureDefaultPlans();
  const limits = await getActivePlanLimits(session.shop);
  const sub = await ensureSubscription(session.shop);
  const activeOfferCount = await db.upsellOffer.count({
    where: { shop: session.shop, status: "active" },
  });

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    currency,
    planLimits: limits as PlanLimits,
    currentPlan: sub.plan,
    activeOfferCount,
  };
};

export default function App() {
  const { apiKey, currency, planLimits, currentPlan, activeOfferCount } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Offers</s-link>
        {planLimits.customBranding && <s-link href="/app/widgets">Widgets</s-link>}
        {planLimits.abTesting && <s-link href="/app/ab-tests">A/B Tests</s-link>}
        {planLimits.analytics && <s-link href="/app/analytics">Analytics</s-link>}
        <s-link href="/app/pricing">Pricing</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet context={{ currency, planLimits, currentPlan, activeOfferCount }} />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs: HeadersArgs) => {
  return boundary.headers(headersArgs);
};
