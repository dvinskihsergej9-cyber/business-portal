-- Add trial fields to Subscription
ALTER TABLE "Subscription" ADD COLUMN "trialStartedAt" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "trialUsed" BOOLEAN NOT NULL DEFAULT 0;
