-- =====================================================================
-- A client cannot be checked in (started / checked out) before the day
-- of their booking – unless staff give a reason. The booking then moves
-- to today, and the original day and the reason are kept.
-- =====================================================================

alter table bookings add column if not exists early_reason text;
alter table bookings add column if not exists original_scheduled_at timestamptz;

create or replace function salon_day(t timestamptz) returns date language sql stable as $$
  select (t at time zone 'Africa/Nairobi')::date
$$;

-- guard: starting or completing a booking whose day is still in the future is refused
create or replace function bookings_no_early_start() returns trigger language plpgsql as $$
begin
  if new.status in ('in_progress', 'completed') and old.status not in ('in_progress', 'completed')
     and new.scheduled_at is not null and salon_day(new.scheduled_at) > salon_day(now()) then
    raise exception 'This booking is for % – check the client in early with a reason first',
      to_char(new.scheduled_at at time zone 'Africa/Nairobi', 'Dy DD Mon');
  end if;
  return new;
end $$;
drop trigger if exists bookings_no_early_start on bookings;
create trigger bookings_no_early_start before update on bookings
  for each row execute function bookings_no_early_start();

-- check a client in: on the booking day as normal; earlier only with a reason (booking moves to now)
create or replace function start_booking(p_id uuid, p_reason text default null) returns jsonb
language plpgsql as $$
declare b bookings; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into b from bookings where id = p_id;
  if b.id is null then raise exception 'Booking not found'; end if;
  if b.status not in ('requested', 'pending', 'booked', 'waiting') then raise exception 'This booking cannot be started (%)', b.status; end if;
  if b.scheduled_at is not null and salon_day(b.scheduled_at) > salon_day(now()) then
    if v_reason is null then
      raise exception 'This booking is for % – give a reason to serve the client today',
        to_char(b.scheduled_at at time zone 'Africa/Nairobi', 'Dy DD Mon');
    end if;
    update bookings set original_scheduled_at = coalesce(original_scheduled_at, scheduled_at), scheduled_at = now(),
           early_reason = v_reason, status = 'in_progress', started_at = now()
     where id = p_id returning * into b;
  else
    update bookings set status = 'in_progress', started_at = now() where id = p_id returning * into b;
  end if;
  return jsonb_build_object('id', b.id, 'status', b.status, 'scheduled_at', b.scheduled_at, 'moved', b.early_reason is not null and v_reason is not null);
end $$;
