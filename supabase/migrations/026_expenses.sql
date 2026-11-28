-- =====================================================================
-- 026 – Expenses: salon expenses, staff reimbursements, audit trail
--
-- Two separate records, linked by the expense id:
--   * expenses                – money spent on the salon (counts once, when approved)
--   * staff_reimbursements    – what the salon owes a staff member who paid with
--                               their own money (created when that expense is approved)
--   * reimbursement_payments  – each instalment paid back (NEVER a new expense)
--
-- Owner = an owner account. Everyone else on staff (managers too) only submits and
-- sees their own. All reading and writing goes through the functions below; the
-- tables themselves are closed to the app.
--
-- "Bought outside" shops marked paid become approved salon expenses automatically.
-- Safe for the live salon: only adds tables / functions / one trigger.
-- =====================================================================

create table if not exists expense_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) > 0),
  active     boolean not null default true,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into expense_categories(name, sort) values
  ('Utilities', 1), ('Electricity', 2), ('Water', 3), ('Salon Products', 4), ('Stock Purchases', 5),
  ('Transport and Delivery', 6), ('Repairs and Maintenance', 7), ('Rent', 8), ('Salaries and Wages', 9),
  ('Cleaning Supplies', 10), ('Marketing', 11), ('Other Expenses', 12)
on conflict (name) do nothing;

create table if not exists expenses (
  id               uuid primary key default gen_random_uuid(),
  description      text not null check (length(trim(description)) > 0),
  amount           numeric(12,2) not null check (amount > 0),
  category_id      uuid not null references expense_categories(id),
  category_name    text not null,                      -- kept as it was when recorded
  expense_date     date not null,
  notes            text,
  paid_by_staff    uuid references staff(id) on delete set null,
  paid_by_name     text not null,
  payment_source   text not null check (payment_source in ('STAFF_PERSONAL', 'SALON_FUNDS')),
  salon_method     text,                               -- how salon funds paid: cash, mpesa, bank, card, other
  approval_status  text not null default 'PENDING' check (approval_status in ('PENDING', 'APPROVED', 'REJECTED')),
  created_at       timestamptz not null default now(),
  created_by       uuid references staff(id) on delete set null,
  approved_at      timestamptz,
  approved_by      uuid references staff(id) on delete set null,
  approved_by_name text,
  rejection_reason text,
  outside_buy_id   uuid unique references outside_buys(id) on delete set null  -- from "Bought outside"
);
create index if not exists expenses_date_idx on expenses (expense_date desc);
create index if not exists expenses_staff_idx on expenses (paid_by_staff, created_at desc);

create table if not exists staff_reimbursements (
  id           uuid primary key default gen_random_uuid(),
  expense_id   uuid not null unique references expenses(id) on delete restrict,
  staff_id     uuid references staff(id) on delete set null,
  staff_name   text not null,
  amount_owed  numeric(12,2) not null check (amount_owed > 0),
  amount_paid  numeric(12,2) not null default 0 check (amount_paid >= 0),
  status       text not null default 'PENDING' check (status in ('PENDING', 'PARTIALLY_REIMBURSED', 'FULLY_REIMBURSED')),
  last_paid_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (amount_paid <= amount_owed)                     -- never overpaid, never negative
);

create table if not exists reimbursement_payments (
  id               uuid primary key default gen_random_uuid(),
  reimbursement_id uuid not null references staff_reimbursements(id) on delete restrict,
  expense_id       uuid not null references expenses(id) on delete restrict,
  staff_id         uuid references staff(id) on delete set null,
  amount           numeric(12,2) not null check (amount > 0),
  method           text not null check (method in ('cash', 'mpesa', 'bank', 'other')),
  reference        text,
  paid_on          date not null,
  notes            text,
  recorded_by      uuid references staff(id) on delete set null,
  recorded_by_name text,
  request_key      uuid unique,                          -- the same payment sent twice is refused
  created_at       timestamptz not null default now()
);

create table if not exists expense_audit (
  id               uuid primary key default gen_random_uuid(),
  expense_id       uuid references expenses(id) on delete set null,
  reimbursement_id uuid references staff_reimbursements(id) on delete set null,
  action           text not null,
  performed_by     uuid references staff(id) on delete set null,
  performed_by_name text,
  at               timestamptz not null default now(),
  previous_value   jsonb,
  new_value        jsonb,
  notes            text
);

-- closed to the app: only the functions below read and write
alter table expense_categories enable row level security;
alter table expenses enable row level security;
alter table staff_reimbursements enable row level security;
alter table reimbursement_payments enable row level security;
alter table expense_audit enable row level security;
revoke all on expense_categories, expenses, staff_reimbursements, reimbursement_payments, expense_audit from anon, authenticated;

-- payments and the audit trail are permanent
create or replace function expense_no_change() returns trigger language plpgsql as $$
begin raise exception 'Financial records cannot be changed or deleted'; end $$;
drop trigger if exists reimbursement_payments_permanent on reimbursement_payments;
create trigger reimbursement_payments_permanent before update or delete on reimbursement_payments
  for each row execute function expense_no_change();
drop trigger if exists expense_audit_permanent on expense_audit;
create trigger expense_audit_permanent before update or delete on expense_audit
  for each row execute function expense_no_change();
drop trigger if exists expenses_no_delete on expenses;
create trigger expenses_no_delete before delete on expenses for each row execute function expense_no_change();

-- ---------- helpers ----------
create or replace function exp_me() returns staff
language plpgsql stable security definer set search_path = public, extensions as $$
declare s staff := current_staff();
begin
  if s.id is null then raise exception 'STAFF_SESSION: Please sign in again'; end if;
  return s;
end $$;

create or replace function exp_owner() returns staff
language plpgsql stable security definer set search_path = public, extensions as $$
declare s staff := exp_me();
begin
  if not ('owner' = any(s.roles)) then raise exception 'Only the owner can do this'; end if;
  return s;
end $$;

create or replace function exp_log(p_expense uuid, p_reimb uuid, p_action text, p_prev jsonb, p_new jsonb, p_notes text default null)
returns void language sql security definer set search_path = public, extensions as $$
  insert into expense_audit(expense_id, reimbursement_id, action, performed_by, performed_by_name, previous_value, new_value, notes)
  values (p_expense, p_reimb, p_action, (current_staff()).id, (current_staff()).name, p_prev, p_new, p_notes)
$$;

create or replace function exp_notify_owners(p_title text, p_body text) returns void
language sql security definer set search_path = public, extensions as $$
  select notify_staff(s.id, p_title, p_body, '/expenses') from staff s where s.active and 'owner' = any(s.roles)
$$;

-- an expense with its reimbursement and payments, as the screens show it
create or replace function exp_row(e expenses) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select to_jsonb(e) || jsonb_build_object(
    'reimbursement', (select to_jsonb(r) || jsonb_build_object('outstanding', r.amount_owed - r.amount_paid,
        'payments', coalesce((select jsonb_agg(to_jsonb(p) - 'request_key' order by p.created_at) from reimbursement_payments p
                               where p.reimbursement_id = r.id), '[]'::jsonb))
      from staff_reimbursements r where r.expense_id = e.id))
$$;

-- the reimbursement owed for an approved staff-paid expense
create or replace function exp_make_reimbursement(e expenses) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  if e.payment_source <> 'STAFF_PERSONAL' or e.approval_status <> 'APPROVED' then return null; end if;
  insert into staff_reimbursements(expense_id, staff_id, staff_name, amount_owed)
  values (e.id, e.paid_by_staff, e.paid_by_name, e.amount)
  on conflict (expense_id) do nothing
  returning id into v;
  return v;
end $$;

revoke execute on function exp_me(), exp_owner(), exp_log(uuid, uuid, text, jsonb, jsonb, text),
  exp_notify_owners(text, text), exp_row(expenses), exp_make_reimbursement(expenses) from public, anon, authenticated;

-- ---------- categories ----------
create or replace function exp_categories() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare s staff := exp_me(); own boolean := 'owner' = any(s.roles);
begin
  return coalesce((select jsonb_agg(to_jsonb(c) order by c.sort, c.name) from expense_categories c where own or c.active), '[]'::jsonb);
end $$;

create or replace function exp_category_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := exp_owner(); v_id uuid := nullif(p->>'id', '')::uuid; v_name text := trim(coalesce(p->>'name', '')); old expense_categories;
begin
  if v_name = '' then raise exception 'Enter the category name'; end if;
  if v_id is null then
    insert into expense_categories(name, sort) values (v_name, (select coalesce(max(sort), 0) + 1 from expense_categories))
    returning id into v_id;
  else
    select * into old from expense_categories where id = v_id;
    if not found then raise exception 'Category not found'; end if;
    update expense_categories set name = v_name, active = coalesce((p->>'active')::boolean, active), updated_at = now() where id = v_id;
  end if;
  return v_id;
exception when unique_violation then raise exception 'There is already a category called %', v_name;
end $$;

-- ---------- staff: submit (paid with their own money) ----------
create or replace function exp_submit(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := exp_me(); c expense_categories; e expenses;
  v_amount numeric := round(coalesce(nullif(p->>'amount', '')::numeric, 0), 2);
  v_date date := nullif(p->>'expense_date', '')::date;
begin
  if trim(coalesce(p->>'description', '')) = '' then raise exception 'Enter what the money was spent on'; end if;
  if v_amount <= 0 then raise exception 'Enter an amount above 0'; end if;
  if v_amount > 10000000 then raise exception 'That amount is too large'; end if;
  if v_date is null then raise exception 'Enter the date of the expense'; end if;
  if v_date > (now() at time zone 'Africa/Nairobi')::date then raise exception 'The date cannot be in the future'; end if;
  select * into c from expense_categories where id = nullif(p->>'category_id', '')::uuid and active;
  if not found then raise exception 'Choose a category'; end if;

  insert into expenses(description, amount, category_id, category_name, expense_date, notes, paid_by_staff, paid_by_name,
                       payment_source, approval_status, created_by)
  values (trim(p->>'description'), v_amount, c.id, c.name, v_date, nullif(trim(p->>'notes'), ''), s.id, s.name,
          'STAFF_PERSONAL', 'PENDING', s.id)
  returning * into e;
  perform exp_log(e.id, null, 'EXPENSE_CREATED', null, to_jsonb(e));
  perform exp_notify_owners('Expense to approve', s.name || ' paid KSh ' || to_char(v_amount, 'FM999,999,990.##') || ' – ' || e.description);
  return exp_row(e);
end $$;

-- staff: their own expenses, what they are owed and what they have been paid
create or replace function exp_mine() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare s staff := exp_me();
begin
  return jsonb_build_object(
    'expenses', coalesce((select jsonb_agg(exp_row(e) order by e.created_at desc) from expenses e where e.paid_by_staff = s.id), '[]'::jsonb),
    'summary', (select jsonb_build_object(
        'submitted', coalesce(sum(e.amount), 0),
        'pending', coalesce(sum(e.amount) filter (where e.approval_status = 'PENDING'), 0),
        'approved', coalesce(sum(e.amount) filter (where e.approval_status = 'APPROVED'), 0),
        'rejected', coalesce(sum(e.amount) filter (where e.approval_status = 'REJECTED'), 0),
        'owed', coalesce((select sum(r.amount_owed) from staff_reimbursements r where r.staff_id = s.id), 0),
        'reimbursed', coalesce((select sum(r.amount_paid) from staff_reimbursements r where r.staff_id = s.id), 0),
        'outstanding', coalesce((select sum(r.amount_owed - r.amount_paid) from staff_reimbursements r where r.staff_id = s.id), 0))
      from expenses e where e.paid_by_staff = s.id));
end $$;

-- ---------- owner ----------
-- add directly: paid from salon funds (approved) – or for a staff member who paid with their own money
create or replace function exp_add(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := exp_owner(); c expense_categories; e expenses; payer staff; v_reimb uuid;
  v_amount numeric := round(coalesce(nullif(p->>'amount', '')::numeric, 0), 2);
  v_date date := nullif(p->>'expense_date', '')::date;
  v_source text := coalesce(nullif(p->>'payment_source', ''), 'SALON_FUNDS');
begin
  if trim(coalesce(p->>'description', '')) = '' then raise exception 'Enter what the money was spent on'; end if;
  if v_amount <= 0 then raise exception 'Enter an amount above 0'; end if;
  if v_date is null then raise exception 'Enter the date of the expense'; end if;
  if v_source not in ('SALON_FUNDS', 'STAFF_PERSONAL') then raise exception 'Choose who paid'; end if;
  select * into c from expense_categories where id = nullif(p->>'category_id', '')::uuid;
  if not found then raise exception 'Choose a category'; end if;
  select * into payer from staff where id = coalesce(nullif(p->>'paid_by_staff', '')::uuid, s.id);
  if not found then raise exception 'Choose who paid'; end if;
  if v_source = 'STAFF_PERSONAL' and payer.id = s.id then raise exception 'Choose the staff member who paid with their own money'; end if;

  insert into expenses(description, amount, category_id, category_name, expense_date, notes, paid_by_staff, paid_by_name,
                       payment_source, salon_method, approval_status, created_by, approved_at, approved_by, approved_by_name)
  values (trim(p->>'description'), v_amount, c.id, c.name, v_date, nullif(trim(p->>'notes'), ''), payer.id, payer.name,
          v_source, case when v_source = 'SALON_FUNDS' then coalesce(nullif(p->>'salon_method', ''), 'cash') end,
          'APPROVED', s.id, now(), s.id, s.name)
  returning * into e;
  perform exp_log(e.id, null, 'EXPENSE_CREATED', null, to_jsonb(e), 'Recorded by the owner');
  v_reimb := exp_make_reimbursement(e);
  if v_reimb is not null then
    perform exp_log(e.id, v_reimb, 'REIMBURSEMENT_OWED', null, jsonb_build_object('amount_owed', e.amount));
    perform notify_staff(payer.id, 'Expense recorded', 'The salon owes you KSh ' || to_char(v_amount, 'FM999,999,990.##') || ' for ' || e.description, '/expenses');
  end if;
  return exp_row(e);
end $$;

-- everything, for the owner's dashboard, tables and reports
create or replace function exp_all() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare s staff := exp_owner();
begin
  return jsonb_build_object(
    'expenses', coalesce((select jsonb_agg(exp_row(e) order by e.expense_date desc, e.created_at desc) from expenses e), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) - 'request_key' order by p.created_at desc) from reimbursement_payments p), '[]'::jsonb));
end $$;

create or replace function exp_audit(p_expense uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare s staff := exp_owner();
begin
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.at) from expense_audit a where a.expense_id = p_expense), '[]'::jsonb);
end $$;

-- approve / reject a staff submission
create or replace function exp_decide(p_id uuid, p_approve boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := exp_owner(); e expenses; old expenses; v_reimb uuid;
begin
  select * into e from expenses where id = p_id for update;
  if not found then raise exception 'Expense not found'; end if;
  if e.approval_status <> 'PENDING' then raise exception 'This expense was already %', lower(e.approval_status); end if;
  if e.paid_by_staff = s.id then raise exception 'You cannot approve your own expense'; end if;
  old := e;
  if p_approve then
    update expenses set approval_status = 'APPROVED', approved_at = now(), approved_by = s.id, approved_by_name = s.name
     where id = p_id returning * into e;
    perform exp_log(e.id, null, 'EXPENSE_APPROVED', jsonb_build_object('approval_status', old.approval_status), jsonb_build_object('approval_status', e.approval_status));
    v_reimb := exp_make_reimbursement(e);
    if v_reimb is not null then
      perform exp_log(e.id, v_reimb, 'REIMBURSEMENT_OWED', null, jsonb_build_object('amount_owed', e.amount));
    end if;
    perform notify_staff(e.paid_by_staff, 'Expense approved',
      e.description || ' · KSh ' || to_char(e.amount, 'FM999,999,990.##') || ' – the salon owes you this', '/expenses');
  else
    if trim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason for rejecting'; end if;
    update expenses set approval_status = 'REJECTED', rejection_reason = trim(p_reason), approved_at = now(), approved_by = s.id, approved_by_name = s.name
     where id = p_id returning * into e;
    perform exp_log(e.id, null, 'EXPENSE_REJECTED', jsonb_build_object('approval_status', old.approval_status),
      jsonb_build_object('approval_status', e.approval_status, 'rejection_reason', e.rejection_reason));
    perform notify_staff(e.paid_by_staff, 'Expense rejected', e.description || ': ' || trim(p_reason), '/expenses');
  end if;
  return exp_row(e);
end $$;

-- edit details (amount only while nothing has been paid back)
create or replace function exp_edit(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := exp_owner(); e expenses; old expenses; c expense_categories; r staff_reimbursements;
  v_amount numeric := round(coalesce(nullif(p->>'amount', '')::numeric, 0), 2);
begin
  select * into e from expenses where id = nullif(p->>'id', '')::uuid for update;
  if not found then raise exception 'Expense not found'; end if;
  if e.outside_buy_id is not null then raise exception 'This comes from Bought outside – change it there'; end if;
  old := e;
  select * into c from expense_categories where id = coalesce(nullif(p->>'category_id', '')::uuid, e.category_id);
  if not found then raise exception 'Choose a category'; end if;
  if trim(coalesce(p->>'description', '')) = '' then raise exception 'Enter what the money was spent on'; end if;
  if v_amount <= 0 then raise exception 'Enter an amount above 0'; end if;
  select * into r from staff_reimbursements where expense_id = e.id for update;
  if v_amount <> e.amount and r.id is not null and r.amount_paid > 0 then
    raise exception 'Part of this was already paid back – the amount cannot change';
  end if;
  update expenses set description = trim(p->>'description'), amount = v_amount, category_id = c.id,
         category_name = case when c.id = e.category_id then e.category_name else c.name end,
         expense_date = coalesce(nullif(p->>'expense_date', '')::date, e.expense_date), notes = nullif(trim(p->>'notes'), '')
   where id = e.id returning * into e;
  if r.id is not null and v_amount <> old.amount then
    update staff_reimbursements set amount_owed = v_amount, updated_at = now() where id = r.id;
  end if;
  perform exp_log(e.id, r.id, 'EXPENSE_EDITED',
    jsonb_build_object('description', old.description, 'amount', old.amount, 'category', old.category_name, 'expense_date', old.expense_date, 'notes', old.notes),
    jsonb_build_object('description', e.description, 'amount', e.amount, 'category', e.category_name, 'expense_date', e.expense_date, 'notes', e.notes));
  return exp_row(e);
end $$;

-- pay a staff member back (all or part); one row per instalment, never a new expense
create or replace function exp_reimburse(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := exp_owner(); r staff_reimbursements; e expenses; pay reimbursement_payments;
  v_amount numeric := round(coalesce(nullif(p->>'amount', '')::numeric, 0), 2);
  v_out numeric; v_key uuid := nullif(p->>'request_key', '')::uuid; v_status text;
begin
  if v_key is not null and exists (select 1 from reimbursement_payments where request_key = v_key) then
    raise exception 'This payment was already recorded';
  end if;
  select * into r from staff_reimbursements where id = nullif(p->>'reimbursement_id', '')::uuid for update;  -- one payment at a time
  if not found then raise exception 'Reimbursement not found'; end if;
  v_out := r.amount_owed - r.amount_paid;
  if r.status = 'FULLY_REIMBURSED' or v_out <= 0 then raise exception 'This has already been paid back in full'; end if;
  if v_amount <= 0 then raise exception 'Enter an amount above 0'; end if;
  if v_amount > v_out then raise exception 'That is more than what is still owed (KSh %)', to_char(v_out, 'FM999,999,990.##'); end if;
  if coalesce(p->>'method', '') not in ('cash', 'mpesa', 'bank', 'other') then raise exception 'Choose how it was paid'; end if;

  insert into reimbursement_payments(reimbursement_id, expense_id, staff_id, amount, method, reference, paid_on, notes,
                                     recorded_by, recorded_by_name, request_key)
  values (r.id, r.expense_id, r.staff_id, v_amount, p->>'method', upper(nullif(trim(p->>'reference'), '')),
          coalesce(nullif(p->>'paid_on', '')::date, (now() at time zone 'Africa/Nairobi')::date), nullif(trim(p->>'notes'), ''),
          s.id, s.name, v_key)
  returning * into pay;
  v_status := case when r.amount_paid + v_amount >= r.amount_owed then 'FULLY_REIMBURSED' else 'PARTIALLY_REIMBURSED' end;
  update staff_reimbursements set amount_paid = amount_paid + v_amount, status = v_status, last_paid_at = now(), updated_at = now()
   where id = r.id;
  perform exp_log(r.expense_id, r.id, case when v_status = 'FULLY_REIMBURSED' then 'FULL_REIMBURSEMENT' else 'PARTIAL_REIMBURSEMENT' end,
    jsonb_build_object('amount_paid', r.amount_paid, 'status', r.status),
    jsonb_build_object('amount_paid', r.amount_paid + v_amount, 'status', v_status, 'payment', v_amount, 'payment_id', pay.id));
  select * into e from expenses where id = r.expense_id;
  perform notify_staff(r.staff_id,
    case when v_status = 'FULLY_REIMBURSED' then 'Paid back in full' else 'Part payment received' end,
    'KSh ' || to_char(v_amount, 'FM999,999,990.##') || ' for ' || e.description
      || case when v_status = 'FULLY_REIMBURSED' then '' else ' · still owed KSh ' || to_char(v_out - v_amount, 'FM999,999,990.##') end,
    '/expenses');
  return exp_row(e);
end $$;

grant execute on function exp_categories(), exp_category_save(jsonb), exp_submit(jsonb), exp_mine(), exp_add(jsonb), exp_all(),
  exp_audit(uuid), exp_decide(uuid, boolean, text), exp_edit(jsonb), exp_reimburse(jsonb) to anon, authenticated;

-- ---------- "Bought outside": a shop marked paid is a salon expense ----------
create or replace function outside_buy_expense() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare c expense_categories; e expenses; v_payer staff;
begin
  if new.paid_at is not null and new.cost > 0 and (tg_op = 'INSERT' or old.paid_at is null) then
    select * into c from expense_categories where name = 'Salon Products';
    if not found then select * into c from expense_categories order by sort limit 1; end if;
    select * into v_payer from staff where id = new.paid_by;
    insert into expenses(description, amount, category_id, category_name, expense_date, notes, paid_by_staff, paid_by_name,
                         payment_source, salon_method, approval_status, created_by, approved_at, approved_by, approved_by_name, outside_buy_id)
    values ('Bought outside: ' || new.item || case when new.qty <> 1 then ' × ' || new.qty::text else '' end || ' (' || new.shop || ')',
            new.cost, c.id, c.name, (new.paid_at at time zone 'Africa/Nairobi')::date, new.notes, v_payer.id, coalesce(v_payer.name, 'Salon'),
            'SALON_FUNDS', new.paid_method, 'APPROVED', new.paid_by, now(), new.paid_by, v_payer.name, new.id)
    on conflict (outside_buy_id) do update set approval_status = 'APPROVED', rejection_reason = null, amount = excluded.amount
    returning * into e;
    perform exp_log(e.id, null, 'EXPENSE_CREATED', null, to_jsonb(e), 'From Bought outside');
  elsif tg_op = 'UPDATE' and new.paid_at is null and old.paid_at is not null then
    update expenses set approval_status = 'REJECTED', rejection_reason = 'Shop payment undone in Bought outside'
     where outside_buy_id = new.id returning * into e;
    if e.id is not null then perform exp_log(e.id, null, 'EXPENSE_REJECTED', null, to_jsonb(e), 'Shop payment undone'); end if;
  end if;
  return new;
end $$;
drop trigger if exists outside_buy_expense on outside_buys;
create trigger outside_buy_expense after insert or update of paid_at on outside_buys
  for each row execute function outside_buy_expense();

-- shops already paid before this update
insert into expenses(description, amount, category_id, category_name, expense_date, notes, paid_by_staff, paid_by_name,
                     payment_source, salon_method, approval_status, created_by, approved_at, approved_by, approved_by_name, outside_buy_id)
select 'Bought outside: ' || o.item || case when o.qty <> 1 then ' × ' || o.qty::text else '' end || ' (' || o.shop || ')',
       o.cost, c.id, c.name, (o.paid_at at time zone 'Africa/Nairobi')::date, o.notes, o.paid_by, coalesce(st.name, 'Salon'),
       'SALON_FUNDS', o.paid_method, 'APPROVED', o.paid_by, o.paid_at, o.paid_by, st.name, o.id
  from outside_buys o
  cross join lateral (select * from expense_categories where name = 'Salon Products') c
  left join staff st on st.id = o.paid_by
 where o.paid_at is not null and o.cost > 0
on conflict (outside_buy_id) do nothing;

-- the Expenses screen is open to every staff member (each sees only their own unless owner)
create or replace function staff_area_list() returns text[] language sql immutable as $$
  select array['dashboard','desk','my-day','bookings','checkout','sales','clients','debts','services','products','team','school','reports','outside','expenses']
$$;
