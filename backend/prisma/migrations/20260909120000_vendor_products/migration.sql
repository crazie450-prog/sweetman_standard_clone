-- Vendor Management in the proposal asks for vendor product relationships and vendor-specific
-- product naming; Ingredient Management lists Products beside Ingredients. A product is what one
-- vendor sells under its own name and code, resolved to one of our ingredients. A product whose
-- ingredient is unknown is parked here the way an unrecognised name is parked in "IngredientAlias".
CREATE TABLE "VendorProduct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "ingredientId" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorProduct_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VendorProduct_organizationId_ingredientId_idx" ON "VendorProduct"("organizationId", "ingredientId");
CREATE INDEX "VendorProduct_vendorId_idx" ON "VendorProduct"("vendorId");
CREATE UNIQUE INDEX "VendorProduct_organizationId_vendorId_name_key" ON "VendorProduct"("organizationId", "vendorId", "name");

ALTER TABLE "VendorProduct" ADD CONSTRAINT "VendorProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VendorProduct" ADD CONSTRAINT "VendorProduct_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VendorProduct" ADD CONSTRAINT "VendorProduct_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The application connects as the table owner and bypasses RLS; the nexus_app role does not,
-- so a policy is mandatory or the table would be readable across tenants.
ALTER TABLE "VendorProduct" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VendorProduct"
  USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
