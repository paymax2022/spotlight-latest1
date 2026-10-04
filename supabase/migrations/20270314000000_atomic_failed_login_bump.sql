-- AUD-BE-007: authService.bumpFailedLogin read failed_login_attempts and
-- PATCHed n+1 — concurrent failures lost increments (both read n, both write
-- n+1), extending the effective lockout threshold. A single UPDATE is atomic,
-- so the increment AND the lockout decision live inside the function: the
-- caller sends the policy inputs, Postgres returns the new count.
--
-- Threshold semantics preserved from the Go code it replaces: at or past the
-- max, status -> 'locked' and locked_until -> now() + p_lock_minutes; below
-- the max only the counter moves (status/locked_until untouched). Already-
-- locked rows keep relocking ( CASE re-fires, extending locked_until ).
CREATE OR REPLACE FUNCTION public.bump_failed_login_attempts(
  p_user_id uuid,
  p_max_attempts integer,
  p_lock_minutes integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts integer;
BEGIN
  UPDATE public.platform_users
     SET failed_login_attempts = failed_login_attempts + 1,
         status = CASE
           WHEN failed_login_attempts + 1 >= p_max_attempts THEN 'locked'
           ELSE status
         END,
         locked_until = CASE
           WHEN failed_login_attempts + 1 >= p_max_attempts
             THEN now() + make_interval(mins => p_lock_minutes)
           ELSE locked_until
         END
   WHERE id = p_user_id
  RETURNING failed_login_attempts INTO v_attempts;

  -- -1 distinguishes "no such user" from a real count of 0.
  RETURN COALESCE(v_attempts, -1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bump_failed_login_attempts(uuid, integer, integer) TO service_role;
