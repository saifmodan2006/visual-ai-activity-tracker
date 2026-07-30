CREATE TABLE "users" (
  "id" UUID PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "settings" JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE "activities" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "url" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "start_time" TIMESTAMPTZ NOT NULL,
  "end_time" TIMESTAMPTZ NOT NULL,
  "duration_seconds" INTEGER NOT NULL,
  "screenshots" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "productivity_score" INTEGER,
  "is_idle" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("user_id", "hostname", "start_time")
);
CREATE INDEX "activities_user_id_start_time_idx" ON "activities" ("user_id", "start_time");
CREATE INDEX "activities_hostname_idx" ON "activities" ("hostname");

CREATE TABLE "daily_summaries" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "date" DATE NOT NULL,
  "total_active_seconds" INTEGER NOT NULL,
  "total_idle_seconds" INTEGER NOT NULL,
  "category_breakdown" JSONB NOT NULL,
  "site_breakdown" JSONB NOT NULL,
  "productivity_average" DOUBLE PRECISION,
  "screenshot_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("user_id", "date")
);

CREATE TABLE "api_logs" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "endpoint" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "status_code" INTEGER NOT NULL,
  "response_time_ms" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "api_logs_user_id_created_at_idx" ON "api_logs" ("user_id", "created_at");

CREATE TABLE "refresh_tokens" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "revoked_at" TIMESTAMPTZ
);
CREATE INDEX "refresh_tokens_user_id_token_hash_idx" ON "refresh_tokens" ("user_id", "token_hash");
