-- CreateTable
CREATE TABLE "IngredientLocationStock" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "onHand" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngredientLocationStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientPriceHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "vendorId" TEXT,
    "locationId" TEXT,
    "costPerUnit" DECIMAL(12,4) NOT NULL,
    "source" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngredientPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngredientLocationStock_locationId_idx" ON "IngredientLocationStock"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientLocationStock_ingredientId_locationId_key" ON "IngredientLocationStock"("ingredientId", "locationId");

-- CreateIndex
CREATE INDEX "IngredientPriceHistory_organizationId_ingredientId_recorded_idx" ON "IngredientPriceHistory"("organizationId", "ingredientId", "recordedAt");

-- CreateIndex
CREATE INDEX "IngredientPriceHistory_organizationId_vendorId_idx" ON "IngredientPriceHistory"("organizationId", "vendorId");

-- AddForeignKey
ALTER TABLE "IngredientLocationStock" ADD CONSTRAINT "IngredientLocationStock_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientLocationStock" ADD CONSTRAINT "IngredientLocationStock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientPriceHistory" ADD CONSTRAINT "IngredientPriceHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientPriceHistory" ADD CONSTRAINT "IngredientPriceHistory_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientPriceHistory" ADD CONSTRAINT "IngredientPriceHistory_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientPriceHistory" ADD CONSTRAINT "IngredientPriceHistory_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
