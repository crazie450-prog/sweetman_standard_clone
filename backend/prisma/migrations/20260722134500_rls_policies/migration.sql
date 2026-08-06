-- Isolation layer 3: Row-Level Security.
-- The last line of defence against raw SQL that bypasses the Prisma tenant extension.
--
-- Model: a connection scopes itself per request with
--   SET LOCAL app.current_org = '<organizationId>'
-- The policy admits a row when organizationId matches. With app.current_org
-- unset, current_setting(..., true) returns NULL and the policy denies by
-- default, so migrations and the seeder run as the table owner, which bypasses
-- RLS while FORCE is not enabled.
--
-- FORCE ROW LEVEL SECURITY is intentionally left off: the application connects
-- as the table owner, while every connection that reaches the database outside
-- the application uses a non-owning role for which RLS is mandatory.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Location', 'User', 'Invitation', 'Vendor', 'Category', 'Ingredient',
    'InventoryTransaction', 'Recipe', 'MenuItem', 'Sale', 'Production', 'WasteEntry'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("organizationId" = current_setting(''app.current_org'', true))
         WITH CHECK ("organizationId" = current_setting(''app.current_org'', true))',
      t
    );
  END LOOP;
END $$;
