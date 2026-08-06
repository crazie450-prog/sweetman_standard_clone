-- The commercial proposal names invoices in the Sprint 2 data model, alongside
-- vendors, ingredients, inventory, recipes and menus. Extraction from uploaded
-- documents belongs to Sprint 3; this is the record it fills in, and it can be
-- entered by hand in the meantime.

CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'confirmed');

CREATE TABLE "Invoice" (
  "id"             TEXT            NOT NULL,
  "organizationId" TEXT            NOT NULL,
  "locationId"     TEXT,
  "vendorId"       TEXT,
  "number"         TEXT,
  "invoiceDate"    TIMESTAMP(3)    NOT NULL,
  "dueDate"        TIMESTAMP(3),
  "status"         "InvoiceStatus" NOT NULL DEFAULT 'draft',
  "subtotal"       DECIMAL(12, 2)  NOT NULL DEFAULT 0,
  "tax"            DECIMAL(12, 2)  NOT NULL DEFAULT 0,
  "total"          DECIMAL(12, 2)  NOT NULL DEFAULT 0,
  "documentKey"    TEXT,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)    NOT NULL,

  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceItem" (
  "id"           TEXT           NOT NULL,
  "invoiceId"    TEXT           NOT NULL,
  "ingredientId" TEXT,
  "description"  TEXT           NOT NULL,
  "quantity"     DECIMAL(12, 3) NOT NULL,
  "unit"         TEXT           NOT NULL,
  "unitPrice"    DECIMAL(12, 4) NOT NULL,
  "lineTotal"    DECIMAL(12, 2) NOT NULL,

  CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- A vendor cannot bill the same number twice; a missing number stays free-form.
CREATE UNIQUE INDEX "Invoice_organizationId_vendorId_number_key"
  ON "Invoice"("organizationId", "vendorId", "number");
CREATE INDEX "Invoice_organizationId_locationId_invoiceDate_idx"
  ON "Invoice"("organizationId", "locationId", "invoiceDate");
CREATE INDEX "Invoice_vendorId_idx" ON "Invoice"("vendorId");
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");
CREATE INDEX "InvoiceItem_ingredientId_idx" ON "InvoiceItem"("ingredientId");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_ingredientId_fkey"
  FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Isolation layer 3: the invoice carries its own tenant, a line reaches one
-- through the invoice it belongs to.
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invoice"
  USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

ALTER TABLE "InvoiceItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InvoiceItem"
  USING (EXISTS (SELECT 1 FROM "Invoice" i
                 WHERE i.id = "InvoiceItem"."invoiceId"
                   AND i."organizationId" = current_setting('app.current_org', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "Invoice" i
                      WHERE i.id = "InvoiceItem"."invoiceId"
                        AND i."organizationId" = current_setting('app.current_org', true)));
