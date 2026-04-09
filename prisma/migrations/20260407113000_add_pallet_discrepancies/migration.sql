DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PalletDiscrepancyStatus') THEN
    CREATE TYPE "PalletDiscrepancyStatus" AS ENUM ('OPEN', 'CLOSED');
  END IF;
END $$;

ALTER TYPE "PalletEventType" ADD VALUE IF NOT EXISTS 'DISCREPANCY_OPEN';
ALTER TYPE "PalletEventType" ADD VALUE IF NOT EXISTS 'DISCREPANCY_CLOSE';

CREATE TABLE IF NOT EXISTS "PalletDiscrepancy" (
  "id" SERIAL NOT NULL,
  "orgId" INTEGER,
  "palletId" INTEGER NOT NULL,
  "locationId" INTEGER,
  "status" "PalletDiscrepancyStatus" NOT NULL DEFAULT 'OPEN',
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "detectedByUserId" INTEGER,
  "lastCheckedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "closedByUserId" INTEGER,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PalletDiscrepancy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PalletDiscrepancy_orgId_status_detectedAt_idx"
  ON "PalletDiscrepancy" ("orgId", "status", "detectedAt");
CREATE INDEX IF NOT EXISTS "PalletDiscrepancy_orgId_palletId_status_idx"
  ON "PalletDiscrepancy" ("orgId", "palletId", "status");
CREATE INDEX IF NOT EXISTS "PalletDiscrepancy_orgId_locationId_status_idx"
  ON "PalletDiscrepancy" ("orgId", "locationId", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PalletDiscrepancy_palletId_fkey'
  ) THEN
    ALTER TABLE "PalletDiscrepancy"
      ADD CONSTRAINT "PalletDiscrepancy_palletId_fkey"
      FOREIGN KEY ("palletId") REFERENCES "Pallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PalletDiscrepancy_locationId_fkey'
  ) THEN
    ALTER TABLE "PalletDiscrepancy"
      ADD CONSTRAINT "PalletDiscrepancy_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "PalletLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PalletDiscrepancy_detectedByUserId_fkey'
  ) THEN
    ALTER TABLE "PalletDiscrepancy"
      ADD CONSTRAINT "PalletDiscrepancy_detectedByUserId_fkey"
      FOREIGN KEY ("detectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PalletDiscrepancy_closedByUserId_fkey'
  ) THEN
    ALTER TABLE "PalletDiscrepancy"
      ADD CONSTRAINT "PalletDiscrepancy_closedByUserId_fkey"
      FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
