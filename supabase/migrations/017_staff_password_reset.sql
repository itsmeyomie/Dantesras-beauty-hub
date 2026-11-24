-- =====================================================================
-- Staff "Forgot password?" (free): a 6-digit code goes to the staff member's
-- email through Supabase Auth (same Gmail as client codes). With the code the
-- app proves the email, then sets a new password here. All staff sessions of
-- that person end, so an old phone is signed out.
-- =====================================================================

create or replace function staff_set_new_password(p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  perform staff_check_password(p_password);
  update staff set password_hash = crypt(p_password, gen_salt('bf'))
   where lower(email) = lower(trim(coalesce(p_email, ''))) and account_status in ('approved', 'pending')
  returning * into s;
  if s.id is null then raise exception 'This email is not linked to a staff account. Ask the owner.'; end if;
  delete from staff_sessions where staff_id = s.id;
  return jsonb_build_object('ok', true, 'name', s.name);
end $$;
revoke execute on function staff_set_new_password(text, text) from public, anon, authenticated;

-- real reset: the email comes from the verified Supabase Auth sign-in (code from the email)
create or replace function staff_reset_password(p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if c is null or c->>'role' <> 'authenticated' or coalesce(c->>'email', '') = '' then
    raise exception 'Enter the code from your email first';
  end if;
  return staff_set_new_password(c->>'email', p_password);
end $$;

-- test mode only (test_codes on): code shown on screen, checked here
create or replace function staff_reset_test_code(p_email text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  if not test_codes_on() then raise exception 'Test codes are off. Update the app.'; end if;
  r := portal_issue_code('email', p_email);
  return jsonb_build_object('to', r->>'address', 'dev_code', r->>'code');
end $$;

create or replace function staff_reset_with_test_code(p_email text, p_code text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_addr text := portal_address('email', p_email); c portal_codes;
begin
  if not test_codes_on() then raise exception 'Test codes are off. Update the app.'; end if;
  select * into c from portal_codes
   where address = v_addr and used_at is null and expires_at > now()
   order by created_at desc limit 1 for update;
  if not found then raise exception 'The code has expired. Ask for a new one.'; end if;
  if c.attempts >= 5 then raise exception 'Too many wrong tries. Ask for a new code.'; end if;
  if c.code_hash <> portal_hash(c.id::text || regexp_replace(coalesce(p_code, ''), '\D', '', 'g')) then
    update portal_codes set attempts = attempts + 1 where id = c.id;
    raise exception 'Wrong code. Check the message and try again.';
  end if;
  update portal_codes set used_at = now() where id = c.id;
  return staff_set_new_password(v_addr, p_password);
end $$;
