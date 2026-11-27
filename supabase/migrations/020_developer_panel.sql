-- =====================================================================
-- Developer panel (/dev): service switch, maintenance message, banner,
-- minimum app version, app health, users & sessions.
--
-- Developers are listed in the private table "developers" (by email). The
-- owner cannot see or change it, and nothing in the app can add to it.
--
-- PAUSE: while app_control.paused is on, every staff and client call is
-- refused with "SERVICE_PAUSED: <message>" – also from old app versions,
-- because the check is in the database. Nothing is deleted; Resume brings
-- everything back as it was. Developers keep access to fix or resume.
-- All switches start OFF: applying this file changes nothing for users.
-- =====================================================================

create table if not exists developers (email text primary key);
alter table developers enable row level security;
revoke all on developers from anon, authenticated;
insert into developers(email) values ('devyomie@gmail.com') on conflict do nothing;

create table if not exists app_control (
  id                  int primary key default 1 check (id = 1),
  paused              boolean not null default false,
  pause_message       text not null default 'This service is paused. Please contact your developer.',
  maintenance         boolean not null default false,
  maintenance_message text not null default 'We are updating the app. Please try again in a few minutes.',
  banner              text,
  min_version_code    int not null default 0,          -- Android versionCode; older apps must update
  updated_at          timestamptz not null default now(),
  updated_by          text
);
insert into app_control(id) values (1) on conflict do nothing;
alter table app_control enable row level security;
revoke all on app_control from anon, authenticated;

create table if not exists app_errors (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  app     text,          -- staff / client / web
  who     text,          -- staff or client id (no names, no tokens)
  version text,
  url     text,
  message text not null,
  detail  text
);
create index if not exists app_errors_at_idx on app_errors (at desc);
alter table app_errors enable row level security;
revoke all on app_errors from anon, authenticated;

-- ---------- helpers ----------
create or replace function service_paused() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select paused from app_control where id = 1), false)
$$;

create or replace function is_developer_email(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from developers where email = lower(trim(coalesce(p_email, ''))))
$$;
revoke execute on function is_developer_email(text) from public, anon, authenticated;

create or replace function service_gate(p_email text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if service_paused() and not is_developer_email(p_email) then
    raise exception 'SERVICE_PAUSED: %', (select pause_message from app_control where id = 1);
  end if;
end $$;
revoke execute on function service_gate(text) from public, anon, authenticated;

-- what every app asks on start (before sign-in): switches and messages
create or replace function app_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('paused', paused, 'pause_message', pause_message, 'maintenance', maintenance,
    'maintenance_message', maintenance_message, 'banner', banner, 'min_version_code', min_version_code)
  from app_control where id = 1
$$;
grant execute on function app_status() to anon, authenticated;

-- phones report their errors (kept short; at most 300 an hour so it cannot flood)
create or replace function report_error(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from app_errors where at > now() - interval '1 hour') >= 300 then return; end if;
  insert into app_errors(app, who, version, url, message, detail)
  values (left(p->>'app', 20), left(p->>'who', 60), left(p->>'version', 30), left(p->>'url', 300),
          left(coalesce(nullif(p->>'message', ''), 'Unknown error'), 500), left(p->>'detail', 2000));
  delete from app_errors where at < now() - interval '30 days';
end $$;
grant execute on function report_error(jsonb) to anon, authenticated;

-- ---------- the gate in the existing sign-in checks (bodies unchanged otherwise) ----------
create or replace function current_staff() returns staff
language sql stable security definer set search_path = public, extensions as $$
  select st.* from staff_sessions ss join staff st on st.id = ss.staff_id
   where request_staff_token() is not null
     and ss.token_hash = portal_hash(request_staff_token()) and ss.expires_at > now()
     and st.account_status = 'approved' and st.active
     and (not service_paused() or is_developer_email(st.email))
   limit 1
$$;

create or replace function staff_session(p_token text) returns staff
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  select st.* into s from staff_sessions ss join staff st on st.id = ss.staff_id
   where ss.token_hash = portal_hash(coalesce(p_token, '')) and ss.expires_at > now();
  if s.id is null then raise exception 'STAFF_SESSION: Please sign in again'; end if;
  if s.account_status <> 'approved' or not s.active then raise exception 'STAFF_SESSION: Your account is not active'; end if;
  perform service_gate(s.email);
  update staff_sessions set expires_at = greatest(expires_at, now() + interval '30 days') where token_hash = portal_hash(p_token);
  return s;
end $$;

create or replace function staff_new_session(p_staff uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  perform service_gate((select email from staff where id = p_staff));
  insert into staff_sessions(token_hash, staff_id, expires_at) values (portal_hash(v_token), p_staff, now() + interval '30 days');
  update staff set last_login = now() where id = p_staff;
  return v_token;
end $$;

create or replace function portal_client(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform service_gate(null);
  update portal_sessions set last_seen = now(), expires_at = greatest(expires_at, now() + interval '90 days')
   where token_hash = portal_hash(coalesce(p_token, '')) and expires_at > now()
  returning client_id into v;
  if v is null then raise exception 'SESSION_EXPIRED: Please sign in again'; end if;
  return v;
end $$;

create or replace function portal_session_for_email(p_email text, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_email text := lower(trim(coalesce(p_email, ''))); v_client clients; v_token text; v_new boolean := false;
begin
  perform service_gate(null);
  if v_email !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'Sign-in has no email address'; end if;
  select * into v_client from clients where lower(email) = v_email order by created_at limit 1;
  if v_client.id is null then
    insert into clients(name, email, source)
    values (coalesce(nullif(trim(p_name), ''), 'New client'), v_email, 'Online')
    returning * into v_client;
    v_new := true;
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into portal_sessions(token_hash, client_id, expires_at) values (portal_hash(v_token), v_client.id, now() + interval '90 days');
  return jsonb_build_object('token', v_token, 'client_id', v_client.id,
    'is_new', v_new or v_client.name = 'New client' or v_client.phone is null);
end $$;
revoke execute on function portal_session_for_email(text, text) from public, anon, authenticated;

-- no reminders go out while the service is paused
create or replace function queue_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; b bookings;
begin
  if service_paused() then return 0; end if;
  for b in select * from bookings
            where status in ('pending', 'booked') and client_id is not null and reminded_at is null
              and salon_day(scheduled_at) = salon_day(now()) + 1 loop
    perform notify_client(b.client_id, 'Reminder: tomorrow',
      'Your appointment at Dantesras is ' || salon_time(b.scheduled_at) || '. See you!');
    update bookings set reminded_at = now() where id = b.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function queue_reminders() from public, anon, authenticated;

-- ---------- developer functions (each checks the caller is a developer) ----------
create or replace function dev_caller(p_token text) returns staff
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := staff_session(p_token);
begin
  if not is_developer_email(s.email) then raise exception 'Developers only'; end if;
  return s;
end $$;
revoke execute on function dev_caller(text) from public, anon, authenticated;

-- is the signed-in person a developer? (never raises; the app shows the menu item)
create or replace function dev_check(p_token text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform dev_caller(p_token);
  return true;
exception when others then return false;
end $$;

create or replace function dev_overview(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c app_control;
begin
  perform dev_caller(p_token);
  select * into c from app_control where id = 1;
  return jsonb_build_object(
    'control', to_jsonb(c),
    'counts', jsonb_build_object(
      'staff', (select count(*) from staff where account_status = 'approved' and active),
      'staff_pending', (select count(*) from staff where account_status = 'pending'),
      'clients', (select count(*) from clients),
      'bookings_today', (select count(*) from bookings where salon_day(coalesce(scheduled_at, created_at)) = salon_day(now())),
      'bookings_7d', (select count(*) from bookings where created_at > now() - interval '7 days'),
      'sales_7d', (select count(*) from sales where sold_at > now() - interval '7 days'),
      'staff_sessions', (select count(*) from staff_sessions where expires_at > now()),
      'client_sessions', (select count(*) from portal_sessions where expires_at > now()),
      'phones', (select count(*) from push_devices),
      'errors_24h', (select count(*) from app_errors where at > now() - interval '24 hours'),
      'push_failed_7d', (select count(*) from notifications where push_error is not null and created_at > now() - interval '7 days'),
      'push_waiting', (select count(*) from notifications where pushed_at is null and created_at < now() - interval '10 minutes'),
      'mpesa_failed_7d', (select count(*) from mpesa_stk_requests where status in ('failed', 'timeout') and created_at > now() - interval '7 days'),
      'db_size', pg_size_pretty(pg_database_size(current_database()))),
    'errors', coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc) from (select * from app_errors order by at desc limit 50) e), '[]'::jsonb),
    'push_failures', coalesce((select jsonb_agg(jsonb_build_object('at', n.created_at, 'title', n.title, 'error', n.push_error) order by n.created_at desc)
        from (select * from notifications where push_error is not null order by created_at desc limit 20) n), '[]'::jsonb),
    'mpesa_failures', coalesce((select jsonb_agg(jsonb_build_object('at', m.created_at, 'purpose', m.purpose, 'amount', m.amount, 'status', m.status, 'reason', m.result_desc) order by m.created_at desc)
        from (select * from mpesa_stk_requests where status in ('failed', 'timeout') order by created_at desc limit 20) m), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'email', s.email, 'roles', s.roles,
        'account_status', s.account_status, 'active', s.active, 'last_login', s.last_login, 'developer', is_developer_email(s.email),
        'sessions', (select count(*) from staff_sessions ss where ss.staff_id = s.id and ss.expires_at > now())) order by s.last_login desc nulls last, s.name)
        from staff s), '[]'::jsonb)
  );
end $$;

create or replace function dev_clients(p_token text, p_q text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform dev_caller(p_token);
  return coalesce((select jsonb_agg(x order by x.last_seen desc nulls last) from (
    select c.id, c.name, c.email, c.phone, c.created_at,
           (select max(ps.last_seen) from portal_sessions ps where ps.client_id = c.id) as last_seen,
           (select count(*) from portal_sessions ps where ps.client_id = c.id and ps.expires_at > now()) as sessions
      from clients c
     where coalesce(trim(p_q), '') = '' or c.name ilike '%' || trim(p_q) || '%' or c.email ilike '%' || trim(p_q) || '%' or c.phone ilike '%' || trim(p_q) || '%'
     order by c.created_at desc limit 50) x), '[]'::jsonb);
end $$;

create or replace function dev_set_control(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := dev_caller(p_token);
begin
  update app_control set
    paused              = coalesce((p->>'paused')::boolean, paused),
    pause_message       = coalesce(nullif(trim(p->>'pause_message'), ''), pause_message),
    maintenance         = coalesce((p->>'maintenance')::boolean, maintenance),
    maintenance_message = coalesce(nullif(trim(p->>'maintenance_message'), ''), maintenance_message),
    banner              = case when p ? 'banner' then nullif(trim(p->>'banner'), '') else banner end,
    min_version_code    = coalesce((p->>'min_version_code')::int, min_version_code),
    updated_at = now(), updated_by = s.email
  where id = 1;
  return app_status();
end $$;

create or replace function dev_staff_sign_out(p_token text, p_id uuid) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  perform dev_caller(p_token);
  delete from staff_sessions where staff_id = p_id and token_hash <> portal_hash(p_token);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function dev_staff_active(p_token text, p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me staff := dev_caller(p_token);
begin
  if p_id = me.id and not p_active then raise exception 'You cannot switch off your own account'; end if;
  update staff set active = p_active where id = p_id;
  if not p_active then delete from staff_sessions where staff_id = p_id; end if;
end $$;

create or replace function dev_client_sign_out(p_token text, p_id uuid) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  perform dev_caller(p_token);
  delete from portal_sessions where client_id = p_id;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function dev_clear_errors(p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform dev_caller(p_token);
  delete from app_errors;
end $$;
