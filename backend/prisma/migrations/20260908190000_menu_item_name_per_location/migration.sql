-- A dish name is unique within the location that serves it, so the same dish can
-- carry its own price at another location. An organization-wide item (locationId
-- null) still appears on every menu, and the service refuses a name that would put
-- two identical dishes on one location's menu: Postgres treats NULL as distinct,
-- so this index alone cannot express that rule.
DROP INDEX "MenuItem_organizationId_name_key";
CREATE UNIQUE INDEX "MenuItem_organizationId_locationId_name_key"
  ON "MenuItem" ("organizationId", "locationId", "name");
