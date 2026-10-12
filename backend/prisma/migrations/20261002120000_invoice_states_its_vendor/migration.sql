-- The vendor name an invoice was received under, kept even when that vendor is not in the
-- catalogue, so the same paper is recognised a second time by its number and that name.
ALTER TABLE "Invoice" ADD COLUMN "vendorName" TEXT;

UPDATE "Invoice" i
SET "vendorName" = v."name"
FROM "Vendor" v
WHERE v."id" = i."vendorId";
