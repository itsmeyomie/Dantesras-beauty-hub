-- =====================================================================
-- Clients may pick ANY time (not only fixed slots). This checks one exact time and,
-- if it is not possible, suggests the nearest free times the same day.
-- Run after 006_school_portal.sql.
-- =====================================================================

-- → {"ok": true}  or  {"ok": false, "reason": "...", "suggestions": ["14:20","15:00",...]}
create or replace function portal_check_time(p_date date, p_time text, p_staff uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  h jsonb := salon_hours_for(p_date);
  v_dur int := setting_num('online_duration_min', 120)::int;
  v_lead int := setting_num('online_lead_minutes', 60)::int;
  v_time time; v_open time; v_last time; v_start timestamptz; v_reason text;
  t time; ts timestamptz; v_sugg jsonb := '[]'::jsonb; n int := 0;
begin
  if h is null then return jsonb_build_object('ok', false, 'reason', 'The salon is closed that day', 'suggestions', '[]'::jsonb); end if;
  begin
    v_time := p_time::time;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'Enter a time, e.g. 14:30', 'suggestions', '[]'::jsonb);
  end;
  v_open := (h->>'open')::time;
  v_last := (h->>'close')::time - interval '60 minutes';     -- last start time
  v_start := (p_date + v_time) at time zone 'Africa/Nairobi';

  if v_time < v_open or v_time > v_last then
    v_reason := format('Choose a time between %s and %s', to_char(v_open, 'HH24:MI'), to_char(v_last, 'HH24:MI'));
  elsif v_start < now() + make_interval(mins => v_lead) then
    v_reason := 'That time has passed or is too soon';
  elsif not slot_free(v_start, v_dur, p_staff) then
    v_reason := case when p_staff is null then 'Fully booked at that time' else 'Your stylist is busy at that time' end;
  else
    return jsonb_build_object('ok', true);
  end if;

  -- nearest free starts (every 15 min), closest to the wanted time first
  for t in
    select g::time from generate_series(p_date + v_open, p_date + v_last, interval '15 minutes') g
    order by abs(extract(epoch from (g::time - v_time)))
  loop
    ts := (p_date + t) at time zone 'Africa/Nairobi';
    continue when ts < now() + make_interval(mins => v_lead);
    if slot_free(ts, v_dur, p_staff) then
      v_sugg := v_sugg || to_jsonb(to_char(t, 'HH24:MI'));
      n := n + 1;
      exit when n >= 4;
    end if;
  end loop;
  return jsonb_build_object('ok', false, 'reason', v_reason,
    'suggestions', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from jsonb_array_elements_text(v_sugg) x));
end $$;

-- Days of a month the client can't book at all (closed, too far ahead, or fully booked)
create or replace function portal_month(p_first date, p_staff uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date; s jsonb; v_out jsonb := '{}'::jsonb;
begin
  for d in select generate_series(p_first, (p_first + interval '1 month - 1 day')::date, interval '1 day')::date loop
    s := portal_slots(d, p_staff);
    v_out := v_out || jsonb_build_object(d::text,
      case when salon_hours_for(d) is null then 'closed'
           when jsonb_array_length(s) = 0 then 'none'
           when not exists (select 1 from jsonb_array_elements(s) x where (x->>'free')::boolean) then 'full'
           else 'open' end);
  end loop;
  return v_out;
end $$;
