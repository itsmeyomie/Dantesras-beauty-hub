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
