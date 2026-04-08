import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type {
  ActionFunctionArgs,
  HeadersArgs,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Count offers for overview
  const totalOffers = await db.upsellOffer.count({
    where: { shop: session.shop },
  });
  const activeOffers = await db.upsellOffer.count({
    where: { shop: session.shop, status: "active" },
  });

  const appUrl = process.env.SHOPIFY_APP_URL || "";

  return {
    shop: session.shop,
    totalOffers,
    activeOffers,
    appUrl,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "disable_all") {
    await db.upsellOffer.updateMany({
      where: { shop: session.shop },
      data: { status: "paused" },
    });
    return { success: true, message: "All offers disabled" };
  }

  if (intent === "enable_all") {
    await db.upsellOffer.updateMany({
      where: { shop: session.shop },
      data: { status: "active" },
    });
    return { success: true, message: "All offers activated" };
  }

  if (intent === "clear_analytics") {
    const shopOffers = await db.upsellOffer.findMany({
      where: { shop: session.shop },
      select: { id: true },
    });
    const offerIds = shopOffers.map((o) => o.id);

    await db.analyticsEvent.deleteMany({
      where: { offerId: { in: offerIds } },
    });
    return { success: true, message: "Analytics data cleared" };
  }

  return { success: false };
};

export default function Settings() {
  const { shop, totalOffers, activeOffers, appUrl } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data &&
      typeof fetcher.data === "object" &&
      "message" in fetcher.data
    ) {
      shopify.toast.show(fetcher.data.message as string);
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <s-page heading="Settings">
      {/* Breadcrumb */}
      <s-box paddingBlockEnd="base">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-link href="/app">
            <s-icon type="arrow-left" size="small" />
          </s-link>
          <s-link href="/app">Offers</s-link>
          <s-text color="subdued">/</s-text>
          <s-text color="subdued">Settings</s-text>
        </s-stack>
      </s-box>


      {/* App Info */}
      <s-section heading="App Information">
        <s-box padding="base" borderWidth="base" borderRadius="large">
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon type="info" color="subdued" size="small" />
              <s-text type="strong">Your App</s-text>
            </s-stack>
            <s-divider />
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-grid-item>
                <s-stack gap="small-100">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-icon type="store" color="subdued" size="small" />
                    <s-text color="subdued">Shop</s-text>
                  </s-stack>
                  <s-text type="strong">{shop}</s-text>
                </s-stack>
              </s-grid-item>
              <s-grid-item>
                <s-stack gap="small-100">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-icon type="link" color="subdued" size="small" />
                    <s-text color="subdued">App URL</s-text>
                  </s-stack>
                  <s-text type="strong">{appUrl || "Not configured"}</s-text>
                </s-stack>
              </s-grid-item>
              <s-grid-item>
                <s-stack gap="small-100">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-icon type="target" color="subdued" size="small" />
                    <s-text color="subdued">Total Offers</s-text>
                  </s-stack>
                  <s-text type="strong">{totalOffers}</s-text>
                </s-stack>
              </s-grid-item>
              <s-grid-item>
                <s-stack gap="small-100">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-icon type="status-active" color="subdued" size="small" />
                    <s-text color="subdued">Active Offers</s-text>
                  </s-stack>
                  <s-text type="strong">{activeOffers}</s-text>
                </s-stack>
              </s-grid-item>
            </s-grid>
          </s-stack>
        </s-box>
      </s-section>

      {/* Quick Actions */}
      <s-section heading="Quick Actions">
        <s-box padding="base" borderWidth="base" borderRadius="large">
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon type="bolt" color="subdued" size="small" />
              <s-text type="strong">Bulk Enable / Disable</s-text>
            </s-stack>
            <s-text color="subdued">
              Quickly enable or disable all offers at once.
            </s-text>
            <s-stack direction="inline" gap="base">
              <s-button
                icon="enabled"
                loading={fetcher.state !== "idle" || undefined}
                onClick={() =>
                  fetcher.submit(
                    { intent: "enable_all" },
                    { method: "POST" },
                  )
                }
              >
                Enable all offers
              </s-button>
              <s-button
                variant="secondary"
                icon="disabled"
                loading={fetcher.state !== "idle" || undefined}
                onClick={() =>
                  fetcher.submit(
                    { intent: "disable_all" },
                    { method: "POST" },
                  )
                }
              >
                Disable all offers
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>
      </s-section>

      {/* Setup Guide */}
      <s-section heading="Setup Guide">
        <s-box padding="base" borderWidth="base" borderRadius="large">
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon type="clipboard-checklist" color="subdued" size="small" />
              <s-text type="strong">Get started in 4 steps</s-text>
            </s-stack>
            <s-divider />

            <s-stack direction="inline" gap="base" alignItems="center">
              <s-badge tone="info">1</s-badge>
              <s-stack gap="small-100">
                <s-text type="strong">Create an offer</s-text>
                <s-text color="subdued">
                  Select a product, set a discount, and configure targeting
                  rules.
                </s-text>
              </s-stack>
            </s-stack>
            <s-divider />

            <s-stack direction="inline" gap="base" alignItems="center">
              <s-badge tone="info">2</s-badge>
              <s-stack gap="small-100">
                <s-text type="strong">Add extension to checkout</s-text>
                <s-text color="subdued">
                  Settings &gt; Checkout &gt; Customize &gt; Add "After
                  Purchase UI" block to the thank-you page.
                </s-text>
              </s-stack>
            </s-stack>
            <s-divider />

            <s-stack direction="inline" gap="base" alignItems="center">
              <s-badge tone="info">3</s-badge>
              <s-stack gap="small-100">
                <s-text type="strong">Set the App URL</s-text>
                <s-text color="subdued">
                  In the checkout editor, click the extension block and set App
                  URL to: {appUrl || "(your app URL)"}
                </s-text>
              </s-stack>
            </s-stack>
            <s-divider />

            <s-stack direction="inline" gap="base" alignItems="center">
              <s-badge tone="info">4</s-badge>
              <s-stack gap="small-100">
                <s-text type="strong">Test it</s-text>
                <s-text color="subdued">
                  Enable "Test mode" on an offer, place a test order, and
                  verify the upsell appears.
                </s-text>
              </s-stack>
            </s-stack>
          </s-stack>
        </s-box>
      </s-section>

      {/* Data Management */}
      <s-section heading="Data Management">
        <s-banner tone="critical" heading="Clear Analytics Data">
          <s-stack gap="base">
            <s-text>
              Remove all tracked events (views, accepts, declines). This cannot
              be undone.
            </s-text>
            {confirmClear ? (
              <s-stack direction="inline" gap="base">
                <s-button
                  tone="critical"
                  icon="delete"
                  onClick={() => {
                    fetcher.submit(
                      { intent: "clear_analytics" },
                      { method: "POST" },
                    );
                    setConfirmClear(false);
                  }}
                >
                  Confirm: Clear all data
                </s-button>
                <s-button
                  variant="secondary"
                  onClick={() => setConfirmClear(false)}
                >
                  Cancel
                </s-button>
              </s-stack>
            ) : (
              <s-button tone="critical" icon="delete" onClick={() => setConfirmClear(true)}>
                Clear analytics data
              </s-button>
            )}
          </s-stack>
        </s-banner>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs: HeadersArgs) => {
  return boundary.headers(headersArgs);
};
