-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Employee" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
    "leaveOverrideDays" INTEGER
);
INSERT INTO "new_Employee" ("birthDate", "createdAt", "department", "fullName", "hiredAt", "id", "position", "status", "telegramChatId", "updatedAt") SELECT "birthDate", "createdAt", "department", "fullName", "hiredAt", "id", "position", "status", "telegramChatId", "updatedAt" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
