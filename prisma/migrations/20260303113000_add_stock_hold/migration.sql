-- CreateEnum
CREATE TYPE "StockHoldStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateTable
CREATE TABLE "StockHold" (
  "id" SERIAL NOT NULL,
  "orgId" INTEGER,
  "itemId" INTEGER NOT NULL,
  "locationId" INTEGER NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL,
  "status" "StockHoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" INTEGER,
  "releasedAt" TIMESTAMP(3),
  "releasedByUserId" INTEGER,
  "releaseNote" TEXT,

  CONSTRAINT "StockHold_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "StockHold"
  ADD CONSTRAINT "StockHold_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockHold"
  ADD CONSTRAINT "StockHold_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockHold"
  ADD CONSTRAINT "StockHold_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockHold"
  ADD CONSTRAINT "StockHold_releasedByUserId_fkey"
  FOREIGN KEY ("releasedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "StockHold_orgId_status_createdAt_idx" ON "StockHold"("orgId", "status", "createdAt");
CREATE INDEX "StockHold_orgId_itemId_locationId_status_idx" ON "StockHold"("orgId", "itemId", "locationId", "status");
CREATE INDEX "StockHold_orgId_locationId_status_idx" ON "StockHold"("orgId", "locationId", "status");
