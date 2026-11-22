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
