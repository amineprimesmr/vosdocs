-- Additive migration: existing credits are preserved as purchased credits.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_credits" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS "email_deliveries" (
  "id" TEXT PRIMARY KEY,
  "payload" JSONB NOT NULL,
  "sent_at" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "request_limits" (
  "id" TEXT PRIMARY KEY,
  "hits" INTEGER NOT NULL DEFAULT 1,
  "expires_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "request_limits_expires_at_idx" ON "request_limits"("expires_at");
