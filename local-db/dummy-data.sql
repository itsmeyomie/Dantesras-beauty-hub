-- =====================================================================
-- DUMMY DATA FOR TESTING ONLY – fake people, fake phone numbers.
-- Runs after 001–003. Uses the real checkout()/add_deposit()/pay_debt()
-- functions so commission, debts and stock are calculated exactly as live.
-- Can also be run on a Supabase *test* project. Never on the live one.
-- =====================================================================

select setseed(0.42);

-- ---------- commission % per category (owner can change in the app) ----------
update services s set commission_pct = case c.name
    when 'Nails' then 25 when 'Kids Hair' then 30 when 'Adult Hair' then 30
    when 'Treatments & Care' then 20 when 'Locs & Undo' then 30 else 20 end
  from service_categories c where c.id = s.category_id;

-- ---------- staff ----------
update staff set name = 'Owner (Dantesras)', phone = '0700000001' where name = 'Owner';
insert into staff(name, phone, roles, payout_schedule) values
  ('Wanjiku Kamau',  '0711000101', '{stylist}', 'weekly'),
  ('Achieng Otieno', '0711000102', '{stylist}', 'weekly'),
  ('Mercy Njeri',    '0711000103', '{stylist,tutor}', 'monthly'),
  ('Faith Wambui',   '0711000104', '{stylist}', 'biweekly'),
  ('Esther Muthoni', '0711000105', '{stylist}', 'daily'),
  ('Joy Atieno',     '0711000106', '{stylist}', 'weekly');

-- ---------- products ----------
insert into products(name, category, unit, price, cost, stock_qty, low_stock, commission_pct, status) values
  ('Kanekalon braid hair',       'Extension hair', 'pack',   300, 180, 60, 15, 10, 'active'),
  ('X-pression braid hair',      'Extension hair', 'pack',   450, 280, 40, 10, 10, 'active'),
  ('Darling Super Star',         'Extension hair', 'pack',   250, 150, 8,  10, 10, 'active'),
  ('Marley twist hair',          'Extension hair', 'pack',   500, 320, 25, 8,  10, 'active'),
  ('Edge control',               'Hair care',      'jar',    350, 200, 18, 5,  5,  'active'),
  ('Hair food (Dax)',            'Hair care',      'jar',    250, 140, 3,  5,  5,  'active'),
  ('Gel polish (assorted)',      'Nails',          'bottle', 800, 450, 20, 5,  5,  'active'),
  ('Nail tips (box)',            'Nails',          'box',    600, 350, 6,  3,  5,  'active'),
  ('Shea butter leave-in',       'Hair care',      'bottle', 400, 230, 0,  0,  5,  'pending');

-- ---------- clients ----------
insert into clients(name, phone, area, source, gender, birth_date, notes)
select v.name, v.phone, v.area, v.source, 'female', v.dob::date, v.notes
from (values
  ('Grace Wanjiru',   '0722100001', 'Kamakis',        'Instagram', '1994-03-12', 'Prefers knotless, medium size'),
  ('Lucy Akinyi',     '0722100002', 'Membley',        'WhatsApp',  '1990-07-01', null),
  ('Mary Nyambura',   '0722100003', 'Ruiru town',     'Referral',  '1988-11-23', 'Sensitive scalp'),
  ('Ann Chebet',      '0722100004', 'Kahawa Sukari',  'TikTok',    '1999-01-30', null),
  ('Brenda Kerubo',   '0722100005', 'Kamakis',        'Instagram', '2001-05-14', null),
  ('Cynthia Wairimu', '0722100006', 'Juja',           'Facebook',  '1995-09-09', 'Always books Wanjiku'),
  ('Diana Moraa',     '0722100007', 'Githurai 45',    'Walk-by',   '1993-12-02', null),
  ('Eunice Wangari',  '0722100008', 'Mwihoko',        'WhatsApp',  '1985-04-18', null),
  ('Fiona Adhiambo',  '0722100009', 'Kimbo',          'Instagram', '2000-08-27', null),
  ('Gladys Kemunto',  '0722100010', 'Membley',        'Referral',  '1992-02-11', null),
  ('Hellen Jepchirchir','0722100011','Ruiru town',    'TikTok',    '1997-06-05', null),
  ('Irene Wambui',    '0722100012', 'Kamakis',        'Instagram', '1996-10-19', 'Nails every 3 weeks'),
  ('Janet Nduta',     '0722100013', 'Kahawa Sukari',  'Facebook',  '1989-03-03', null),
  ('Karen Awino',     '0722100014', 'Juja',           'WhatsApp',  '1998-12-25', null),
  ('Lilian Waithira', '0722100015', 'Mwihoko',        'Walk-by',   '1991-07-21', null),
  ('Mildred Nekesa',  '0722100016', 'Githurai 45',    'Referral',  '1987-01-08', null),
  ('Nancy Wanjala',   '0722100017', 'Kimbo',          'Instagram', '2002-04-16', null),
  ('Olivia Muthoni',  '0722100018', 'Kamakis',        'TikTok',    '2003-09-30', null),
  ('Pauline Kanini',  '0722100019', 'Membley',        'WhatsApp',  '1986-05-27', 'Locs retie monthly'),
  ('Rose Nafula',     '0722100020', 'Ruiru town',     'Call',      '1984-08-13', null),
  ('Sharon Chepkoech','0722100021', 'Juja',           'Instagram', '1999-11-04', null),
  ('Tabitha Wairimu', '0722100022', 'Kamakis',        'Facebook',  '1990-02-28', null),
  ('Violet Anyango',  '0722100023', 'Kahawa Sukari',  'WhatsApp',  '1995-06-17', null),
  ('Winnie Njoki',    '0722100024', 'Mwihoko',        'Referral',  '1993-10-10', null),
  ('Yvonne Kathambi', '0722100025', 'Kimbo',          'TikTok',    '2000-01-22', null),
  ('Zipporah Wangui', '0722100026', 'Githurai 45',    'Call',      '1982-12-12', null),
  ('Beatrice Mumbi',  '0722100027', 'Membley',        'Instagram', '1996-03-08', null),
  ('Caroline Wacera', '0722100028', 'Kamakis',        'WhatsApp',  '1994-07-29', null)
) as v(name, phone, area, source, dob, notes);

-- kids linked to a parent
insert into clients(name, phone, area, source, gender, birth_date, parent_id)
select v.name, null, v.area, 'Referral', 'female', v.dob::date, (select id from clients where phone = v.parent)
from (values
  ('Tamara (Grace''s daughter)',   '0722100001', 'Kamakis',     '2018-04-02'),
  ('Wambui Jr (Lucy''s daughter)', '0722100002', 'Membley',     '2016-09-15'),
  ('Neema (Mary''s daughter)',     '0722100003', 'Ruiru town',  '2019-01-20'),
  ('Shiru (Eunice''s daughter)',   '0722100008', 'Mwihoko',     '2014-06-11'),
  ('Imani (Janet''s daughter)',    '0722100013', 'Kahawa Sukari','2017-11-30'),
  ('Zawadi (Rose''s daughter)',    '0722100020', 'Ruiru town',  '2020-03-05')
) as v(name, parent, area, dob);

update clients set preferred_staff_id = (select id from staff where name = 'Wanjiku Kamau') where phone in ('0722100006','0722100001');
update clients set preferred_staff_id = (select id from staff where name = 'Mercy Njeri') where phone in ('0722100012','0722100019');

-- ---------- 21 days of sales through the real checkout ----------
create or replace function pg_temp.random_sale(p_day date, p_today boolean) returns void language plpgsql as $$
declare
  v_client clients; v_guest text; v_age int; v_kids boolean;
  v_channel text; v_source text; v_items jsonb := '[]'; v_staff jsonb; v_pay jsonb;
  v_sub numeric := 0; v_disc numeric := 0; v_trans numeric := 0; v_total numeric; v_paid numeric;
  v_n int; v_svc services; v_var service_variants; v_price numeric; v_prod products;
  v_s1 uuid; v_s2 uuid; v_sale uuid; v_ts timestamptz; v_method text; v_booking uuid; v_dep numeric := 0;
  v_hour int;
begin
  -- who
  if random() < 0.85 then
    select * into v_client from clients order by random() limit 1;
    v_age := extract(year from age(v_client.birth_date));
  else
    v_guest := (array['Walk-in Janet','Guest Mercy','Guest Aisha','Walk-in Purity','Guest Lydia'])[1 + floor(random()*5)::int];
    v_age := 30;
  end if;
  v_kids := v_age is not null and v_age <= 12;

  -- channel
  v_channel := case when random() < 0.45 then 'walkin' when random() < 0.85 then 'salon' else 'home' end;
  if v_guest is not null and v_channel = 'home' then v_channel := 'walkin'; end if;
  v_source := case v_channel when 'walkin' then 'In person'
              else (array['WhatsApp','Instagram','Call','TikTok','Facebook','WhatsApp','Instagram'])[1 + floor(random()*7)::int] end;

  -- services
  v_n := case when random() < 0.25 then 2 else 1 end;
  for i in 1..v_n loop
    select s.* into v_svc from services s join service_categories c on c.id = s.category_id
     where s.active and (case when v_kids then c.client_type = 'kids' else c.client_type <> 'kids' end)
     order by random() limit 1;
    v_var := null;
    if random() < 0.35 then select * into v_var from service_variants where service_id = v_svc.id order by random() limit 1; end if;
    v_price := coalesce(v_var.price, case v_svc.price_type
                 when 'range' then v_svc.price + round(random() * (v_svc.max_price - v_svc.price) / 100) * 100
                 when 'from'  then v_svc.price + round(random() * 10) * 100
                 else v_svc.price end);
    v_items := v_items || jsonb_build_object('kind','service','service_id',v_svc.id,'variant_id',v_var.id,
                 'name', case when v_kids then 'Kids ' else '' end || v_svc.name || coalesce(' – ' || v_var.name, ''),
                 'qty',1,'unit_price',v_price);
    v_sub := v_sub + v_price;
  end loop;

  -- extension hair bought here (about 1 in 4)
  if random() < 0.25 then
    select * into v_prod from products where status = 'active' and category = 'Extension hair' and stock_qty > 3 order by random() limit 1;
    if found then
      v_n := 1 + floor(random()*3)::int;
      v_items := v_items || jsonb_build_object('kind','product','product_id',v_prod.id,'name',v_prod.name,'qty',v_n,'unit_price',v_prod.price);
      v_sub := v_sub + v_prod.price * v_n;
    end if;
  end if;

  -- stylists: joint work about 1 in 5
  select id into v_s1 from staff where active order by random() limit 1;
  if random() < 0.2 then
    select id into v_s2 from staff where active and id <> v_s1 order by random() limit 1;
    v_staff := jsonb_build_array(jsonb_build_object('staff_id',v_s1,'share_pct',50), jsonb_build_object('staff_id',v_s2,'share_pct',50));
  else
    v_staff := jsonb_build_array(jsonb_build_object('staff_id',v_s1,'share_pct',100));
  end if;

  if random() < 0.12 then v_disc := round(v_sub * 0.05 / 50) * 50; end if;
  if v_channel = 'home' then v_trans := 200 + round(random()*3)*100; end if;
  v_total := v_sub - v_disc + v_trans;

  -- time of day (busier late morning and afternoon)
  v_hour := (array[8,9,10,10,11,11,12,13,14,14,15,15,16,17,18,19])[1 + floor(random()*16)::int];
  if extract(isodow from p_day) = 7 then v_hour := 12 + floor(random()*7)::int; end if;
  v_ts := (p_day + make_time(v_hour, floor(random()*60)::int, 0)) at time zone 'Africa/Nairobi';
  if p_today and v_ts > now() then v_ts := now() - (random() * interval '3 hours'); end if;

  -- salon/home bookings get a booking + deposit first
  if v_channel in ('salon','home') then
    insert into bookings(client_id, guest_name, channel, source, status, scheduled_at, duration_min, address, transport_fee, created_at)
    values (v_client.id, v_guest, v_channel, v_source, 'pending', v_ts, 120,
            case when v_channel = 'home' then coalesce(v_client.area, 'Ruiru') || ', house no. ' || (1 + floor(random()*90)::int) end,
            v_trans, v_ts - interval '2 days')
    returning id into v_booking;
    insert into booking_services(booking_id, service_id, variant_id, name, price)
      select v_booking, nullif(i->>'service_id','')::uuid, nullif(i->>'variant_id','')::uuid, i->>'name', (i->>'unit_price')::numeric
      from jsonb_array_elements(v_items) i where i->>'kind' = 'service';
    -- full prepayment covers the booked services (+ transport); never more than the final bill
    v_dep := least(case when random() < 0.3 then (select sum((i->>'unit_price')::numeric) from jsonb_array_elements(v_items) i where i->>'kind' = 'service') + v_trans else 500 end, v_total);
    perform add_deposit(v_booking, 'mpesa_till', v_dep, upper(substr(md5(random()::text), 1, 3)), v_ts - interval '2 days');
    update payments set paid_at = v_ts - interval '2 days' where booking_id = v_booking and kind = 'deposit';
  end if;

  -- payment: mostly M-Pesa, some cash; about 6% leave a debt (saved clients only)
  v_paid := v_total - v_dep;
  if v_client.id is not null and random() < 0.06 then v_paid := greatest(0, v_paid - (300 + round(random()*5)*100)); end if;
  v_method := (array['mpesa_till','mpesa_till','mpesa_till','cash','cash','mpesa_send','mpesa_paybill'])[1 + floor(random()*7)::int];
  v_pay := case when v_paid > 0 then jsonb_build_array(jsonb_build_object('method', v_method, 'amount', v_paid,
             'mpesa_ref', case when v_method like 'mpesa%' then upper(substr(md5(random()::text), 1, 3)) end,
             'mpesa_at', case when v_method like 'mpesa%' then v_ts end))
           else '[]'::jsonb end;

  v_sale := checkout(jsonb_build_object(
    'booking_id', v_booking, 'client_id', v_client.id, 'guest_name', v_guest, 'channel', v_channel,
    'entered_by', v_s1, 'discount', v_disc, 'discount_reason', case when v_disc > 0 then 'Regular client' end,
    'transport_fee', v_trans, 'items', v_items, 'staff', v_staff, 'payments', v_pay));

  -- move everything to the sale's real time
  update sales set sold_at = v_ts where id = v_sale;
  update payments set paid_at = v_ts where sale_id = v_sale and kind = 'sale';
  update staff_earnings set created_at = v_ts where sale_id = v_sale;
  if v_booking is not null then update bookings set completed_at = v_ts + interval '2 hours' where id = v_booking; end if;
end $$;

do $$
declare d date; n int; today date := (now() at time zone 'Africa/Nairobi')::date;
begin
  for d in select generate_series(today - 20, today, interval '1 day')::date loop
    n := case extract(isodow from d) when 6 then 14 when 7 then 6 else 8 end + floor(random()*5)::int;
    if d = today then n := 5; end if;
    for i in 1..n loop perform pg_temp.random_sale(d, d = today); end loop;
  end loop;
end $$;

-- a few debt repayments
do $$
declare r record;
begin
  for r in select id, balance, sold_at from sales where balance > 0 order by sold_at limit 3 loop
    perform pay_debt(r.id, 'mpesa_till', least(r.balance, 300), 'K7P', r.sold_at + interval '3 days');
    update payments set paid_at = r.sold_at + interval '3 days' where sale_id = r.id and kind = 'debt';
  end loop;
end $$;

-- ---------- upcoming bookings, no-shows, cancellations, walk-in queue ----------
do $$
declare
  today date := (now() at time zone 'Africa/Nairobi')::date;
  b uuid; c uuid; s uuid; svc services; i int;
begin
  for i in 0..9 loop
    select id into c from clients where phone is not null order by random() limit 1;
    select s.* into svc from services s join service_categories sc on sc.id = s.category_id
      where sc.client_type <> 'kids' order by random() limit 1;
    select id into s from staff where active order by random() limit 1;
    insert into bookings(client_id, channel, source, status, scheduled_at, duration_min, address, transport_fee)
    values (c, case when i = 3 then 'home' else 'salon' end, 'WhatsApp', 'pending',
            ((today + (i / 3)) + make_time(9 + (i % 3) * 3, 0, 0)) at time zone 'Africa/Nairobi', 120,
            case when i = 3 then 'Membley estate, house 12' end, case when i = 3 then 300 else 0 end)
    returning id into b;
    insert into booking_services(booking_id, service_id, name, price) values (b, svc.id, svc.name, svc.price);
    insert into booking_staff(booking_id, staff_id) values (b, s);
    if i % 3 <> 2 then perform add_deposit(b, 'mpesa_till', 500, upper(substr(md5(random()::text),1,3)), now()); end if;
  end loop;

  -- past no-shows (deposit kept) and a cancellation
  for i in 1..3 loop
    select id into c from clients where phone is not null order by random() limit 1;
    insert into bookings(client_id, channel, source, status, scheduled_at, duration_min)
    values (c, 'salon', 'Instagram', 'pending', ((today - i * 4) + time '10:00') at time zone 'Africa/Nairobi', 120)
    returning id into b;
    insert into booking_services(booking_id, name, price) values (b, 'Knotless', 1700);
    perform add_deposit(b, 'mpesa_till', 500, 'N0S', now());
    update bookings set status = case when i = 3 then 'cancelled' else 'no_show' end,
                        cancel_reason = case when i = 3 then 'Client travelled' end where id = b;
  end loop;

  -- walk-ins waiting right now
  for i in 1..3 loop
    select * into svc from services where active order by random() limit 1;
    insert into bookings(guest_name, client_id, channel, source, status, scheduled_at, created_at)
    values (case when i = 2 then 'Walk-in Purity' end,
            case when i <> 2 then (select id from clients where phone is not null order by random() limit 1) end,
            'walkin', 'In person', case when i = 1 then 'in_progress' else 'waiting' end, now(), now() - (i * interval '17 minutes'))
    returning id into b;
    insert into booking_services(booking_id, service_id, name, price) values (b, svc.id, svc.name, svc.price);
  end loop;
end $$;

-- ---------- staff payouts ----------
insert into staff_payouts(staff_id, kind, amount, method, paid_at, note)
select id, 'payout', 2500 + floor(random()*8)*250, 'mpesa_send', now() - interval '7 days', 'Weekly payout'
from staff where name <> 'Owner (Dantesras)';
insert into staff_payouts(staff_id, kind, amount, method, paid_at, note)
select id, 'advance', 1000, 'cash', now() - interval '2 days', 'Advance' from staff where name = 'Joy Atieno';

-- ---------- school: students and fees ----------
insert into students(name, phone, guardian_name, guardian_phone, course_id, start_date, total_fee, status)
select v.name, v.phone, v.guardian, v.gphone, c.id, (now() - (v.weeks || ' weeks')::interval)::date,
       case c.fee_type when 'monthly' then c.fee * c.duration_value else c.fee end, v.status
from (values
  ('Purity Wanjiru',  '0733200001', 'Jane Wanjiru',  '0733300001', 'Hairdressing',    6,  'active'),
  ('Esther Akoth',    '0733200002', 'Paul Otieno',   '0733300002', 'Hairdressing',    10, 'active'),
  ('Lydia Chelangat', '0733200003', 'Ruth Chelangat','0733300003', 'Hairdressing',    2,  'active'),
  ('Aisha Mohamed',   '0733200004', 'Amina Mohamed', '0733300004', 'Nail technology', 4,  'active'),
  ('Becky Wairimu',   '0733200005', 'Peter Kariuki', '0733300005', 'Nail technology', 8,  'active'),
  ('Joan Kwamboka',   '0733200006', 'Mary Kwamboka', '0733300006', 'Make-up',         3,  'active'),
  ('Stacy Nyokabi',   '0733200007', 'Ann Nyokabi',   '0733300007', 'Make-up',         9,  'completed'),
  ('Mercy Kiprono',   '0733200008', 'John Kiprono',  '0733300008', 'Hairdressing',    16, 'completed')
) as v(name, phone, guardian, gphone, course, weeks, status)
join courses c on c.name = v.course;

insert into payments(kind, student_id, method, amount, mpesa_ref, mpesa_at, paid_at)
select 'school_fee', s.id, m.method, m.amount, case when m.method like 'mpesa%' then upper(substr(md5(random()::text),1,3)) end,
       case when m.method like 'mpesa%' then s.start_date + m.after end, s.start_date + m.after
from students s
cross join lateral (values
  ('mpesa_paybill', least(s.total_fee, 8000::numeric), interval '0 days'),
  ('cash',          least(greatest(s.total_fee - 8000, 0), case when s.status = 'completed' then s.total_fee else 6000 end), interval '25 days')
) as m(method, amount, after)
where m.amount > 0 and s.start_date + m.after <= now();
