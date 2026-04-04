/*
  Warnings:

  - You are about to drop the column `enabled` on the `UpsellOffer` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "status" TEXT NOT NULL DEFAULT 'active',
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "scheduledStart" DATETIME,
    "scheduledEnd" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "fallbackOfferId" TEXT,
    "abTestId" TEXT,
    CONSTRAINT "UpsellOffer_abTestId_fkey" FOREIGN KEY ("abTestId") REFERENCES "ABTest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_UpsellOffer" ("abTestId", "createdAt", "ctaText", "description", "discountType", "discountValue", "fallbackOfferId", "id", "priority", "productId", "productImage", "productPrice", "productTitle", "scheduledEnd", "scheduledStart", "shop", "testMode", "timeLimitMinutes", "title", "updatedAt", "variantId") SELECT "abTestId", "createdAt", "ctaText", "description", "discountType", "discountValue", "fallbackOfferId", "id", "priority", "productId", "productImage", "productPrice", "productTitle", "scheduledEnd", "scheduledStart", "shop", "testMode", "timeLimitMinutes", "title", "updatedAt", "variantId" FROM "UpsellOffer";
DROP TABLE "UpsellOffer";
ALTER TABLE "new_UpsellOffer" RENAME TO "UpsellOffer";
CREATE INDEX "UpsellOffer_shop_idx" ON "UpsellOffer"("shop");
CREATE INDEX "UpsellOffer_shop_status_idx" ON "UpsellOffer"("shop", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
