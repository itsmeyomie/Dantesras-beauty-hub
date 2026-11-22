-- =====================================================================
-- Staff accounts: everyone signs up with email + password (and a photo), the OWNER approves
-- and gives the role (stylist / receptionist / manager). Sessions work like the client app.
-- Passwords are hashed with bcrypt (pgcrypto). Run after 008_stylists_at_time.sql.
-- Roles in staff.roles: owner, manager, receptionist, stylist, tutor
-- =====================================================================

alter table staff add column if not exists email text;
alter table staff add column if not exists password_hash text;
alter table staff add column if not exists photo text;            -- small JPEG as data URL (later: Supabase Storage URL)
alter table staff add column if not exists specialty text;        -- shown to clients, e.g. "Nails · gel"
alter table staff add column if not exists account_status text not null default 'none'
  check (account_status in ('none','pending','approved','declined'));
alter table staff add column if not exists wanted_role text;
alter table staff add column if not exists requested_at timestamptz;
alter table staff add column if not exists decline_reason text;
alter table staff add column if not exists last_login timestamptz;
create unique index if not exists staff_email_uidx on staff (lower(email)) where email is not null;

create table if not exists staff_sessions (
  token_hash text primary key,
  staff_id   uuid not null references staff(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table staff_sessions enable row level security;   -- no policy: only reachable through the functions below

-- public profile of a staff member (never the password hash)
create or replace function staff_json(s staff) returns jsonb language sql stable as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'email', s.email, 'phone', s.phone, 'roles', s.roles,
    'photo', s.photo, 'specialty', s.specialty, 'account_status', s.account_status, 'wanted_role', s.wanted_role,
    'active', s.active, 'requested_at', s.requested_at, 'decline_reason', s.decline_reason)
$$;

create or replace function staff_check_password(p text) returns void language plpgsql immutable as $$
begin
  if length(coalesce(p, '')) < 6 then raise exception 'Use a password of at least 6 characters'; end if;
end $$;

-- token → approved, active staff member
create or replace function staff_session(p_token text) returns staff
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  select st.* into s from staff_sessions ss join staff st on st.id = ss.staff_id
   where ss.token_hash = portal_hash(coalesce(p_token, '')) and ss.expires_at > now();
  if s.id is null then raise exception 'STAFF_SESSION: Please sign in again'; end if;
  if s.account_status <> 'approved' or not s.active then raise exception 'STAFF_SESSION: Your account is not active'; end if;
  update staff_sessions set expires_at = greatest(expires_at, now() + interval '30 days') where token_hash = portal_hash(p_token);
  return s;
end $$;

create or replace function staff_new_session(p_staff uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  insert into staff_sessions(token_hash, staff_id, expires_at) values (portal_hash(v_token), p_staff, now() + interval '30 days');
  update staff set last_login = now() where id = p_staff;
  return v_token;
end $$;

-- ---------- sign up (anyone) ----------
-- p = { name, email, phone, password, role: stylist|receptionist|manager, specialty?, photo? }
create or replace function staff_signup(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(coalesce(p->>'email', '')));
  v_role text := coalesce(p->>'role', 'stylist');
  v_phone text := nullif(trim(coalesce(p->>'phone', '')), '');
  s staff;
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Enter your full name'; end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'Enter a valid email address'; end if;
  if v_phone is not null and mpesa_phone(v_phone) is null then raise exception 'Enter a valid phone number, e.g. 0712 345 678'; end if;
  perform staff_check_password(p->>'password');
  if v_role not in ('stylist','receptionist','manager') then raise exception 'Choose stylist, receptionist or manager'; end if;
  if length(coalesce(p->>'photo', '')) > 450000 then raise exception 'The photo is too large'; end if;
  if exists (select 1 from staff where lower(email) = v_email) then
    raise exception 'An account with this email already exists. Sign in instead.';
  end if;

  -- someone the owner already added (same phone, no account yet) → that record gets the account
  if v_phone is not null then
    select * into s from staff where email is null and mpesa_phone(phone) = mpesa_phone(v_phone) and not ('owner' = any(roles)) limit 1;
  end if;
  if s.id is null then
    insert into staff(name, phone, roles, active) values (trim(p->>'name'), case when v_phone is not null then '0' || substr(mpesa_phone(v_phone), 4) end, array[v_role], false)
    returning * into s;
  end if;
  update staff set email = v_email, password_hash = crypt(p->>'password', gen_salt('bf')),
         name = trim(p->>'name'), specialty = nullif(trim(coalesce(p->>'specialty', '')), ''), photo = nullif(p->>'photo', ''),
         account_status = 'pending', wanted_role = v_role, requested_at = now(), decline_reason = null
   where id = s.id returning * into s;
  return staff_json(s);
end $$;

-- ---------- sign in ----------
create or replace function staff_login(p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  select * into s from staff where lower(email) = lower(trim(coalesce(p_email, '')));
  if s.id is null or s.password_hash is null or s.password_hash <> crypt(coalesce(p_password, ''), s.password_hash) then
    raise exception 'Wrong email or password';
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

-- ---------- first owner ----------
create or replace function staff_setup_needed() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from staff where 'owner' = any(roles) and account_status = 'approved' and email is not null)
$$;

-- only while no owner account exists: the owner record gets email + password
create or replace function staff_owner_setup(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v_email text := lower(trim(coalesce(p->>'email', '')));
begin
  if not staff_setup_needed() then raise exception 'The owner account is already set up'; end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'Enter a valid email address'; end if;
  perform staff_check_password(p->>'password');
  select * into s from staff where 'owner' = any(roles) order by created_at limit 1;
  if s.id is null then
    insert into staff(name, roles) values (coalesce(nullif(trim(p->>'name'), ''), 'Owner'), '{owner,stylist}') returning * into s;
  end if;
  update staff set email = v_email, password_hash = crypt(p->>'password', gen_salt('bf')),
         name = coalesce(nullif(trim(p->>'name'), ''), name), account_status = 'approved', active = true
   where id = s.id returning * into s;
  return jsonb_build_object('status', 'approved', 'token', staff_new_session(s.id), 'staff', staff_json(s));
end $$;

-- ---------- my profile ----------
create or replace function staff_me(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  return staff_json(staff_session(p_token));
end $$;

-- p = { name?, phone?, specialty?, photo?, password? }
create or replace function staff_update_me(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := staff_session(p_token);
begin
  if p ? 'name' and coalesce(trim(p->>'name'), '') = '' then raise exception 'Enter your name'; end if;
  if nullif(p->>'phone', '') is not null and mpesa_phone(p->>'phone') is null then raise exception 'Enter a valid phone number'; end if;
  if length(coalesce(p->>'photo', '')) > 450000 then raise exception 'The photo is too large'; end if;
  if nullif(p->>'password', '') is not null then perform staff_check_password(p->>'password'); end if;
  update staff set
    name = coalesce(nullif(trim(p->>'name'), ''), name),
    phone = coalesce(case when nullif(p->>'phone', '') is not null then '0' || substr(mpesa_phone(p->>'phone'), 4) end, phone),
    specialty = case when p ? 'specialty' then nullif(trim(p->>'specialty'), '') else specialty end,
    photo = case when p ? 'photo' then nullif(p->>'photo', '') else photo end,
    password_hash = case when nullif(p->>'password', '') is not null then crypt(p->>'password', gen_salt('bf')) else password_hash end
  where id = s.id returning * into s;
  return staff_json(s);
end $$;

create or replace function staff_logout(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from staff_sessions where token_hash = portal_hash(coalesce(p_token, ''));
$$;

-- ---------- owner: approve / decline ----------
create or replace function staff_requests(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me staff := staff_session(p_token);
begin
  if not ('owner' = any(me.roles)) then raise exception 'Only the owner can see staff requests'; end if;
  return coalesce((select jsonb_agg(staff_json(s) order by s.requested_at desc) from staff s where s.account_status in ('pending','declined')), '[]'::jsonb);
end $$;

-- p_role: stylist | receptionist | manager
create or replace function staff_approve(p_token text, p_id uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me staff := staff_session(p_token); s staff;
begin
  if not ('owner' = any(me.roles)) then raise exception 'Only the owner can approve staff'; end if;
  if p_role not in ('stylist','receptionist','manager') then raise exception 'Choose stylist, receptionist or manager'; end if;
  update staff set account_status = 'approved', active = true, decline_reason = null,
         roles = array(select distinct r from unnest(roles || array[p_role]) r where r = 'tutor' or r = p_role)
   where id = p_id and account_status in ('pending','declined') returning * into s;
  if s.id is null then raise exception 'This request was already answered'; end if;
  return staff_json(s);
end $$;

create or replace function staff_decline(p_token text, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me staff := staff_session(p_token);
begin
  if not ('owner' = any(me.roles)) then raise exception 'Only the owner can decline staff'; end if;
  update staff set account_status = 'declined', decline_reason = nullif(trim(p_reason), '')
   where id = p_id and account_status = 'pending';
  if not found then raise exception 'This request was already answered'; end if;
  delete from staff_sessions where staff_id = p_id;
end $$;

-- ---------- client app: show photos and specialities ----------
create or replace function portal_stylists_at(p_date date, p_time text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_start timestamptz := (p_date + p_time::time) at time zone 'Africa/Nairobi';
  v_dur int := setting_num('online_duration_min', 120)::int;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'photo', s.photo, 'specialty', s.specialty,
      'free', slot_free(v_start, v_dur, s.id)) order by s.name)
    from staff s where s.active and 'stylist' = any(s.roles)), '[]'::jsonb);
end $$;

create or replace function portal_stylists() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'photo', photo, 'specialty', specialty) order by name), '[]'::jsonb)
  from staff where active and 'stylist' = any(roles)
$$;

-- client app menu: stylists now carry photo + speciality
create or replace function portal_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'client_type', c.client_type,
        'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'price', s.price,
            'price_type', s.price_type, 'max_price', s.max_price,
            'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'price', v.price) order by v.sort)
                                  from service_variants v where v.service_id = s.id), '[]'::jsonb)) order by s.sort, s.name)
          from services s where s.category_id = c.id and s.active), '[]'::jsonb)) order by c.sort)
      from service_categories c), '[]'::jsonb),
    'stylists', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'photo', photo, 'specialty', specialty) order by name)
      from staff where active and 'stylist' = any(roles)), '[]'::jsonb),
    'courses', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'fee', fee, 'fee_type', fee_type,
        'duration_value', duration_value, 'duration_unit', duration_unit) order by name) from courses where active), '[]'::jsonb),
    'settings', coalesce((select jsonb_object_agg(key, value) from settings where key in
      ('deposit_min','late_minutes','salon_hours','school_hours','kids_max_age','online_booking','online_lead_minutes','online_days_ahead',
       'online_duration_min','salon_phone','salon_location','business_name')), '{}'::jsonb)
  )
$$;
