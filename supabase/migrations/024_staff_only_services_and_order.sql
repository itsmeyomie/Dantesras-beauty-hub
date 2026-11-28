-- =====================================================================
-- 024 – Staff-only service categories (Finishers) and the menu order
--
--   * a category can be "staff only": clients don't see its services in the
--     app (menu, booking) and can't book them online; staff still use them
--   * Finishers becomes staff only
--   * menu order: Washes, Undos, Treatments & Care, Nails, Kids Hair, Adult Hair
--     (Washes is new: the wash services move into it from Treatments & Care)
--
-- Safe for the live salon: sales and bookings keep their service names.
-- =====================================================================

alter table service_categories add column if not exists staff_only boolean not null default false;

-- may the caller see this category? (runs with full rights so the check itself isn't hidden)
create or replace function category_visible(p_category uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select (select is_staff()) or not coalesce((select staff_only from service_categories where id = p_category), false)
$$;

drop policy if exists read_all on service_categories;
create policy read_all on service_categories for select to anon, authenticated
  using (not staff_only or (select is_staff()));
drop policy if exists read_all on services;
create policy read_all on services for select to anon, authenticated
  using (category_visible(category_id));
drop policy if exists read_all on service_variants;
create policy read_all on service_variants for select to anon, authenticated
  using (category_visible((select s.category_id from services s where s.id = service_id)));

-- online (client) bookings can't include a staff-only service, even by going around the app
create or replace function booking_services_staff_only() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.service_id is not null
     and exists (select 1 from bookings b where b.id = new.booking_id and b.online)
     and exists (select 1 from services s join service_categories c on c.id = s.category_id
                  where s.id = new.service_id and c.staff_only) then
    raise exception 'A chosen service is no longer offered';
  end if;
  return new;
end $$;
drop trigger if exists booking_services_staff_only on booking_services;
create trigger booking_services_staff_only before insert or update on booking_services
  for each row execute function booking_services_staff_only();

-- ---------- the salon's menu ----------
update service_categories set staff_only = true where name ilike 'finisher%';

insert into service_categories(name, client_type, sort) values ('Washes', 'any', 1) on conflict (name) do nothing;
update services set category_id = (select id from service_categories where name = 'Washes')
 where category_id = (select id from service_categories where name = 'Treatments & Care')
   and name ilike '%wash%';

update service_categories c set sort = o.sort
  from (values ('Washes', 1), ('Locs & Undo', 2), ('Treatments & Care', 3), ('Nails', 4), ('Kids Hair', 5), ('Adult Hair', 6)) o(name, sort)
 where c.name = o.name;
-- anything else (e.g. Finishers, categories added later) after these, in its old order
update service_categories c set sort = 100 + x.n
  from (select id, row_number() over (order by sort, name) as n from service_categories
         where name not in ('Washes', 'Locs & Undo', 'Treatments & Care', 'Nails', 'Kids Hair', 'Adult Hair')) x
 where c.id = x.id;

-- the client app's menu leaves out staff-only categories
create or replace function portal_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'client_type', c.client_type,
        'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'price', s.price,
            'price_type', s.price_type, 'max_price', s.max_price,
            'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'price', v.price) order by v.sort)
                                  from service_variants v where v.service_id = s.id), '[]'::jsonb)) order by s.sort, s.name)
          from services s where s.category_id = c.id and s.active), '[]'::jsonb)) order by c.sort)
      from service_categories c where not c.staff_only), '[]'::jsonb),
    'stylists', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'photo', photo, 'specialty', specialty) order by name)
      from staff where active and 'stylist' = any(roles)), '[]'::jsonb),
    'courses', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'fee', fee, 'fee_type', fee_type,
        'duration_value', duration_value, 'duration_unit', duration_unit) order by name) from courses where active), '[]'::jsonb),
    'settings', coalesce((select jsonb_object_agg(key, value) from settings where key in
      ('deposit_min','late_minutes','salon_hours','school_hours','kids_max_age','online_booking','online_lead_minutes','online_days_ahead',
       'online_duration_min','salon_phone','salon_location','business_name')), '{}'::jsonb)
  )
$$;
