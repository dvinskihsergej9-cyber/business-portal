-- CreateTable
CREATE TABLE "WarehouseTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "dueDate" DATETIME,
    "assignerId" INTEGER NOT NULL,
    "executorName" TEXT,
    "executorChatId" TEXT,
    "lastReminderAt" DATETIME,
    CONSTRAINT "WarehouseTask_assignerId_fkey" FOREIGN KEY ("assignerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
