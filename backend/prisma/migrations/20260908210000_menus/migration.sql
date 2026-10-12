-- A menu is a named collection of menu items that an organization assigns to the
-- locations that serve it. The items keep their own location and price; the menu
-- groups them and is what the cost analytics of a menu are computed over.
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MenuItemOnMenu" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MenuItemOnMenu_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MenuOnLocation" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    CONSTRAINT "MenuOnLocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Menu_organizationId_idx" ON "Menu"("organizationId");
CREATE UNIQUE INDEX "Menu_organizationId_name_key" ON "Menu"("organizationId", "name");
CREATE INDEX "MenuItemOnMenu_menuId_idx" ON "MenuItemOnMenu"("menuId");
CREATE UNIQUE INDEX "MenuItemOnMenu_menuId_menuItemId_key" ON "MenuItemOnMenu"("menuId", "menuItemId");
CREATE INDEX "MenuOnLocation_locationId_idx" ON "MenuOnLocation"("locationId");
CREATE UNIQUE INDEX "MenuOnLocation_menuId_locationId_key" ON "MenuOnLocation"("menuId", "locationId");

ALTER TABLE "Menu" ADD CONSTRAINT "Menu_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuItemOnMenu" ADD CONSTRAINT "MenuItemOnMenu_menuId_fkey"
    FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuItemOnMenu" ADD CONSTRAINT "MenuItemOnMenu_menuItemId_fkey"
    FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuOnLocation" ADD CONSTRAINT "MenuOnLocation_menuId_fkey"
    FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuOnLocation" ADD CONSTRAINT "MenuOnLocation_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: the menu carries the organization itself, the two join
-- tables reach it through the menu.
ALTER TABLE "Menu" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Menu"
  USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

ALTER TABLE "MenuItemOnMenu" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MenuItemOnMenu"
  USING (EXISTS (SELECT 1 FROM "Menu" m
                 WHERE m.id = "MenuItemOnMenu"."menuId"
                   AND m."organizationId" = current_setting('app.current_org', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "Menu" m
                      WHERE m.id = "MenuItemOnMenu"."menuId"
                        AND m."organizationId" = current_setting('app.current_org', true)));

ALTER TABLE "MenuOnLocation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MenuOnLocation"
  USING (EXISTS (SELECT 1 FROM "Menu" m
                 WHERE m.id = "MenuOnLocation"."menuId"
                   AND m."organizationId" = current_setting('app.current_org', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "Menu" m
                      WHERE m.id = "MenuOnLocation"."menuId"
                        AND m."organizationId" = current_setting('app.current_org', true)));
