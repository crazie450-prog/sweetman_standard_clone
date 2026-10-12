-- A conversion may be recorded for one recipe; there it is read before the ingredient's own
-- rules and the shared ones, and it goes when the recipe goes.
ALTER TABLE "UnitConversion" ADD COLUMN "recipeId" TEXT;

DROP INDEX "UnitConversion_organizationId_ingredientId_fromUnit_toUnit_key";

CREATE UNIQUE INDEX "UnitConversion_organizationId_recipeId_ingredientId_fromUni_key" ON "UnitConversion"("organizationId", "recipeId", "ingredientId", "fromUnit", "toUnit");

CREATE INDEX "UnitConversion_recipeId_idx" ON "UnitConversion"("recipeId");

ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
