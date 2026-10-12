-- Per-location ingredient settings.
--
-- The table already carried the cost a location pays. It now carries the vendor
-- it buys from, the level at which that location reorders, and the vendor's own
-- code for the item, so one shared ingredient can be bought differently in every
-- restaurant. It is renamed to match what it holds.
--
-- Every column is nullable on purpose: a row states only what the location
-- overrides, and anything left empty falls back to the organization's ingredient.
--
-- Written by hand rather than generated: a generated diff would drop the table
-- and create the new one, discarding the per-location costs already recorded.

ALTER TABLE "IngredientLocationPricing" RENAME TO "IngredientLocationSettings";

ALTER INDEX "IngredientLocationPricing_pkey"
  RENAME TO "IngredientLocationSettings_pkey";
ALTER INDEX "IngredientLocationPricing_ingredientId_locationId_key"
  RENAME TO "IngredientLocationSettings_ingredientId_locationId_key";
ALTER INDEX "IngredientLocationPricing_locationId_idx"
  RENAME TO "IngredientLocationSettings_locationId_idx";

ALTER TABLE "IngredientLocationSettings"
  RENAME CONSTRAINT "IngredientLocationPricing_ingredientId_fkey"
  TO "IngredientLocationSettings_ingredientId_fkey";
ALTER TABLE "IngredientLocationSettings"
  RENAME CONSTRAINT "IngredientLocationPricing_locationId_fkey"
  TO "IngredientLocationSettings_locationId_fkey";

ALTER TABLE "IngredientLocationSettings"
  ALTER COLUMN "costPerUnit" DROP NOT NULL,
  ADD COLUMN "reorderLevel" DECIMAL(12,3),
  ADD COLUMN "vendorId" TEXT,
  ADD COLUMN "vendorSku" TEXT;

CREATE INDEX "IngredientLocationSettings_vendorId_idx"
  ON "IngredientLocationSettings"("vendorId");

ALTER TABLE "IngredientLocationSettings"
  ADD CONSTRAINT "IngredientLocationSettings_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The row-level security policy created for the old name follows the table
-- through the rename, because Postgres stores it against the table itself. It
-- still reaches the tenant through the parent ingredient, which is what the
-- nexus_app role is checked against.
