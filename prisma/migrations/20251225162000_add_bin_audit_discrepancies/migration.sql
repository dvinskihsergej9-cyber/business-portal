-- CreateTable
CREATE TABLE "BinAuditSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "startedByUserId" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT "BinAuditSession_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BinAuditEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" TEXT NOT NULL,
    "note" TEXT,
    CONSTRAINT "BinAuditEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BinAuditSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BinAuditEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockDiscrepancy" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER,
    "locationId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "countedQty" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "closedByUserId" INTEGER,
    "closeNote" TEXT,
    "movementOpId" TEXT,
    CONSTRAINT "StockDiscrepancy_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BinAuditSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockDiscrepancy_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockDiscrepancy_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockDiscrepancy_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
