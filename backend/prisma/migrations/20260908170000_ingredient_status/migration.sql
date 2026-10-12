-- An ingredient can be archived instead of deleted: it keeps its history and its
-- recipe lines, and stops being offered for new work. Existing rows stay active.
ALTER TABLE "Ingredient" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
