-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpsellOffer" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ctaText" TEXT NOT NULL DEFAULT 'Add to Order',
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productImage" TEXT,
    "productPrice" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" DOUBLE PRECISION NOT NULL,
    "timeLimitMinutes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "scheduledStart" TIMESTAMP(3),
    "scheduledEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fallbackOfferId" TEXT,
    "abTestId" TEXT,

    CONSTRAINT "UpsellOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetingRule" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "offerId" TEXT,
    "eventType" TEXT NOT NULL,
    "orderId" TEXT,
    "revenue" DOUBLE PRECISION,
    "funnelStep" INTEGER NOT NULL DEFAULT 1,
    "abTestId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ABTest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "splitPercent" INTEGER NOT NULL DEFAULT 50,
    "winnerId" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ABTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WidgetConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "widgetType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "settings" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WidgetConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyQuestion" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "questionType" TEXT NOT NULL DEFAULT 'rating',
    "options" TEXT NOT NULL DEFAULT '[]',
    "position" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyResponse" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "orderId" TEXT,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandingConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "primaryColor" TEXT NOT NULL DEFAULT '#000000',
    "accentColor" TEXT NOT NULL DEFAULT '#22c55e',
    "buttonStyle" TEXT NOT NULL DEFAULT 'rounded',
    "showTrustBadges" BOOLEAN NOT NULL DEFAULT true,
    "customMessage" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UpsellOffer_shop_idx" ON "UpsellOffer"("shop");

-- CreateIndex
CREATE INDEX "UpsellOffer_shop_status_idx" ON "UpsellOffer"("shop", "status");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_shop_idx" ON "AnalyticsEvent"("shop");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_offerId_idx" ON "AnalyticsEvent"("offerId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventType_idx" ON "AnalyticsEvent"("eventType");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WidgetConfig_shop_widgetType_key" ON "WidgetConfig"("shop", "widgetType");

-- CreateIndex
CREATE UNIQUE INDEX "BrandingConfig_shop_key" ON "BrandingConfig"("shop");

-- AddForeignKey
ALTER TABLE "UpsellOffer" ADD CONSTRAINT "UpsellOffer_abTestId_fkey" FOREIGN KEY ("abTestId") REFERENCES "ABTest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetingRule" ADD CONSTRAINT "TargetingRule_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "UpsellOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "UpsellOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "SurveyQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

