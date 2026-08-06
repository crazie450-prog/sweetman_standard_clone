-- The last table left outside isolation layer 3. Organization is the tenant
-- root, so it is scoped by its own id rather than by an "organizationId"
-- column. Without this policy a non-owning role could read every tenant's
-- name, owner email, address and Stripe customer id.
--
-- Platform administration is unaffected: it runs through the application, which
-- connects as the table owner and bypasses RLS.

ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Organization"
  USING (id = current_setting('app.current_org', true))
  WITH CHECK (id = current_setting('app.current_org', true));
