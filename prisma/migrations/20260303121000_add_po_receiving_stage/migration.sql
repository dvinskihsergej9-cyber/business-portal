-- CreateEnum
CREATE TYPE "PurchaseOrderReceivingStage" AS ENUM ('NEW', 'IN_PROGRESS', 'CONFIRMED', 'FINALIZED');

-- AlterTable
ALTER TABLE "PurchaseOrder"
  ADD COLUMN "receivingStage" "PurchaseOrderReceivingStage" NOT NULL DEFAULT 'NEW';

-- Backfill based on existing status
UPDATE "PurchaseOrder"
SET "receivingStage" = CASE
  WHEN "status" IN ('RECEIVED', 'CLOSED') THEN 'FINALIZED'::"PurchaseOrderReceivingStage"
  WHEN "status" = 'PARTIAL' THEN 'CONFIRMED'::"PurchaseOrderReceivingStage"
  ELSE 'NEW'::"PurchaseOrderReceivingStage"
END;
