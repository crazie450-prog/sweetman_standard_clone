-- Sales Import in the proposal asks for imported dish names to be mapped to existing menu items.
-- A name a sales file states is parked here until someone binds it, the way an unrecognised
-- ingredient name is parked in "IngredientAlias".
CREATE TABLE "MenuItemAlias" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "menuItemId" TEXT,
    "rawName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItemAlias_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MenuItemAlias_organizationId_menuItemId_idx" ON "MenuItemAlias"("organizationId", "menuItemId");
CREATE UNIQUE INDEX "MenuItemAlias_organizationId_rawName_key" ON "MenuItemAlias"("organizationId", "rawName");

ALTER TABLE "MenuItemAlias" ADD CONSTRAINT "MenuItemAlias_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuItemAlias" ADD CONSTRAINT "MenuItemAlias_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The application connects as the table owner and bypasses RLS; the nexus_app role does not,
-- so a policy is mandatory or the table would be readable across tenants.
ALTER TABLE "MenuItemAlias" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MenuItemAlias"
  USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
