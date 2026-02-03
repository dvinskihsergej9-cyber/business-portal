/*
  Warnings:

  - You are about to alter the column `metadata` on the `Payment` table. The data in that column could be lost. The data in that column will be cast from `Unsupported("json")` to `Json`.

*/
-- CreateTable
CREATE TABLE "WarehouseReceivingLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "remainingQty" INTEGER NOT NULL,
    "manufacturedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "locationId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "placedAt" DATETIME,
    "placedById" INTEGER,
    CONSTRAINT "WarehouseReceivingLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WarehouseReceivingLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WarehouseReceivingLine_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WarehouseReceivingLine_placedById_fkey" FOREIGN KEY ("placedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Payment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Payment" ("amount", "createdAt", "currency", "id", "metadata", "provider", "providerPaymentId", "status", "userId") SELECT "amount", "createdAt", "currency", "id", "metadata", "provider", "providerPaymentId", "status", "userId" FROM "Payment";
DROP TABLE "Payment";
ALTER TABLE "new_Payment" RENAME TO "Payment";
CREATE UNIQUE INDEX "Payment_provider_providerPaymentId_key" ON "Payment"("provider", "providerPaymentId");
CREATE TABLE "new_StockRevisionItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "revisionId" INTEGER NOT NULL,
    "discrepancyId" INTEGER,
    "locationId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "countedQty" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "appliedAt" DATETIME,
    "appliedByUserId" INTEGER,
    "appliedMovementOpId" TEXT,
    "note" TEXT,
    CONSTRAINT "StockRevisionItem_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "StockRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRevisionItem_discrepancyId_fkey" FOREIGN KEY ("discrepancyId") REFERENCES "StockDiscrepancy" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRevisionItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRevisionItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRevisionItem_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StockRevisionItem" ("appliedAt", "appliedByUserId", "appliedMovementOpId", "countedQty", "delta", "discrepancyId", "expectedQty", "id", "itemId", "locationId", "note", "revisionId", "status") SELECT "appliedAt", "appliedByUserId", "appliedMovementOpId", "countedQty", "delta", "discrepancyId", "expectedQty", "id", "itemId", "locationId", "note", "revisionId", "status" FROM "StockRevisionItem";
DROP TABLE "StockRevisionItem";
ALTER TABLE "new_StockRevisionItem" RENAME TO "StockRevisionItem";
CREATE TABLE "new_Subscription" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "plan" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paidUntil" DATETIME,
    "trialStartedAt" DATETIME,
    "trialUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Subscription" ("createdAt", "id", "paidUntil", "plan", "status", "trialStartedAt", "trialUsed", "updatedAt", "userId") SELECT "createdAt", "id", "paidUntil", "plan", "status", "trialStartedAt", "trialUsed", "updatedAt", "userId" FROM "Subscription";
DROP TABLE "Subscription";
ALTER TABLE "new_Subscription" RENAME TO "Subscription";
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "WarehouseReceivingLine_status_idx" ON "WarehouseReceivingLine"("status");

-- CreateIndex
CREATE INDEX "WarehouseReceivingLine_itemId_idx" ON "WarehouseReceivingLine"("itemId");

-- CreateIndex
CREATE INDEX "WarehouseReceivingLine_locationId_idx" ON "WarehouseReceivingLine"("locationId");
