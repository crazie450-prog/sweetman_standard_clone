-- Cycle protection, layer 1: self-reference is impossible at the database level.
-- Layers 2 and 3 (graph DFS and a depth limit) live in CostingService.assertEdgeAllowed.

ALTER TABLE "RecipeComponent"
  ADD CONSTRAINT "recipe_component_no_self_reference"
  CHECK ("parentId" <> "componentId");
