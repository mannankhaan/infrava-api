-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'OPERATIVE');

-- CreateEnum
CREATE TYPE "FaultStatus" AS ENUM ('CREATED', 'ASSIGNED_TO_ADMIN', 'ASSIGNED_TO_OPERATIVE', 'OPERATIVE_SUBMITTED', 'REJECTED', 'REASSIGNED', 'ADMIN_SUBMITTED', 'COMPLETED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "admin_id" UUID,
    "super_admin_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faults" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fault_ref" TEXT NOT NULL DEFAULT '',
    "citadel_ref" TEXT,
    "ck_ref" TEXT,
    "time_allocated" TIMESTAMPTZ,
    "planned_arrival" TIMESTAMPTZ,
    "planned_completion" TIMESTAMPTZ,
    "priority" TEXT,
    "work_type" TEXT,
    "title" TEXT NOT NULL,
    "location_text" TEXT,
    "location_lat" DOUBLE PRECISION,
    "location_lng" DOUBLE PRECISION,
    "description" TEXT,
    "onsite_contact_name" TEXT,
    "onsite_contact_phone" TEXT,
    "onsite_contact_email" TEXT,
    "visit_task_briefing" BOOLEAN NOT NULL DEFAULT false,
    "visit_lsr" BOOLEAN NOT NULL DEFAULT false,
    "visit_link_block" BOOLEAN NOT NULL DEFAULT false,
    "visit_safe_work_pack" BOOLEAN NOT NULL DEFAULT false,
    "visit_possession" BOOLEAN NOT NULL DEFAULT false,
    "visit_temp_works" BOOLEAN NOT NULL DEFAULT false,
    "visit_isolation" BOOLEAN NOT NULL DEFAULT false,
    "contractor_company" TEXT,
    "contractor_name" TEXT,
    "contractor_email" TEXT,
    "contractor_mobile" TEXT,
    "attendance_dates" JSONB,
    "supervisor_names" TEXT,
    "operative_name" TEXT,
    "materials_used" TEXT,
    "methodology" TEXT,
    "works_description" TEXT,
    "dimensions" TEXT,
    "further_work" BOOLEAN,
    "further_work_notes" TEXT,
    "status" "FaultStatus" NOT NULL DEFAULT 'CREATED',
    "created_by" UUID NOT NULL,
    "assigned_admin_id" UUID,
    "assigned_operative_id" UUID,
    "fault_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "operative_submitted_at" TIMESTAMPTZ,
    "admin_submitted_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "rejection_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "faults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fault_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fault_id" UUID NOT NULL,
    "r2_key" TEXT NOT NULL,
    "photo_stage" TEXT NOT NULL,
    "file_name" TEXT,
    "file_size_bytes" INTEGER,
    "deleted_at" TIMESTAMPTZ,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fault_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fault_audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fault_id" UUID NOT NULL,
    "changed_by" UUID NOT NULL,
    "change_type" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fault_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eod_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fault_id" UUID NOT NULL,
    "super_admin_id" UUID NOT NULL,
    "pdf_r2_key" TEXT,
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eod_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_deletion_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requested_by" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "processed_by" UUID,
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "faults_fault_ref_key" ON "faults"("fault_ref");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_super_admin_id_fkey" FOREIGN KEY ("super_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faults" ADD CONSTRAINT "faults_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faults" ADD CONSTRAINT "faults_assigned_admin_id_fkey" FOREIGN KEY ("assigned_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faults" ADD CONSTRAINT "faults_assigned_operative_id_fkey" FOREIGN KEY ("assigned_operative_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fault_photos" ADD CONSTRAINT "fault_photos_fault_id_fkey" FOREIGN KEY ("fault_id") REFERENCES "faults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fault_audit_log" ADD CONSTRAINT "fault_audit_log_fault_id_fkey" FOREIGN KEY ("fault_id") REFERENCES "faults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fault_audit_log" ADD CONSTRAINT "fault_audit_log_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eod_reports" ADD CONSTRAINT "eod_reports_fault_id_fkey" FOREIGN KEY ("fault_id") REFERENCES "faults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eod_reports" ADD CONSTRAINT "eod_reports_super_admin_id_fkey" FOREIGN KEY ("super_admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
