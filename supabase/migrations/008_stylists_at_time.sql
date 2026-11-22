-- =====================================================================
-- "Choose your stylist" in the client app: which stylists are free at the chosen time.
-- Run after 007_any_time_booking.sql.
-- =====================================================================
create or replace function portal_stylists_at(p_date date, p_time text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_start timestamptz := (p_date + p_time::time) at time zone 'Africa/Nairobi';
  v_dur int := setting_num('online_duration_min', 120)::int;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'free', slot_free(v_start, v_dur, s.id)) order by s.name)
    from staff s where s.active and 'stylist' = any(s.roles)), '[]'::jsonb);
end $$;
