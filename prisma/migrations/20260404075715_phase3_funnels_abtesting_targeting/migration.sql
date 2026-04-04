-- CreateTable
CREATE TABLE "ABTest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "splitPercent" INTEGER NOT NULL DEFAULT 50,
    "winnerId" TEXT,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AnalyticsEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "orderId" TEXT,
    "revenue" REAL,
    "funnelStep" INTEGER NOT NULL DEFAULT 1,
    "abTestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalyticsEvent_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "UpsellOffer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AnalyticsEvent" ("createdAt", "eventType", "id", "offerId", "orderId", "revenue", "shop") SELECT "createdAt", "eventType", "id", "offerId", "orderId", "revenue", "shop" FROM "AnalyticsEvent";
DROP TABLE "AnalyticsEvent";
ALTER TABLE "new_AnalyticsEvent" RENAME TO "AnalyticsEvent";
CREATE TABLE "new_UpsellOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "discountValue" REAL NOT NULL,
    "timeLimitMinutes" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "fallbackOfferId" TEXT,
    "abTestId" TEXT,
    CONSTRAINT "UpsellOffer_abTestId_fkey" FOREIGN KEY ("abTestId") REFERENCES "ABTest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_UpsellOffer" ("createdAt", "ctaText", "description", "discountType", "discountValue", "enabled", "id", "priority", "productId", "productImage", "productPrice", "productTitle", "shop", "testMode", "timeLimitMinutes", "title", "updatedAt", "variantId") SELECT "createdAt", "ctaText", "description", "discountType", "discountValue", "enabled", "id", "priority", "productId", "productImage", "productPrice", "productTitle", "shop", "testMode", "timeLimitMinutes", "title", "updatedAt", "variantId" FROM "UpsellOffer";
DROP TABLE "UpsellOffer";
ALTER TABLE "new_UpsellOffer" RENAME TO "UpsellOffer";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
