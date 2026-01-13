-- CreateTable
CREATE TABLE "OrgProfile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "orgName" TEXT NOT NULL,
    "legalAddress" TEXT NOT NULL,
    "actualAddress" TEXT NOT NULL,
    "inn" TEXT NOT NULL,
    "kpp" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
