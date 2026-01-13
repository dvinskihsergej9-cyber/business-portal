-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN "fromLocationId" INTEGER;
ALTER TABLE "StockMovement" ADD COLUMN "locationId" INTEGER;
ALTER TABLE "StockMovement" ADD COLUMN "opId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "refId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "refType" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "toLocationId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_opId_key" ON "StockMovement"("opId");
