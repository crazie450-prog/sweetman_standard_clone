-- Unit conversions for recipe costing.
--
-- A row states "1 fromUnit = factor toUnit". A NULL "ingredientId" makes the
-- rule organization-wide; a set one narrows it to a single ingredient, which is
-- how mass and volume are bridged (an egg weighs 50 g, a litre of flour weighs
-- 0.6 kg). Conversions inside one dimension (g/kg, ml/l) are built into the
-- application and need no rows here.

-- CreateTable
CREATE TABLE "UnitConversion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ingredientId" TEXT,
    "fromUnit" TEXT NOT NULL,
    "toUnit" TEXT NOT NULL,
    "factor" DECIMAL(18,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnitConversion_organizationId_ingredientId_idx" ON "UnitConversion"("organizationId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitConversion_organizationId_ingredientId_fromUnit_toUnit_key" ON "UnitConversion"("organizationId", "ingredientId", "fromUnit", "toUnit");

-- AddForeignKey
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security (isolation layer 3). The application connects as the table
-- owner and bypasses RLS; the nexus_app role does not, so a policy is mandatory
-- or the table would be readable across tenants.
ALTER TABLE "UnitConversion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UnitConversion"
  USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "UnitConversion" TO nexus_app;
