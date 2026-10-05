CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"actor" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "jobs_status_chk" CHECK ("jobs"."status" in ('queued','running','done','dead')),
	CONSTRAINT "jobs_attempts_chk" CHECK ("jobs"."attempts" >= 0 and "jobs"."max_attempts" >= 1)
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeat" (
	"worker" text PRIMARY KEY NOT NULL,
	"beat_at" timestamp with time zone NOT NULL,
	"last_cycle_ms" integer NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "audit_log_event_idx" ON "audit_log" USING btree ("event","created_at");--> statement-breakpoint
CREATE INDEX "jobs_ready_idx" ON "jobs" USING btree ("status","run_after");