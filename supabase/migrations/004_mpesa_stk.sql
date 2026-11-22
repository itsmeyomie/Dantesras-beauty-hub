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
