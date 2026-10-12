-- A date stated without a time (a sale, a waste entry, a batch, an invoice) used to be stored as
-- midnight UTC, which west of UTC is the evening of the day before. Days are now counted in the
-- organization's timezone and a stated day is stored at its local midday, so the rows already on
-- file are moved to the midday of the same calendar day. Rows carrying a real time are untouched.

UPDATE "Sale" s
SET "date" = (s."date"::date + time '12:00') AT TIME ZONE o."timezone" AT TIME ZONE 'UTC'
FROM "Organization" o
WHERE o."id" = s."organizationId" AND s."date"::time = time '00:00'
  AND o."timezone" IN (SELECT "name" FROM pg_timezone_names);

UPDATE "WasteEntry" w
SET "date" = (w."date"::date + time '12:00') AT TIME ZONE o."timezone" AT TIME ZONE 'UTC'
FROM "Organization" o
WHERE o."id" = w."organizationId" AND w."date"::time = time '00:00'
  AND o."timezone" IN (SELECT "name" FROM pg_timezone_names);

UPDATE "InventoryTransaction" t
SET "createdAt" = (t."createdAt"::date + time '12:00') AT TIME ZONE o."timezone" AT TIME ZONE 'UTC'
FROM "Organization" o
WHERE o."id" = t."organizationId" AND t."type" = 'WASTE' AND t."createdAt"::time = time '00:00'
  AND o."timezone" IN (SELECT "name" FROM pg_timezone_names);

UPDATE "Production" p
SET "date" = (p."date"::date + time '12:00') AT TIME ZONE o."timezone" AT TIME ZONE 'UTC'
FROM "Organization" o
WHERE o."id" = p."organizationId" AND p."date"::time = time '00:00'
  AND o."timezone" IN (SELECT "name" FROM pg_timezone_names);

UPDATE "Invoice" i
SET "invoiceDate" = (i."invoiceDate"::date + time '12:00') AT TIME ZONE o."timezone" AT TIME ZONE 'UTC'
FROM "Organization" o
WHERE o."id" = i."organizationId" AND i."invoiceDate"::time = time '00:00'
  AND o."timezone" IN (SELECT "name" FROM pg_timezone_names);

UPDATE "Invoice" i
SET "dueDate" = (i."dueDate"::date + time '12:00') AT TIME ZONE o."timezone" AT TIME ZONE 'UTC'
FROM "Organization" o
WHERE o."id" = i."organizationId" AND i."dueDate"::time = time '00:00'
  AND o."timezone" IN (SELECT "name" FROM pg_timezone_names);
