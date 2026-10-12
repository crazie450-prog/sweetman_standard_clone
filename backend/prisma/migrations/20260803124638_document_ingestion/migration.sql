-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('invoice', 'recipe', 'menu', 'sales');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('queued', 'processing', 'requires_review', 'confirmed', 'failed');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT,
    "type" "DocumentType" NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "jobId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Extraction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Extraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientAlias" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ingredientId" TEXT,
    "rawName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngredientAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_organizationId_locationId_createdAt_idx" ON "Document"("organizationId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "Document_organizationId_status_idx" ON "Document"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Extraction_organizationId_documentId_idx" ON "Extraction"("organizationId", "documentId");

-- CreateIndex
CREATE INDEX "IngredientAlias_organizationId_ingredientId_idx" ON "IngredientAlias"("organizationId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientAlias_organizationId_rawName_key" ON "IngredientAlias"("organizationId", "rawName");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Extraction" ADD CONSTRAINT "Extraction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Extraction" ADD CONSTRAINT "Extraction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientAlias" ADD CONSTRAINT "IngredientAlias_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientAlias" ADD CONSTRAINT "IngredientAlias_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security for the new ingestion tables (isolation layer 3).
-- Document and IngredientAlias carry "organizationId" directly; Extraction
-- reaches its tenant through the parent Document. The application connects as
-- the table owner and bypasses RLS; the nexus_app role does not, so a policy is
-- mandatory or the tables would be readable across tenants.

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Document"
  USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

ALTER TABLE "IngredientAlias" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IngredientAlias"
  USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

ALTER TABLE "Extraction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Extraction"
  USING (EXISTS (SELECT 1 FROM "Document" d
                 WHERE d.id = "Extraction"."documentId"
                   AND d."organizationId" = current_setting('app.current_org', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "Document" d
                      WHERE d.id = "Extraction"."documentId"
                        AND d."organizationId" = current_setting('app.current_org', true)));

-- The default privileges granted to nexus_app in 20260727093000 cover tables
-- created afterwards, but grant explicitly so the role works regardless of who
-- runs this migration.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Document", "Extraction", "IngredientAlias" TO nexus_app;
