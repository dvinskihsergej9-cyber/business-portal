-- Add stock revision snapshot tables
CREATE TABLE "StockRevision" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" INTEGER,
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "StockRevisionItem" (
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
  FOREIGN KEY ("revisionId") REFERENCES "StockRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("discrepancyId") REFERENCES "StockDiscrepancy"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("appliedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
