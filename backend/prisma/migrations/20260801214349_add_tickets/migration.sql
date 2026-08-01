-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "business_id" TEXT NOT NULL,
    "app_slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'bug',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'new',
    "severity" TEXT NOT NULL DEFAULT 'normal',
    "risk_level" TEXT NOT NULL DEFAULT 'unknown',
    "reporter_external_id" TEXT NOT NULL,
    "reporter_name" TEXT NOT NULL,
    "reporter_role" TEXT,
    "context" JSONB,
    "dedup_of_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "deployed_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_attachments" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "duration_sec" INTEGER,
    "transcript" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_plans" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "goal_md" TEXT NOT NULL,
    "acceptance" JSONB,
    "assumptions" JSONB,
    "risk_level" TEXT NOT NULL DEFAULT 'unknown',
    "estimate_min" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "read_calls" INTEGER,
    "run_cost_usd" DOUBLE PRECISION,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "run_branch" TEXT,
    "verdict" TEXT,
    "verdict_output" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");

-- CreateIndex
CREATE INDEX "tickets_business_id_idx" ON "tickets"("business_id");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE INDEX "tickets_app_slug_idx" ON "tickets"("app_slug");

-- CreateIndex
CREATE INDEX "tickets_reporter_external_id_idx" ON "tickets"("reporter_external_id");

-- CreateIndex
CREATE INDEX "tickets_created_at_idx" ON "tickets"("created_at");

-- CreateIndex
CREATE INDEX "ticket_attachments_ticket_id_idx" ON "ticket_attachments"("ticket_id");

-- CreateIndex
CREATE INDEX "ticket_plans_ticket_id_idx" ON "ticket_plans"("ticket_id");

-- CreateIndex
CREATE INDEX "ticket_plans_status_idx" ON "ticket_plans"("status");

-- CreateIndex
CREATE INDEX "ticket_events_ticket_id_created_at_idx" ON "ticket_events"("ticket_id", "created_at");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_dedup_of_id_fkey" FOREIGN KEY ("dedup_of_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_plans" ADD CONSTRAINT "ticket_plans_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
