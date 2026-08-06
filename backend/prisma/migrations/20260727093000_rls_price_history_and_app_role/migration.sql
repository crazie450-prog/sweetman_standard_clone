-- Extends Row-Level Security to the price history table and introduces the
-- non-owning application role.
--
-- 1. IngredientPriceHistory is a tenant table, so it receives the same policy;
--    "every tenant table is under RLS" holds without exceptions.
-- 2. Role nexus_app does not own the tables, therefore RLS is mandatory for it.
--    The isolation test suite connects under this role, and so does any
--    connection that reaches the database outside the application: analytics,
--    a manual psql session, a migration script. That is what RLS is for here —
--    a barrier for access that bypasses the application, not a duplicate of the
--    Prisma tenant extension.
--
-- The application itself stays on the owning role: a per-request
-- `SET LOCAL app.current_org` requires a transaction around every query, which
-- Prisma's connection pool cannot provide without doubling the round trips.
-- Application-level scoping is handled by layers 1 and 2 (AsyncLocalStorage and
-- the Prisma extension).

ALTER TABLE "IngredientPriceHistory" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IngredientPriceHistory"
  USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

-- Role for connections that bypass the application. The password is dev-only;
-- in production a DBA creates the role with their own password and the same grants.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_app') THEN
    CREATE ROLE nexus_app LOGIN PASSWORD 'nexus_app_dev';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO nexus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexus_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexus_app;
