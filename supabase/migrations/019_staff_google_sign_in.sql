-- =====================================================================
-- Owner and staff: "Continue with Google" on the staff sign-in page.
-- Only for people who already have a staff account with that (verified)
-- Google email. Same rules as the password sign-in: pending accounts wait
-- for the owner, declined / switched-off accounts are refused.
-- =====================================================================

create or replace function staff_login_for_email(p_email text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  select * into s from staff where lower(email) = lower(trim(coalesce(p_email, '')));
  if s.id is null then
    raise exception 'No staff account uses %. Sign in with your password, or create an account first.', lower(trim(p_email));
  end if;
  if s.account_status = 'pending' then
    return jsonb_build_object('status', 'pending', 'staff', staff_json(s));
  end if;
  if s.account_status = 'declined' then
    raise exception 'Your request was declined%', coalesce(': ' || s.decline_reason, '. Talk to the owner.');
  end if;
  if not s.active then raise exception 'Your account is switched off. Talk to the owner.'; end if;
  return jsonb_build_object('status', 'approved', 'token', staff_new_session(s.id), 'staff', staff_json(s));
end $$;
revoke execute on function staff_login_for_email(text) from public, anon, authenticated;

-- real: the email comes from the verified Google sign-in (Supabase Auth), never from the caller
create or replace function staff_login_google() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if c is null or c->>'role' <> 'authenticated' or coalesce(c->>'email', '') = '' then
    raise exception 'Sign in with Google first';
  end if;
  return staff_login_for_email(c->>'email');
end $$;

-- test mode only (test_codes on): "Google" without a Google account
create or replace function staff_test_google(p_email text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not test_codes_on() then raise exception 'Test sign-in is off. Update the app.'; end if;
  return staff_login_for_email(p_email);
end $$;
