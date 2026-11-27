-- =====================================================================
-- 023 – Client phone numbers, WhatsApp and email: OWNER ONLY
--
-- Staff (managers, reception, stylists, finishers) see the client's name only.
-- The numbers stay in the database and keep working where they are needed
-- (client sign-in, M-Pesa prompts to the saved number) – they are just not
-- handed out to staff any more, not on screen and not through the database.
--
-- Safe for the live salon: no data changes. Older app versions read the
-- number directly and must be updated (Android 2.3 / reload the website).
-- =====================================================================

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce('owner' = any((current_staff()).roles), false)
$$;

-- ---------- 1. the clients table: contact columns can't be read directly ----------
revoke select on clients from anon, authenticated;
do $$ declare cols text; begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'clients' and column_name not in ('phone', 'whatsapp', 'email');
  execute format('grant select (%s) on clients to anon, authenticated', cols);
end $$;

-- staff may give a NEW client's number, but only the owner changes a saved one
create or replace function clients_guard_contacts() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if api_caller() and is_staff() and not is_owner() and (
       (old.phone is not null and new.phone is distinct from old.phone)
    or (old.whatsapp is not null and new.whatsapp is distinct from old.whatsapp)
    or (old.email is not null and new.email is distinct from old.email)) then
    raise exception 'Only the owner can change a client''s phone number or email';
  end if;
  return new;
end $$;
drop trigger if exists clients_guard_contacts on clients;
create trigger clients_guard_contacts before update on clients for each row execute function clients_guard_contacts();

-- ---------- 2. reading clients: names for staff, contacts for the owner ----------
create or replace function client_row(c clients, p_owner boolean) returns jsonb language sql stable as $$
  select case when p_owner then to_jsonb(c) else to_jsonb(c) - 'phone' - 'whatsapp' - 'email' end
$$;

-- search by name (anyone on staff); by number: the owner any part of it, others only the full number
create or replace function search_clients(p_term text default '', p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare t text := trim(coalesce(p_term, '')); d text := regexp_replace(trim(coalesce(p_term, '')), '\D', '', 'g');
        own boolean := is_owner(); v_full text := mpesa_phone(p_term);
begin
  if api_caller() and not is_staff() then raise exception 'STAFF_SESSION: Please sign in again'; end if;
  return coalesce((select jsonb_agg(client_row(c, own) order by c.name) from (
    select * from clients c
     where t = '' or c.name ilike '%' || t || '%'
        or (own and length(d) >= 3 and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || d || '%')
        or (v_full is not null and (mpesa_phone(c.phone) = v_full or mpesa_phone(c.whatsapp) = v_full))
     order by c.name limit greatest(1, least(coalesce(p_limit, 50), 500))) c), '[]'::jsonb);
end $$;

create or replace function get_client(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if api_caller() and not is_staff() then raise exception 'STAFF_SESSION: Please sign in again'; end if;
  return (select client_row(c, is_owner()) from clients c where c.id = p_id);
end $$;

-- the owner's screens fetch the numbers of the clients they show ({} for everyone else)
create or replace function client_contacts(p_ids jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not is_owner() then return '{}'::jsonb; end if;
  return coalesce((select jsonb_object_agg(id::text, jsonb_build_object('phone', phone, 'whatsapp', whatsapp, 'email', email))
    from clients where id::text in (select jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)))), '{}'::jsonb);
end $$;
revoke execute on function client_row(clients, boolean) from public, anon, authenticated;

-- ---------- 3. views: number only for the owner (views now run with their owner's rights, so they check the caller) ----------
create or replace view v_debts with (security_invoker = false) as
select s.id as sale_id, s.sold_at, s.total, s.paid, s.balance,
       c.id as client_id, c.name as client_name, case when is_owner() then c.phone end as client_phone,
       (current_date - (s.sold_at at time zone 'Africa/Nairobi')::date) as days_owed
from sales s join clients c on c.id = s.client_id
where s.status = 'completed' and s.balance > 0
  and (not api_caller() or (select staff_can(array['sales','reports','dashboard','desk','debts','clients'])));

create or replace view v_refunds_due with (security_invoker = false) as
select b.id as booking_id, b.status, b.scheduled_at, b.response_note, c.name as client_name,
       case when is_owner() then c.phone end as client_phone,
       sum(p.amount) as paid
from bookings b join payments p on p.booking_id = b.id and p.kind = 'deposit'
left join clients c on c.id = b.client_id
where b.status = 'declined' and (not api_caller() or (select is_staff()))
group by b.id, c.name, c.phone;

-- M-Pesa prompts keep the number they were sent to – not readable by staff either
revoke select on mpesa_stk_requests from anon, authenticated;
do $$ declare cols text; begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'mpesa_stk_requests' and column_name <> 'phone';
  execute format('grant select (%s) on mpesa_stk_requests to anon, authenticated', cols);
end $$;

-- ---------- 4. M-Pesa prompt to the client's SAVED number (staff don't need to see it) ----------
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
  if v_phone is null and coalesce(trim(p_phone), '') = '' then
    -- no number typed: use the one saved for this client (a child: her parent's) / student
    select coalesce(mpesa_phone(x.phone), mpesa_phone(x.whatsapp), mpesa_phone(x.parent_phone), mpesa_phone(x.parent_whatsapp)) into v_phone from (
      select c.phone, c.whatsapp, pc.phone as parent_phone, pc.whatsapp as parent_whatsapp
        from bookings b join clients c on c.id = b.client_id left join clients pc on pc.id = c.parent_id
       where p_purpose = 'deposit' and b.id = p_booking_id
      union all
      select c.phone, c.whatsapp, pc.phone, pc.whatsapp
        from sales s join clients c on c.id = s.client_id left join clients pc on pc.id = c.parent_id
       where p_purpose = 'debt' and s.id = p_sale_id
      union all
      select st.phone, null, null, null from students st where p_purpose = 'school_fee' and st.id = p_student_id) x
    limit 1;
    if v_phone is null then raise exception 'No M-Pesa number is saved for this client – type one in'; end if;
  end if;
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
revoke execute on function stk_create(text, text, numeric, uuid, uuid, uuid, boolean) from public, anon, authenticated;

-- the number goes back to the screen only for the owner, the client herself, or whoever typed it
create or replace function stk_test_start(p_purpose text, p_phone text, p_amount numeric,
  p_booking_id uuid default null, p_sale_id uuid default null, p_student_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb; v_checkout text := 'ws_CO_SIM_' || replace(gen_random_uuid()::text, '-', '');
begin
  if not test_mode_on() then raise exception 'M-Pesa prompts go through Safaricom now. Update the app.'; end if;
  r := stk_create(p_purpose, p_phone, p_amount, p_booking_id, p_sale_id, p_student_id, true);
  perform stk_accepted((r->>'id')::uuid, 'SIM', v_checkout);
  return jsonb_build_object('id', r->>'id', 'checkout_request_id', v_checkout,
    'phone', case when coalesce(trim(p_phone), '') <> '' or is_owner() or not is_staff() then r->>'phone' end,
    'amount', (r->>'amount')::numeric, 'simulated', true, 'customer_message', 'Test mode – no money moves');
end $$;

create or replace function stk_status(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r mpesa_stk_requests;
begin
  update mpesa_stk_requests set status = 'timeout', result_desc = 'No answer from the phone', completed_at = now()
   where id = p_id and status = 'pending'
     and created_at < now() - make_interval(secs => setting_num('mpesa_stk_timeout_sec', 120));
  select * into r from mpesa_stk_requests where id = p_id;
  if not found then raise exception 'Payment request not found'; end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'amount', r.amount,
    'phone', case when is_staff() and not is_owner() then null else r.phone end,
    'receipt', r.mpesa_receipt, 'result_desc', r.result_desc, 'needs_attention', r.needs_attention,
    'simulated', r.simulated, 'checkout_request_id', r.checkout_request_id);
end $$;
