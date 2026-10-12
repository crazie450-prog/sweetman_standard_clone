-- A dish name is unique per location since 20260908190000, so a name a sales file states means
-- whatever that location serves. An alias held for the whole organization sent a sale rung up at
-- one location to a dish belonging to another. The alias follows the location the same way.
ALTER TABLE "MenuItemAlias" ADD COLUMN "locationId" TEXT;

DROP INDEX "MenuItemAlias_organizationId_rawName_key";
CREATE UNIQUE INDEX "MenuItemAlias_organizationId_locationId_rawName_key" ON "MenuItemAlias"("organizationId", "locationId", "rawName");
CREATE INDEX "MenuItemAlias_locationId_idx" ON "MenuItemAlias"("locationId");

ALTER TABLE "MenuItemAlias" ADD CONSTRAINT "MenuItemAlias_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
