ALTER TABLE "User"
ADD COLUMN "marketingEmailsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "marketingConsentAt" TIMESTAMP(3),
ADD COLUMN "marketingUnsubscribedAt" TIMESTAMP(3);
