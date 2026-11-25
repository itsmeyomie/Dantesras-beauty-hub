-- =====================================================================
-- One phone, two people: the same phone can get notifications as a client
-- AND as a staff member (e.g. the owner who also books as a client).
-- Before, registering as one replaced the other, so owner pushes were lost.
-- =====================================================================

create or replace function portal_register_device(p_token text, p_device text, p_platform text default 'android') returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := portal_client(p_token);
begin
  if coalesce(p_device, '') = '' then return; end if;
  insert into push_devices(token, client_id, platform) values (p_device, v, coalesce(p_platform, 'android'))
  on conflict (token) do update set client_id = v, last_seen = now();       -- keeps staff_id
end $$;

create or replace function staff_register_device(p_token text, p_device text, p_platform text default 'android') returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := staff_session(p_token);
begin
  if coalesce(p_device, '') = '' then return; end if;
  insert into push_devices(token, staff_id, platform) values (p_device, s.id, coalesce(p_platform, 'android'))
  on conflict (token) do update set staff_id = s.id, last_seen = now();     -- keeps client_id
end $$;

-- signing out of one side: this phone stops getting that side's notifications only
drop function if exists unregister_device(text);
create or replace function unregister_device(p_device text, p_kind text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'client' then update push_devices set client_id = null where token = p_device;
  elsif p_kind = 'staff' then update push_devices set staff_id = null where token = p_device;
  else delete from push_devices where token = p_device;
  end if;
  delete from push_devices where token = p_device and client_id is null and staff_id is null;
end $$;
