-- CreateTable
CREATE TABLE "Organization" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "plan" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paidUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "userId" INTEGER,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BinAuditEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "sessionId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" TEXT NOT NULL,
    "note" TEXT,
    CONSTRAINT "BinAuditEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BinAuditSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BinAuditEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BinAuditEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BinAuditEvent" ("checkedAt", "id", "locationId", "note", "result", "sessionId") SELECT "checkedAt", "id", "locationId", "note", "result", "sessionId" FROM "BinAuditEvent";
DROP TABLE "BinAuditEvent";
ALTER TABLE "new_BinAuditEvent" RENAME TO "BinAuditEvent";
CREATE UNIQUE INDEX "BinAuditEvent_id_orgId_key" ON "BinAuditEvent"("id", "orgId");
CREATE TABLE "new_BinAuditSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "startedByUserId" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT "BinAuditSession_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BinAuditSession_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BinAuditSession" ("finishedAt", "id", "startedAt", "startedByUserId", "status") SELECT "finishedAt", "id", "startedAt", "startedByUserId", "status" FROM "BinAuditSession";
DROP TABLE "BinAuditSession";
ALTER TABLE "new_BinAuditSession" RENAME TO "BinAuditSession";
CREATE UNIQUE INDEX "BinAuditSession_id_orgId_key" ON "BinAuditSession"("id", "orgId");
CREATE TABLE "new_Employee" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "fullName" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "telegramChatId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "hiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "birthDate" DATETIME,
    "leaveRegionCategory" TEXT NOT NULL DEFAULT 'STANDARD',
    "annualLeaveDays" INTEGER NOT NULL DEFAULT 28,
    "leaveOverrideDays" INTEGER,
    CONSTRAINT "Employee_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Employee" ("annualLeaveDays", "birthDate", "createdAt", "department", "fullName", "hiredAt", "id", "leaveOverrideDays", "leaveRegionCategory", "position", "status", "telegramChatId", "updatedAt") SELECT "annualLeaveDays", "birthDate", "createdAt", "department", "fullName", "hiredAt", "id", "leaveOverrideDays", "leaveRegionCategory", "position", "status", "telegramChatId", "updatedAt" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
CREATE UNIQUE INDEX "Employee_id_orgId_key" ON "Employee"("id", "orgId");
CREATE TABLE "new_HrLeaveApplication" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "employeeId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "days" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "reason" TEXT,
    "docText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HrLeaveApplication_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HrLeaveApplication_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_HrLeaveApplication" ("createdAt", "days", "docText", "employeeId", "endDate", "id", "reason", "startDate", "status", "type", "updatedAt") SELECT "createdAt", "days", "docText", "employeeId", "endDate", "id", "reason", "startDate", "status", "type", "updatedAt" FROM "HrLeaveApplication";
DROP TABLE "HrLeaveApplication";
ALTER TABLE "new_HrLeaveApplication" RENAME TO "HrLeaveApplication";
CREATE UNIQUE INDEX "HrLeaveApplication_id_orgId_key" ON "HrLeaveApplication"("id", "orgId");
CREATE TABLE "new_InviteToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdByUserId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InviteToken_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InviteToken_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_InviteToken" ("createdAt", "createdByUserId", "email", "expiresAt", "id", "role", "tokenHash", "usedAt") SELECT "createdAt", "createdByUserId", "email", "expiresAt", "id", "role", "tokenHash", "usedAt" FROM "InviteToken";
DROP TABLE "InviteToken";
ALTER TABLE "new_InviteToken" RENAME TO "InviteToken";
CREATE UNIQUE INDEX "InviteToken_tokenHash_key" ON "InviteToken"("tokenHash");
CREATE UNIQUE INDEX "InviteToken_id_orgId_key" ON "InviteToken"("id", "orgId");
CREATE TABLE "new_Item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
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
    CONSTRAINT "Item_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Item" ("barcode", "createdAt", "defaultPrice", "id", "maxStock", "minStock", "name", "qrCode", "sku", "unit", "updatedAt") SELECT "barcode", "createdAt", "defaultPrice", "id", "maxStock", "minStock", "name", "qrCode", "sku", "unit", "updatedAt" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
CREATE UNIQUE INDEX "Item_sku_key" ON "Item"("sku");
CREATE UNIQUE INDEX "Item_barcode_key" ON "Item"("barcode");
CREATE UNIQUE INDEX "Item_qrCode_key" ON "Item"("qrCode");
CREATE UNIQUE INDEX "Item_id_orgId_key" ON "Item"("id", "orgId");
CREATE TABLE "new_LeaveRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeaveRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeaveRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LeaveRequest" ("comment", "createdAt", "endDate", "id", "startDate", "status", "type", "updatedAt", "userId") SELECT "comment", "createdAt", "endDate", "id", "startDate", "status", "type", "updatedAt", "userId" FROM "LeaveRequest";
DROP TABLE "LeaveRequest";
ALTER TABLE "new_LeaveRequest" RENAME TO "LeaveRequest";
CREATE UNIQUE INDEX "LeaveRequest_id_orgId_key" ON "LeaveRequest"("id", "orgId");
CREATE TABLE "new_OrgProfile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "orgName" TEXT NOT NULL,
    "legalAddress" TEXT NOT NULL,
    "actualAddress" TEXT NOT NULL,
    "inn" TEXT NOT NULL,
    "kpp" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrgProfile_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OrgProfile" ("actualAddress", "id", "inn", "kpp", "legalAddress", "orgName", "phone", "updatedAt") SELECT "actualAddress", "id", "inn", "kpp", "legalAddress", "orgName", "phone", "updatedAt" FROM "OrgProfile";
DROP TABLE "OrgProfile";
ALTER TABLE "new_OrgProfile" RENAME TO "OrgProfile";
CREATE UNIQUE INDEX "OrgProfile_orgId_key" ON "OrgProfile"("orgId");
CREATE UNIQUE INDEX "OrgProfile_id_orgId_key" ON "OrgProfile"("id", "orgId");
CREATE TABLE "new_PaymentRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "expenseCode" TEXT,
    "dueDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PaymentRequest" ("amount", "comment", "createdAt", "currency", "dueDate", "expenseCode", "id", "status", "title", "updatedAt", "userId") SELECT "amount", "comment", "createdAt", "currency", "dueDate", "expenseCode", "id", "status", "title", "updatedAt", "userId" FROM "PaymentRequest";
DROP TABLE "PaymentRequest";
ALTER TABLE "new_PaymentRequest" RENAME TO "PaymentRequest";
CREATE UNIQUE INDEX "PaymentRequest_id_orgId_key" ON "PaymentRequest"("id", "orgId");
CREATE TABLE "new_PurchaseOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "number" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plannedDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "supplierId" INTEGER NOT NULL,
    "comment" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseOrder" ("comment", "createdAt", "createdById", "date", "id", "number", "plannedDate", "status", "supplierId", "updatedAt") SELECT "comment", "createdAt", "createdById", "date", "id", "number", "plannedDate", "status", "supplierId", "updatedAt" FROM "PurchaseOrder";
DROP TABLE "PurchaseOrder";
ALTER TABLE "new_PurchaseOrder" RENAME TO "PurchaseOrder";
CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");
CREATE UNIQUE INDEX "PurchaseOrder_id_orgId_key" ON "PurchaseOrder"("id", "orgId");
CREATE TABLE "new_PurchaseOrderItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "orderId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "quantity" REAL NOT NULL,
    "receivedQty" REAL NOT NULL DEFAULT 0,
    "price" REAL NOT NULL,
    CONSTRAINT "PurchaseOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseOrderItem" ("id", "itemId", "orderId", "price", "quantity", "receivedQty") SELECT "id", "itemId", "orderId", "price", "quantity", "receivedQty" FROM "PurchaseOrderItem";
DROP TABLE "PurchaseOrderItem";
ALTER TABLE "new_PurchaseOrderItem" RENAME TO "PurchaseOrderItem";
CREATE UNIQUE INDEX "PurchaseOrderItem_id_orgId_key" ON "PurchaseOrderItem"("id", "orgId");
CREATE TABLE "new_ReceivingDiscrepancy" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "purchaseOrderId" INTEGER NOT NULL,
    "itemId" INTEGER,
    "expectedQty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "closedByUserId" INTEGER,
    "closeNote" TEXT,
    "movementOpId" TEXT,
    CONSTRAINT "ReceivingDiscrepancy_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReceivingDiscrepancy_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReceivingDiscrepancy_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReceivingDiscrepancy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ReceivingDiscrepancy" ("closeNote", "closedAt", "closedByUserId", "createdAt", "delta", "expectedQty", "id", "itemId", "movementOpId", "note", "purchaseOrderId", "receivedQty", "status") SELECT "closeNote", "closedAt", "closedByUserId", "createdAt", "delta", "expectedQty", "id", "itemId", "movementOpId", "note", "purchaseOrderId", "receivedQty", "status" FROM "ReceivingDiscrepancy";
DROP TABLE "ReceivingDiscrepancy";
ALTER TABLE "new_ReceivingDiscrepancy" RENAME TO "ReceivingDiscrepancy";
CREATE UNIQUE INDEX "ReceivingDiscrepancy_id_orgId_key" ON "ReceivingDiscrepancy"("id", "orgId");
CREATE TABLE "new_SafetyAssignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "employeeId" INTEGER NOT NULL,
    "instructionId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dueDate" DATETIME,
    "completedAt" DATETIME,
    "lastReminderAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SafetyAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SafetyAssignment_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "SafetyInstruction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SafetyAssignment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SafetyAssignment" ("completedAt", "createdAt", "dueDate", "employeeId", "id", "instructionId", "lastReminderAt", "status", "updatedAt") SELECT "completedAt", "createdAt", "dueDate", "employeeId", "id", "instructionId", "lastReminderAt", "status", "updatedAt" FROM "SafetyAssignment";
DROP TABLE "SafetyAssignment";
ALTER TABLE "new_SafetyAssignment" RENAME TO "SafetyAssignment";
CREATE UNIQUE INDEX "SafetyAssignment_id_orgId_key" ON "SafetyAssignment"("id", "orgId");
CREATE TABLE "new_SafetyInstruction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "role" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SafetyInstruction_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SafetyInstruction" ("createdAt", "description", "id", "role", "title") SELECT "createdAt", "description", "id", "role", "title" FROM "SafetyInstruction";
DROP TABLE "SafetyInstruction";
ALTER TABLE "new_SafetyInstruction" RENAME TO "SafetyInstruction";
CREATE UNIQUE INDEX "SafetyInstruction_id_orgId_key" ON "SafetyInstruction"("id", "orgId");
CREATE TABLE "new_StockDiscrepancy" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "sessionId" INTEGER,
    "locationId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "countedQty" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "closedByUserId" INTEGER,
    "closeNote" TEXT,
    "movementOpId" TEXT,
    CONSTRAINT "StockDiscrepancy_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BinAuditSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockDiscrepancy_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockDiscrepancy_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockDiscrepancy_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockDiscrepancy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StockDiscrepancy" ("closeNote", "closedAt", "closedByUserId", "countedQty", "createdAt", "delta", "expectedQty", "id", "itemId", "locationId", "movementOpId", "sessionId", "status") SELECT "closeNote", "closedAt", "closedByUserId", "countedQty", "createdAt", "delta", "expectedQty", "id", "itemId", "locationId", "movementOpId", "sessionId", "status" FROM "StockDiscrepancy";
DROP TABLE "StockDiscrepancy";
ALTER TABLE "new_StockDiscrepancy" RENAME TO "StockDiscrepancy";
CREATE UNIQUE INDEX "StockDiscrepancy_id_orgId_key" ON "StockDiscrepancy"("id", "orgId");
CREATE TABLE "new_StockMovement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "opId" TEXT,
    "type" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "fromLocationId" INTEGER,
    "toLocationId" INTEGER,
    "quantity" REAL NOT NULL,
    "comment" TEXT,
    "pricePerUnit" REAL,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StockMovement" ("comment", "createdAt", "createdById", "fromLocationId", "id", "itemId", "locationId", "opId", "pricePerUnit", "quantity", "refId", "refType", "toLocationId", "type") SELECT "comment", "createdAt", "createdById", "fromLocationId", "id", "itemId", "locationId", "opId", "pricePerUnit", "quantity", "refId", "refType", "toLocationId", "type" FROM "StockMovement";
DROP TABLE "StockMovement";
ALTER TABLE "new_StockMovement" RENAME TO "StockMovement";
CREATE UNIQUE INDEX "StockMovement_opId_key" ON "StockMovement"("opId");
CREATE UNIQUE INDEX "StockMovement_id_orgId_key" ON "StockMovement"("id", "orgId");
CREATE TABLE "new_Supplier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "name" TEXT NOT NULL,
    "inn" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Supplier_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Supplier" ("comment", "createdAt", "email", "id", "inn", "name", "phone", "updatedAt") SELECT "comment", "createdAt", "email", "id", "inn", "name", "phone", "updatedAt" FROM "Supplier";
DROP TABLE "Supplier";
ALTER TABLE "new_Supplier" RENAME TO "Supplier";
CREATE UNIQUE INDEX "Supplier_id_orgId_key" ON "Supplier"("id", "orgId");
CREATE TABLE "new_SupplierTruck" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierTruck_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SupplierTruck" ("arrivalAt", "cargo", "createdAt", "deliveryDate", "directImport", "driverName", "driverPhone", "gate", "id", "note", "orderNumber", "status", "supplier", "truckNumber", "unloadEndAt", "unloadStartAt", "vehicleBrand") SELECT "arrivalAt", "cargo", "createdAt", "deliveryDate", "directImport", "driverName", "driverPhone", "gate", "id", "note", "orderNumber", "status", "supplier", "truckNumber", "unloadEndAt", "unloadStartAt", "vehicleBrand" FROM "SupplierTruck";
DROP TABLE "SupplierTruck";
ALTER TABLE "new_SupplierTruck" RENAME TO "SupplierTruck";
CREATE UNIQUE INDEX "SupplierTruck_id_orgId_key" ON "SupplierTruck"("id", "orgId");
CREATE TABLE "new_WarehouseLocation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "name" TEXT NOT NULL,
    "zone" TEXT,
    "aisle" TEXT,
    "rack" TEXT,
    "level" TEXT,
    "code" TEXT,
    "qrCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WarehouseLocation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WarehouseLocation" ("aisle", "code", "createdAt", "id", "level", "name", "qrCode", "rack", "updatedAt", "zone") SELECT "aisle", "code", "createdAt", "id", "level", "name", "qrCode", "rack", "updatedAt", "zone" FROM "WarehouseLocation";
DROP TABLE "WarehouseLocation";
ALTER TABLE "new_WarehouseLocation" RENAME TO "WarehouseLocation";
CREATE UNIQUE INDEX "WarehouseLocation_code_key" ON "WarehouseLocation"("code");
CREATE UNIQUE INDEX "WarehouseLocation_qrCode_key" ON "WarehouseLocation"("qrCode");
CREATE UNIQUE INDEX "WarehouseLocation_id_orgId_key" ON "WarehouseLocation"("id", "orgId");
CREATE TABLE "new_WarehousePlacement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "itemId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WarehousePlacement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WarehousePlacement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WarehousePlacement_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WarehousePlacement" ("createdAt", "id", "itemId", "locationId", "qty", "updatedAt") SELECT "createdAt", "id", "itemId", "locationId", "qty", "updatedAt" FROM "WarehousePlacement";
DROP TABLE "WarehousePlacement";
ALTER TABLE "new_WarehousePlacement" RENAME TO "WarehousePlacement";
CREATE UNIQUE INDEX "WarehousePlacement_itemId_locationId_key" ON "WarehousePlacement"("itemId", "locationId");
CREATE UNIQUE INDEX "WarehousePlacement_id_orgId_key" ON "WarehousePlacement"("id", "orgId");
CREATE TABLE "new_WarehouseRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "desiredDate" DATETIME,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "statusComment" TEXT,
    "createdById" INTEGER NOT NULL,
    "relatedPaymentId" INTEGER,
    "relatedDocument" TEXT,
    "targetEmployee" TEXT,
    CONSTRAINT "WarehouseRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WarehouseRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WarehouseRequest" ("comment", "createdAt", "createdById", "desiredDate", "id", "relatedDocument", "relatedPaymentId", "status", "statusComment", "targetEmployee", "title", "type", "updatedAt") SELECT "comment", "createdAt", "createdById", "desiredDate", "id", "relatedDocument", "relatedPaymentId", "status", "statusComment", "targetEmployee", "title", "type", "updatedAt" FROM "WarehouseRequest";
DROP TABLE "WarehouseRequest";
ALTER TABLE "new_WarehouseRequest" RENAME TO "WarehouseRequest";
CREATE UNIQUE INDEX "WarehouseRequest_id_orgId_key" ON "WarehouseRequest"("id", "orgId");
CREATE TABLE "new_WarehouseRequestItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "name" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unit" TEXT,
    "requestId" INTEGER NOT NULL,
    CONSTRAINT "WarehouseRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WarehouseRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WarehouseRequestItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WarehouseRequestItem" ("id", "name", "quantity", "requestId", "unit") SELECT "id", "name", "quantity", "requestId", "unit" FROM "WarehouseRequestItem";
DROP TABLE "WarehouseRequestItem";
ALTER TABLE "new_WarehouseRequestItem" RENAME TO "WarehouseRequestItem";
CREATE UNIQUE INDEX "WarehouseRequestItem_id_orgId_key" ON "WarehouseRequestItem"("id", "orgId");
CREATE TABLE "new_WarehouseTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orgId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "executorName" TEXT,
    "executorChatId" TEXT,
    "assignerId" INTEGER NOT NULL,
    "lastReminderAt" DATETIME,
    CONSTRAINT "WarehouseTask_assignerId_fkey" FOREIGN KEY ("assignerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WarehouseTask_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WarehouseTask" ("assignerId", "createdAt", "description", "dueDate", "executorChatId", "executorName", "id", "lastReminderAt", "status", "title", "updatedAt") SELECT "assignerId", "createdAt", "description", "dueDate", "executorChatId", "executorName", "id", "lastReminderAt", "status", "title", "updatedAt" FROM "WarehouseTask";
DROP TABLE "WarehouseTask";
ALTER TABLE "new_WarehouseTask" RENAME TO "WarehouseTask";
CREATE UNIQUE INDEX "WarehouseTask_id_orgId_key" ON "WarehouseTask"("id", "orgId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Membership_orgId_userId_key" ON "Membership"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_id_orgId_key" ON "Membership"("id", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_orgId_key" ON "Subscription"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_id_orgId_key" ON "Subscription"("id", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_providerPaymentId_key" ON "Payment"("provider", "providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_id_orgId_key" ON "Payment"("id", "orgId");
