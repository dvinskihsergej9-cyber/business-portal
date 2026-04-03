CREATE TYPE "RouteSheetStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'LOADING', 'COMPLETED', 'CANCELLED');
CREATE TYPE "RouteSheetItemStatus" AS ENUM ('PLANNED', 'LOADED', 'CANCELLED');
CREATE TYPE "RouteSheetEventType" AS ENUM ('CREATE', 'ADD_ITEM', 'REMOVE_ITEM', 'PUBLISH', 'START_LOADING', 'LOAD_PALLET', 'COMPLETE', 'CANCEL');

ALTER TABLE "PalletDispatch"
ADD COLUMN "routeSheetId" INTEGER,
ADD COLUMN "routeSheetItemId" INTEGER;

CREATE TABLE "PalletRouteSheet" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER,
    "sheetNumber" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "destinationRc" TEXT NOT NULL,
    "route" TEXT,
    "vehicle" TEXT,
    "driver" TEXT,
    "plannedDate" TIMESTAMP(3),
    "notes" TEXT,
    "status" "RouteSheetStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" INTEGER NOT NULL,
    "publishedByUserId" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "startedByUserId" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedByUserId" INTEGER,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PalletRouteSheet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PalletRouteSheetItem" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER,
    "routeSheetId" INTEGER NOT NULL,
    "palletId" INTEGER NOT NULL,
    "status" "RouteSheetItemStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loadedAt" TIMESTAMP(3),
    "loadedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PalletRouteSheetItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PalletRouteSheetEvent" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER,
    "routeSheetId" INTEGER NOT NULL,
    "itemId" INTEGER,
    "type" "RouteSheetEventType" NOT NULL,
    "userId" INTEGER,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PalletRouteSheetEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PalletRouteSheet_orgId_sheetNumber_key" ON "PalletRouteSheet"("orgId", "sheetNumber");
CREATE INDEX "PalletRouteSheet_orgId_status_plannedDate_createdAt_idx" ON "PalletRouteSheet"("orgId", "status", "plannedDate", "createdAt");

CREATE UNIQUE INDEX "PalletRouteSheetItem_orgId_routeSheetId_palletId_key" ON "PalletRouteSheetItem"("orgId", "routeSheetId", "palletId");
CREATE INDEX "PalletRouteSheetItem_orgId_palletId_status_idx" ON "PalletRouteSheetItem"("orgId", "palletId", "status");
CREATE INDEX "PalletRouteSheetItem_orgId_routeSheetId_status_plannedAt_idx" ON "PalletRouteSheetItem"("orgId", "routeSheetId", "status", "plannedAt");

CREATE INDEX "PalletRouteSheetEvent_orgId_routeSheetId_createdAt_idx" ON "PalletRouteSheetEvent"("orgId", "routeSheetId", "createdAt");
CREATE INDEX "PalletRouteSheetEvent_orgId_itemId_createdAt_idx" ON "PalletRouteSheetEvent"("orgId", "itemId", "createdAt");

CREATE UNIQUE INDEX "PalletDispatch_routeSheetItemId_key" ON "PalletDispatch"("routeSheetItemId");
CREATE INDEX "PalletDispatch_orgId_routeSheetId_dispatchedAt_idx" ON "PalletDispatch"("orgId", "routeSheetId", "dispatchedAt");

ALTER TABLE "PalletRouteSheet"
ADD CONSTRAINT "PalletRouteSheet_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PalletRouteSheet"
ADD CONSTRAINT "PalletRouteSheet_publishedByUserId_fkey"
FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PalletRouteSheet"
ADD CONSTRAINT "PalletRouteSheet_startedByUserId_fkey"
FOREIGN KEY ("startedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PalletRouteSheet"
ADD CONSTRAINT "PalletRouteSheet_completedByUserId_fkey"
FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PalletRouteSheetItem"
ADD CONSTRAINT "PalletRouteSheetItem_routeSheetId_fkey"
FOREIGN KEY ("routeSheetId") REFERENCES "PalletRouteSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PalletRouteSheetItem"
ADD CONSTRAINT "PalletRouteSheetItem_palletId_fkey"
FOREIGN KEY ("palletId") REFERENCES "Pallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PalletRouteSheetItem"
ADD CONSTRAINT "PalletRouteSheetItem_loadedByUserId_fkey"
FOREIGN KEY ("loadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PalletRouteSheetEvent"
ADD CONSTRAINT "PalletRouteSheetEvent_routeSheetId_fkey"
FOREIGN KEY ("routeSheetId") REFERENCES "PalletRouteSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PalletRouteSheetEvent"
ADD CONSTRAINT "PalletRouteSheetEvent_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "PalletRouteSheetItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PalletRouteSheetEvent"
ADD CONSTRAINT "PalletRouteSheetEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PalletDispatch"
ADD CONSTRAINT "PalletDispatch_routeSheetId_fkey"
FOREIGN KEY ("routeSheetId") REFERENCES "PalletRouteSheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PalletDispatch"
ADD CONSTRAINT "PalletDispatch_routeSheetItemId_fkey"
FOREIGN KEY ("routeSheetItemId") REFERENCES "PalletRouteSheetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
