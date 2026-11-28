-- =====================================================================
-- 025 – Staff pay in AMOUNTS (KSh), seen by the OWNER only;
--       the client is told who will serve her (no money)
--
-- Example: 1,800 → salon fee 200, finisher 200, main stylist 700, owner keeps 700.
--   * each service can have its own amounts (salon fee, finisher, main stylist);
--     a service without a stylist amount falls back to "stylist % of the rest"
--   * at checkout only the owner sees the split and can change it for that job
--   * nobody else can read the pay amounts – not staff, not clients
--     (each person still sees their own pay in My earnings)
--
-- Safe for the live salon: off until the owner picks the rule in Settings;
-- sales already recorded never change.
-- =====================================================================

alter table services add column if not exists stylist_fee numeric(12,2) check (stylist_fee is null or stylist_fee >= 0);

-- ---------- pay amounts: owner only ----------
revoke select on services from anon, authenticated;
do $$ declare cols text; begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'services'
     and column_name not in ('salon_fee', 'finisher_fee', 'stylist_pct', 'stylist_fee');
  execute format('grant select (%s) on services to anon, authenticated', cols);
end $$;

-- only the owner sets them (managers can still edit the menu and prices)
create or replace function services_guard_pay() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if api_caller() and not is_owner() then
    if tg_op = 'INSERT' then
      new.salon_fee := null; new.finisher_fee := null; new.stylist_pct := null; new.stylist_fee := null;
    else
      new.salon_fee := old.salon_fee; new.finisher_fee := old.finisher_fee;
      new.stylist_pct := old.stylist_pct; new.stylist_fee := old.stylist_fee;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists services_guard_pay on services;
create trigger services_guard_pay before insert or update on services for each row execute function services_guard_pay();

-- the owner's screens read them here ({} for everyone else)
create or replace function service_pay() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not is_owner() then return '{}'::jsonb; end if;
  return coalesce((select jsonb_object_agg(id::text, jsonb_build_object('salon_fee', salon_fee, 'finisher_fee', finisher_fee,
           'stylist_fee', stylist_fee, 'stylist_pct', stylist_pct)) from services), '{}'::jsonb);
end $$;

-- pay settings: owner only
drop policy if exists read_all on settings;
create policy read_all on settings for select to anon, authenticated
  using (key not in ('pay_rule', 'salon_fee', 'finisher_fee', 'stylist_balance_pct') or (select is_owner()));

-- the split kept on each sale: owner only
revoke select on sales from anon, authenticated;
do $$ declare cols text; begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'sales' and column_name <> 'pay_split';
  execute format('grant select (%s) on sales to anon, authenticated', cols);
end $$;

-- ---------- the split with amounts ----------
--   p_pay (owner, this job only): {salon_fee, finisher_fee, stylist_amount}  (old apps: stylist_pct)
create or replace function apply_fee_split(p_sale uuid, p_staff jsonb, p_pay jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  d_salon numeric := setting_num('salon_fee', 200);
  d_fin   numeric := setting_num('finisher_fee', 250);
  d_pct   numeric := setting_num('stylist_balance_pct', 50);
  v_factor numeric; v_has_fin boolean;
  v_net numeric := 0; v_salon numeric := 0; v_fin numeric := 0; v_sty numeric := 0;
  v_main_sum numeric; v_fin_sum numeric; v_pct numeric;
  r record; v_out jsonb;
begin
  select case when subtotal > 0 then (subtotal - discount) / subtotal else 0 end into v_factor
    from sales where id = p_sale;

  -- mark the finishers
  update sale_staff ss set part = 'finisher'
    from jsonb_array_elements(coalesce(p_staff, '[]')) s
   where ss.sale_id = p_sale and ss.staff_id = (s->>'staff_id')::uuid and s->>'part' = 'finisher';
  select coalesce(sum(share_pct) filter (where part = 'main'), 0), coalesce(sum(share_pct) filter (where part = 'finisher'), 0)
    into v_main_sum, v_fin_sum from sale_staff where sale_id = p_sale;
  if v_main_sum = 0 then -- only finishers chosen: they did the whole job
    update sale_staff set part = 'main' where sale_id = p_sale;
    v_main_sum := v_fin_sum; v_fin_sum := 0;
  end if;
  v_has_fin := v_fin_sum > 0;

  -- service lines, one by one (each service can have its own amounts)
  for r in
    select si.line_total * v_factor as net, si.qty,
           coalesce(sv.salon_fee, d_salon) as sf, coalesce(sv.finisher_fee, d_fin) as ff,
           sv.stylist_fee as stf, coalesce(sv.stylist_pct, d_pct) as pct
      from sale_items si left join services sv on sv.id = si.service_id
     where si.sale_id = p_sale and si.kind = 'service'
  loop
    declare s numeric; f numeric; t numeric; begin
      s := least(r.sf * r.qty, r.net);
      f := case when v_has_fin then least(r.ff * r.qty, r.net - s) else 0 end;
      t := case when r.stf is not null then least(r.stf * r.qty, r.net - s - f)   -- a set amount
                else (r.net - s - f) * r.pct / 100 end;                            -- or % of the rest
      v_net := v_net + r.net; v_salon := v_salon + s; v_fin := v_fin + f; v_sty := v_sty + t;
    end;
  end loop;

  -- amounts chosen for this job (owner only – checked by the caller)
  if p_pay is not null and p_pay <> 'null'::jsonb then
    v_salon := coalesce(nullif(p_pay->>'salon_fee','')::numeric, v_salon);
    v_fin := case when v_has_fin then coalesce(nullif(p_pay->>'finisher_fee','')::numeric, v_fin) else 0 end;
    if v_salon < 0 or v_fin < 0 then raise exception 'Amounts cannot be negative'; end if;
    if nullif(p_pay->>'stylist_amount','') is not null then
      v_sty := (p_pay->>'stylist_amount')::numeric;
      if v_sty < 0 then raise exception 'Amounts cannot be negative'; end if;
    elsif nullif(p_pay->>'stylist_pct','') is not null then
      v_pct := (p_pay->>'stylist_pct')::numeric;
      if v_pct < 0 or v_pct > 100 then raise exception 'Stylist share must be between 0 and 100%%'; end if;
      v_sty := (v_net - v_salon - v_fin) * v_pct / 100;
    end if;
    if v_salon + v_fin + v_sty > v_net + 0.001 then
      raise exception 'Salon fee, finisher and stylist (KSh %) are more than the services (KSh %)', round(v_salon + v_fin + v_sty, 2), round(v_net, 2);
    end if;
  end if;

  v_sty := round(v_sty, 2); v_fin := round(v_fin, 2); v_salon := round(v_salon, 2); v_net := round(v_net, 2);

  -- replace the commission rows of this sale
  delete from staff_earnings where sale_id = p_sale and kind = 'commission';
  insert into staff_earnings(sale_id, staff_id, kind, amount)
  select p_sale, staff_id, 'commission', round(sum(amt), 2) from (
    select ss.staff_id, si.line_total * v_factor * coalesce(o.pct, si.commission_pct) / 100 * ss.share_pct / 100 as amt
      from sale_items si cross join sale_staff ss
      left join staff_commission_overrides o on o.staff_id = ss.staff_id and o.service_id = si.service_id
     where si.sale_id = p_sale and ss.sale_id = p_sale and si.kind = 'product'
    union all
    select ss.staff_id,
           case when ss.part = 'finisher' then v_fin * ss.share_pct / v_fin_sum
                else v_sty * ss.share_pct / v_main_sum end
      from sale_staff ss where ss.sale_id = p_sale
  ) x
  group by staff_id
  having round(sum(amt), 2) > 0;

  v_out := jsonb_build_object('rule', 'fee_split', 'services', v_net, 'salon_fee', v_salon, 'finisher_fee', v_fin,
    'stylist', v_sty, 'owner_keeps', round(v_net - v_salon - v_fin - v_sty, 2),
    'salon_keeps', round(v_net - v_fin - v_sty, 2), 'chosen', p_pay is not null and p_pay <> 'null'::jsonb);
  update sales set pay_split = v_out where id = p_sale;
  return v_out;
end $$;
revoke execute on function apply_fee_split(uuid, jsonb, jsonb) from public, anon, authenticated;

-- checkout: as in 022, but only the OWNER may change the split for a job
create or replace function checkout(p jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_sale uuid; v_pay jsonb := nullif(p->'pay', 'null'::jsonb);
begin
  perform require_staff(array['checkout']);
  if v_pay is not null and api_caller() and not is_owner() then
    raise exception 'Only the owner can change the pay split';
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

-- ---------- the client is told who will serve her (no money) ----------
create or replace function booking_staff_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare b bookings; v_name text;
begin
  select * into b from bookings where id = new.booking_id;
  if b.status not in ('requested', 'pending', 'booked', 'waiting', 'in_progress') then return new; end if;
  perform notify_staff(new.staff_id,
    case when new.part = 'finisher' then 'You finish a client' else 'New client for you' end,
    booking_who(b) || ' · ' || case when b.status = 'in_progress' then 'in the chair now'
                                    else coalesce(salon_time(b.scheduled_at), 'walk-in, now') end
      || case when b.channel = 'home' then ' · home service' || coalesce(': ' || b.address, '') else '' end,
    '/my-day');
  -- the client: who will do her hair (not when she picked this stylist herself in her request)
  if b.client_id is not null and not (b.status = 'requested' and b.preferred_staff_id is not distinct from new.staff_id) then
    select name into v_name from staff where id = new.staff_id;
    perform notify_client(b.client_id,
      case when new.part = 'finisher' then 'Your finisher' else 'Your stylist' end,
      v_name || case when new.part = 'finisher' then ' will finish your hair' else ' will be your stylist' end
        || case when b.status = 'in_progress' then '' else coalesce(' · ' || salon_time(b.scheduled_at), '') end);
  end if;
  return new;
end $$;
