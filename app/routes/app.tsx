import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import type { HeadersArgs, LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Ensure the shop has our app URL stored as a metafield
  // so the checkout extension can call our backend
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  if (appUrl) {
    try {
      // Get the shop's GID first
      const shopResponse = await admin.graphql(
        `#graphql
        query { shop { id } }`,
      );
      const shopData = await shopResponse.json();
      const shopId = shopData.data?.shop?.id;

      if (shopId) {
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
      console.error("Failed to set app_url metafield:", err);
    }
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Offers</s-link>
        <s-link href="/app/analytics">Analytics</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
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
