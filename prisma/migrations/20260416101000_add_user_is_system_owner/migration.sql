ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "isSystemOwner" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" AS u
SET "isSystemOwner" = true
FROM "Organization" AS o
WHERE
  u."orgId" = o."id"
  AND o."code" = 'platform-owner'
  AND u."role" = 'ADMIN'
  AND u."isActive" = true;

CREATE INDEX IF NOT EXISTS "User_isSystemOwner_idx"
ON "User" ("isSystemOwner");