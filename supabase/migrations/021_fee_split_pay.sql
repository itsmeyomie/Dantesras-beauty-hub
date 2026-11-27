-- =====================================================================
-- 021 – Staff pay rule "salon fee + finisher fee, then split the rest"
--
-- Example: service 1,600 → salon fee 200, finisher 250, balance 1,150
-- split 50/50 → stylist 575, salon 200 + 575 = 775, finisher 250.
--
-- Safe for the live salon:
--   * off until the owner picks it in Settings (setting pay_rule = 'fee_split');
--     until then checkout pays exactly as before (commission %)
--   * only adds columns / functions; sales already recorded never change
-- =====================================================================

-- per-service amounts (blank = use the salon-wide default from Settings)
alter table services add column if not exists salon_fee   numeric(12,2) check (salon_fee is null or salon_fee >= 0);
alter table services add column if not exists finisher_fee numeric(12,2) check (finisher_fee is null or finisher_fee >= 0);
alter table services add column if not exists stylist_pct numeric(5,2) check (stylist_pct is null or stylist_pct between 0 and 100);

-- who was the finisher on a sale, and how the pay was split (kept for the record)
alter table sale_staff add column if not exists part text not null default 'main';
do $$ begin
  alter table sale_staff add constraint sale_staff_part_chk check (part in ('main','finisher'));
exception when duplicate_object then null; end $$;
alter table sales add column if not exists pay_split jsonb;

-- read a text setting
create or replace function setting_text(p_key text, p_default text)
returns text language sql stable as $$
  select coalesce((select value #>> '{}' from settings where key = p_key), p_default)
$$;

-- ---------------------------------------------------------------------
-- Re-work the commission of one sale with the fee-split rule.
--   p_staff: [{staff_id, share_pct, part?}]  (part 'finisher' marks the finisher)
--   p_pay:   null, or {salon_fee, finisher_fee, stylist_pct} chosen for this job
-- Products keep their own commission %. Discount comes off the balance.
-- ---------------------------------------------------------------------
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
           coalesce(sv.salon_fee, d_salon) as sf, coalesce(sv.finisher_fee, d_fin) as ff, coalesce(sv.stylist_pct, d_pct) as pct
      from sale_items si left join services sv on sv.id = si.service_id
     where si.sale_id = p_sale and si.kind = 'service'
  loop
    declare s numeric; f numeric; begin
      s := least(r.sf * r.qty, r.net);
      f := case when v_has_fin then least(r.ff * r.qty, r.net - s) else 0 end;
      v_net := v_net + r.net; v_salon := v_salon + s; v_fin := v_fin + f;
      v_sty := v_sty + (r.net - s - f) * r.pct / 100;
    end;
  end loop;

  -- amounts chosen for this job (owner / manager only – checked by the caller)
  if p_pay is not null and p_pay <> 'null'::jsonb then
    v_salon := coalesce(nullif(p_pay->>'salon_fee','')::numeric, v_salon);
    v_fin := case when v_has_fin then coalesce(nullif(p_pay->>'finisher_fee','')::numeric, v_fin) else 0 end;
    v_pct := coalesce(nullif(p_pay->>'stylist_pct','')::numeric, d_pct);
    if v_salon < 0 or v_fin < 0 then raise exception 'Fees cannot be negative'; end if;
    if v_salon + v_fin > v_net + 0.001 then
      raise exception 'Salon fee and finisher fee (%) are more than the services (%)', v_salon + v_fin, round(v_net, 2);
    end if;
    if v_pct < 0 or v_pct > 100 then raise exception 'Stylist share must be between 0 and 100%%'; end if;
    v_sty := (v_net - v_salon - v_fin) * v_pct / 100;
  end if;

  v_sty := round(v_sty, 2); v_fin := round(v_fin, 2); v_salon := round(v_salon, 2); v_net := round(v_net, 2);

  -- replace the commission rows of this sale
  delete from staff_earnings where sale_id = p_sale and kind = 'commission';
  insert into staff_earnings(sale_id, staff_id, kind, amount)
  select p_sale, staff_id, 'commission', round(sum(amt), 2) from (
    -- products: their own commission %, split by share (as before)
    select ss.staff_id, si.line_total * v_factor * coalesce(o.pct, si.commission_pct) / 100 * ss.share_pct / 100 as amt
      from sale_items si cross join sale_staff ss
      left join staff_commission_overrides o on o.staff_id = ss.staff_id and o.service_id = si.service_id
     where si.sale_id = p_sale and ss.sale_id = p_sale and si.kind = 'product'
    union all
    -- services: the stylist(s) share the stylist's part, the finisher(s) the finisher fee
    select ss.staff_id,
           case when ss.part = 'finisher' then v_fin * ss.share_pct / v_fin_sum
                else v_sty * ss.share_pct / v_main_sum end
      from sale_staff ss where ss.sale_id = p_sale
  ) x
  group by staff_id
  having round(sum(amt), 2) > 0;

  v_out := jsonb_build_object('rule', 'fee_split', 'services', v_net, 'salon_fee', v_salon, 'finisher_fee', v_fin,
    'stylist', v_sty, 'salon_keeps', round(v_net - v_fin - v_sty, 2), 'chosen', p_pay is not null and p_pay <> 'null'::jsonb);
  update sales set pay_split = v_out where id = p_sale;
  return v_out;
end $$;
revoke execute on function apply_fee_split(uuid, jsonb, jsonb) from public, anon, authenticated;

-- checkout: unchanged unless the owner switched the pay rule on
create or replace function checkout(p jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_sale uuid; v_pay jsonb := nullif(p->'pay', 'null'::jsonb);
begin
  perform require_staff(array['checkout']);
  if v_pay is not null and api_caller() and not staff_can(array['team']) then
    raise exception 'Only the owner or a manager can change the pay split';
  end if;
  v_sale := checkout_core(p || jsonb_build_object('entered_by', my_staff_id()));
  if setting_text('pay_rule', 'percent') = 'fee_split' then
    perform apply_fee_split(v_sale, p->'staff', v_pay);
  end if;
  return v_sale;
end $$;
