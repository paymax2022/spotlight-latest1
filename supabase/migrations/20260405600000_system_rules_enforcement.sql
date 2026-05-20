-- Migration: Platform system rules enforcement
-- Adds: audit logging enhancements, prize position support, admin vote tracking

-- ============================================================
-- 1. Add position column to contest_prizes if not exists
-- ============================================================
ALTER TABLE public.contest_prizes
ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 1;

-- ============================================================
-- 2. Admin Audit Logs table — ensure it exists with full schema
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL,
  target_table TEXT,
  target_id TEXT,
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  admin_id UUID,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action_type ON public.admin_audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target_id ON public.admin_audit_logs(target_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON public.admin_audit_logs(created_at DESC);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_full_access_audit_logs" ON public.admin_audit_logs;
CREATE POLICY "admin_full_access_audit_logs"
ON public.admin_audit_logs
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- ============================================================
-- 3. Add admin_id column to audit logs if not exists
-- ============================================================
ALTER TABLE public.admin_audit_logs
ADD COLUMN IF NOT EXISTS admin_id UUID;

-- ============================================================
-- 4. Ensure contest_prizes has awarded_at column
-- ============================================================
ALTER TABLE public.contest_prizes
ADD COLUMN IF NOT EXISTS awarded_at TIMESTAMPTZ;

-- ============================================================
-- 5. Function: log_admin_action — reusable audit logger
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action_type TEXT,
  p_target_table TEXT,
  p_target_id TEXT,
  p_new_value JSONB DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  log_id UUID;
BEGIN
  INSERT INTO public.admin_audit_logs (
    action_type, target_table, target_id, new_value, reason, admin_id
  ) VALUES (
    p_action_type, p_target_table, p_target_id, p_new_value, p_reason, auth.uid()
  )
  RETURNING id INTO log_id;
  RETURN log_id;
END;
$$;

-- ============================================================
-- 6. Ensure contests table has created_by column for admin tracking
-- ============================================================
ALTER TABLE public.contests
ADD COLUMN IF NOT EXISTS created_by UUID;

-- ============================================================
-- 7. RLS: Restrict contest creation to admin only
-- Users can read contests, only admins can insert/update/delete
-- ============================================================
DROP POLICY IF EXISTS "public_read_contests" ON public.contests;
CREATE POLICY "public_read_contests"
ON public.contests
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "admin_manage_contests" ON public.contests;
CREATE POLICY "admin_manage_contests"
ON public.contests
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM auth.users au
    WHERE au.id = auth.uid()
    AND (
      au.raw_user_meta_data->>'role' = 'admin'
      OR au.raw_app_meta_data->>'role' = 'admin'
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM auth.users au
    WHERE au.id = auth.uid()
    AND (
      au.raw_user_meta_data->>'role' = 'admin'
      OR au.raw_app_meta_data->>'role' = 'admin'
    )
  )
);
