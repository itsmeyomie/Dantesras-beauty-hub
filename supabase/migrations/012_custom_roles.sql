-- =====================================================================
-- Roles the owner creates, and which screens each role can open.
-- Finisher: finishes the braids / work of the main stylist on a booking.
-- =====================================================================

create table if not exists staff_roles (
  key        text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name       text not null,
  areas      text[] not null default '{}',     -- screens this role can open (me and more are always open)
  serves     boolean not null default false,   -- can be the main person serving a client
  finishes   boolean not null default false,   -- finishes the main stylist's work
  built_in   boolean not null default false,   -- owner/manager/receptionist/stylist/tutor cannot be deleted
  sort       int not null default 100,
  created_at timestamptz not null default now()
);
alter table staff_roles enable row level security;
drop policy if exists staff_roles_read on staff_roles;
create policy staff_roles_read on staff_roles for select using (true);
grant select on staff_roles to anon, authenticated;
revoke insert, update, delete on staff_roles from anon, authenticated;

-- the screens a role can be given (settings, staff requests and roles stay with the owner)
create or replace function staff_area_list() returns text[] language sql immutable as $$
  select array['dashboard','desk','my-day','bookings','checkout','sales','clients','debts','services','products','team','school','reports']
$$;

insert into staff_roles(key, name, areas, serves, finishes, built_in, sort) values
  ('owner', 'Owner', staff_area_list() || array['settings','staff-requests','roles'], true, false, true, 1),
  ('manager', 'Manager', array['dashboard','desk','bookings','checkout','sales','clients','debts','services','products','team','school','reports'], false, false, true, 2),
  ('receptionist', 'Receptionist', array['desk','bookings','checkout','sales','clients','debts','school'], false, false, true, 3),
  ('stylist', 'Stylist', array['my-day','bookings','checkout'], true, false, true, 4),
  ('tutor', 'Tutor', array[]::text[], false, false, true, 5),
  ('finisher', 'Finisher', array['my-day','bookings'], false, true, false, 6)
on conflict (key) do nothing;

-- who did what on a booking: the main stylist(s) or the finisher
alter table booking_staff add column if not exists part text not null default 'main';
do $$ begin
  alter table booking_staff add constraint booking_staff_part_chk check (part in ('main','finisher'));
exception when duplicate_object then null; end $$;

-- default share of the commission for the finisher at checkout (percent)
insert into settings(key, value) values ('finisher_share_pct', '20') on conflict (key) do nothing;

-- screens a staff member can open = all screens of all their roles
create or replace function staff_areas(p_roles text[]) returns text[] language sql stable as $$
  select coalesce(array(select distinct a from staff_roles r, unnest(r.areas) a where r.key = any(p_roles) order by a), '{}')
$$;

create or replace function staff_json(s staff) returns jsonb language sql stable as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'email', s.email, 'phone', s.phone, 'roles', s.roles,
    'photo', s.photo, 'specialty', s.specialty, 'account_status', s.account_status, 'wanted_role', s.wanted_role,
    'active', s.active, 'requested_at', s.requested_at, 'decline_reason', s.decline_reason,
    'areas', to_jsonb(staff_areas(s.roles)))
$$;

-- ---------- owner: create / change / delete roles ----------
-- p = { key?, name, areas[], serves, finishes }
create or replace function staff_role_save(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  me staff := staff_session(p_token);
  v_name text := trim(coalesce(p->>'name', ''));
  v_key text := nullif(p->>'key', '');
  v_areas text[] := array(select jsonb_array_elements_text(coalesce(p->'areas', '[]')));
  r staff_roles;
begin
  if not ('owner' = any(me.roles)) then raise exception 'Only the owner can change roles'; end if;
  if v_name = '' then raise exception 'Give the role a name'; end if;
  if exists (select 1 from unnest(v_areas) a where a <> all(staff_area_list())) then raise exception 'Unknown screen'; end if;
  if v_key = 'owner' then raise exception 'The owner role always has every screen'; end if;
  if v_key is null then
    v_key := trim(both '_' from regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g'));
    if v_key !~ '^[a-z]' then v_key := 'role_' || v_key; end if;
    v_key := left(v_key, 30);
    if exists (select 1 from staff_roles where key = v_key or lower(name) = lower(v_name)) then
      raise exception 'A role called % already exists', v_name;
    end if;
    insert into staff_roles(key, name, areas, serves, finishes, sort)
    values (v_key, v_name, v_areas, coalesce((p->>'serves')::boolean, false), coalesce((p->>'finishes')::boolean, false),
            (select coalesce(max(sort), 0) + 1 from staff_roles))
    returning * into r;
  else
    if exists (select 1 from staff_roles where lower(name) = lower(v_name) and key <> v_key) then
      raise exception 'A role called % already exists', v_name;
    end if;
    update staff_roles set name = v_name, areas = v_areas,
           serves = coalesce((p->>'serves')::boolean, serves), finishes = coalesce((p->>'finishes')::boolean, finishes)
     where key = v_key returning * into r;
    if r.key is null then raise exception 'Role not found'; end if;
  end if;
  return to_jsonb(r);
end $$;

create or replace function staff_role_delete(p_token text, p_key text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me staff := staff_session(p_token); v_n int;
begin
  if not ('owner' = any(me.roles)) then raise exception 'Only the owner can change roles'; end if;
  if exists (select 1 from staff_roles where key = p_key and built_in) then raise exception 'Built-in roles cannot be deleted'; end if;
  select count(*) into v_n from staff where p_key = any(roles) and active;
  if v_n > 0 then raise exception 'First move the % staff member(s) with this role to another role', v_n; end if;
  update staff set roles = array_remove(roles, p_key) where p_key = any(roles);
  update staff set wanted_role = null where wanted_role = p_key;
  delete from staff_roles where key = p_key;
end $$;

-- ---------- role checks now use the roles table ----------
create or replace function staff_set_roles(p_token text, p_id uuid, p_roles text[]) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me staff := staff_session(p_token);
begin
  if not ('owner' = any(me.roles)) then raise exception 'Only the owner can change roles'; end if;
  if exists (select 1 from unnest(p_roles) r where not exists (select 1 from staff_roles k where k.key = r)) then
    raise exception 'Unknown role';
  end if;
  if p_id = me.id and not ('owner' = any(p_roles)) then raise exception 'You cannot remove your own owner role'; end if;
  update staff set roles = p_roles where id = p_id;
end $$;

create or replace function staff_approve(p_token text, p_id uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me staff := staff_session(p_token); s staff;
begin
  if not ('owner' = any(me.roles)) then raise exception 'Only the owner can approve staff'; end if;
  if p_role = 'owner' or not exists (select 1 from staff_roles where key = p_role) then raise exception 'Choose a role'; end if;
  update staff set account_status = 'approved', active = true, decline_reason = null,
         roles = array(select distinct r from unnest(roles || array[p_role]) r where r = 'tutor' or r = p_role)
   where id = p_id and account_status in ('pending','declined') returning * into s;
  if s.id is null then raise exception 'This request was already answered'; end if;
  return staff_json(s);
end $$;

-- p = { name, email, phone, password, role (any role except owner), specialty?, photo? }
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
  if v_role = 'owner' or not exists (select 1 from staff_roles where key = v_role) then raise exception 'Choose the job you do'; end if;
  if length(coalesce(p->>'photo', '')) > 450000 then raise exception 'The photo is too large'; end if;
  if exists (select 1 from staff where lower(email) = v_email) then
    raise exception 'An account with this email already exists. Sign in instead.';
  end if;
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
