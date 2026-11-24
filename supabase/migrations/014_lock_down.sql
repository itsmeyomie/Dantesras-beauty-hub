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
