-- A recipe already belongs to a location, and a dish name has been unique per location since
-- 20260908190000. The recipe name was not: two kitchens could not each keep their own House Sauce.
-- Postgres treats NULL as distinct, so this index states that a location may not repeat a name;
-- the service states the rest — an organization-wide recipe may not take a name a location uses.
DROP INDEX "Recipe_organizationId_name_key";
CREATE UNIQUE INDEX "Recipe_organizationId_locationId_name_key" ON "Recipe"("organizationId", "locationId", "name");
