import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  getPlans,
  parsePlanFeatures,
  ensureSubscription,
  createSubscriptionCharge,
  syncSubscriptionStatus,
  cancelSubscription,
  isTrialActive,
} from "../utils/billing.server";
import { getAppUrl } from "../utils/env.server";
import { formatPlanPrice } from "../utils/format";
import { PlanCardButton } from "../components/PlanCardButton";
// Plan type from Prisma
type PrismaPlan = Awaited<ReturnType<typeof getPlans>>[number];
import type {
  ActionFunctionArgs,
  HeadersArgs,
  LoaderFunctionArgs,
} from "react-router";

interface PlanCard {
  name: string;
  slug: string;
  price: number;
  trialDays: number;
  features: string[];
  isFree: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  // Fetch shop currency
  let shopCurrency = "USD";
  try {
    const shopRes = await admin.graphql(`#graphql query { shop { currencyCode } }`);
    const shopData = await shopRes.json();
    shopCurrency = shopData.data?.shop?.currencyCode || "USD";
  } catch { /* fallback USD */ }

  // Sync with Shopify's actual billing state
  await syncSubscriptionStatus(admin, session.shop);
  const subscription = await ensureSubscription(session.shop);

  const dbPlans = await getPlans();

  return {
    plans: dbPlans.map((p: PrismaPlan): PlanCard => ({
      name: p.name,
      slug: p.slug,
      price: p.price,
      trialDays: p.trialDays,
      features: parsePlanFeatures(p),
      isFree: p.price === 0,
    })),
    currentPlan: subscription.plan,
    status: subscription.status,
    isCancelled: subscription.status === "cancelled",
    trialActive: isTrialActive(subscription),
    trialEndsAt: subscription.trialEndsAt?.toISOString() || null,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
    shopCurrency,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "subscribe") {
    const planSlug = formData.get("plan") as string;

    // Build return URL using Shopify admin path
    const storeDomain = session.shop.replace(".myshopify.com", "");
    let appHandle = "";
    try {
      const appRes = await admin.graphql(`#graphql query { app { handle } }`);
      const appData = await appRes.json();
      appHandle = appData.data?.app?.handle || "";
    } catch { /* fallback */ }

    const returnUrl = appHandle
      ? `https://admin.shopify.com/store/${storeDomain}/apps/${appHandle}/app/pricing`
      : `${getAppUrl()}/app/pricing`;

    const { confirmationUrl } = await createSubscriptionCharge(
      admin,
      session.shop,
      planSlug,
      returnUrl,
    );

    return { confirmationUrl };
  }

  if (intent === "cancel") {
    const subscription = await ensureSubscription(session.shop);
    if (subscription.shopifyChargeId) {
      await cancelSubscription(admin, subscription.shopifyChargeId);
      // Mark as cancelled but keep plan until period ends
      await db.subscription.update({
        where: { shop: session.shop },
        data: { status: "cancelled" },
      });
    }
    return { cancelled: true };
  }

  return { success: false };
};

export default function Pricing() {
  const { plans, currentPlan, trialActive, trialEndsAt, shopCurrency, isCancelled, currentPeriodEnd, status } =
    useLoaderData<typeof loader>();
  const isLocalCurrency = shopCurrency !== "USD";
  const periodEndDate = currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleDateString() : null;

  const trialEndDate = trialEndsAt ? new Date(trialEndsAt).toLocaleDateString() : null;

  if (plans.length === 0) {
    return (
      <s-page heading="Pricing Plans">
        <s-section>
          <s-banner tone="info" heading="No plans available">
            <s-text>Plans are being configured. Please check back later.</s-text>
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Pricing Plans">
      {/* Current Plan Banner */}
      <s-section>
        <s-banner
          tone={isCancelled ? "warning" : currentPlan === "free" ? "info" : "success"}
          heading={
            isCancelled
              ? `Your ${currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} plan has been cancelled`
              : currentPlan === "free"
              ? "You are on the Free plan"
              : `You are on the ${currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} plan`
          }
        >
          {isCancelled && periodEndDate && (
            <s-text>
              You still have access to all {currentPlan} features until {periodEndDate}.
              After that, you'll be moved to the Free plan. You can re-subscribe anytime.
            </s-text>
          )}
          {isCancelled && !periodEndDate && (
            <s-text>Your subscription has been cancelled. You can re-subscribe anytime.</s-text>
          )}
          {!isCancelled && trialActive && trialEndDate && (
            <s-text>Your free trial ends on {trialEndDate}. You won't be charged until the trial expires.</s-text>
          )}
          {!isCancelled && currentPlan === "free" && (
            <s-text>Upgrade to unlock more offers, A/B testing, advanced analytics, and more.</s-text>
          )}
        </s-banner>
      </s-section>

      {/* Plan Cards */}
      <s-section>
        <s-grid gridTemplateColumns={plans.length >= 3 ? "1fr 1fr 1fr" : `repeat(${plans.length}, minmax(0, 360px))`} gap="base">
          {(plans as PlanCard[]).map((plan: PlanCard, idx: number) => {
            const isCurrent = currentPlan === plan.slug;
            const currentIdx = (plans as PlanCard[]).findIndex((p: PlanCard) => p.slug === currentPlan);
            const isDowngrade = currentIdx > idx;
            return (
              <s-grid-item key={plan.slug}>
                <s-box
                  padding="large-200"
                  borderWidth="base"
                  borderRadius="large"
                  background={isCurrent ? "subdued" : undefined}
                >
                  <s-stack gap="base">
                    {/* Badge row */}
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      {isCurrent && <s-badge tone="info">Current plan</s-badge>}
                      {plan.isFree && !isCurrent && <s-badge>Free</s-badge>}
                      {!plan.isFree && plan.trialDays > 0 && (
                        <s-badge tone="warning">{plan.trialDays}-day trial</s-badge>
                      )}
                    </s-stack>

                    {/* Plan name */}
                    <s-text type="strong">{plan.name}</s-text>

                    {/* Price */}
                    <s-stack gap="small-100">
                      <s-stack direction="inline" gap="small-100" alignItems="baseline">
                        <span style={{ fontSize: "32px", fontWeight: 700, lineHeight: 1, color: "var(--s-color-text)" }}>
                          {formatPlanPrice(plan.price, "")}
                        </span>
                        {!plan.isFree && (
                          <s-text color="subdued">USD/month</s-text>
                        )}
                      </s-stack>
                      {!plan.isFree && isLocalCurrency && (
                        <s-text color="subdued">
                          Billed in USD. Shopify converts to {shopCurrency} on your invoice.
                        </s-text>
                      )}
                    </s-stack>

                    {/* Action button */}
                    <PlanCardButton
                      planSlug={plan.slug}
                      isCurrent={isCurrent}
                      isCancelled={isCancelled}
                      isFree={plan.isFree}
                      isDowngrade={isDowngrade}
                      trialDays={plan.trialDays}
                      periodEndDate={periodEndDate}
                      currentPlanSlug={currentPlan}
                    />

                    {/* Divider */}
                    <s-divider />

                    {/* Features list */}
                    <s-stack gap="small-200">
                      <s-text color="subdued">What's included</s-text>
                      {plan.features.map((feature: string, i: number) => (
                        <s-stack key={i} direction="inline" gap="small-200" alignItems="center">
                          <s-icon type="check-circle" size="small" />
                          <s-text>{feature}</s-text>
                        </s-stack>
                      ))}
                    </s-stack>
                  </s-stack>
                </s-box>
              </s-grid-item>
            );
          })}
        </s-grid>
      </s-section>

      {/* FAQ Accordion */}
      <s-section heading="Frequently Asked Questions">
        <s-box borderWidth="base" borderRadius="large" overflow="hidden">
          <s-stack gap="none">
            <details style={{ borderBottom: "1px solid var(--s-color-border)" }}>
              <summary style={{ padding: "16px", cursor: "pointer", fontWeight: 600, fontSize: "14px" }}>
                How does the free trial work?
              </summary>
              <s-box padding="none base base base">
                <s-text color="subdued">
                  Paid plans include a 3-day free trial. You won't be charged until the trial ends.
                  Cancel anytime during the trial and you won't be charged at all.
                </s-text>
              </s-box>
            </details>
            <details style={{ borderBottom: "1px solid var(--s-color-border)" }}>
              <summary style={{ padding: "16px", cursor: "pointer", fontWeight: 600, fontSize: "14px" }}>
                How am I billed?
              </summary>
              <s-box padding="none base base base">
                <s-text color="subdued">
                  All charges appear on your monthly Shopify bill. We don't collect payment
                  details directly — Shopify handles everything securely.
                </s-text>
              </s-box>
            </details>
            <details style={{ borderBottom: "1px solid var(--s-color-border)" }}>
              <summary style={{ padding: "16px", cursor: "pointer", fontWeight: 600, fontSize: "14px" }}>
                Can I upgrade or downgrade?
              </summary>
              <s-box padding="none base base base">
                <s-text color="subdued">
                  Yes! You can switch plans at any time. When you upgrade, you get immediate access to
                  new features. Shopify prorates the charge automatically based on your billing cycle.
                </s-text>
              </s-box>
            </details>
            <details style={{ borderBottom: "1px solid var(--s-color-border)" }}>
              <summary style={{ padding: "16px", cursor: "pointer", fontWeight: 600, fontSize: "14px" }}>
                What happens if I cancel?
              </summary>
              <s-box padding="none base base base">
                <s-text color="subdued">
                  When you cancel, you keep access to all paid features until the end of your current
                  billing period. After that, you'll be moved to the Free plan. Your offers and data
                  stay intact — only features beyond the free tier will be locked. You can re-subscribe
                  anytime to restore access.
                </s-text>
              </s-box>
            </details>
            <details>
              <summary style={{ padding: "16px", cursor: "pointer", fontWeight: 600, fontSize: "14px" }}>
                What's included in the Free plan?
              </summary>
              <s-box padding="none base base base">
                <s-text color="subdued">
                  The Free plan includes up to 2 active post-purchase upsell offers with smart
                  targeting rules. To unlock A/B testing, advanced analytics, custom branding,
                  funnel chaining, and scheduled offers — upgrade to Starter or Pro.
                </s-text>
              </s-box>
            </details>
          </s-stack>
        </s-box>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs: HeadersArgs) => {
  return boundary.headers(headersArgs);
};
