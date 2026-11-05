-- Let the application's login role assume `app_runtime`.
--
-- 0005 creates the role but never grants it to anyone. That went unnoticed in
-- staging because the login role there is a superuser, and a superuser can
-- `set role` to anything. Production connects with the pooler role, which is
-- not: every governed request failed with
--
--   permission denied to set role "app_runtime"
--
-- before reaching a single policy. The policies were correct and unreachable.
--
-- The grant goes to `current_user`, the role this migration is applied with -
-- the same role the application connects as. Granting it does not widen that
-- role's own authority (it already owns these objects); it only allows dropping
-- down to the restricted one inside a transaction.
--
-- Idempotent: a second run is a no-op.

do $$
declare
  login_role text := current_user;
begin
  execute format('grant app_runtime to %I', login_role);
end;
$$;
