-- CreateTable: Plan
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trialDays" INTEGER NOT NULL DEFAULT 3,
    "maxOffers" INTEGER NOT NULL DEFAULT 2,
    "abTesting" BOOLEAN NOT NULL DEFAULT false,
    "analytics" BOOLEAN NOT NULL DEFAULT false,
    "customBranding" BOOLEAN NOT NULL DEFAULT false,
    "prioritySupport" BOOLEAN NOT NULL DEFAULT false,
    "scheduledOffers" BOOLEAN NOT NULL DEFAULT false,
    "funnelChaining" BOOLEAN NOT NULL DEFAULT false,
    "csvExport" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

-- CreateTable: Subscription
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "shopifyChargeId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "trialStartsAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_shop_key" ON "Subscription"("shop");

-- CreateTable: AdminConfig
CREATE TABLE "AdminConfig" (
    "id" TEXT NOT NULL DEFAULT 'admin_config',
    "password" TEXT NOT NULL DEFAULT 'Admin@e07a595',
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminConfig_pkey" PRIMARY KEY ("id")
);

-- Seed default plans
INSERT INTO "Plan" ("id", "name", "slug", "price", "trialDays", "maxOffers", "abTesting", "analytics", "customBranding", "prioritySupport", "scheduledOffers", "funnelChaining", "csvExport", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('plan_free', 'Free', 'free', 0, 0, 2, false, false, false, false, false, false, false, true, 0, NOW(), NOW()),
  ('plan_starter', 'Starter', 'starter', 9.99, 3, 10, true, true, true, false, false, false, false, true, 1, NOW(), NOW()),
  ('plan_pro', 'Pro', 'pro', 29.99, 3, -1, true, true, true, true, true, true, true, true, 2, NOW(), NOW());
