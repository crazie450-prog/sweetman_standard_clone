-- Closes a gap in isolation layer 3.
--
-- The first RLS migration covered every table that carries "organizationId"
-- directly. The nine tables below belong to a tenant through their parent
-- instead, so they were left without a policy and stayed fully readable for any
-- non-owning role: recipe compositions and quantities, sale line items with
-- prices and unit costs, per-location stock.
--
-- Each policy reaches the tenant through the parent row. The application is
-- unaffected: it connects as the table owner, for which RLS is bypassed.

-- Through User
ALTER TABLE "UserLocation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UserLocation"
  USING (EXISTS (SELECT 1 FROM "User" u
                 WHERE u.id = "UserLocation"."userId"
                   AND u."organizationId" = current_setting('app.current_org', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "User" u
                      WHERE u.id = "UserLocation"."userId"
                        AND u."organizationId" = current_setting('app.current_org', true)));

-- Through Ingredient
ALTER TABLE "IngredientLocationPricing" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IngredientLocationPricing"
  USING (EXISTS (SELECT 1 FROM "Ingredient" i
                 WHERE i.id = "IngredientLocationPricing"."ingredientId"
                   AND i."organizationId" = current_setting('app.current_org', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "Ingredient" i
                      WHERE i.id = "IngredientLocationPricing"."ingredientId"
                        AND i."organizationId" = current_setting('app.current_org', true)));

ALTER TABLE "IngredientLocationStock" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IngredientLocationStock"
  USING (EXISTS (SELECT 1 FROM "Ingredient" i
                 WHERE i.id = "IngredientLocationStock"."ingredientId"
                   AND i."organizationId" = current_setting('app.current_org', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "Ingredient" i
                      WHERE i.id = "IngredientLocationStock"."ingredientId"
                        AND i."organizationId" = current_setting('app.current_org', true)));

-- Through Recipe
ALTER TABLE "RecipeSection" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RecipeSection"
  USING (EXISTS (SELECT 1 FROM "Recipe" r
                 WHERE r.id = "RecipeSection"."recipeId"
                   AND r."organizationId" = current_setting('app.current_org', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "Recipe" r
                      WHERE r.id = "RecipeSection"."recipeId"
                        AND r."organizationId" = current_setting('app.current_org', true)));

ALTER TABLE "RecipeIngredient" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RecipeIngredient"
  USING (EXISTS (SELECT 1 FROM "Recipe" r
                 WHERE r.id = "RecipeIngredient"."recipeId"
                   AND r."organizationId" = current_setting('app.current_org', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "Recipe" r
                      WHERE r.id = "RecipeIngredient"."recipeId"
                        AND r."organizationId" = current_setting('app.current_org', true)));

ALTER TABLE "RecipeComponent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RecipeComponent"
  USING (EXISTS (SELECT 1 FROM "Recipe" r
                 WHERE r.id = "RecipeComponent"."parentId"
                   AND r."organizationId" = current_setting('app.current_org', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "Recipe" r
                      WHERE r.id = "RecipeComponent"."parentId"
                        AND r."organizationId" = current_setting('app.current_org', true)));

ALTER TABLE "Instruction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Instruction"
  USING (EXISTS (SELECT 1 FROM "Recipe" r
                 WHERE r.id = "Instruction"."recipeId"
                   AND r."organizationId" = current_setting('app.current_org', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "Recipe" r
                      WHERE r.id = "Instruction"."recipeId"
                        AND r."organizationId" = current_setting('app.current_org', true)));

-- Through MenuItem
ALTER TABLE "MenuItemRecipe" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MenuItemRecipe"
  USING (EXISTS (SELECT 1 FROM "MenuItem" m
                 WHERE m.id = "MenuItemRecipe"."menuItemId"
                   AND m."organizationId" = current_setting('app.current_org', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "MenuItem" m
                      WHERE m.id = "MenuItemRecipe"."menuItemId"
                        AND m."organizationId" = current_setting('app.current_org', true)));

-- Through Sale
ALTER TABLE "SaleItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SaleItem"
  USING (EXISTS (SELECT 1 FROM "Sale" s
                 WHERE s.id = "SaleItem"."saleId"
                   AND s."organizationId" = current_setting('app.current_org', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "Sale" s
                      WHERE s.id = "SaleItem"."saleId"
                        AND s."organizationId" = current_setting('app.current_org', true)));
