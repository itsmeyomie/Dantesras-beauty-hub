-- =====================================================================
-- Protect staff account fields from the public (anon) key while the rest of the database is
-- still in development mode (dev_open_access). Run after 009_staff_accounts.sql.
--  - nobody can read password hashes through the API
--  - email, password, account status and approval fields can only change through the
--    staff_* functions (sign up, approve, profile), never by writing the table directly
-- The app reads staff with an explicit column list (no "*").
-- =====================================================================
revoke select, insert, update on staff from anon, authenticated;

grant select (id, name, phone, roles, basic_salary, payout_schedule, active, created_at,
              email, photo, specialty, account_status, wanted_role, requested_at, decline_reason, last_login)
  on staff to anon, authenticated;

-- the owner's Team page can still add people and set pay / schedule / on-off
grant insert (name, phone, roles, basic_salary, payout_schedule, active) on staff to anon, authenticated;
grant update (name, phone, basic_salary, payout_schedule, active) on staff to anon, authenticated;

-- sessions and one-time codes: functions only
revoke all on staff_sessions, portal_sessions, portal_codes from anon, authenticated;

-- roles change only through the owner (Team page)
create or replace function staff_set_roles(p_token text, p_id uuid, p_roles text[]) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me staff := staff_session(p_token);
begin
  if not ('owner' = any(me.roles)) then raise exception 'Only the owner can change roles'; end if;
  if exists (select 1 from unnest(p_roles) r where r not in ('owner','manager','receptionist','stylist','tutor')) then
    raise exception 'Unknown role';
  end if;
  if p_id = me.id and not ('owner' = any(p_roles)) then raise exception 'You cannot remove your own owner role'; end if;
  update staff set roles = p_roles where id = p_id;
end $$;
