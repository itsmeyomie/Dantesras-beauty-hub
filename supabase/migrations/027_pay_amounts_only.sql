-- =====================================================================
-- 027 – Staff pay in SHILLINGS only (no percentages)
--
--   * every sale is paid with amounts: salon fee, finisher, main stylist (KSh);
--     the owner keeps the rest – the old "commission %" rule is gone
--   * today's percentages are turned into amounts ONCE so pay stays as it was:
--       service: main stylist = price × its commission %   (e.g. 10% of 1,600 → 160)
--       product: staff get    = price × its commission %   per item sold
--     the owner then changes any amount on the Service menu / Products
--   * a service without an amount uses the default in Settings (KSh)
--   * two stylists on one job share the stylist amount equally, or the owner types
--     each person's amount at checkout (no 50/50 percentages)
--
-- Sales already recorded never change.
-- =====================================================================

alter table products add column if not exists staff_fee numeric(12,2) check (staff_fee is null or staff_fee >= 0);

-- today's percentages → amounts (only where no amount was set yet)
update services set stylist_fee = round(price * commission_pct / 100) where stylist_fee is null;
update products set staff_fee = round(price * commission_pct / 100) where staff_fee is null;

-- amounts are always on; the default for a service without its own amount is in KSh
insert into settings(key, value) values ('pay_rule', '"fee_split"') on conflict (key) do update set value = '"fee_split"';
insert into settings(key, value) values ('stylist_fee', '0') on conflict (key) do nothing;
-- the finisher used to get a share of the commission (nothing on 0% services): start at 0 until the owner sets amounts
insert into settings(key, value) values ('finisher_fee', '0') on conflict (key) do nothing;
drop policy if exists read_all on settings;
create policy read_all on settings for select to anon, authenticated
  using (key not in ('pay_rule', 'salon_fee', 'finisher_fee', 'stylist_balance_pct', 'stylist_fee') or (select is_owner()));

-- ---------- the split, in amounts ----------
--   p_pay (owner, this job only): {salon_fee, people: {staff_id: amount}}   – each person's own amount
--                                 or {salon_fee, finisher_fee, stylist_amount}  – shared equally
create or replace function apply_fee_split(p_sale uuid, p_staff jsonb, p_pay jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  d_salon numeric := setting_num('salon_fee', 200);
  d_fin   numeric := setting_num('finisher_fee', 250);
  d_sty   numeric := setting_num('stylist_fee', 0);
  v_factor numeric; v_has_fin boolean; v_people jsonb;
  v_net numeric := 0; v_salon numeric := 0; v_fin numeric := 0; v_sty numeric := 0;
  v_mains int; v_fins int;
  r record; v_out jsonb;
begin
  select case when subtotal > 0 then (subtotal - discount) / subtotal else 0 end into v_factor
    from sales where id = p_sale;

  -- mark the finishers
  update sale_staff ss set part = 'finisher'
    from jsonb_array_elements(coalesce(p_staff, '[]')) s
   where ss.sale_id = p_sale and ss.staff_id = (s->>'staff_id')::uuid and s->>'part' = 'finisher';
  select count(*) filter (where part = 'main'), count(*) filter (where part = 'finisher')
    into v_mains, v_fins from sale_staff where sale_id = p_sale;
  if v_mains = 0 then -- only finishers chosen: they did the whole job
    update sale_staff set part = 'main' where sale_id = p_sale;
    v_mains := v_fins; v_fins := 0;
  end if;
  v_has_fin := v_fins > 0;

  -- service lines: each service's amounts (or the Settings defaults)
  for r in
    select si.line_total * v_factor as net, si.qty,
           coalesce(sv.salon_fee, d_salon) as sf, coalesce(sv.finisher_fee, d_fin) as ff, coalesce(sv.stylist_fee, d_sty) as stf
      from sale_items si left join services sv on sv.id = si.service_id
     where si.sale_id = p_sale and si.kind = 'service'
  loop
    declare s numeric; f numeric; t numeric; begin
      s := least(r.sf * r.qty, r.net);
      f := case when v_has_fin then least(r.ff * r.qty, r.net - s) else 0 end;
      t := least(r.stf * r.qty, r.net - s - f);
      v_net := v_net + r.net; v_salon := v_salon + s; v_fin := v_fin + f; v_sty := v_sty + t;
    end;
  end loop;

  -- amounts the owner typed for this job
  if p_pay is not null and p_pay <> 'null'::jsonb then
    v_salon := coalesce(nullif(p_pay->>'salon_fee', '')::numeric, v_salon);
    if v_salon < 0 then raise exception 'Amounts cannot be negative'; end if;
    v_people := nullif(p_pay->'people', 'null'::jsonb);
    if v_people is not null then
      if exists (select 1 from jsonb_each_text(v_people) x where x.value::numeric < 0) then raise exception 'Amounts cannot be negative'; end if;
      if exists (select 1 from jsonb_object_keys(v_people) k where not exists (select 1 from sale_staff where sale_id = p_sale and staff_id = k::uuid)) then
        raise exception 'An amount was given for someone not on this job';
      end if;
      select coalesce(sum((v_people->>ss.staff_id::text)::numeric) filter (where ss.part = 'main'), 0),
             coalesce(sum((v_people->>ss.staff_id::text)::numeric) filter (where ss.part = 'finisher'), 0)
        into v_sty, v_fin from sale_staff ss where ss.sale_id = p_sale;
    else
      v_fin := case when v_has_fin then coalesce(nullif(p_pay->>'finisher_fee', '')::numeric, v_fin) else 0 end;
      v_sty := coalesce(nullif(p_pay->>'stylist_amount', '')::numeric, v_sty);
      if v_fin < 0 or v_sty < 0 then raise exception 'Amounts cannot be negative'; end if;
    end if;
    if v_salon + v_fin + v_sty > v_net + 0.001 then
      raise exception 'Salon fee, finisher and stylist (KSh %) are more than the services (KSh %)', round(v_salon + v_fin + v_sty, 2), round(v_net, 2);
    end if;
  end if;

  v_sty := round(v_sty, 2); v_fin := round(v_fin, 2); v_salon := round(v_salon, 2); v_net := round(v_net, 2);

  -- replace the pay rows of this sale
  delete from staff_earnings where sale_id = p_sale and kind = 'commission';
  insert into staff_earnings(sale_id, staff_id, kind, amount)
  select p_sale, staff_id, 'commission', round(sum(amt), 2) from (
    -- products: a set amount per item, shared by everyone on the job
    select ss.staff_id, coalesce(pr.staff_fee, 0) * si.qty / greatest(v_mains + v_fins, 1) as amt
      from sale_items si join products pr on pr.id = si.product_id
      cross join sale_staff ss
     where si.sale_id = p_sale and ss.sale_id = p_sale and si.kind = 'product'
    union all
    -- services: each person's own amount (owner typed) or the amounts shared equally
    select ss.staff_id,
           case when v_people is not null then coalesce((v_people->>ss.staff_id::text)::numeric, 0)
                when ss.part = 'finisher' then v_fin / nullif(v_fins, 0)
                else v_sty / nullif(v_mains, 0) end
      from sale_staff ss where ss.sale_id = p_sale
  ) x
  group by staff_id
  having round(sum(amt), 2) > 0;

  v_out := jsonb_build_object('rule', 'amounts', 'services', v_net, 'salon_fee', v_salon, 'finisher_fee', v_fin,
    'stylist', v_sty, 'owner_keeps', round(v_net - v_salon - v_fin - v_sty, 2),
    'salon_keeps', round(v_net - v_fin - v_sty, 2), 'chosen', p_pay is not null and p_pay <> 'null'::jsonb,
    'people', v_people);
  update sales set pay_split = v_out where id = p_sale;
  return v_out;
end $$;
revoke execute on function apply_fee_split(uuid, jsonb, jsonb) from public, anon, authenticated;

-- checkout: the amounts always apply (owner-only changes, outside items as in 025)
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
  perform apply_fee_split(v_sale, p->'staff', v_pay);
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
