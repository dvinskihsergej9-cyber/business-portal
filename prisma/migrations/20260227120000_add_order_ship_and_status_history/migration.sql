-- AlterTable
ALTER TABLE "SalesOrder"
  ADD COLUMN "shippedAt" TIMESTAMP(3),
  ADD COLUMN "shippedByUserId" INTEGER,
  ADD COLUMN "carrier" TEXT,
  ADD COLUMN "trackingNumber" TEXT,
  ADD COLUMN "shipNotes" TEXT;

-- AddForeignKey
ALTER TABLE "SalesOrder"
  ADD CONSTRAINT "SalesOrder_shippedByUserId_fkey"
  FOREIGN KEY ("shippedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "SalesOrder_shippedByUserId_idx" ON "SalesOrder"("shippedByUserId");

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
  "id" SERIAL NOT NULL,
  "orgId" INTEGER,
  "orderId" INTEGER NOT NULL,
  "fromStatus" "SalesOrderStatus",
  "toStatus" "SalesOrderStatus" NOT NULL,
  "eventType" TEXT NOT NULL,
  "actorUserId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metaJson" JSONB,

  CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "OrderStatusHistory"
  ADD CONSTRAINT "OrderStatusHistory_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory"
  ADD CONSTRAINT "OrderStatusHistory_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orgId_createdAt_idx" ON "OrderStatusHistory"("orgId", "createdAt");
CREATE INDEX "OrderStatusHistory_orgId_orderId_createdAt_idx" ON "OrderStatusHistory"("orgId", "orderId", "createdAt");
CREATE INDEX "OrderStatusHistory_orgId_toStatus_createdAt_idx" ON "OrderStatusHistory"("orgId", "toStatus", "createdAt");