-- =====================================================================
-- Free client sign-in: email code or Google (Supabase Auth), no SMS.
--
-- 1. The app signs the client in with Supabase Auth (email code / Google).
-- 2. It calls portal_from_auth() with that sign-in; the database reads the
--    VERIFIED email from the sign-in (request.jwt.claims, checked by Supabase),
--    finds the client with that email (or creates one) and starts the usual
--    client session. Staff can link an existing client by adding their email.
--
-- Test sign-in codes (shown on screen) now have their own switch "test_codes",
-- separate from the simulated M-Pesa ("test_mode").
-- =====================================================================

insert into settings(key, value)
select 'test_codes', coalesce((select value from settings where key = 'test_mode'), 'true'::jsonb)
on conflict (key) do nothing;

create or replace function test_codes_on() returns boolean language sql stable as $$
  select coalesce((select (value #>> '{}')::boolean from settings where key = 'test_codes'), false)
$$;

-- sign-in code shown on screen – only while test_codes is on
create or replace function portal_test_code(p_channel text, p_address text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  if not test_codes_on() then raise exception 'Test sign-in is off. Update the app.'; end if;
  r := portal_issue_code(p_channel, p_address);
  return jsonb_build_object('sent', true, 'channel', p_channel, 'to', r->>'address', 'simulated', true, 'dev_code', r->>'code');
end $$;

-- client session for a verified email (shared by real and test sign-in)
create or replace function portal_session_for_email(p_email text, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_email text := lower(trim(coalesce(p_email, ''))); v_client clients; v_token text; v_new boolean := false;
begin
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

-- real sign-in: the email comes from the Supabase Auth sign-in, never from the caller
create or replace function portal_from_auth() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  c jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_name text;
begin
  if c is null or c->>'role' <> 'authenticated' or coalesce(c->>'email', '') = '' then
    raise exception 'Sign in with your email code or Google first';
  end if;
  v_name := coalesce(c->'user_metadata'->>'full_name', c->'user_metadata'->>'name');
  return portal_session_for_email(c->>'email', v_name);
end $$;

-- test "Sign in with Google" (no Google account needed) – only while test_codes is on
create or replace function portal_test_google(p_email text, p_name text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not test_codes_on() then raise exception 'Test sign-in is off. Update the app.'; end if;
  return portal_session_for_email(p_email, p_name);
end $$;

-- the email code tables are only used by test codes now
-- (the portal-otp Edge Function with SMS / WhatsApp is no longer needed)
