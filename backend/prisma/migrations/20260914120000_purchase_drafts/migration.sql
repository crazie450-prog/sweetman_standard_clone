-- Predictive Ordering in the proposal generates purchasing recommendations from sales, inventory,
-- waste, consumption and invoice history, shown as proposed drafts that a person reviews, adjusts
-- and approves by hand. A draft belongs to one location and, where the ingredients name one, to one
-- vendor; its lines snapshot the suggestion and the stock at the moment it was made, so a person
-- can see later what the recommendation rested on. Approving a draft moves no stock and sends
-- nothing: stock still arrives through a confirmed invoice.

-- CreateEnum
CREATE TYPE "PurchaseDraftStatus" AS ENUM ('draft', 'approved');

-- CreateTable
CREATE TABLE "PurchaseDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "vendorId" TEXT,
    "status" "PurchaseDraftStatus" NOT NULL DEFAULT 'draft',
    "note" TEXT,
    "days" INTEGER NOT NULL,
    "horizon" INTEGER NOT NULL,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseDraftLine" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,4),
    "suggested" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "onHand" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseDraftLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseDraft_organizationId_locationId_status_idx" ON "PurchaseDraft"("organizationId", "locationId", "status");

-- CreateIndex
CREATE INDEX "PurchaseDraft_vendorId_idx" ON "PurchaseDraft"("vendorId");

-- CreateIndex
CREATE INDEX "PurchaseDraftLine_ingredientId_idx" ON "PurchaseDraftLine"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDraftLine_draftId_ingredientId_key" ON "PurchaseDraftLine"("draftId", "ingredientId");

-- AddForeignKey
ALTER TABLE "PurchaseDraft" ADD CONSTRAINT "PurchaseDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDraft" ADD CONSTRAINT "PurchaseDraft_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDraft" ADD CONSTRAINT "PurchaseDraft_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDraftLine" ADD CONSTRAINT "PurchaseDraftLine_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "PurchaseDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDraftLine" ADD CONSTRAINT "PurchaseDraftLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The application connects as the table owner and bypasses RLS; the nexus_app role does not,
-- so a policy is mandatory or the table would be readable across tenants. The line carries no
-- organizationId of its own and is reached through its draft.
ALTER TABLE "PurchaseDraft" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PurchaseDraft"
  USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

ALTER TABLE "PurchaseDraftLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PurchaseDraftLine"
  USING (EXISTS (SELECT 1 FROM "PurchaseDraft" d WHERE d."id" = "draftId"
                 AND d."organizationId" = current_setting('app.current_org', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "PurchaseDraft" d WHERE d."id" = "draftId"
                      AND d."organizationId" = current_setting('app.current_org', true)));
