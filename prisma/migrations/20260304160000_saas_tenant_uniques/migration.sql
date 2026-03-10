-- Make tenant-scoped uniqueness explicit for SaaS isolation.
-- Warehouse location codes/QR must be unique inside one organization only.
DROP INDEX IF EXISTS "WarehouseLocation_code_key";
DROP INDEX IF EXISTS "WarehouseLocation_qrCode_key";
CREATE UNIQUE INDEX IF NOT EXISTS "WarehouseLocation_orgId_code_key"
  ON "WarehouseLocation"("orgId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "WarehouseLocation_orgId_qrCode_key"
  ON "WarehouseLocation"("orgId", "qrCode");

-- External order id must be unique per organization.
DROP INDEX IF EXISTS "SalesOrder_externalOrderId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "SalesOrder_orgId_externalOrderId_key"
  ON "SalesOrder"("orgId", "externalOrderId");
