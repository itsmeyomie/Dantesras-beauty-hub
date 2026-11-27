-- =====================================================================
-- 022 – Home services: who brings the hair · stylist told when added to a
--       client already in the chair · things bought from outside shops
--
-- Safe for the live salon: only adds columns, a table and functions.
-- Sales already recorded never change.
-- =====================================================================

-- ---------- 1. home service: salon brings the hair, or the client has it ----------
-- hair_items: [{product_id, name, qty, price}] – goes on her bill at checkout and comes out of stock
alter table bookings add column if not exists hair_source text;
alter table bookings add column if not exists hair_items jsonb not null default '[]'::jsonb;
do $$ begin
  alter table bookings add constraint bookings_hair_source_chk check (hair_source is null or hair_source in ('salon','client'));
exception when duplicate_object then null; end $$;

-- ---------- 2. tell the stylist also when the client is already in the chair ----------
create or replace function booking_staff_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  select * into b from bookings where id = new.booking_id;
  if b.status not in ('requested', 'pending', 'booked', 'waiting', 'in_progress') then return new; end if;
  perform notify_staff(new.staff_id,
    case when new.part = 'finisher' then 'You finish a client' else 'New client for you' end,
    booking_who(b) || ' · ' || case when b.status = 'in_progress' then 'in the chair now'
                                    else coalesce(salon_time(b.scheduled_at), 'walk-in, now') end
      || case when b.channel = 'home' then ' · home service' || coalesce(': ' || b.address, '') else '' end,
    '/my-day');
  return new;
end $$;

-- ---------- 3. bought from an outside shop (e.g. braids we don't have), shop paid in the evening ----------
create or replace function staff_area_list() returns text[] language sql immutable as $$
  select array['dashboard','desk','my-day','bookings','checkout','sales','clients','debts','services','products','team','school','reports','outside']
$$;
update staff_roles set areas = areas || array['outside']
 where key in ('owner', 'manager') and not ('outside' = any(areas));

create table if not exists outside_buys (
  id          uuid primary key default gen_random_uuid(),
  bought_at   timestamptz not null default now(),
  shop        text not null check (length(trim(shop)) > 0),
  item        text not null check (length(trim(item)) > 0),
  qty         numeric(12,2) not null default 1 check (qty > 0),
  cost        numeric(12,2) not null check (cost >= 0),          -- what we owe the shop (all of it)
  booking_id  uuid references bookings(id) on delete set null,   -- the client it was for
  on_bill     boolean not null default false,                    -- the client pays for it on her bill
  bill_price  numeric(12,2) check (bill_price is null or bill_price >= 0), -- charged to the client (all of it)
  sale_id     uuid references sales(id) on delete set null,      -- the bill it went on
  notes       text,
  recorded_by uuid references staff(id) on delete set null,
  paid_at     timestamptz,
  paid_method text check (paid_method is null or paid_method in ('cash','mpesa')),
  paid_ref    text,
  paid_by     uuid references staff(id) on delete set null,
  check (not on_bill or (booking_id is not null and bill_price is not null))
);
create index if not exists outside_buys_open_idx on outside_buys (bought_at) where paid_at is null;
create index if not exists outside_buys_booking_idx on outside_buys (booking_id);

-- who recorded it / who paid the shop (taken from the signed-in staff member)
create or replace function outside_buys_stamp() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if tg_op = 'INSERT' then
    new.recorded_by := coalesce(my_staff_id(), new.recorded_by);
    new.sale_id := null; new.paid_at := null; new.paid_by := null; new.paid_method := null; new.paid_ref := null;
  else
    if old.sale_id is not null and (new.on_bill is distinct from old.on_bill or new.bill_price is distinct from old.bill_price
                                    or new.booking_id is distinct from old.booking_id) then
      raise exception 'Already on the client''s bill – it cannot be changed';
    end if;
    if coalesce(current_setting('dbh.outside_billing', true), '') <> 'on' then
      new.sale_id := old.sale_id;  -- only checkout links a bill
    end if;
    new.recorded_by := old.recorded_by;
  end if;
  if new.paid_at is not null and new.paid_method is null then raise exception 'Choose how the shop was paid'; end if;
  if new.paid_at is not null and (tg_op = 'INSERT' or old.paid_at is null) then new.paid_by := my_staff_id(); end if;
  if new.paid_at is null then new.paid_by := null; new.paid_method := null; new.paid_ref := null; end if;
  new.paid_ref := upper(nullif(trim(new.paid_ref), ''));
  if not new.on_bill then new.bill_price := null; end if;
  return new;
end $$;
drop trigger if exists outside_buys_stamp on outside_buys;
create trigger outside_buys_stamp before insert or update on outside_buys for each row execute function outside_buys_stamp();

alter table outside_buys enable row level security;
grant select, insert, update, delete on outside_buys to anon, authenticated;
drop policy if exists owner_manager on outside_buys;
create policy owner_manager on outside_buys for all to anon, authenticated
  using ((select staff_can(array['outside']))) with check ((select staff_can(array['outside'])));

-- checkout (any staff who can take payment) sees what goes on this client's bill
create or replace function booking_outside_lines(p_booking uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform require_staff(array['checkout']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'item', o.item, 'shop', o.shop, 'qty', o.qty,
           'bill_price', o.bill_price) order by o.bought_at)
    from outside_buys o where o.booking_id = p_booking and o.on_bill and o.sale_id is null), '[]'::jsonb);
end $$;
revoke execute on function booking_outside_lines(uuid) from public;
grant execute on function booking_outside_lines(uuid) to anon, authenticated;

-- checkout: as in 021, plus outside items on the bill are linked to the sale (so they are never charged twice)
create or replace function checkout(p jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_sale uuid; v_pay jsonb := nullif(p->'pay', 'null'::jsonb);
begin
  perform require_staff(array['checkout']);
  if v_pay is not null and api_caller() and not staff_can(array['team']) then
    raise exception 'Only the owner or a manager can change the pay split';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p->'items', '[]')) i
              join outside_buys o on o.id = nullif(i->>'outside_id', '')::uuid
             where o.sale_id is not null) then
    raise exception 'An outside item is already on another bill';
  end if;
  v_sale := checkout_core(p || jsonb_build_object('entered_by', my_staff_id()));
  if setting_text('pay_rule', 'percent') = 'fee_split' then
    perform apply_fee_split(v_sale, p->'staff', v_pay);
  end if;
  -- outside items: link to this bill; their cost is what the shop charged
  perform set_config('dbh.outside_billing', 'on', true);
  update outside_buys o set sale_id = v_sale
    from jsonb_array_elements(coalesce(p->'items', '[]')) i
   where o.id = nullif(i->>'outside_id', '')::uuid and o.sale_id is null;
  update sale_items si set unit_cost = round(o.cost / o.qty, 2)
    from outside_buys o
   where si.sale_id = v_sale and o.sale_id = v_sale and si.kind = 'product' and si.product_id is null and si.name = o.item;
  perform set_config('dbh.outside_billing', '', true);
  return v_sale;
end $$;
