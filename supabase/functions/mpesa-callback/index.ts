// Supabase Edge Function: Safaricom calls this after the client answers the STK prompt.
// URL given to Daraja: https://<project>.supabase.co/functions/v1/mpesa-callback?key=<DARAJA_CALLBACK_SECRET>
// Deploy WITHOUT JWT check (Safaricom has no Supabase key):
//   supabase functions deploy mpesa-callback --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

Deno.serve(async (req) => {
  const ok = () => new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), { headers: { 'Content-Type': 'application/json' } });
  const key = new URL(req.url).searchParams.get('key');
  if (!key || key !== Deno.env.get('DARAJA_CALLBACK_SECRET')) return new Response('Forbidden', { status: 403 });

  const body = await req.json().catch(() => null);
  const cb = body?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return ok();

  const items: { Name: string; Value?: string | number }[] = cb.CallbackMetadata?.Item ?? [];
  const get = (n: string) => items.find((i) => i.Name === n)?.Value;

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { error } = await db.rpc('stk_complete', {
    p_checkout_request_id: cb.CheckoutRequestID,
    p_result_code: Number(cb.ResultCode),
    p_result_desc: cb.ResultDesc ?? null,
    p_receipt: (get('MpesaReceiptNumber') as string) ?? null,
    p_amount: get('Amount') !== undefined ? Number(get('Amount')) : null,
    p_phone: get('PhoneNumber') !== undefined ? String(get('PhoneNumber')) : null,
  });
  if (error) console.error('stk_complete failed', cb.CheckoutRequestID, error.message);
  return ok(); // always acknowledge, Safaricom does not retry usefully
});
