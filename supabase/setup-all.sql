-- =====================================================================
-- Dantesras – COMPLETE database setup for a NEW Supabase project.
-- Supabase Dashboard → SQL Editor → New query → paste this whole file → Run.
-- It is migrations 001–016 joined together (generated; edit the migrations, not this file).
-- No dummy data. The first visit to /staff/sign-in offers "Set up the owner account".
-- =====================================================================


-- ##################################################################### 001_schema.sql
-- =====================================================================
-- Dantesras Beauty Hub & Hair and Beauty School – database schema
-- Run in Supabase: Dashboard → SQL Editor → paste → Run (once).
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------- Settings (owner-configurable rules) ----------
create table if not exists settings (
  key   text primary key,
  value jsonb not null
);

-- ---------- Staff ----------
create table if not exists staff (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  roles      text[] not null default '{stylist}',
  basic_salary numeric(12,2) not null default 0,
  payout_schedule text not null default 'weekly'
             check (payout_schedule in ('daily','weekly','biweekly','monthly')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Clients ----------
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text unique,
  whatsapp    text,
  birth_date  date,
  gender      text,
  area        text,
  source      text,
  notes       text,
  parent_id   uuid references clients(id) on delete set null,
  preferred_staff_id uuid references staff(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists clients_name_idx on clients (lower(name));

-- ---------- Service menu ----------
create table if not exists service_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  client_type text not null default 'any' check (client_type in ('kids','adult','any')),
  sort        int not null default 0
);

create table if not exists services (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references service_categories(id) on delete restrict,
  name           text not null,
  price          numeric(12,2) not null check (price >= 0),
  -- fixed: price only · range: price..max_price · from: price or more
  price_type     text not null default 'fixed' check (price_type in ('fixed','range','from')),
  max_price      numeric(12,2),
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 50),
  active         boolean not null default true,
  sort           int not null default 0,
  created_at     timestamptz not null default now()
);

create table if not exists service_variants (
  id         uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  name       text not null,
  price      numeric(12,2) not null check (price >= 0),
  sort       int not null default 0
);

-- Per-staff commission override for a service (staff rate wins)
create table if not exists staff_commission_overrides (
  staff_id   uuid not null references staff(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  pct        numeric(5,2) not null check (pct between 0 and 50),
  primary key (staff_id, service_id)
);

-- ---------- Products ----------
create table if not exists products (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  category       text,
  unit           text not null default 'piece',
  price          numeric(12,2) not null default 0,
  cost           numeric(12,2) not null default 0,
  stock_qty      numeric(12,2) not null default 0,
  low_stock      numeric(12,2) not null default 0,
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 50),
  status         text not null default 'active' check (status in ('active','pending','inactive')),
  created_at     timestamptz not null default now()
);

-- ---------- Bookings (salon / home / walk-in) ----------
create table if not exists bookings (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references clients(id) on delete set null,
  guest_name      text,
  channel         text not null check (channel in ('salon','home','walkin')),
  source          text,
  status          text not null default 'pending'
                  check (status in ('pending','booked','waiting','in_progress','completed','cancelled','no_show')),
  scheduled_at    timestamptz,
  duration_min    int,
  address         text,
  stylists_needed int not null default 1,
  transport_fee   numeric(12,2) not null default 0,
  notes           text,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  check (client_id is not null or guest_name is not null)
);
create index if not exists bookings_sched_idx on bookings (scheduled_at);
create index if not exists bookings_status_idx on bookings (status);

create table if not exists booking_services (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  service_id uuid references services(id) on delete set null,
  variant_id uuid references service_variants(id) on delete set null,
  name       text not null,
  price      numeric(12,2) not null
);

create table if not exists booking_staff (
  booking_id uuid not null references bookings(id) on delete cascade,
  staff_id   uuid not null references staff(id) on delete cascade,
  primary key (booking_id, staff_id)
);

-- ---------- Sales ----------
create table if not exists sales (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid references bookings(id) on delete set null,
  client_id       uuid references clients(id) on delete set null,
  guest_name      text,
  channel         text not null default 'salon' check (channel in ('salon','home','walkin')),
  sold_at         timestamptz not null default now(),
  subtotal        numeric(12,2) not null default 0,
  discount        numeric(12,2) not null default 0,
  discount_reason text,
  transport_fee   numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  paid            numeric(12,2) not null default 0,
  balance         numeric(12,2) not null default 0,
  status          text not null default 'completed' check (status in ('completed','void')),
  void_reason     text,
  entered_by      uuid references staff(id) on delete set null,
  notes           text
);
create index if not exists sales_sold_at_idx on sales (sold_at);

create table if not exists sale_items (
  id             uuid primary key default gen_random_uuid(),
  sale_id        uuid not null references sales(id) on delete cascade,
  kind           text not null check (kind in ('service','product')),
  service_id     uuid references services(id) on delete set null,
  variant_id     uuid references service_variants(id) on delete set null,
  product_id     uuid references products(id) on delete set null,
  name           text not null,
  qty            numeric(12,2) not null default 1,
  unit_price     numeric(12,2) not null,
  unit_cost      numeric(12,2) not null default 0,
  line_total     numeric(12,2) not null,
  commission_pct numeric(5,2) not null default 0
);

create table if not exists sale_staff (
  sale_id   uuid not null references sales(id) on delete cascade,
  staff_id  uuid not null references staff(id) on delete restrict,
  share_pct numeric(5,2) not null check (share_pct > 0 and share_pct <= 100),
  primary key (sale_id, staff_id)
);

-- Commission + transport earned per staff per sale
create table if not exists staff_earnings (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid not null references sales(id) on delete cascade,
  staff_id   uuid not null references staff(id) on delete restrict,
  kind       text not null check (kind in ('commission','transport')),
  amount     numeric(12,2) not null,
  created_at timestamptz not null default now()
);

-- Payouts and advances to staff
create table if not exists staff_payouts (
  id       uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete restrict,
  kind     text not null default 'payout' check (kind in ('payout','advance','bonus')),
  amount   numeric(12,2) not null check (amount > 0),
  method   text not null default 'cash',
  paid_at  timestamptz not null default now(),
  note     text
);

-- ---------- School ----------
create table if not exists courses (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  fee            numeric(12,2) not null,
  fee_type       text not null default 'total' check (fee_type in ('total','monthly')),
  duration_value int not null,
  duration_unit  text not null default 'weeks' check (duration_unit in ('weeks','months')),
  active         boolean not null default true
);

create table if not exists students (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  phone          text,
  guardian_name  text,
  guardian_phone text,
  course_id      uuid not null references courses(id) on delete restrict,
  start_date     date not null default current_date,
  status         text not null default 'active' check (status in ('active','completed','dropped')),
  total_fee      numeric(12,2) not null,
  notes          text,
  created_at     timestamptz not null default now()
);

-- ---------- Payments (sales, deposits, debt repayments, school fees) ----------
create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('sale','deposit','debt','school_fee')),
  sale_id     uuid references sales(id) on delete cascade,
  booking_id  uuid references bookings(id) on delete set null,
  student_id  uuid references students(id) on delete cascade,
  client_id   uuid references clients(id) on delete set null,
  method      text not null check (method in ('cash','mpesa_till','mpesa_paybill','mpesa_send','card')),
  amount      numeric(12,2) not null check (amount > 0),
  mpesa_ref   text,          -- last 3 characters of the M-Pesa code
  mpesa_at    timestamptz,   -- time shown on the M-Pesa message
  paid_at     timestamptz not null default now(),
  note        text,
  check (method not like 'mpesa%' or (mpesa_ref is not null and length(mpesa_ref) = 3))
);
create index if not exists payments_paid_at_idx on payments (paid_at);
create index if not exists payments_sale_idx on payments (sale_id);

-- ##################################################################### 002_functions.sql
-- =====================================================================
-- Business logic: checkout, deposits, debts, voids, reports
-- Run after 001_schema.sql.
-- =====================================================================

-- Helper: read a numeric setting
create or replace function setting_num(p_key text, p_default numeric)
returns numeric language sql stable as $$
  select coalesce((select (value #>> '{}')::numeric from settings where key = p_key), p_default)
$$;

-- ---------------------------------------------------------------------
-- Deposit on a booking. A booking is "booked" (slot held) once deposits
-- reach the minimum deposit or the full booking value.
-- ---------------------------------------------------------------------
create or replace function add_deposit(
  p_booking_id uuid, p_method text, p_amount numeric,
  p_mpesa_ref text default null, p_mpesa_at timestamptz default null)
returns numeric language plpgsql as $$
declare
  v_client uuid; v_total_paid numeric; v_value numeric; v_min numeric;
begin
  select client_id into v_client from bookings where id = p_booking_id;
  if not found then raise exception 'Booking not found'; end if;

  insert into payments(kind, booking_id, client_id, method, amount, mpesa_ref, mpesa_at)
  values ('deposit', p_booking_id, v_client, p_method, p_amount, upper(nullif(p_mpesa_ref,'')), p_mpesa_at);

  select coalesce(sum(amount),0) into v_total_paid from payments
   where booking_id = p_booking_id and kind = 'deposit';
  select coalesce(sum(price),0) + (select transport_fee from bookings where id = p_booking_id)
    into v_value from booking_services where booking_id = p_booking_id;
  v_min := setting_num('deposit_min', 500);

  -- never take more upfront than the booking is worth (checkout would reject it)
  if v_value > 0 and v_total_paid > v_value then
    raise exception 'Payment (%) is more than the booking total (%)', v_total_paid, v_value;
  end if;

  if v_total_paid >= least(v_min, greatest(v_value, 1)) then
    update bookings set status = 'booked' where id = p_booking_id and status = 'pending';
  end if;
  return v_total_paid;
end $$;

-- ---------------------------------------------------------------------
-- Checkout. One transaction: sale, items, staff shares, payments,
-- deposits applied, commission + transport earnings, stock, booking done.
--
-- p = {
--   booking_id?, client_id?, guest_name?, channel, entered_by?,
--   discount, discount_reason?, transport_fee, notes?,
--   items:    [{kind, service_id?, variant_id?, product_id?, name, qty, unit_price}],
--   staff:    [{staff_id, share_pct}],          -- shares must total 100
--   payments: [{method, amount, mpesa_ref?, mpesa_at?}]
-- }
-- ---------------------------------------------------------------------
create or replace function checkout(p jsonb)
returns uuid language plpgsql as $$
declare
  v_sale uuid;
  v_booking uuid := nullif(p->>'booking_id','')::uuid;
  v_client uuid := nullif(p->>'client_id','')::uuid;
  v_sub numeric := 0;
  v_disc numeric := coalesce(nullif(p->>'discount','')::numeric, 0);
  v_trans numeric := coalesce(nullif(p->>'transport_fee','')::numeric, 0);
  v_total numeric; v_paid numeric := 0; v_factor numeric; v_share_sum numeric;
  v_max_disc numeric;
  it jsonb; pay jsonb;
begin
  if jsonb_array_length(coalesce(p->'items','[]')) = 0 then
    raise exception 'Add at least one service or product';
  end if;
  if jsonb_array_length(coalesce(p->'staff','[]')) = 0 then
    raise exception 'Choose the stylist(s) who did the work';
  end if;
  select sum((s->>'share_pct')::numeric) into v_share_sum from jsonb_array_elements(p->'staff') s;
  if abs(v_share_sum - 100) > 0.01 then
    raise exception 'Stylist shares must add up to 100%% (now %)', v_share_sum;
  end if;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_sub := v_sub + (it->>'unit_price')::numeric * coalesce(nullif(it->>'qty','')::numeric, 1);
  end loop;
  if v_disc < 0 or v_disc > v_sub then raise exception 'Invalid discount'; end if;
  v_max_disc := setting_num('max_discount_pct', 10);
  if v_sub > 0 and v_disc / v_sub * 100 > v_max_disc + 0.001
     and coalesce((p->>'owner_approved')::boolean, false) = false then
    raise exception 'Discount above % percent needs the owner', v_max_disc;
  end if;
  v_total := v_sub - v_disc + v_trans;

  insert into sales(booking_id, client_id, guest_name, channel, subtotal, discount, discount_reason,
                    transport_fee, total, entered_by, notes)
  values (v_booking, v_client, nullif(p->>'guest_name',''), coalesce(p->>'channel','salon'),
          v_sub, v_disc, nullif(p->>'discount_reason',''), v_trans, v_total,
          nullif(p->>'entered_by','')::uuid, nullif(p->>'notes',''))
  returning id into v_sale;

  -- items (commission % and product cost captured at time of sale)
  insert into sale_items(sale_id, kind, service_id, variant_id, product_id, name, qty, unit_price,
                         unit_cost, line_total, commission_pct)
  select v_sale, i->>'kind',
         nullif(i->>'service_id','')::uuid, nullif(i->>'variant_id','')::uuid,
         nullif(i->>'product_id','')::uuid, i->>'name',
         coalesce(nullif(i->>'qty','')::numeric,1), (i->>'unit_price')::numeric,
         coalesce(pr.cost, 0),
         (i->>'unit_price')::numeric * coalesce(nullif(i->>'qty','')::numeric,1),
         coalesce(sv.commission_pct, pr.commission_pct, 0)
  from jsonb_array_elements(p->'items') i
  left join services sv on sv.id = nullif(i->>'service_id','')::uuid
  left join products pr on pr.id = nullif(i->>'product_id','')::uuid;

  insert into sale_staff(sale_id, staff_id, share_pct)
  select v_sale, (s->>'staff_id')::uuid, (s->>'share_pct')::numeric
  from jsonb_array_elements(p->'staff') s;

  -- deposits already paid on the booking count towards this sale
  if v_booking is not null then
    update payments set sale_id = v_sale
     where booking_id = v_booking and kind = 'deposit' and sale_id is null;
  end if;

  for pay in select * from jsonb_array_elements(coalesce(p->'payments','[]')) loop
    if coalesce(nullif(pay->>'amount','')::numeric,0) > 0 then
      insert into payments(kind, sale_id, booking_id, client_id, method, amount, mpesa_ref, mpesa_at)
      values ('sale', v_sale, v_booking, v_client, pay->>'method', (pay->>'amount')::numeric,
              upper(nullif(pay->>'mpesa_ref','')), nullif(pay->>'mpesa_at','')::timestamptz);
    end if;
  end loop;

  select coalesce(sum(amount),0) into v_paid from payments where sale_id = v_sale;
  if v_paid > v_total + 0.001 then
    raise exception 'Payments (%) are more than the total (%)', v_paid, v_total;
  end if;
  if v_paid < v_total and v_client is null then
    raise exception 'Guests must pay in full (no debt for guests)';
  end if;
  update sales set paid = v_paid, balance = v_total - v_paid where id = v_sale;

  -- commission on price after discount; staff override wins; split by share
  v_factor := case when v_sub > 0 then (v_sub - v_disc) / v_sub else 0 end;
  insert into staff_earnings(sale_id, staff_id, kind, amount)
  select v_sale, ss.staff_id, 'commission',
         round(sum(si.line_total * v_factor * coalesce(o.pct, si.commission_pct) / 100 * ss.share_pct / 100), 2)
  from sale_items si
  cross join sale_staff ss
  left join staff_commission_overrides o on o.staff_id = ss.staff_id and o.service_id = si.service_id
  where si.sale_id = v_sale and ss.sale_id = v_sale
  group by ss.staff_id
  having round(sum(si.line_total * v_factor * coalesce(o.pct, si.commission_pct) / 100 * ss.share_pct / 100), 2) > 0;

  -- transport fee goes to the stylists who travelled, by share
  if v_trans > 0 then
    insert into staff_earnings(sale_id, staff_id, kind, amount)
    select v_sale, ss.staff_id, 'transport', round(v_trans * ss.share_pct / 100, 2)
    from sale_staff ss where ss.sale_id = v_sale;
  end if;

  -- stock
  update products pr set stock_qty = pr.stock_qty - si.qty
    from sale_items si where si.sale_id = v_sale and si.product_id = pr.id;

  if v_booking is not null then
    update bookings set status = 'completed', completed_at = now() where id = v_booking;
  end if;
  return v_sale;
end $$;

-- ---------------------------------------------------------------------
-- Debt repayment
-- ---------------------------------------------------------------------
create or replace function pay_debt(
  p_sale_id uuid, p_method text, p_amount numeric,
  p_mpesa_ref text default null, p_mpesa_at timestamptz default null)
returns numeric language plpgsql as $$
declare v_bal numeric; v_client uuid;
begin
  select balance, client_id into v_bal, v_client from sales where id = p_sale_id and status = 'completed' for update;
  if not found then raise exception 'Sale not found'; end if;
  if p_amount <= 0 or p_amount > v_bal + 0.001 then
    raise exception 'Amount must be between 1 and the balance (%)', v_bal;
  end if;
  insert into payments(kind, sale_id, client_id, method, amount, mpesa_ref, mpesa_at)
  values ('debt', p_sale_id, v_client, p_method, p_amount, upper(nullif(p_mpesa_ref,'')), p_mpesa_at);
  update sales set paid = paid + p_amount, balance = balance - p_amount where id = p_sale_id;
  return v_bal - p_amount;
end $$;

-- ---------------------------------------------------------------------
-- Void a sale (owner only once login exists). Never deletes.
-- ---------------------------------------------------------------------
create or replace function void_sale(p_sale_id uuid, p_reason text)
returns void language plpgsql as $$
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  update sales set status = 'void', void_reason = p_reason, balance = 0
   where id = p_sale_id and status = 'completed';
  if not found then raise exception 'Sale not found or already void'; end if;
  delete from staff_earnings where sale_id = p_sale_id;
  update products pr set stock_qty = pr.stock_qty + si.qty
    from sale_items si where si.sale_id = p_sale_id and si.product_id = pr.id;
end $$;

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------
create or replace view v_debts with (security_invoker = true) as
select s.id as sale_id, s.sold_at, s.total, s.paid, s.balance,
       c.id as client_id, c.name as client_name, c.phone as client_phone,
       (current_date - (s.sold_at at time zone 'Africa/Nairobi')::date) as days_owed
from sales s join clients c on c.id = s.client_id
where s.status = 'completed' and s.balance > 0;

create or replace view v_student_balances with (security_invoker = true) as
select st.*, co.name as course_name,
       coalesce((select sum(amount) from payments p where p.student_id = st.id and p.kind = 'school_fee'),0) as paid,
       st.total_fee - coalesce((select sum(amount) from payments p where p.student_id = st.id and p.kind = 'school_fee'),0) as balance
from students st join courses co on co.id = st.course_id;

create or replace view v_staff_balances with (security_invoker = true) as
select sf.id as staff_id, sf.name, sf.active, sf.payout_schedule, sf.basic_salary,
       coalesce((select sum(amount) from staff_earnings e where e.staff_id = sf.id and e.kind = 'commission'),0) as commission_total,
       coalesce((select sum(amount) from staff_earnings e where e.staff_id = sf.id and e.kind = 'transport'),0) as transport_total,
       coalesce((select sum(amount) from staff_payouts p where p.staff_id = sf.id and p.kind in ('payout','advance')),0) as paid_out,
       coalesce((select sum(amount) from staff_earnings e where e.staff_id = sf.id),0)
         - coalesce((select sum(amount) from staff_payouts p where p.staff_id = sf.id and p.kind in ('payout','advance')),0) as unpaid
from staff sf;

-- ---------------------------------------------------------------------
-- Report for a date range (dates in Nairobi time, inclusive)
-- ---------------------------------------------------------------------
create or replace function sales_report(p_from date, p_to date)
returns jsonb language sql stable as $$
with rng as (
  select (p_from::timestamp at time zone 'Africa/Nairobi') as t0,
         ((p_to + 1)::timestamp at time zone 'Africa/Nairobi') as t1
),
s as (select * from sales, rng where sold_at >= rng.t0 and sold_at < rng.t1 and status = 'completed'),
pay as (select p.* from payments p, rng where p.paid_at >= rng.t0 and p.paid_at < rng.t1),
items as (select si.* from sale_items si join s on s.id = si.sale_id),
earn as (select e.* from staff_earnings e join s on s.id = e.sale_id)
select jsonb_build_object(
  'from', p_from, 'to', p_to,
  'sales_total',   coalesce((select sum(total - transport_fee) from s),0),
  'sales_count',   (select count(*) from s),
  'clients_served',(select count(*) from s),
  'avg_ticket',    coalesce((select round(avg(total - transport_fee),0) from s),0),
  'services_total',coalesce((select sum(line_total) from items where kind='service'),0),
  'products_total',coalesce((select sum(line_total) from items where kind='product'),0),
  'discounts',     coalesce((select sum(discount) from s),0),
  'transport_fees',coalesce((select sum(transport_fee) from s),0),
  'debt_created',  coalesce((select sum(balance) from s),0),
  'commission',    coalesce((select sum(amount) from earn where kind='commission'),0),
  'product_cost',  coalesce((select sum(unit_cost * qty) from items where kind='product'),0),
  'voids',         (select count(*) from sales, rng where sold_at >= rng.t0 and sold_at < rng.t1 and status='void'),
  'collected', jsonb_build_object(
      'salon',  coalesce((select sum(amount) from pay where kind in ('sale','deposit','debt')),0),
      'school', coalesce((select sum(amount) from pay where kind = 'school_fee'),0)),
  'by_method', coalesce((select jsonb_object_agg(method, amt) from
      (select method, sum(amount) amt from pay where kind <> 'school_fee' group by method) x), '{}'::jsonb),
  'school_by_method', coalesce((select jsonb_object_agg(method, amt) from
      (select method, sum(amount) amt from pay where kind = 'school_fee' group by method) x), '{}'::jsonb),
  'by_channel', coalesce((select jsonb_agg(jsonb_build_object('channel', channel, 'count', n, 'total', amt)) from
      (select channel, count(*) n, sum(total - transport_fee) amt from s group by channel) x), '[]'::jsonb),
  'top_services', coalesce((select jsonb_agg(x order by x.total desc) from
      (select name, count(*) as count, sum(line_total) as total from items where kind='service'
        group by name order by sum(line_total) desc limit 10) x), '[]'::jsonb),
  'top_products', coalesce((select jsonb_agg(x order by x.total desc) from
      (select name, sum(qty) as count, sum(line_total) as total from items where kind='product'
        group by name order by sum(line_total) desc limit 10) x), '[]'::jsonb),
  'by_category', coalesce((select jsonb_agg(x order by x.total desc) from
      (select coalesce(c.name,'Products') as name, sum(i.line_total) as total from items i
        left join services sv on sv.id = i.service_id
        left join service_categories c on c.id = sv.category_id
        group by coalesce(c.name,'Products')) x), '[]'::jsonb),
  'by_staff', coalesce((select jsonb_agg(x order by x.sales desc) from
      (select sf.id, sf.name,
              count(distinct ss.sale_id) as clients,
              round(sum((s.total - s.transport_fee) * ss.share_pct / 100),2) as sales,
              coalesce((select sum(amount) from earn e where e.staff_id = sf.id and e.kind='commission'),0) as commission
         from sale_staff ss join s on s.id = ss.sale_id join staff sf on sf.id = ss.staff_id
        group by sf.id, sf.name) x), '[]'::jsonb),
  'by_source', coalesce((select jsonb_agg(x) from
      (select coalesce(b.source,'Unknown') as source, count(*) as count, sum(s.total - s.transport_fee) as total
         from s left join bookings b on b.id = s.booking_id group by coalesce(b.source,'Unknown')) x), '[]'::jsonb),
  'by_hour', coalesce((select jsonb_agg(x order by x.hour) from
      (select extract(hour from sold_at at time zone 'Africa/Nairobi')::int as hour, count(*) as count,
              sum(total - transport_fee) as total from s group by 1) x), '[]'::jsonb),
  'by_weekday', coalesce((select jsonb_agg(x order by x.dow) from
      (select extract(isodow from sold_at at time zone 'Africa/Nairobi')::int as dow, count(*) as count,
              sum(total - transport_fee) as total from s group by 1) x), '[]'::jsonb),
  'daily', coalesce((select jsonb_agg(x order by x.day) from
      (select (sold_at at time zone 'Africa/Nairobi')::date as day, count(*) as count,
              sum(total - transport_fee) as total from s group by 1) x), '[]'::jsonb),
  'no_shows', (select count(*) from bookings, rng where scheduled_at >= rng.t0 and scheduled_at < rng.t1 and status='no_show'),
  'forfeited_deposits', coalesce((select sum(p.amount) from payments p join bookings b on b.id = p.booking_id, rng
      where p.kind='deposit' and b.status='no_show' and b.scheduled_at >= rng.t0 and b.scheduled_at < rng.t1),0),
  'debts_outstanding', coalesce((select sum(balance) from v_debts),0),
  'school_balances',   coalesce((select sum(balance) from v_student_balances where status='active'),0)
);
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- !! DEVELOPMENT ONLY: login is not built yet, so the public (anon) key
-- !! can read and write everything. Replace these policies when login
-- !! is implemented, before real client data goes in.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['settings','staff','clients','service_categories','services','service_variants',
    'staff_commission_overrides','products','bookings','booking_services','booking_staff','sales',
    'sale_items','sale_staff','staff_earnings','staff_payouts','courses','students','payments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists dev_open_access on %I', t);
    execute format('create policy dev_open_access on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ##################################################################### 003_seed.sql
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

-- ##################################################################### 004_mpesa_stk.sql
-- =====================================================================
-- M-Pesa STK push ("Lipa na M-Pesa Online" prompt on the client's phone)
--
-- Flow:  app → Edge Function mpesa-stk → stk_create() → Daraja STK push
--        Safaricom → Edge Function mpesa-callback → stk_complete() → payment recorded
--        app polls stk_status() until success / failed / cancelled / timeout
--
-- Until Daraja keys are added the Edge Function (and the internal test database) run in
-- SIMULATION mode: no money moves, the prompt is shown on screen instead of the phone.
-- Run after 003_seed.sql.
-- =====================================================================

alter table payments add column if not exists mpesa_receipt text;  -- full M-Pesa code from Safaricom (STK only)
alter table payments add column if not exists stk_request_id uuid;

create table if not exists mpesa_stk_requests (
  id                  uuid primary key default gen_random_uuid(),
  purpose             text not null check (purpose in ('deposit','debt','school_fee')),
  booking_id          uuid references bookings(id) on delete set null,
  sale_id             uuid references sales(id) on delete set null,
  student_id          uuid references students(id) on delete set null,
  phone               text not null,            -- 2547XXXXXXXX / 2541XXXXXXXX
  amount              numeric(12,2) not null check (amount >= 1),
  account_ref         text not null,
  description         text not null,
  status              text not null default 'pending'
                      check (status in ('pending','success','failed','cancelled','timeout')),
  merchant_request_id text,
  checkout_request_id text unique,
  result_code         int,
  result_desc         text,
  mpesa_receipt       text,
  payment_id          uuid references payments(id) on delete set null,
  needs_attention     text,                     -- money received but could not be applied automatically
  simulated           boolean not null default false,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz
);
create index if not exists stk_created_idx on mpesa_stk_requests (created_at);

insert into settings(key, value) values
  ('mpesa_stk_method', '"mpesa_paybill"'),   -- which method STK payments are recorded as: mpesa_paybill or mpesa_till
  ('mpesa_stk_timeout_sec', '120'),
  ('business_name', '"DANTESRAS BEAUTY HUB"')
on conflict (key) do nothing;

-- 07XXXXXXXX / 01XXXXXXXX / +2547… / 2547… → 2547XXXXXXXX (null if not a Kenyan mobile number)
create or replace function mpesa_phone(p text)
returns text language sql immutable as $$
  select case
    when d ~ '^254[17][0-9]{8}$' then d
    when d ~ '^0[17][0-9]{8}$'   then '254' || substr(d, 2)
    when d ~ '^[17][0-9]{8}$'    then '254' || d
    else null end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;

-- What is still owed on a booking (services + transport − deposits already paid)
create or replace function booking_unpaid(p_booking_id uuid)
returns numeric language sql stable as $$
  select coalesce((select sum(price) from booking_services where booking_id = p_booking_id), 0)
       + coalesce((select transport_fee from bookings where id = p_booking_id), 0)
       - coalesce((select sum(amount) from payments where booking_id = p_booking_id and kind = 'deposit'), 0)
$$;

-- ---------------------------------------------------------------------
-- 1. Create a request (called by the Edge Function before it calls Daraja)
-- ---------------------------------------------------------------------
create or replace function stk_create(
  p_purpose text, p_phone text, p_amount numeric,
  p_booking_id uuid default null, p_sale_id uuid default null, p_student_id uuid default null,
  p_simulated boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := mpesa_phone(p_phone);
  v_amount numeric := round(coalesce(p_amount, 0));
  v_max numeric; v_ref text; v_desc text; v_status text; v_row mpesa_stk_requests;
begin
  if v_phone is null then raise exception 'Enter a valid Safaricom number, e.g. 0712 345 678'; end if;
  if v_amount < 1 then raise exception 'Enter the amount to pay'; end if;
  if v_amount > 250000 then raise exception 'M-Pesa allows at most KSh 250,000 per payment'; end if;

  if p_purpose = 'deposit' then
    select status into v_status from bookings where id = p_booking_id;
    if not found then raise exception 'Booking not found'; end if;
    if v_status not in ('requested','pending','booked','waiting','in_progress') then
      raise exception 'This booking is %, it can no longer take payments', replace(v_status, '_', ' ');
    end if;
    v_max := booking_unpaid(p_booking_id);
    v_ref := 'BOOKING'; v_desc := 'Booking deposit';
  elsif p_purpose = 'debt' then
    select balance into v_max from sales where id = p_sale_id and status <> 'void';
    if not found then raise exception 'Sale not found'; end if;
    v_ref := 'BALANCE'; v_desc := 'Salon balance';
  elsif p_purpose = 'school_fee' then
    select balance into v_max from v_student_balances where id = p_student_id;
    if not found then raise exception 'Student not found'; end if;
    v_ref := 'SCHOOLFEE'; v_desc := 'School fees';
  else
    raise exception 'Unknown payment purpose %', p_purpose;
  end if;
  if v_max is not null and v_max > 0 and v_amount > ceil(v_max) then
    raise exception 'Amount (KSh %) is more than what is owed (KSh %)', v_amount, ceil(v_max);
  end if;
  if v_max is not null and v_max <= 0 then raise exception 'Nothing is owed'; end if;

  -- one open prompt per thing at a time (an older unanswered one is closed)
  update mpesa_stk_requests set status = 'timeout', result_desc = 'Replaced by a new request', completed_at = now()
   where status = 'pending'
     and coalesce(booking_id::text, sale_id::text, student_id::text) = coalesce(p_booking_id::text, p_sale_id::text, p_student_id::text);

  insert into mpesa_stk_requests(purpose, booking_id, sale_id, student_id, phone, amount, account_ref, description, simulated)
  values (p_purpose, p_booking_id, p_sale_id, p_student_id, v_phone, v_amount, v_ref, v_desc, p_simulated)
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

-- 2. Store Daraja's ids after the push was accepted
create or replace function stk_accepted(p_id uuid, p_merchant_request_id text, p_checkout_request_id text)
returns void language sql security definer set search_path = public as $$
  update mpesa_stk_requests set merchant_request_id = p_merchant_request_id, checkout_request_id = p_checkout_request_id
   where id = p_id;
$$;

-- 2b. Daraja refused the push (wrong number, system busy…)
create or replace function stk_rejected(p_id uuid, p_desc text)
returns void language sql security definer set search_path = public as $$
  update mpesa_stk_requests set status = 'failed', result_desc = p_desc, completed_at = now()
   where id = p_id and status = 'pending';
$$;

-- ---------------------------------------------------------------------
-- 3. Safaricom's answer (callback). Safe to call twice: only a pending request changes.
--    Result codes: 0 paid · 1032 cancelled by user · 1037 no answer / phone off · 1 insufficient funds · others failed
-- ---------------------------------------------------------------------
create or replace function stk_complete(
  p_checkout_request_id text, p_result_code int, p_result_desc text,
  p_receipt text default null, p_amount numeric default null, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r mpesa_stk_requests; v_method text; v_pay uuid; v_amount numeric;
begin
  select * into r from mpesa_stk_requests where checkout_request_id = p_checkout_request_id for update;
  if not found then raise exception 'Unknown CheckoutRequestID %', p_checkout_request_id; end if;
  if r.status <> 'pending' then return to_jsonb(r); end if;

  if p_result_code <> 0 then
    update mpesa_stk_requests set
      status = case p_result_code when 1032 then 'cancelled' when 1037 then 'timeout' else 'failed' end,
      result_code = p_result_code, result_desc = p_result_desc, completed_at = now()
     where id = r.id returning * into r;
    return to_jsonb(r);
  end if;

  v_method := coalesce((select value #>> '{}' from settings where key = 'mpesa_stk_method'), 'mpesa_paybill');
  v_amount := coalesce(p_amount, r.amount);
  update mpesa_stk_requests set status = 'success', result_code = 0, result_desc = p_result_desc,
         mpesa_receipt = upper(p_receipt), amount = v_amount, completed_at = now()
   where id = r.id;

  -- apply the money; if that fails (e.g. booking was cancelled meanwhile) keep the money on record for the owner
  begin
    if r.purpose = 'deposit' then
      perform add_deposit(r.booking_id, v_method, v_amount, right(upper(p_receipt), 3), now());
      select id into v_pay from payments where booking_id = r.booking_id and kind = 'deposit' order by paid_at desc limit 1;
    elsif r.purpose = 'debt' then
      perform pay_debt(r.sale_id, v_method, v_amount, right(upper(p_receipt), 3), now());
      select id into v_pay from payments where sale_id = r.sale_id and kind = 'debt' order by paid_at desc limit 1;
    else
      insert into payments(kind, student_id, method, amount, mpesa_ref, mpesa_at)
      values ('school_fee', r.student_id, v_method, v_amount, right(upper(p_receipt), 3), now())
      returning id into v_pay;
    end if;
    update payments set mpesa_receipt = upper(p_receipt), stk_request_id = r.id, note = coalesce(note, 'M-Pesa prompt')
     where id = v_pay;
    update mpesa_stk_requests set payment_id = v_pay where id = r.id;
  exception when others then
    update mpesa_stk_requests set needs_attention = sqlerrm where id = r.id;
  end;

  select * into r from mpesa_stk_requests where id = r.id;
  return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------
-- 4. Status for the waiting screen. Unanswered prompts expire.
-- ---------------------------------------------------------------------
create or replace function stk_status(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r mpesa_stk_requests;
begin
  update mpesa_stk_requests set status = 'timeout', result_desc = 'No answer from the phone', completed_at = now()
   where id = p_id and status = 'pending'
     and created_at < now() - make_interval(secs => setting_num('mpesa_stk_timeout_sec', 120));
  select * into r from mpesa_stk_requests where id = p_id;
  if not found then raise exception 'Payment request not found'; end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'amount', r.amount, 'phone', r.phone,
    'receipt', r.mpesa_receipt, 'result_desc', r.result_desc, 'needs_attention', r.needs_attention,
    'simulated', r.simulated, 'checkout_request_id', r.checkout_request_id);
end $$;

alter table mpesa_stk_requests enable row level security;
drop policy if exists dev_open_access on mpesa_stk_requests;
-- DEVELOPMENT ONLY (same as the other tables until login is built)
create policy dev_open_access on mpesa_stk_requests for all to anon, authenticated using (true) with check (true);

-- ##################################################################### 005_client_portal.sql
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

-- ##################################################################### 006_school_portal.sql
-- =====================================================================
-- School in the client app: apply for a course, the school accepts (→ student + fee balance)
-- or declines; enrolled students see their fee balance and pay by M-Pesa prompt.
-- Run after 005_client_portal.sql.
-- =====================================================================

alter table students add column if not exists client_id uuid references clients(id) on delete set null;
alter table students add column if not exists email text;

create table if not exists course_applications (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references clients(id) on delete set null,
  course_id       uuid not null references courses(id) on delete restrict,
  name            text not null,
  phone           text,
  email           text,
  guardian_name   text,
  guardian_phone  text,
  preferred_start date,
  notes           text,
  status          text not null default 'requested' check (status in ('requested','accepted','declined','withdrawn')),
  response_note   text,
  student_id      uuid references students(id) on delete set null,
  created_at      timestamptz not null default now(),
  answered_at     timestamptz
);
create index if not exists course_app_status_idx on course_applications (status, created_at);

-- Full fee for a course (monthly fee × months, or the total)
create or replace function course_total(p_course uuid) returns numeric language sql stable as $$
  select case when fee_type = 'monthly'
              then fee * case when duration_unit = 'months' then duration_value else ceil(duration_value / 4.33) end
              else fee end
  from courses where id = p_course
$$;

-- ---------- client app ----------
-- p = { course_id, name, phone, email?, guardian_name?, guardian_phone?, preferred_start?, notes? }
create or replace function portal_apply_course(p_token text, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid := portal_client(p_token); v_course courses; v_id uuid; v_start date := nullif(p->>'preferred_start', '')::date;
begin
  select * into v_course from courses where id = nullif(p->>'course_id', '')::uuid and active;
  if v_course.id is null then raise exception 'Choose a course'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Enter the student''s full name'; end if;
  if mpesa_phone(p->>'phone') is null then raise exception 'Enter a valid phone number for the student'; end if;
  if nullif(p->>'guardian_phone', '') is not null and mpesa_phone(p->>'guardian_phone') is null then
    raise exception 'Enter a valid phone number for the guardian / next of kin';
  end if;
  if v_start is not null and v_start < (now() at time zone 'Africa/Nairobi')::date then raise exception 'Choose a start date from today on'; end if;
  if exists (select 1 from course_applications where client_id = v and course_id = v_course.id and status = 'requested') then
    raise exception 'You already applied for %. The school will contact you.', v_course.name;
  end if;
  insert into course_applications(client_id, course_id, name, phone, email, guardian_name, guardian_phone, preferred_start, notes)
  values (v, v_course.id, trim(p->>'name'), '0' || substr(mpesa_phone(p->>'phone'), 4), lower(nullif(trim(p->>'email'), '')),
          nullif(trim(p->>'guardian_name'), ''),
          case when nullif(p->>'guardian_phone', '') is not null then '0' || substr(mpesa_phone(p->>'guardian_phone'), 4) end,
          v_start, nullif(trim(p->>'notes'), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function portal_school(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := portal_client(p_token);
begin
  return jsonb_build_object(
    'applications', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'course', c.name, 'name', a.name, 'status', a.status,
        'preferred_start', a.preferred_start, 'response_note', a.response_note, 'created_at', a.created_at,
        'total', course_total(c.id)) order by a.created_at desc)
      from course_applications a join courses c on c.id = a.course_id where a.client_id = v), '[]'::jsonb),
    'enrolments', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'course', s.course_name, 'start_date', s.start_date,
        'status', s.status, 'total_fee', s.total_fee, 'paid', s.paid, 'balance', s.balance, 'phone', s.phone) order by s.start_date desc)
      from v_student_balances s where s.client_id = v), '[]'::jsonb));
end $$;

create or replace function portal_withdraw_application(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := portal_client(p_token);
begin
  update course_applications set status = 'withdrawn', answered_at = now() where id = p_id and client_id = v and status = 'requested';
  if not found then raise exception 'This application was already answered'; end if;
end $$;

-- ---------- school side ----------
create or replace function accept_application(p_id uuid, p_start date default null, p_total_fee numeric default null, p_note text default null)
returns uuid language plpgsql as $$
declare a course_applications; v_student uuid;
begin
  select * into a from course_applications where id = p_id for update;
  if a.id is null then raise exception 'Application not found'; end if;
  if a.status <> 'requested' then raise exception 'This application was already answered'; end if;
  insert into students(name, phone, email, guardian_name, guardian_phone, course_id, start_date, total_fee, client_id, notes)
  values (a.name, a.phone, a.email, a.guardian_name, a.guardian_phone, a.course_id,
          coalesce(p_start, a.preferred_start, current_date), coalesce(p_total_fee, course_total(a.course_id)), a.client_id,
          'Applied in the app' || coalesce(': ' || a.notes, ''))
  returning id into v_student;
  update course_applications set status = 'accepted', student_id = v_student, answered_at = now(), response_note = nullif(trim(p_note), '')
   where id = p_id;
  return v_student;
end $$;

create or replace function decline_application(p_id uuid, p_reason text) returns void
language plpgsql as $$
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the applicant a reason'; end if;
  update course_applications set status = 'declined', response_note = trim(p_reason), answered_at = now()
   where id = p_id and status = 'requested';
  if not found then raise exception 'This application was already answered'; end if;
end $$;

-- the student-balance view gains client_id (st.* already includes it once the column exists)
drop view if exists v_student_balances;
create view v_student_balances with (security_invoker = true) as
select st.*, co.name as course_name,
       coalesce((select sum(amount) from payments p where p.student_id = st.id and p.kind = 'school_fee'),0) as paid,
       st.total_fee - coalesce((select sum(amount) from payments p where p.student_id = st.id and p.kind = 'school_fee'),0) as balance
from students st join courses co on co.id = st.course_id;

alter table course_applications enable row level security;
drop policy if exists dev_open_access on course_applications;
-- DEVELOPMENT ONLY (same as the other tables until staff login is built)
create policy dev_open_access on course_applications for all to anon, authenticated using (true) with check (true);

-- ##################################################################### 007_any_time_booking.sql
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

-- ##################################################################### 008_stylists_at_time.sql
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

-- ##################################################################### 009_staff_accounts.sql
-- =====================================================================
-- Staff accounts: everyone signs up with email + password (and a photo), the OWNER approves
-- and gives the role (stylist / receptionist / manager). Sessions work like the client app.
-- Passwords are hashed with bcrypt (pgcrypto). Run after 008_stylists_at_time.sql.
-- Roles in staff.roles: owner, manager, receptionist, stylist, tutor
-- =====================================================================

alter table staff add column if not exists email text;
alter table staff add column if not exists password_hash text;
alter table staff add column if not exists photo text;            -- small JPEG as data URL (later: Supabase Storage URL)
alter table staff add column if not exists specialty text;        -- shown to clients, e.g. "Nails · gel"
alter table staff add column if not exists account_status text not null default 'none'
  check (account_status in ('none','pending','approved','declined'));
alter table staff add column if not exists wanted_role text;
alter table staff add column if not exists requested_at timestamptz;
alter table staff add column if not exists decline_reason text;
alter table staff add column if not exists last_login timestamptz;
create unique index if not exists staff_email_uidx on staff (lower(email)) where email is not null;

create table if not exists staff_sessions (
  token_hash text primary key,
  staff_id   uuid not null references staff(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table staff_sessions enable row level security;   -- no policy: only reachable through the functions below

-- public profile of a staff member (never the password hash)
create or replace function staff_json(s staff) returns jsonb language sql stable as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'email', s.email, 'phone', s.phone, 'roles', s.roles,
    'photo', s.photo, 'specialty', s.specialty, 'account_status', s.account_status, 'wanted_role', s.wanted_role,
    'active', s.active, 'requested_at', s.requested_at, 'decline_reason', s.decline_reason)
$$;

create or replace function staff_check_password(p text) returns void language plpgsql immutable as $$
begin
  if length(coalesce(p, '')) < 6 then raise exception 'Use a password of at least 6 characters'; end if;
end $$;

-- token → approved, active staff member
create or replace function staff_session(p_token text) returns staff
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  select st.* into s from staff_sessions ss join staff st on st.id = ss.staff_id
   where ss.token_hash = portal_hash(coalesce(p_token, '')) and ss.expires_at > now();
  if s.id is null then raise exception 'STAFF_SESSION: Please sign in again'; end if;
  if s.account_status <> 'approved' or not s.active then raise exception 'STAFF_SESSION: Your account is not active'; end if;
  update staff_sessions set expires_at = greatest(expires_at, now() + interval '30 days') where token_hash = portal_hash(p_token);
  return s;
end $$;

create or replace function staff_new_session(p_staff uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  insert into staff_sessions(token_hash, staff_id, expires_at) values (portal_hash(v_token), p_staff, now() + interval '30 days');
  update staff set last_login = now() where id = p_staff;
  return v_token;
end $$;

-- ---------- sign up (anyone) ----------
-- p = { name, email, phone, password, role: stylist|receptionist|manager, specialty?, photo? }
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
  if v_role not in ('stylist','receptionist','manager') then raise exception 'Choose stylist, receptionist or manager'; end if;
  if length(coalesce(p->>'photo', '')) > 450000 then raise exception 'The photo is too large'; end if;
  if exists (select 1 from staff where lower(email) = v_email) then
    raise exception 'An account with this email already exists. Sign in instead.';
  end if;

  -- someone the owner already added (same phone, no account yet) → that record gets the account
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

-- ---------- sign in ----------
create or replace function staff_login(p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  select * into s from staff where lower(email) = lower(trim(coalesce(p_email, '')));
  if s.id is null or s.password_hash is null or s.password_hash <> crypt(coalesce(p_password, ''), s.password_hash) then
    raise exception 'Wrong email or password';
  end if;
  if s.account_status = 'pending' then
    return jsonb_build_object('status', 'pending', 'staff', staff_json(s));
  end if;
  if s.account_status = 'declined' then
    raise exception 'Your request was declined%', coalesce(': ' || s.decline_reason, '. Talk to the owner.');
  end if;
  if not s.active then raise exception 'Your account is switched off. Talk to the owner.'; end if;
  return jsonb_build_object('status', 'approved', 'token', staff_new_session(s.id), 'staff', staff_json(s));
end $$;

-- ---------- first owner ----------
create or replace function staff_setup_needed() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from staff where 'owner' = any(roles) and account_status = 'approved' and email is not null)
$$;

-- only while no owner account exists: the owner record gets email + password
create or replace function staff_owner_setup(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v_email text := lower(trim(coalesce(p->>'email', '')));
begin
  if not staff_setup_needed() then raise exception 'The owner account is already set up'; end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'Enter a valid email address'; end if;
  perform staff_check_password(p->>'password');
  select * into s from staff where 'owner' = any(roles) order by created_at limit 1;
  if s.id is null then
    insert into staff(name, roles) values (coalesce(nullif(trim(p->>'name'), ''), 'Owner'), '{owner,stylist}') returning * into s;
  end if;
  update staff set email = v_email, password_hash = crypt(p->>'password', gen_salt('bf')),
         name = coalesce(nullif(trim(p->>'name'), ''), name), account_status = 'approved', active = true
   where id = s.id returning * into s;
  return jsonb_build_object('status', 'approved', 'token', staff_new_session(s.id), 'staff', staff_json(s));
end $$;

-- ---------- my profile ----------
create or replace function staff_me(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  return staff_json(staff_session(p_token));
end $$;

-- p = { name?, phone?, specialty?, photo?, password? }
create or replace function staff_update_me(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := staff_session(p_token);
begin
  if p ? 'name' and coalesce(trim(p->>'name'), '') = '' then raise exception 'Enter your name'; end if;
  if nullif(p->>'phone', '') is not null and mpesa_phone(p->>'phone') is null then raise exception 'Enter a valid phone number'; end if;
  if length(coalesce(p->>'photo', '')) > 450000 then raise exception 'The photo is too large'; end if;
  if nullif(p->>'password', '') is not null then perform staff_check_password(p->>'password'); end if;
  update staff set
    name = coalesce(nullif(trim(p->>'name'), ''), name),
    phone = coalesce(case when nullif(p->>'phone', '') is not null then '0' || substr(mpesa_phone(p->>'phone'), 4) end, phone),
    specialty = case when p ? 'specialty' then nullif(trim(p->>'specialty'), '') else specialty end,
    photo = case when p ? 'photo' then nullif(p->>'photo', '') else photo end,
    password_hash = case when nullif(p->>'password', '') is not null then crypt(p->>'password', gen_salt('bf')) else password_hash end
  where id = s.id returning * into s;
  return staff_json(s);
end $$;

create or replace function staff_logout(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from staff_sessions where token_hash = portal_hash(coalesce(p_token, ''));
$$;

-- ---------- owner: approve / decline ----------
create or replace function staff_requests(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me staff := staff_session(p_token);
begin
  if not ('owner' = any(me.roles)) then raise exception 'Only the owner can see staff requests'; end if;
  return coalesce((select jsonb_agg(staff_json(s) order by s.requested_at desc) from staff s where s.account_status in ('pending','declined')), '[]'::jsonb);
end $$;

-- p_role: stylist | receptionist | manager
create or replace function staff_approve(p_token text, p_id uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me staff := staff_session(p_token); s staff;
begin
  if not ('owner' = any(me.roles)) then raise exception 'Only the owner can approve staff'; end if;
  if p_role not in ('stylist','receptionist','manager') then raise exception 'Choose stylist, receptionist or manager'; end if;
  update staff set account_status = 'approved', active = true, decline_reason = null,
         roles = array(select distinct r from unnest(roles || array[p_role]) r where r = 'tutor' or r = p_role)
   where id = p_id and account_status in ('pending','declined') returning * into s;
  if s.id is null then raise exception 'This request was already answered'; end if;
  return staff_json(s);
end $$;

create or replace function staff_decline(p_token text, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me staff := staff_session(p_token);
begin
  if not ('owner' = any(me.roles)) then raise exception 'Only the owner can decline staff'; end if;
  update staff set account_status = 'declined', decline_reason = nullif(trim(p_reason), '')
   where id = p_id and account_status = 'pending';
  if not found then raise exception 'This request was already answered'; end if;
  delete from staff_sessions where staff_id = p_id;
end $$;

-- ---------- client app: show photos and specialities ----------
create or replace function portal_stylists_at(p_date date, p_time text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_start timestamptz := (p_date + p_time::time) at time zone 'Africa/Nairobi';
  v_dur int := setting_num('online_duration_min', 120)::int;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'photo', s.photo, 'specialty', s.specialty,
      'free', slot_free(v_start, v_dur, s.id)) order by s.name)
    from staff s where s.active and 'stylist' = any(s.roles)), '[]'::jsonb);
end $$;

create or replace function portal_stylists() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'photo', photo, 'specialty', specialty) order by name), '[]'::jsonb)
  from staff where active and 'stylist' = any(roles)
$$;

-- client app menu: stylists now carry photo + speciality
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
    'stylists', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'photo', photo, 'specialty', specialty) order by name)
      from staff where active and 'stylist' = any(roles)), '[]'::jsonb),
    'courses', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'fee', fee, 'fee_type', fee_type,
        'duration_value', duration_value, 'duration_unit', duration_unit) order by name) from courses where active), '[]'::jsonb),
    'settings', coalesce((select jsonb_object_agg(key, value) from settings where key in
      ('deposit_min','late_minutes','salon_hours','school_hours','kids_max_age','online_booking','online_lead_minutes','online_days_ahead',
       'online_duration_min','salon_phone','salon_location','business_name')), '{}'::jsonb)
  )
$$;

-- ##################################################################### 010_protect_staff_accounts.sql
-- =====================================================================
-- Protect staff account fields from the public (anon) key while the rest of the database is
-- still in development mode (dev_open_access). Run after 009_staff_accounts.sql.
--  - nobody can read password hashes through the API
--  - email, password, account status and approval fields can only change through the
--    staff_* functions (sign up, approve, profile), never by writing the table directly
-- The app reads staff with an explicit column list (no "*").
-- =====================================================================
revoke select, insert, update on staff from anon, authenticated;

grant select (id, name, phone, roles, basic_salary, payout_schedule, active, created_at,
              email, photo, specialty, account_status, wanted_role, requested_at, decline_reason, last_login)
  on staff to anon, authenticated;

-- the owner's Team page can still add people and set pay / schedule / on-off
grant insert (name, phone, roles, basic_salary, payout_schedule, active) on staff to anon, authenticated;
grant update (name, phone, basic_salary, payout_schedule, active) on staff to anon, authenticated;

-- sessions and one-time codes: functions only
revoke all on staff_sessions, portal_sessions, portal_codes from anon, authenticated;

-- roles change only through the owner (Team page)
create or replace function staff_set_roles(p_token text, p_id uuid, p_roles text[]) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare me staff := staff_session(p_token);
begin
  if not ('owner' = any(me.roles)) then raise exception 'Only the owner can change roles'; end if;
  if exists (select 1 from unnest(p_roles) r where r not in ('owner','manager','receptionist','stylist','tutor')) then
    raise exception 'Unknown role';
  end if;
  if p_id = me.id and not ('owner' = any(p_roles)) then raise exception 'You cannot remove your own owner role'; end if;
  update staff set roles = p_roles where id = p_id;
end $$;

-- ##################################################################### 011_test_mode.sql
-- =====================================================================
-- TEST MODE without Edge Functions.
-- While the setting test_mode = true, the app gets sign-in codes and simulated M-Pesa prompts
-- straight from the database (no SMS, no money moves) – so the system can be tested before the
-- Edge Functions, SMS/WhatsApp/email and Daraja accounts are set up.
-- Switch it off (Settings → Test mode, or: update settings set value = 'false' where key = 'test_mode')
-- before real clients use the app; then these functions refuse to work.
-- Run after 010_protect_staff_accounts.sql.
-- =====================================================================
insert into settings(key, value) values ('test_mode', 'true') on conflict (key) do nothing;

create or replace function test_mode_on() returns boolean language sql stable as $$
  select coalesce((select (value #>> '{}')::boolean from settings where key = 'test_mode'), false)
$$;

-- client sign-in code, shown on screen (same answer as the portal-otp function in simulation)
create or replace function portal_test_code(p_channel text, p_address text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  if not test_mode_on() then raise exception 'Sign-in codes are sent by SMS / WhatsApp / email now. Update the app.'; end if;
  r := portal_issue_code(p_channel, p_address);
  return jsonb_build_object('sent', true, 'channel', p_channel, 'to', r->>'address', 'simulated', true, 'dev_code', r->>'code');
end $$;

-- start a simulated M-Pesa prompt (same answer as the mpesa-stk function without Daraja keys)
create or replace function stk_test_start(p_purpose text, p_phone text, p_amount numeric,
  p_booking_id uuid default null, p_sale_id uuid default null, p_student_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb; v_checkout text := 'ws_CO_SIM_' || replace(gen_random_uuid()::text, '-', '');
begin
  if not test_mode_on() then raise exception 'M-Pesa prompts go through Safaricom now. Update the app.'; end if;
  r := stk_create(p_purpose, p_phone, p_amount, p_booking_id, p_sale_id, p_student_id, true);
  perform stk_accepted((r->>'id')::uuid, 'SIM', v_checkout);
  return jsonb_build_object('id', r->>'id', 'checkout_request_id', v_checkout, 'phone', r->>'phone', 'amount', (r->>'amount')::numeric,
    'simulated', true, 'customer_message', 'Test mode – no money moves');
end $$;

-- answer the simulated prompt as if on the phone: pay | cancel | insufficient | timeout | wrong_pin
create or replace function stk_test_answer(p_checkout_request_id text, p_outcome text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_code int; v_desc text; v_receipt text; r jsonb;
begin
  if not test_mode_on() then raise exception 'Test mode is off'; end if;
  if not exists (select 1 from mpesa_stk_requests where checkout_request_id = p_checkout_request_id and simulated) then
    raise exception 'Not a test payment';
  end if;
  select c, d into v_code, v_desc from (values
    ('pay', 0, 'The service request is processed successfully.'), ('cancel', 1032, 'Request cancelled by user'),
    ('insufficient', 1, 'The balance is insufficient for the transaction'), ('timeout', 1037, 'DS timeout user cannot be reached'),
    ('wrong_pin', 2001, 'The initiator information is invalid')) o(k, c, d)
  where k = coalesce(p_outcome, 'pay');
  if v_code is null then v_code := 0; v_desc := 'The service request is processed successfully.'; end if;
  if v_code = 0 then v_receipt := 'T' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 9)); end if;
  r := stk_complete(p_checkout_request_id, v_code, v_desc, v_receipt, null, null);
  return jsonb_build_object('ResultCode', v_code, 'ResultDesc', v_desc, 'status', r->>'status');
end $$;

-- ##################################################################### 012_custom_roles.sql
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

-- ##################################################################### 013_early_checkin.sql
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

-- ##################################################################### 014_lock_down.sql
-- =====================================================================
-- LOCK-DOWN: replaces the open test access with role-based access.
--
-- How staff are recognised: the app sends the staff sign-in token in the
-- header "x-staff-token" with every request. The database checks it
-- (staff_sessions) and the screens of the person's roles (staff_roles).
--
--   anyone (clients, the public)  → only the price list, courses, settings,
--                                   roles; everything else through the
--                                   portal_* functions (their own data only)
--   signed-in staff               → day-to-day salon data
--   by screen (role)              → money, reports, team, school, settings
--   money changes (checkout, deposits, debts, voids, confirm …) only through
--   checked functions, never by writing the tables directly.
-- =====================================================================

-- ---------- who is calling ----------
create or replace function request_staff_token() returns text language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json->>'x-staff-token', '')
$$;

-- the signed-in, approved, active staff member (null if none) – never raises
create or replace function current_staff() returns staff
language sql stable security definer set search_path = public, extensions as $$
  select st.* from staff_sessions ss join staff st on st.id = ss.staff_id
   where request_staff_token() is not null
     and ss.token_hash = portal_hash(request_staff_token()) and ss.expires_at > now()
     and st.account_status = 'approved' and st.active
   limit 1
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select (current_staff()).id is not null
$$;

create or replace function my_staff_id() returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select (current_staff()).id
$$;

-- may the caller open one of these screens? (owner: everything)
create or replace function staff_can(p_areas text[]) returns boolean
language plpgsql stable security definer set search_path = public, extensions as $$
declare s staff := current_staff();
begin
  if s.id is null then return false; end if;
  if 'owner' = any(s.roles) then return true; end if;
  return staff_areas(s.roles) && p_areas;
end $$;

-- calls from the app come in as "anon"/"authenticated"; the server itself (service role,
-- SQL editor, database jobs) is trusted
create or replace function api_caller() returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('role', true), ''), 'none') in ('anon', 'authenticated')
$$;

create or replace function require_staff(p_areas text[]) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not api_caller() then return; end if;
  if not is_staff() then raise exception 'STAFF_SESSION: Please sign in again'; end if;
  if not staff_can(p_areas) then raise exception 'Your role cannot do this'; end if;
end $$;

-- ---------- remove the open test access ----------
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists dev_open_access on %I', t);
  end loop;
end $$;

-- helper to (re)create one policy
create or replace function pg_temp.pol(p_table text, p_name text, p_cmd text, p_using text, p_check text default null)
returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on %I', p_name, p_table);
  execute format('create policy %I on %I for %s to anon, authenticated %s %s', p_name, p_table, p_cmd,
    case when p_cmd = 'insert' then '' else 'using (' || p_using || ')' end,
    case when p_cmd in ('insert', 'update', 'all') then 'with check (' || coalesce(p_check, p_using) || ')' else '' end);
end $$;

-- public: price list, categories, courses, settings, roles (read only)
select pg_temp.pol('service_categories', 'read_all', 'select', 'true');
select pg_temp.pol('services', 'read_all', 'select', 'true');
select pg_temp.pol('service_variants', 'read_all', 'select', 'true');
select pg_temp.pol('courses', 'read_all', 'select', 'true');
select pg_temp.pol('settings', 'read_all', 'select', 'true');

-- price list and courses: changed by the screens that own them
select pg_temp.pol('service_categories', 'write_services', 'all', '(select staff_can(array[''services'']))');
select pg_temp.pol('services', 'write_services', 'all', '(select staff_can(array[''services'']))');
select pg_temp.pol('service_variants', 'write_services', 'all', '(select staff_can(array[''services'']))');
select pg_temp.pol('staff_commission_overrides', 'read_staff', 'select', '(select is_staff())');
select pg_temp.pol('staff_commission_overrides', 'write_team', 'all', '(select staff_can(array[''team'',''services'']))');
select pg_temp.pol('courses', 'write_school', 'all', '(select staff_can(array[''school'']))');
select pg_temp.pol('settings', 'write_owner', 'all', '(select staff_can(array[''settings'']))');

-- staff list: only staff see it (clients see stylists through portal functions)
select pg_temp.pol('staff', 'read_staff', 'select', '(select is_staff())');
select pg_temp.pol('staff', 'write_team', 'insert', null, '(select staff_can(array[''team'']))');
select pg_temp.pol('staff', 'update_team', 'update', '(select staff_can(array[''team'']))');

-- clients: every staff member (bookings show client names); deleting only with the Clients screen
select pg_temp.pol('clients', 'read_staff', 'select', '(select is_staff())');
select pg_temp.pol('clients', 'add_staff', 'insert', null, '(select is_staff())');
select pg_temp.pol('clients', 'update_staff', 'update', '(select is_staff())');
select pg_temp.pol('clients', 'delete_clients', 'delete', '(select staff_can(array[''clients'']))');

-- bookings: every staff member (team board, my day, assigning)
select pg_temp.pol('bookings', 'staff_all', 'all', '(select is_staff())');
select pg_temp.pol('booking_services', 'staff_all', 'all', '(select is_staff())');
select pg_temp.pol('booking_staff', 'staff_all', 'all', '(select is_staff())');

-- products: staff read; stock and prices by the Products screen; others may suggest (pending)
select pg_temp.pol('products', 'read_staff', 'select', '(select is_staff())');
select pg_temp.pol('products', 'add_staff', 'insert', null,
  '(select is_staff()) and (status = ''pending'' or (select staff_can(array[''products''])))');
select pg_temp.pol('products', 'update_products', 'update', '(select staff_can(array[''products'']))');

-- money: read by the screens that show it; written only by the checked functions below
-- (a stylist sees only the sales they worked on – for My earnings)
select pg_temp.pol('sale_staff', 'read_money', 'select',
  'staff_id = (select my_staff_id()) or (select staff_can(array[''sales'',''reports'',''dashboard'',''desk'',''debts'',''clients'']))');
select pg_temp.pol('sales', 'read_money', 'select',
  '(select staff_can(array[''sales'',''reports'',''dashboard'',''desk'',''debts'',''clients'']))
   or exists (select 1 from sale_staff ss where ss.sale_id = sales.id and ss.staff_id = (select my_staff_id()))');
select pg_temp.pol('sale_items', 'read_money', 'select',
  '(select staff_can(array[''sales'',''reports'',''dashboard'',''desk'',''debts'',''clients'']))
   or exists (select 1 from sale_staff ss where ss.sale_id = sale_items.sale_id and ss.staff_id = (select my_staff_id()))');
select pg_temp.pol('payments', 'read_staff', 'select', '(select is_staff())');
select pg_temp.pol('payments', 'add_school_fee', 'insert', null,
  '(select staff_can(array[''school''])) and kind = ''school_fee''');
select pg_temp.pol('mpesa_stk_requests', 'read_staff', 'select', '(select is_staff())');

-- earnings and payouts: your own, or the Team / Reports screens
select pg_temp.pol('staff_earnings', 'read_own_or_team', 'select',
  'staff_id = (select my_staff_id()) or (select staff_can(array[''team'',''reports'']))');
select pg_temp.pol('staff_payouts', 'read_own_or_team', 'select',
  'staff_id = (select my_staff_id()) or (select staff_can(array[''team'',''reports'']))');
select pg_temp.pol('staff_payouts', 'add_team', 'insert', null, '(select staff_can(array[''team'']))');

-- school
select pg_temp.pol('students', 'school', 'all', '(select staff_can(array[''school'']))');
select pg_temp.pol('course_applications', 'school', 'all', '(select staff_can(array[''school'']))');

-- staff_sessions, portal_sessions, portal_codes: no policy = nobody reads them directly

-- ---------- money and booking actions: checked functions ----------
-- The original function is kept as "<name>_core" (not callable from the app);
-- the public name checks the caller's screens first, then runs it.
do $$
declare f record;
begin
  for f in select * from (values
    ('add_deposit', 'uuid, text, numeric, text, timestamptz'),
    ('checkout', 'jsonb'),
    ('pay_debt', 'uuid, text, numeric, text, timestamptz'),
    ('void_sale', 'uuid, text'),
    ('sales_report', 'date, date'),
    ('confirm_booking', 'uuid, text'),
    ('decline_booking', 'uuid, text'),
    ('accept_application', 'uuid, date, numeric, text'),
    ('decline_application', 'uuid, text'),
    ('start_booking', 'uuid, text')
  ) as v(name, args) loop
    if to_regprocedure(f.name || '_core(' || f.args || ')') is null then
      execute format('alter function %s(%s) rename to %s', f.name, f.args, f.name || '_core');
    end if;
    execute format('alter function %s(%s) security definer set search_path = public, extensions', f.name || '_core', f.args);
    execute format('revoke execute on function %s(%s) from public, anon, authenticated', f.name || '_core', f.args);
  end loop;
end $$;

create or replace function add_deposit(p_booking_id uuid, p_method text, p_amount numeric,
  p_mpesa_ref text default null, p_mpesa_at timestamptz default null) returns numeric
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_staff(array['bookings','desk','checkout','my-day']);
  return add_deposit_core(p_booking_id, p_method, p_amount, p_mpesa_ref, p_mpesa_at);
end $$;

create or replace function checkout(p jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_staff(array['checkout']);
  return checkout_core(p || jsonb_build_object('entered_by', my_staff_id()));
end $$;

create or replace function pay_debt(p_sale_id uuid, p_method text, p_amount numeric,
  p_mpesa_ref text default null, p_mpesa_at timestamptz default null) returns numeric
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_staff(array['debts','checkout','clients','desk']);
  return pay_debt_core(p_sale_id, p_method, p_amount, p_mpesa_ref, p_mpesa_at);
end $$;

create or replace function void_sale(p_sale_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_staff(array['sales']);
  perform void_sale_core(p_sale_id, p_reason);
end $$;

create or replace function sales_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform require_staff(array['reports','dashboard','desk','sales']);
  return sales_report_core(p_from, p_to);
end $$;

create or replace function confirm_booking(p_id uuid, p_note text default null) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_staff(array['bookings','desk']);
  return confirm_booking_core(p_id, p_note);
end $$;

create or replace function decline_booking(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_staff(array['bookings','desk']);
  perform decline_booking_core(p_id, p_reason);
end $$;

create or replace function accept_application(p_id uuid, p_start date default null, p_total_fee numeric default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_staff(array['school']);
  return accept_application_core(p_id, p_start, p_total_fee, p_note);
end $$;

create or replace function decline_application(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_staff(array['school']);
  perform decline_application_core(p_id, p_reason);
end $$;

create or replace function start_booking(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_staff(array['bookings','desk','my-day','checkout']);
  return start_booking_core(p_id, p_reason);
end $$;

-- M-Pesa internals: only the server (edge functions / service role), never the app directly
revoke execute on function stk_create(text, text, numeric, uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function stk_complete(text, int, text, text, numeric, text) from public, anon, authenticated;
revoke execute on function stk_accepted(uuid, text, text) from public, anon, authenticated;
revoke execute on function stk_rejected(uuid, text) from public, anon, authenticated;

-- the role-check helpers are fine to call; the session table itself stays closed
revoke all on staff_sessions, portal_sessions, portal_codes from anon, authenticated;

-- ##################################################################### 015_client_auth.sql
-- =====================================================================
-- Free client sign-in: email code or Google (Supabase Auth), no SMS.
--
-- 1. The app signs the client in with Supabase Auth (email code / Google).
-- 2. It calls portal_from_auth() with that sign-in; the database reads the
--    VERIFIED email from the sign-in (request.jwt.claims, checked by Supabase),
--    finds the client with that email (or creates one) and starts the usual
--    client session. Staff can link an existing client by adding their email.
--
-- Test sign-in codes (shown on screen) now have their own switch "test_codes",
-- separate from the simulated M-Pesa ("test_mode").
-- =====================================================================

insert into settings(key, value)
select 'test_codes', coalesce((select value from settings where key = 'test_mode'), 'true'::jsonb)
on conflict (key) do nothing;

create or replace function test_codes_on() returns boolean language sql stable as $$
  select coalesce((select (value #>> '{}')::boolean from settings where key = 'test_codes'), false)
$$;

-- sign-in code shown on screen – only while test_codes is on
create or replace function portal_test_code(p_channel text, p_address text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb;
begin
  if not test_codes_on() then raise exception 'Test sign-in is off. Update the app.'; end if;
  r := portal_issue_code(p_channel, p_address);
  return jsonb_build_object('sent', true, 'channel', p_channel, 'to', r->>'address', 'simulated', true, 'dev_code', r->>'code');
end $$;

-- client session for a verified email (shared by real and test sign-in)
create or replace function portal_session_for_email(p_email text, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_email text := lower(trim(coalesce(p_email, ''))); v_client clients; v_token text; v_new boolean := false;
begin
  if v_email !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'Sign-in has no email address'; end if;
  select * into v_client from clients where lower(email) = v_email order by created_at limit 1;
  if v_client.id is null then
    insert into clients(name, email, source)
    values (coalesce(nullif(trim(p_name), ''), 'New client'), v_email, 'Online')
    returning * into v_client;
    v_new := true;
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into portal_sessions(token_hash, client_id, expires_at) values (portal_hash(v_token), v_client.id, now() + interval '90 days');
  return jsonb_build_object('token', v_token, 'client_id', v_client.id,
    'is_new', v_new or v_client.name = 'New client' or v_client.phone is null);
end $$;
revoke execute on function portal_session_for_email(text, text) from public, anon, authenticated;

-- real sign-in: the email comes from the Supabase Auth sign-in, never from the caller
create or replace function portal_from_auth() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  c jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_name text;
begin
  if c is null or c->>'role' <> 'authenticated' or coalesce(c->>'email', '') = '' then
    raise exception 'Sign in with your email code or Google first';
  end if;
  v_name := coalesce(c->'user_metadata'->>'full_name', c->'user_metadata'->>'name');
  return portal_session_for_email(c->>'email', v_name);
end $$;

-- test "Sign in with Google" (no Google account needed) – only while test_codes is on
create or replace function portal_test_google(p_email text, p_name text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not test_codes_on() then raise exception 'Test sign-in is off. Update the app.'; end if;
  return portal_session_for_email(p_email, p_name);
end $$;

-- the email code tables are only used by test codes now
-- (the portal-otp Edge Function with SMS / WhatsApp is no longer needed)

-- ##################################################################### 016_notifications.sql
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
