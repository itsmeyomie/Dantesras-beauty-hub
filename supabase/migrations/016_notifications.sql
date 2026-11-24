-- =====================================================================
-- Notifications (free): in-app list + push to the Android app via Firebase.
--
--   things happen (booking confirmed, new request, client assigned, payment …)
--     → triggers add a row to notifications (one per person)
--     → everyone sees them in the app (Notifications)
--     → the push-send Edge Function (every minute, see supabase/live/push-cron.sql)
--       sends unsent rows to the person's phones through Firebase Cloud Messaging
-- =====================================================================

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references clients(id) on delete cascade,
  staff_id   uuid references staff(id) on delete cascade,
  title      text not null,
  body       text not null default '',
  url        text,                                -- page to open, e.g. /portal/bookings
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  pushed_at  timestamptz,                         -- sent to phones (or nothing to send)
  push_error text,
  check ((client_id is null) <> (staff_id is null))
);
create index if not exists notifications_client_idx on notifications (client_id, created_at desc);
create index if not exists notifications_staff_idx on notifications (staff_id, created_at desc);
create index if not exists notifications_unpushed_idx on notifications (created_at) where pushed_at is null;

-- phones that can receive push (Firebase device tokens)
create table if not exists push_devices (
  token      text primary key,
  client_id  uuid references clients(id) on delete cascade,
  staff_id   uuid references staff(id) on delete cascade,
  platform   text not null default 'android',
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
alter table notifications enable row level security;
alter table push_devices enable row level security;
revoke all on notifications, push_devices from anon, authenticated;   -- only through the functions below

alter table bookings add column if not exists reminded_at timestamptz;

-- ---------- adding notifications ----------
create or replace function salon_time(t timestamptz) returns text language sql stable as $$
  select to_char(t at time zone 'Africa/Nairobi', 'Dy DD Mon, HH24:MI')
$$;

create or replace function notify_client(p_client uuid, p_title text, p_body text, p_url text default '/portal/bookings')
returns void language sql security definer set search_path = public as $$
  insert into notifications(client_id, title, body, url) select p_client, p_title, coalesce(p_body, ''), p_url where p_client is not null
$$;
create or replace function notify_staff(p_staff uuid, p_title text, p_body text, p_url text default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications(staff_id, title, body, url)
  select p_staff, p_title, coalesce(p_body, ''), p_url
   where p_staff is not null and p_staff is distinct from my_staff_id()   -- not for what you did yourself
$$;
-- everyone active whose roles open one of these screens (owner always)
create or replace function notify_area(p_areas text[], p_title text, p_body text, p_url text default null)
returns void language sql security definer set search_path = public as $$
  select notify_staff(s.id, p_title, p_body, p_url) from staff s
   where s.active and s.account_status = 'approved'
     and ('owner' = any(s.roles) or staff_areas(s.roles) && p_areas)
$$;
revoke execute on function notify_client(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function notify_staff(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function notify_area(text[], text, text, text) from public, anon, authenticated;

create or replace function booking_who(b bookings) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from clients where id = b.client_id), b.guest_name, 'A client')
$$;

-- ---------- booking events ----------
create or replace function bookings_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.online and new.status = 'requested' then
      perform notify_area(array['desk'], 'New online booking request',
        booking_who(new) || ' · ' || salon_time(new.scheduled_at), '/bookings?tab=requests');
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'requested' and new.status in ('pending', 'booked') then
      perform notify_client(new.client_id, 'Booking confirmed ✔',
        salon_time(new.scheduled_at) || coalesce(' – ' || nullif(new.response_note, ''), '')
        || case when new.status = 'pending' then ' · Pay the deposit to hold your slot.' else '' end);
    elsif new.status = 'declined' then
      perform notify_client(new.client_id, 'Booking not accepted', coalesce(new.response_note, 'Please choose another time.'));
    elsif new.status = 'cancelled' and is_staff() then
      perform notify_client(new.client_id, 'Booking cancelled',
        salon_time(new.scheduled_at) || coalesce(' – ' || nullif(new.cancel_reason, ''), ''));
    elsif new.status = 'cancelled' and old.online then
      -- the client cancelled in the app: tell the front desk
      perform notify_area(array['desk'], 'Client cancelled', booking_who(new) || ' · ' || salon_time(old.scheduled_at), '/bookings');
    end if;
  elsif new.scheduled_at is distinct from old.scheduled_at and new.status in ('pending', 'booked') and is_staff() then
    perform notify_client(new.client_id, 'Booking moved', 'New time: ' || salon_time(new.scheduled_at));
  end if;
  return new;
end $$;
drop trigger if exists bookings_notify on bookings;
create trigger bookings_notify after insert or update on bookings for each row execute function bookings_notify();

-- a stylist / finisher is given a client
create or replace function booking_staff_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  select * into b from bookings where id = new.booking_id;
  if b.status not in ('requested', 'pending', 'booked', 'waiting') then return new; end if;
  perform notify_staff(new.staff_id,
    case when new.part = 'finisher' then 'You finish a client' else 'New client for you' end,
    booking_who(b) || ' · ' || coalesce(salon_time(b.scheduled_at), 'walk-in, now'), '/my-day');
  return new;
end $$;
drop trigger if exists booking_staff_notify on booking_staff;
create trigger booking_staff_notify after insert on booking_staff for each row execute function booking_staff_notify();

-- money received from a client
create or replace function payments_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('deposit', 'debt') and new.client_id is not null then
    perform notify_client(new.client_id, 'Payment received',
      'KSh ' || to_char(new.amount, 'FM999,999,990') || case when new.kind = 'deposit' then ' deposit – your slot is held.' else ' – thank you!' end);
  end if;
  return new;
end $$;
drop trigger if exists payments_notify on payments;
create trigger payments_notify after insert on payments for each row execute function payments_notify();

-- school applications answered
create or replace function applications_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'requested' then
    perform notify_area(array['school'], 'New school application', (select name from courses where id = new.course_id), '/school?tab=applications');
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    perform notify_client(new.client_id,
      case when new.status = 'accepted' then 'You are accepted 🎓' else 'School application' end,
      coalesce(nullif(new.response_note, ''), case when new.status = 'accepted' then 'Welcome to the school!' else 'Not accepted this time.' end),
      '/portal/school');
  end if;
  return new;
end $$;
drop trigger if exists applications_notify on course_applications;
create trigger applications_notify after insert or update on course_applications for each row execute function applications_notify();

-- staff accounts
create or replace function staff_account_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.account_status = 'pending' and old.account_status is distinct from 'pending' then
    perform notify_staff(s.id, 'Staff account to approve', new.name || ' wants to join', '/staff-requests')
       from staff s where 'owner' = any(s.roles) and s.active;
  elsif new.account_status = 'approved' and old.account_status = 'pending' then
    perform notify_staff(new.id, 'Your account is approved', 'You can now sign in to the staff app.', null);
  end if;
  return new;
end $$;
drop trigger if exists staff_account_notify on staff;
create trigger staff_account_notify after update of account_status on staff for each row execute function staff_account_notify();

-- ---------- reminders: the evening before (run by the daily job) ----------
create or replace function queue_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; b bookings;
begin
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

-- ---------- the app: register a phone, read notifications ----------
create or replace function portal_register_device(p_token text, p_device text, p_platform text default 'android') returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := portal_client(p_token);
begin
  if coalesce(p_device, '') = '' then return; end if;
  insert into push_devices(token, client_id, platform) values (p_device, v, coalesce(p_platform, 'android'))
  on conflict (token) do update set client_id = v, staff_id = null, last_seen = now();
end $$;

create or replace function staff_register_device(p_token text, p_device text, p_platform text default 'android') returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := staff_session(p_token);
begin
  if coalesce(p_device, '') = '' then return; end if;
  insert into push_devices(token, staff_id, platform) values (p_device, s.id, coalesce(p_platform, 'android'))
  on conflict (token) do update set staff_id = s.id, client_id = null, last_seen = now();
end $$;

-- signing out: this phone stops receiving
create or replace function unregister_device(p_device text) returns void
language sql security definer set search_path = public as $$
  delete from push_devices where token = p_device
$$;

create or replace function portal_notifications(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := portal_client(p_token);
begin
  return coalesce((select jsonb_agg(to_jsonb(n) - 'client_id' - 'staff_id' - 'push_error' order by n.created_at desc)
    from (select * from notifications where client_id = v order by created_at desc limit 40) n), '[]'::jsonb);
end $$;
create or replace function portal_notifications_read(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := portal_client(p_token);
begin
  update notifications set read_at = now() where client_id = v and read_at is null;
end $$;

create or replace function staff_notifications(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := staff_session(p_token);
begin
  return coalesce((select jsonb_agg(to_jsonb(n) - 'client_id' - 'staff_id' - 'push_error' order by n.created_at desc)
    from (select * from notifications where staff_id = s.id order by created_at desc limit 40) n), '[]'::jsonb);
end $$;
create or replace function staff_notifications_read(p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := staff_session(p_token);
begin
  update notifications set read_at = now() where staff_id = s.id and read_at is null;
end $$;

-- ---------- for the push-send Edge Function only (service role) ----------
-- the job's shared secret lives in the database; the function asks whether a request carries it
create table if not exists push_job_secret (id int primary key default 1 check (id = 1), secret text not null);
alter table push_job_secret enable row level security;
revoke all on push_job_secret from anon, authenticated;
insert into push_job_secret(secret) values (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')) on conflict (id) do nothing;

create or replace function push_check_secret(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_secret, '') <> '' and exists (select 1 from push_job_secret where secret = p_secret)
$$;

-- next unsent notifications with the phones to send them to
create or replace function push_take_batch(p_limit int default 100) returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'url', n.url,
    'devices', coalesce((select jsonb_agg(d.token) from push_devices d
                          where (n.client_id is not null and d.client_id = n.client_id)
                             or (n.staff_id is not null and d.staff_id = n.staff_id)), '[]'::jsonb))), '[]'::jsonb)
  from (select * from notifications where pushed_at is null and created_at > now() - interval '2 days'
         order by created_at limit p_limit) n
$$;

-- results: [{id, error?}], plus device tokens Firebase says are gone
create or replace function push_mark(p_done jsonb, p_dead_devices jsonb default '[]') returns void
language sql security definer set search_path = public as $$
  update notifications n set pushed_at = now(), push_error = d->>'error'
    from jsonb_array_elements(p_done) d where n.id = (d->>'id')::uuid;
  delete from push_devices where token in (select jsonb_array_elements_text(p_dead_devices));
$$;

revoke execute on function push_check_secret(text) from public, anon, authenticated;
revoke execute on function push_take_batch(int) from public, anon, authenticated;
revoke execute on function push_mark(jsonb, jsonb) from public, anon, authenticated;
