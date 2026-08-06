-- DropIndex
DROP INDEX "Invitation_organizationId_email_status_key";

-- DropIndex
DROP INDEX "Invitation_organizationId_idx";

-- CreateIndex
CREATE INDEX "Invitation_organizationId_email_idx" ON "Invitation"("organizationId", "email");
