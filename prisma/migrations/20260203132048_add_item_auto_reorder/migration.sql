-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "qrCode" TEXT,
    "unit" TEXT,
    "minStock" REAL,
    "maxStock" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "defaultPrice" REAL,
    "category" TEXT NOT NULL DEFAULT 'STOCK',
    "autoReorderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoReorderMin" REAL,
    "autoReorderSupplierId" INTEGER,
    "autoReorderContactName" TEXT,
    "autoReorderContactEmail" TEXT,
    "autoReorderMessage" TEXT,
    "autoReorderActive" BOOLEAN NOT NULL DEFAULT false,
    "autoReorderLastTriggeredAt" DATETIME,
    "autoReorderLastReminderAt" DATETIME,
    "autoReorderLastOrderId" INTEGER,
    CONSTRAINT "Item_autoReorderSupplierId_fkey" FOREIGN KEY ("autoReorderSupplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Item" ("barcode", "category", "createdAt", "defaultPrice", "id", "maxStock", "minStock", "name", "qrCode", "sku", "unit", "updatedAt") SELECT "barcode", "category", "createdAt", "defaultPrice", "id", "maxStock", "minStock", "name", "qrCode", "sku", "unit", "updatedAt" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
CREATE UNIQUE INDEX "Item_sku_key" ON "Item"("sku");
CREATE UNIQUE INDEX "Item_barcode_key" ON "Item"("barcode");
CREATE UNIQUE INDEX "Item_qrCode_key" ON "Item"("qrCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
