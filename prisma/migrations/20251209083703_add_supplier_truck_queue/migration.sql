-- CreateTable
CREATE TABLE "SupplierTruck" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" TEXT NOT NULL DEFAULT 'IN_QUEUE',
    "arrivalAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unloadStartAt" DATETIME,
    "unloadEndAt" DATETIME,
    "supplier" TEXT,
    "orderNumber" TEXT,
    "deliveryDate" DATETIME,
    "vehicleBrand" TEXT,
    "truckNumber" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "gate" TEXT,
    "cargo" TEXT,
    "note" TEXT,
    "directImport" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
