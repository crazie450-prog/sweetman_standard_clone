-- One refresh token per user meant one session per user: signing in on a second
-- device overwrote the hash and silently ended the first session. Sessions move
-- into their own table, one row per device.
--
-- Existing sessions cannot be carried over — the old column holds a hash with no
-- record of which device it belonged to, so everyone signs in again once.

CREATE TABLE "UserSession" (
  "id"               TEXT         NOT NULL,
  "userId"           TEXT         NOT NULL,
  "refreshTokenHash" TEXT         NOT NULL,
  "userAgent"        TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSession_refreshTokenHash_key" ON "UserSession"("refreshTokenHash");
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

ALTER TABLE "UserSession"
  ADD CONSTRAINT "UserSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" DROP COLUMN "refreshTokenHash";

-- Isolation layer 3: a session reaches its tenant through the user it belongs to.
ALTER TABLE "UserSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UserSession"
  USING (EXISTS (SELECT 1 FROM "User" u
                 WHERE u.id = "UserSession"."userId"
                   AND u."organizationId" = current_setting('app.current_org', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "User" u
                      WHERE u.id = "UserSession"."userId"
                        AND u."organizationId" = current_setting('app.current_org', true)));

-- A rotated token is remembered for one step. Presenting it again is reuse and
-- ends that session; presenting a token nobody knows is simply invalid, which
-- is what an ordinary sign-out leaves behind.
ALTER TABLE "UserSession" ADD COLUMN "previousTokenHash" TEXT;
CREATE UNIQUE INDEX "UserSession_previousTokenHash_key" ON "UserSession"("previousTokenHash");
