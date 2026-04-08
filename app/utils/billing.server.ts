import db from "../db.server";
import type { Plan } from "@prisma/client";

// --- Plan helpers (DB-driven) ---

const FREE_LIMITS = {
  maxOffers: 2,
  abTesting: false,
  analytics: false,
  customBranding: false,
  prioritySupport: false,
  scheduledOffers: false,
  funnelChaining: false,
  csvExport: false,
};

/** Auto-generate feature list from plan flags */
export function buildFeatureList(plan: {
  maxOffers: number; abTesting: boolean; analytics: boolean; csvExport: boolean;
  customBranding: boolean; funnelChaining: boolean; scheduledOffers: boolean;
  prioritySupport: boolean; trialDays: number;
}): string[] {
  const list: string[] = [];
  if (plan.maxOffers === -1) list.push("Unlimited active offers");
  else list.push(`Up to ${plan.maxOffers} active offers`);
  list.push("Post-purchase upsells");
  list.push("Smart targeting rules");
  if (plan.abTesting) list.push("A/B split testing");
  if (plan.analytics) list.push("Advanced analytics dashboard");
  if (plan.csvExport) list.push("Analytics CSV export");
  if (plan.customBranding) list.push("Custom widgets & branding");
  if (plan.funnelChaining) list.push("Offer funnel chaining");
  if (plan.scheduledOffers) list.push("Scheduled & timed offers");
  if (plan.prioritySupport) list.push("Priority support");
  if (plan.trialDays > 0) list.push(`${plan.trialDays}-day free trial`);
  return list;
}

const DEFAULT_PLANS = [
  {
    name: "Free", slug: "free", price: 0, trialDays: 0, maxOffers: 2, sortOrder: 0,
    abTesting: false, analytics: false, csvExport: false, customBranding: false,
    funnelChaining: false, scheduledOffers: false, prioritySupport: false,
  },
  {
    name: "Starter", slug: "starter", price: 9.99, trialDays: 3, maxOffers: 10, sortOrder: 1,
    abTesting: true, analytics: true, csvExport: false, customBranding: true,
    funnelChaining: false, scheduledOffers: false, prioritySupport: false,
  },
  {
    name: "Pro", slug: "pro", price: 29.99, trialDays: 3, maxOffers: -1, sortOrder: 2,
    abTesting: true, analytics: true, csvExport: true, customBranding: true,
    funnelChaining: true, scheduledOffers: true, prioritySupport: true,
  },
];

export async function ensureDefaultPlans() {
  for (const plan of DEFAULT_PLANS) {
    const existing = await db.plan.findUnique({ where: { slug: plan.slug } });
    if (!existing) {
      await db.plan.create({
        data: { ...plan, isActive: true },
      });
    }
  }
}

export async function getPlans() {
  return db.plan.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
}

export async function getPlan(slug: string) {
  return db.plan.findUnique({ where: { slug } });
}

export function parsePlanFeatures(plan: Plan): string[] {
  return buildFeatureList(plan);
}

export function getPlanLimits(plan: Plan | null) {
  if (!plan) return FREE_LIMITS;
  return {
    maxOffers: plan.maxOffers,
    abTesting: plan.abTesting,
    analytics: plan.analytics,
    customBranding: plan.customBranding,
    prioritySupport: plan.prioritySupport,
    scheduledOffers: plan.scheduledOffers,
    funnelChaining: plan.funnelChaining,
    csvExport: plan.csvExport,
  };
}

// --- Subscription helpers ---

export async function getShopSubscription(shop: string) {
  return db.subscription.findUnique({ where: { shop } });
}

export async function ensureSubscription(shop: string) {
  let sub = await db.subscription.findUnique({ where: { shop } });
  if (!sub) {
    sub = await db.subscription.create({
      data: { shop, plan: "free", status: "active" },
    });
  }
  return sub;
}

export function isTrialActive(sub: { trialEndsAt: Date | null }): boolean {
  if (!sub.trialEndsAt) return false;
  return new Date() < sub.trialEndsAt;
}

export async function getActivePlanLimits(shop: string) {
  const sub = await ensureSubscription(shop);

  // Active subscription — use plan limits
  if (sub.status === "active") {
    const plan = await getPlan(sub.plan);
    return getPlanLimits(plan);
  }

  // Cancelled but still within billing period — keep access
  if (sub.status === "cancelled" && sub.currentPeriodEnd && new Date() < sub.currentPeriodEnd) {
    const plan = await getPlan(sub.plan);
    return getPlanLimits(plan);
  }

  // Expired or no subscription — free limits
  return FREE_LIMITS;
}

/** Check if merchant still has access (active or in grace period) */
export function hasActiveAccess(sub: { status: string; currentPeriodEnd: Date | null }): boolean {
  if (sub.status === "active") return true;
  if (sub.status === "cancelled" && sub.currentPeriodEnd && new Date() < sub.currentPeriodEnd) return true;
  return false;
}

// --- Shopify Billing API ---

export async function createSubscriptionCharge(
  admin: any,
  shop: string,
  planSlug: string,
  returnUrl: string,
) {
  const plan = await getPlan(planSlug);
  if (!plan) throw new Error(`Unknown plan: ${planSlug}`);
  if (plan.price === 0) throw new Error("Cannot create charge for free plan");

  const response = await admin.graphql(
    `#graphql
    mutation appSubscriptionCreate(
      $name: String!
      $returnUrl: URL!
      $trialDays: Int!
      $amount: Decimal!
      $currencyCode: CurrencyCode!
    ) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        trialDays: $trialDays
        test: ${process.env.NODE_ENV !== "production" ? "true" : "false"}
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: $amount, currencyCode: $currencyCode }
              }
            }
          }
        ]
      ) {
        appSubscription {
          id
          status
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        name: `UpsellHive ${plan.name}`,
        returnUrl,
        trialDays: plan.trialDays,
        amount: plan.price,
        currencyCode: "USD",
      },
    },
  );

  const data = await response.json();
  const result = data.data?.appSubscriptionCreate;

  if (result?.userErrors?.length > 0) {
    throw new Error(result.userErrors.map((e: any) => e.message).join(", "));
  }

  return {
    subscriptionId: result?.appSubscription?.id,
    confirmationUrl: result?.confirmationUrl,
  };
}

export async function getActiveShopifySubscription(admin: any) {
  const response = await admin.graphql(
    `#graphql
    query {
      appInstallation {
        activeSubscriptions {
          id
          name
          status
          trialDays
          currentPeriodEnd
          test
        }
      }
    }`,
  );

  const data = await response.json();
  const subscriptions = data.data?.appInstallation?.activeSubscriptions || [];
  return subscriptions[0] || null;
}

export async function cancelSubscription(admin: any, subscriptionId: string) {
  const response = await admin.graphql(
    `#graphql
    mutation appSubscriptionCancel($id: ID!) {
      appSubscriptionCancel(id: $id) {
        appSubscription {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
    { variables: { id: subscriptionId } },
  );

  const data = await response.json();
  return data.data?.appSubscriptionCancel;
}

export async function syncSubscriptionStatus(admin: any, shop: string) {
  const activeSub = await getActiveShopifySubscription(admin);

  if (activeSub) {
    // Match plan by name from DB
    const allPlans = await db.plan.findMany();
    const matchedPlan = allPlans.find((p) =>
      activeSub.name?.includes(p.name),
    );
    const planSlug = matchedPlan?.slug || "free";

    await db.subscription.upsert({
      where: { shop },
      update: {
        plan: planSlug,
        status: activeSub.status === "ACTIVE" ? "active" : "pending",
        shopifyChargeId: activeSub.id,
        currentPeriodEnd: activeSub.currentPeriodEnd
          ? new Date(activeSub.currentPeriodEnd)
          : null,
      },
      create: {
        shop,
        plan: planSlug,
        status: "active",
        shopifyChargeId: activeSub.id,
        trialStartsAt: new Date(),
        trialEndsAt: activeSub.trialDays
          ? new Date(Date.now() + activeSub.trialDays * 86400000)
          : null,
        currentPeriodEnd: activeSub.currentPeriodEnd
          ? new Date(activeSub.currentPeriodEnd)
          : null,
      },
    });

    return { plan: planSlug, status: "active" };
  }

  // No active Shopify subscription — check if we have a cancelled sub with grace period
  const existingSub = await db.subscription.findUnique({ where: { shop } });

  if (existingSub && existingSub.status === "cancelled" && existingSub.currentPeriodEnd && new Date() < existingSub.currentPeriodEnd) {
    // Still in grace period — keep the plan but mark as cancelled
    return { plan: existingSub.plan, status: "cancelled" };
  }

  // Grace period expired or no subscription — downgrade to free
  await db.subscription.upsert({
    where: { shop },
    update: { plan: "free", status: "active", shopifyChargeId: null, currentPeriodEnd: null },
    create: { shop, plan: "free", status: "active" },
  });

  return { plan: "free", status: "active" };
}
