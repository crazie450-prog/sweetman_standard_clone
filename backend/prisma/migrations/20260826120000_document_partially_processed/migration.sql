-- A document may apply only part of what it carried: an invoice whose lines did not all
-- reach an ingredient is neither fully confirmed nor failed. The proposal names this state.
-- The value is only added here; nothing reads or writes it in this migration, which is what
-- lets ALTER TYPE run inside the transaction Prisma wraps a migration in.
ALTER TYPE "DocumentStatus" ADD VALUE 'partially_processed';
