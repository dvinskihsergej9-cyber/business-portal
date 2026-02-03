-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WarehouseReceivingLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "remainingQty" INTEGER NOT NULL,
    "manufacturedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sourceType" TEXT NOT NULL DEFAULT 'RECEIVING',
    "discrepancyId" INTEGER,
    "locationId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "placedAt" DATETIME,
    "placedById" INTEGER,
    CONSTRAINT "WarehouseReceivingLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WarehouseReceivingLine_discrepancyId_fkey" FOREIGN KEY ("discrepancyId") REFERENCES "StockDiscrepancy" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WarehouseReceivingLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WarehouseReceivingLine_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WarehouseReceivingLine_placedById_fkey" FOREIGN KEY ("placedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WarehouseReceivingLine" ("createdAt", "createdById", "expiresAt", "id", "itemId", "locationId", "manufacturedAt", "placedAt", "placedById", "qty", "remainingQty", "status") SELECT "createdAt", "createdById", "expiresAt", "id", "itemId", "locationId", "manufacturedAt", "placedAt", "placedById", "qty", "remainingQty", "status" FROM "WarehouseReceivingLine";
DROP TABLE "WarehouseReceivingLine";
ALTER TABLE "new_WarehouseReceivingLine" RENAME TO "WarehouseReceivingLine";
CREATE INDEX "WarehouseReceivingLine_status_idx" ON "WarehouseReceivingLine"("status");
CREATE INDEX "WarehouseReceivingLine_itemId_idx" ON "WarehouseReceivingLine"("itemId");
CREATE INDEX "WarehouseReceivingLine_locationId_idx" ON "WarehouseReceivingLine"("locationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
