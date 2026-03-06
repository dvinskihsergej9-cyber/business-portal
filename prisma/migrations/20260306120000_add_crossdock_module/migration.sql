-- CreateEnum
CREATE TYPE "CrossdockDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CrossdockStatus" AS ENUM ('PLANNED', 'ARRIVED', 'AT_DOCK', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "CrossdockDock" (
  "id" SERIAL NOT NULL,
  "orgId" INTEGER,
  "code" TEXT NOT NULL,
  "name" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CrossdockDock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrossdockOperation" (
  "id" SERIAL NOT NULL,
  "orgId" INTEGER,
  "direction" "CrossdockDirection" NOT NULL,
  "status" "CrossdockStatus" NOT NULL DEFAULT 'PLANNED',
  "dockId" INTEGER,
  "referenceNumber" TEXT,
  "partnerName" TEXT,
  "truckNumber" TEXT,
  "cargoSummary" TEXT,
  "plannedAt" TIMESTAMP(3),
  "actualArrivalAt" TIMESTAMP(3),
  "atDockAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "note" TEXT,
  "createdByUserId" INTEGER,
  "updatedByUserId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CrossdockOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrossdockDock_orgId_code_key" ON "CrossdockDock"("orgId", "code");
CREATE INDEX "CrossdockDock_orgId_isActive_idx" ON "CrossdockDock"("orgId", "isActive");

-- CreateIndex
CREATE INDEX "CrossdockOperation_orgId_status_plannedAt_idx" ON "CrossdockOperation"("orgId", "status", "plannedAt");
CREATE INDEX "CrossdockOperation_orgId_direction_status_idx" ON "CrossdockOperation"("orgId", "direction", "status");
CREATE INDEX "CrossdockOperation_dockId_idx" ON "CrossdockOperation"("dockId");

-- AddForeignKey
ALTER TABLE "CrossdockOperation"
  ADD CONSTRAINT "CrossdockOperation_dockId_fkey"
  FOREIGN KEY ("dockId") REFERENCES "CrossdockDock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CrossdockOperation"
  ADD CONSTRAINT "CrossdockOperation_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CrossdockOperation"
  ADD CONSTRAINT "CrossdockOperation_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
