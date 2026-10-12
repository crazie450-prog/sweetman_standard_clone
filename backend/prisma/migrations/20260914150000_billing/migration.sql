-- Stripe Billing in the proposal: subscription plans, checkout, tenant subscriptions, webhooks,
-- subscription status, failed-payment handling, delinquent status and access restrictions for
-- inactive subscriptions. The organization records the plan it pays for, the provider's
-- subscription, when the paid period ends and how many seats it is billed for; BillingEvent keeps
-- the id of every provider event that was applied, so a webhook delivered twice changes nothing twice.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "billingSeats" INTEGER,
ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "planId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT;

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingEvent_organizationId_receivedAt_idx" ON "BillingEvent"("organizationId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_stripeSubscriptionId_key" ON "Organization"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The application connects as the table owner and bypasses RLS; the nexus_app role does not.
ALTER TABLE "BillingEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillingEvent"
  USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
