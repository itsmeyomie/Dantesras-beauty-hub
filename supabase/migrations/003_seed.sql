-- =====================================================================
-- Starting data: settings, service menu (Nov 2026), school courses.
-- Commission % starts at 0 – the owner sets it per service in the app.
-- Safe to run once on an empty database.
-- =====================================================================

insert into settings(key, value) values
  ('deposit_min',      '500'),
  ('late_minutes',     '20'),
  ('max_discount_pct', '10'),
  ('kids_max_age',     '12'),
  ('salon_hours', '{"mon_sat":{"open":"08:00","close":"20:00"},"sun":{"open":"12:00","close":"20:00"}}'),
  ('school_hours','{"mon_fri":{"open":"09:00","close":"17:00"}}')
on conflict (key) do nothing;

-- only one owner record, even if this file is run again
insert into staff(name, roles) select 'Owner', '{owner,stylist}'
where not exists (select 1 from staff where 'owner' = any(roles));

insert into service_categories(name, client_type, sort) values
  ('Nails','any',1), ('Kids Hair','kids',2), ('Adult Hair','adult',3),
  ('Treatments & Care','any',4), ('Locs & Undo','any',5)
on conflict (name) do nothing;

-- helper to add a service with optional variants: variants = [["name", price], ...]
create or replace function pg_temp.add_service(p_cat text, p_name text, p_price numeric,
  p_type text default 'fixed', p_max numeric default null, p_variants jsonb default '[]', p_sort int default 0)
returns void language plpgsql as $$
declare v_id uuid; v jsonb; i int := 0;
begin
  -- safe to run again: a service that is already on the menu is left as it is
  if exists (select 1 from services s join service_categories c on c.id = s.category_id where c.name = p_cat and s.name = p_name) then
    return;
  end if;
  insert into services(category_id, name, price, price_type, max_price, sort)
  values ((select id from service_categories where name = p_cat), p_name, p_price, p_type, p_max, p_sort)
  returning id into v_id;
  for v in select * from jsonb_array_elements(p_variants) loop
    i := i + 1;
    insert into service_variants(service_id, name, price, sort) values (v_id, v->>0, (v->>1)::numeric, i);
  end loop;
end $$;

-- Nails
select pg_temp.add_service('Nails','Gel',500);
select pg_temp.add_service('Nails','Builder gel',1200);
select pg_temp.add_service('Nails','Gum gel',1500,'fixed',null,'[["Extended",1700]]');
select pg_temp.add_service('Nails','Pedi gel',1300);
select pg_temp.add_service('Nails','Plain pedicure',800);
select pg_temp.add_service('Nails','Refill',1000);
select pg_temp.add_service('Nails','Tips gel',1000,'fixed',null,'[["Arted",1400]]');

-- Kids hair (0–12)
select pg_temp.add_service('Kids Hair','2 strands',1200,'fixed',null,'[["With lines",1400]]');
select pg_temp.add_service('Kids Hair','Pussycats',800,'fixed',null,'[["Extended",1200]]');
select pg_temp.add_service('Kids Hair','Updo',700,'fixed',null,'[["Extended",1000]]');
select pg_temp.add_service('Kids Hair','Half – normal braids',1300);
select pg_temp.add_service('Kids Hair','Half – knotless',1500);
select pg_temp.add_service('Kids Hair','Half – plain hair',800);
select pg_temp.add_service('Kids Hair','3 strands (own hair)',800);
select pg_temp.add_service('Kids Hair','Selfies',1200);
select pg_temp.add_service('Kids Hair','Knotless – full head',1500);
select pg_temp.add_service('Kids Hair','Knotless twists',1700);
select pg_temp.add_service('Kids Hair','Goddess',1800);

-- Adult hair
select pg_temp.add_service('Adult Hair','Knotless',1700);
select pg_temp.add_service('Adult Hair','Half',1600,'fixed',null,'[["Extended",1800],["Goddess",2000],["Double extension",2400]]');
select pg_temp.add_service('Adult Hair','Backdo',1200,'fixed',null,'[["Extended",1500]]');
select pg_temp.add_service('Adult Hair','Updo',1500,'fixed',null,'[["Extended",1700]]');
select pg_temp.add_service('Adult Hair','Stitch lines',1800,'fixed',null,'[["Updo",2000],["Half",2000]]');
select pg_temp.add_service('Adult Hair','Gel application',1000);
select pg_temp.add_service('Adult Hair','Knotless twists',1800);
select pg_temp.add_service('Adult Hair','Lines with crochets',1500);
select pg_temp.add_service('Adult Hair','Loose braids',1800);
select pg_temp.add_service('Adult Hair','Boho',1800);
select pg_temp.add_service('Adult Hair','Marley twists (normal size)',1800);
select pg_temp.add_service('Adult Hair','Marley twists (small)',2500,'from');
select pg_temp.add_service('Adult Hair','Mini braids',2500);
select pg_temp.add_service('Adult Hair','Mini twists',3000);

-- Treatments & care
select pg_temp.add_service('Treatments & Care','Deep treatment (own product)',500);
select pg_temp.add_service('Treatments & Care','Leave-in treatment (own product)',200);
select pg_temp.add_service('Treatments & Care','Wig wash',700);
select pg_temp.add_service('Treatments & Care','Chemical application',2500);
select pg_temp.add_service('Treatments & Care','Dye',3000);

-- Locs & undo
select pg_temp.add_service('Locs & Undo','Retie – micro locs',1200);
select pg_temp.add_service('Locs & Undo','Sisterlocks',2000,'range',2500);
select pg_temp.add_service('Locs & Undo','Locs undo',1500);
select pg_temp.add_service('Locs & Undo','Undo – micro',700);
select pg_temp.add_service('Locs & Undo','Undo – mini (hair)',500);

-- School courses
insert into courses(name, fee, fee_type, duration_value, duration_unit) values
  ('Hairdressing',    8000,  'monthly', 3,  'months'),
  ('Nail technology', 20000, 'total',   10, 'weeks'),
  ('Make-up',         18000, 'total',   7,  'weeks')
on conflict (name) do nothing;
