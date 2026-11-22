-- =====================================================================
-- Client app (portal): sign-in with a one-time code (SMS, WhatsApp or email),
-- online booking requests that the salon confirms, deposits by M-Pesa prompt.
--
-- Everything the client app does goes through the portal_* functions below, which check the
-- client's session token. When real login is added the tables can be locked down without
-- changing the client app.
-- Run after 004_mpesa_stk.sql.
-- =====================================================================

-- ---------- clients: email, online sign-in ----------
alter table clients add column if not exists email text;
create unique index if not exists clients_email_uidx on clients (lower(email)) where email is not null;

-- ---------- bookings: online requests ----------
alter table bookings drop constraint if exists bookings_status_check;
alter table bookings add constraint bookings_status_check
  check (status in ('requested','pending','booked','waiting','in_progress','completed','cancelled','no_show','declined'));
alter table bookings add column if not exists online boolean not null default false;   -- made by the client in the app
alter table bookings add column if not exists response_note text;                      -- salon's message to the client
alter table bookings add column if not exists confirmed_at timestamptz;
alter table bookings add column if not exists preferred_staff_id uuid references staff(id) on delete set null;

insert into settings(key, value) values
  ('online_booking', 'true'),             -- switch online booking on / off
  ('online_lead_minutes', '60'),          -- earliest booking = now + this
  ('online_days_ahead', '30'),            -- how far ahead clients can book
  ('online_duration_min', '120'),         -- slot length used for online requests
  ('online_max_open', '3'),               -- open requests per client
  ('salon_phone', '""'),                  -- shown in the client app (call / WhatsApp)
  ('salon_location', '"Karuguru junction, Kamakis, Ruiru"')
on conflict (key) do nothing;

-- ---------- one-time codes and sessions ----------
create table if not exists portal_codes (
  id         uuid primary key default gen_random_uuid(),
  channel    text not null check (channel in ('sms','whatsapp','email')),
  address    text not null,                    -- 2547XXXXXXXX or lower-case email
  code_hash  text not null,
  attempts   int not null default 0,
  used_at    timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists portal_codes_addr_idx on portal_codes (address, created_at);

create table if not exists portal_sessions (
  token_hash text primary key,
  client_id  uuid not null references clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  expires_at timestamptz not null
);

-- these two tables are only touched through the functions below
alter table portal_codes enable row level security;
alter table portal_sessions enable row level security;

create or replace function portal_hash(p text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex')
$$;

create or replace function portal_address(p_channel text, p_address text) returns text language plpgsql immutable as $$
begin
  if p_channel = 'email' then
    if coalesce(p_address, '') !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'Enter a valid email address'; end if;
    return lower(trim(p_address));
  end if;
  if mpesa_phone(p_address) is null then raise exception 'Enter a valid Kenyan mobile number, e.g. 0712 345 678'; end if;
  return mpesa_phone(p_address);
end $$;

-- 1. Create a code. Called ONLY by the Edge Function that delivers it (portal-otp); never exposed to the app.
create or replace function portal_issue_code(p_channel text, p_address text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_addr text := portal_address(p_channel, p_address); v_code text; v_id uuid;
begin
  if (select count(*) from portal_codes where address = v_addr and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many codes requested. Please wait a few minutes and try again.';
  end if;
  if exists (select 1 from portal_codes where address = v_addr and created_at > now() - interval '30 seconds') then
    raise exception 'A code was just sent. Wait 30 seconds before asking for another.';
  end if;
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_id := gen_random_uuid();
  insert into portal_codes(id, channel, address, code_hash, expires_at)
  values (v_id, p_channel, v_addr, portal_hash(v_id::text || v_code), now() + interval '10 minutes');
  return jsonb_build_object('address', v_addr, 'code', v_code, 'expires_in', 600);
end $$;
-- Supabase grants new functions to anon/authenticated by default; this one must stay server-only
revoke all on function portal_issue_code(text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function portal_issue_code(text, text) from anon, authenticated;
  end if;
end $$;

-- 2. Check the code → session token (finds or creates the client)
create or replace function portal_verify_code(p_channel text, p_address text, p_code text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_addr text := portal_address(p_channel, p_address);
  c portal_codes; v_client clients; v_token text; v_new boolean := false;
begin
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

  if p_channel = 'email' then
    select * into v_client from clients where lower(email) = v_addr order by created_at limit 1;
  else
    select * into v_client from clients
     where mpesa_phone(phone) = v_addr or mpesa_phone(whatsapp) = v_addr order by created_at limit 1;
  end if;
  if v_client.id is null then
    insert into clients(name, phone, whatsapp, email, source)
    values (coalesce(nullif(trim(p_name), ''), 'New client'),
            case when p_channel <> 'email' then '0' || substr(v_addr, 4) end,
            case when p_channel = 'whatsapp' then '0' || substr(v_addr, 4) end,
            case when p_channel = 'email' then v_addr end,
            'Online')
    returning * into v_client;
    v_new := true;
  elsif p_channel = 'whatsapp' and v_client.whatsapp is null then
    update clients set whatsapp = '0' || substr(v_addr, 4) where id = v_client.id;
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into portal_sessions(token_hash, client_id, expires_at) values (portal_hash(v_token), v_client.id, now() + interval '90 days');
  return jsonb_build_object('token', v_token, 'is_new', v_new or v_client.name = 'New client', 'client_id', v_client.id);
end $$;

-- session token → client id (sliding 90-day session)
create or replace function portal_client(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  update portal_sessions set last_seen = now(), expires_at = greatest(expires_at, now() + interval '90 days')
   where token_hash = portal_hash(coalesce(p_token, '')) and expires_at > now()
  returning client_id into v;
  if v is null then raise exception 'SESSION_EXPIRED: Please sign in again'; end if;
  return v;
end $$;

create or replace function portal_sign_out(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from portal_sessions where token_hash = portal_hash(coalesce(p_token, ''));
$$;

create or replace function portal_me(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := portal_client(p_token);
begin
  return (select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'whatsapp', c.whatsapp, 'email', c.email,
    'birth_date', c.birth_date, 'area', c.area,
    'balance', coalesce((select sum(balance) from v_debts d where d.client_id = c.id), 0))
  from clients c where c.id = v);
end $$;

create or replace function portal_update_profile(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := portal_client(p_token); v_email text := lower(nullif(trim(p->>'email'), ''));
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Enter your name'; end if;
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'Enter a valid email address'; end if;
  if nullif(p->>'phone', '') is not null and mpesa_phone(p->>'phone') is null then raise exception 'Enter a valid phone number'; end if;
  if v_email is not null and exists (select 1 from clients where lower(email) = v_email and id <> v) then
    raise exception 'That email is already used by another account';
  end if;
  if nullif(p->>'phone', '') is not null and exists (select 1 from clients where mpesa_phone(phone) = mpesa_phone(p->>'phone') and id <> v) then
    raise exception 'That phone number is already used by another account. Sign in with it instead.';
  end if;
  update clients set
    name = trim(p->>'name'),
    phone = coalesce(case when nullif(p->>'phone', '') is not null then '0' || substr(mpesa_phone(p->>'phone'), 4) end, phone),
    email = coalesce(v_email, email),
    area = coalesce(nullif(trim(p->>'area'), ''), area),
    birth_date = coalesce(nullif(p->>'birth_date', '')::date, birth_date)
  where id = v;
  return portal_me(p_token);
end $$;

-- ---------- public menu for the app (no salaries, costs or commission) ----------
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
    'stylists', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
      from staff where active and 'stylist' = any(roles)), '[]'::jsonb),
    'courses', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'fee', fee, 'fee_type', fee_type,
        'duration_value', duration_value, 'duration_unit', duration_unit) order by name) from courses where active), '[]'::jsonb),
    'settings', coalesce((select jsonb_object_agg(key, value) from settings where key in
      ('deposit_min','late_minutes','salon_hours','school_hours','kids_max_age','online_booking','online_lead_minutes','online_days_ahead',
       'online_duration_min','salon_phone','salon_location','business_name')), '{}'::jsonb)
  )
$$;

-- ---------- availability ----------
-- Is there a stylist free (or the chosen one) for [start, start + duration)?
create or replace function slot_free(p_start timestamptz, p_duration int, p_staff uuid default null, p_ignore uuid default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_capacity int; v_used int;
begin
  if p_staff is not null then
    return not exists (
      select 1 from bookings b join booking_staff bs on bs.booking_id = b.id
       where bs.staff_id = p_staff and b.id is distinct from p_ignore
         and b.status in ('requested','pending','booked','in_progress')
         and b.scheduled_at < p_start + make_interval(mins => p_duration)
         and b.scheduled_at + make_interval(mins => coalesce(b.duration_min, 60)) > p_start);
  end if;
  select count(*) into v_capacity from staff where active and 'stylist' = any(roles);
  select coalesce(sum(greatest(b.stylists_needed, (select count(*) from booking_staff bs where bs.booking_id = b.id)::int, 1)), 0)
    into v_used from bookings b
   where b.id is distinct from p_ignore and b.status in ('requested','pending','booked','in_progress')
     and b.scheduled_at < p_start + make_interval(mins => p_duration)
     and b.scheduled_at + make_interval(mins => coalesce(b.duration_min, 60)) > p_start;
  return v_used < v_capacity;
end $$;

-- Opening hours for a date → {open, close} as text, or null if closed
create or replace function salon_hours_for(p_date date) returns jsonb language sql stable as $$
  select case when extract(isodow from p_date) = 7 then value->'sun' else value->'mon_sat' end
  from settings where key = 'salon_hours'
$$;

-- Times a client can choose on a day: [{"time":"10:00","free":true}, …]
create or replace function portal_slots(p_date date, p_staff uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  h jsonb := salon_hours_for(p_date);
  v_dur int := setting_num('online_duration_min', 120)::int;
  v_lead int := setting_num('online_lead_minutes', 60)::int;
  t timestamp; ts timestamptz; v_out jsonb := '[]'::jsonb;
begin
  if h is null or p_date > (now() at time zone 'Africa/Nairobi')::date + setting_num('online_days_ahead', 30)::int then return v_out; end if;
  for t in select generate_series(p_date + (h->>'open')::time, p_date + (h->>'close')::time - interval '60 minutes', interval '30 minutes') loop
    ts := t at time zone 'Africa/Nairobi';
    if ts < now() + make_interval(mins => v_lead) then continue; end if;
    v_out := v_out || jsonb_build_object('time', to_char(t, 'HH24:MI'), 'free', slot_free(ts, v_dur, p_staff));
  end loop;
  return v_out;
end $$;

-- ---------- booking requests ----------
-- p = { channel: salon|home, date: 'YYYY-MM-DD', time: 'HH:MM', staff_id?, address?, notes?,
--       services: [{service_id, variant_id?}] }
create or replace function portal_request_booking(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_client uuid := portal_client(p_token);
  v_channel text := coalesce(p->>'channel', 'salon');
  v_date date := (p->>'date')::date;
  v_time time := (p->>'time')::time;
  v_start timestamptz; h jsonb; v_id uuid; v_staff uuid := nullif(p->>'staff_id', '')::uuid;
  v_dur int := setting_num('online_duration_min', 120)::int;
  item jsonb; s services; v service_variants; cat service_categories; v_total numeric := 0; n int := 0;
begin
  if not coalesce((select (value #>> '{}')::boolean from settings where key = 'online_booking'), true) then
    raise exception 'Online booking is paused. Please call or WhatsApp the salon.';
  end if;
  if v_channel not in ('salon', 'home') then raise exception 'Choose salon or home service'; end if;
  if v_channel = 'home' and coalesce(trim(p->>'address'), '') = '' then raise exception 'Enter where the home service is'; end if;
  if v_date is null or v_time is null then raise exception 'Choose a date and time'; end if;
  v_start := (v_date + v_time) at time zone 'Africa/Nairobi';
  if v_start < now() + make_interval(mins => setting_num('online_lead_minutes', 60)::int) then
    raise exception 'That time has passed or is too soon. Choose a later time.';
  end if;
  if v_date > (now() at time zone 'Africa/Nairobi')::date + setting_num('online_days_ahead', 30)::int then
    raise exception 'You can book up to % days ahead', setting_num('online_days_ahead', 30)::int;
  end if;
  h := salon_hours_for(v_date);
  if h is null or v_time < (h->>'open')::time or v_time > (h->>'close')::time - interval '60 minutes' then
    raise exception 'The salon is closed at that time';
  end if;
  if (select count(*) from bookings where client_id = v_client and online and status in ('requested','pending')
        and scheduled_at > now()) >= setting_num('online_max_open', 3) then
    raise exception 'You already have % bookings waiting. Wait for the salon to confirm them first.', setting_num('online_max_open', 3)::int;
  end if;
  if jsonb_array_length(coalesce(p->'services', '[]'::jsonb)) = 0 then raise exception 'Choose at least one service'; end if;
  if v_staff is not null and not exists (select 1 from staff where id = v_staff and active) then raise exception 'That stylist is not available'; end if;
  if not slot_free(v_start, v_dur, v_staff) then
    raise exception 'Sorry, that time was just taken. Please choose another time.';
  end if;

  insert into bookings(client_id, channel, source, status, scheduled_at, duration_min, address, notes, online, preferred_staff_id)
  values (v_client, v_channel, 'Online', 'requested', v_start, v_dur, nullif(trim(p->>'address'), ''), nullif(trim(p->>'notes'), ''), true, v_staff)
  returning id into v_id;

  -- prices come from the menu, never from the app
  for item in select * from jsonb_array_elements(p->'services') loop
    select * into s from services where id = (item->>'service_id')::uuid and active;
    if s.id is null then raise exception 'A chosen service is no longer offered'; end if;
    select * into cat from service_categories where id = s.category_id;
    v := null;
    if nullif(item->>'variant_id', '') is not null then
      select * into v from service_variants where id = (item->>'variant_id')::uuid and service_id = s.id;
      if v.id is null then raise exception 'A chosen option is no longer offered'; end if;
    end if;
    insert into booking_services(booking_id, service_id, variant_id, name, price)
    values (v_id, s.id, v.id,
            case when cat.client_type = 'kids' then 'Kids ' else '' end || s.name || coalesce(' – ' || v.name, ''),
            coalesce(v.price, s.price));
    v_total := v_total + coalesce(v.price, s.price);
    n := n + 1;
  end loop;
  if n > 8 then raise exception 'At most 8 services per booking'; end if;
  if v_staff is not null then insert into booking_staff(booking_id, staff_id) values (v_id, v_staff); end if;

  return jsonb_build_object('id', v_id, 'total', v_total,
    'deposit', least(setting_num('deposit_min', 500), v_total));
end $$;

create or replace function portal_bookings(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := portal_client(p_token);
begin
  return (select coalesce(jsonb_agg(x order by x.scheduled_at desc), '[]'::jsonb) from (
    select b.id, b.channel, b.status, b.scheduled_at, b.address, b.notes, b.response_note, b.online, b.created_at,
      coalesce((select jsonb_agg(jsonb_build_object('name', bs.name, 'price', bs.price)) from booking_services bs where bs.booking_id = b.id), '[]') as services,
      coalesce((select jsonb_agg(st.name) from booking_staff x join staff st on st.id = x.staff_id where x.booking_id = b.id), '[]') as stylists,
      coalesce((select sum(price) from booking_services bs where bs.booking_id = b.id), 0) + b.transport_fee as total,
      coalesce((select sum(amount) from payments p where p.booking_id = b.id and p.kind = 'deposit'), 0) as paid
    from bookings b where b.client_id = v and b.channel <> 'walkin'
  ) x);
end $$;

create or replace function portal_cancel_booking(p_token text, p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := portal_client(p_token);
begin
  update bookings set status = 'cancelled', cancel_reason = coalesce(nullif(trim(p_reason), ''), 'Cancelled by client in the app')
   where id = p_id and client_id = v and status in ('requested','pending','booked') and scheduled_at > now();
  if not found then raise exception 'This booking can no longer be cancelled in the app. Please call the salon.'; end if;
end $$;

-- ---------- salon side: answer a request ----------
create or replace function confirm_booking(p_id uuid, p_note text default null) returns text
language plpgsql as $$
declare v_paid numeric; v_value numeric; v_status text;
begin
  select coalesce(sum(amount), 0) into v_paid from payments where booking_id = p_id and kind = 'deposit';
  v_value := booking_unpaid(p_id) + v_paid;
  v_status := case when v_paid >= least(setting_num('deposit_min', 500), greatest(v_value, 1)) then 'booked' else 'pending' end;
  update bookings set status = v_status, confirmed_at = now(), response_note = nullif(trim(p_note), '')
   where id = p_id and status = 'requested';
  if not found then raise exception 'This request was already answered'; end if;
  return v_status;
end $$;

create or replace function decline_booking(p_id uuid, p_reason text) returns void
language plpgsql as $$
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Tell the client why (e.g. suggest another time)'; end if;
  update bookings set status = 'declined', response_note = trim(p_reason), cancel_reason = trim(p_reason)
   where id = p_id and status in ('requested','pending');
  if not found then raise exception 'This request was already answered'; end if;
end $$;

-- a declined/cancelled booking with money on it needs a refund (shown to the owner)
create or replace view v_refunds_due with (security_invoker = true) as
select b.id as booking_id, b.status, b.scheduled_at, b.response_note, c.name as client_name, c.phone as client_phone,
       sum(p.amount) as paid
from bookings b join payments p on p.booking_id = b.id and p.kind = 'deposit'
left join clients c on c.id = b.client_id
where b.status = 'declined'
group by b.id, c.name, c.phone;

-- DEVELOPMENT ONLY: open like the other tables until staff login is built
drop policy if exists dev_open_access on portal_codes;
drop policy if exists dev_open_access on portal_sessions;
-- (no policy on portal_codes / portal_sessions = nobody can read them directly; functions still can)
