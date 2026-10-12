-- When the provider says an event happened, as opposed to when it arrived: a payment provider does
-- not promise to deliver events in order, so an older event arriving after a newer one is recorded
-- and does not overwrite what the newer one applied.

-- AlterTable
ALTER TABLE "BillingEvent" ADD COLUMN     "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "BillingEvent_organizationId_occurredAt_idx" ON "BillingEvent"("organizationId", "occurredAt");

-- Organizations registered before subscriptions were enforced carry a trial that may have ended
-- long ago without anyone reading it. Refusing their changes the moment this release starts would
-- close them without notice, so each such trial runs for fourteen more days from this migration.
UPDATE "Organization"
SET "trialEndsAt" = now() + interval '14 days'
WHERE "subscriptionStatus" = 'trial' AND "trialEndsAt" < now();
